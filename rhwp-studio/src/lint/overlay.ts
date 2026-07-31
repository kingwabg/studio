/**
 * 인라인 검사 — 맞춤법·서식 위반을 **캔버스 위 밑줄로 바로** 보여주고, 눌러서 고친다.
 * 스펙: studio `docs/plans/format-linter.md`
 *
 * 왜 만들었나: 검사기 자체는 이미 있었다(`ui/spell-dialog.ts` — 규칙·검사·교정 전부).
 * 빠진 건 "대화상자를 열어야 보인다"는 것뿐이었다. 그래서 이 파일은 **표시와 조작**만
 * 맡고, 규칙·검사는 lint/items.ts(맞춤법+서식 합류)가 준다.
 *
 * ⚠ 조판을 건드리지 않는다 — 페이지 렌더 파이프라인 밖의 별도 레이어에 그린다.
 * (렌더에 손대면 조판 회귀가 나는 게 이 저장소의 반복 함정)
 * 좌표 변환은 TrackOverlay(engine/track-review.ts)와 같은 방식:
 * getSelectionRects → 쪽 좌표 → virtualScroll 로 화면 좌표.
 */
import { scanAll, itemKey, type LintItem } from './items';
import { LintPanel } from './panel';
import { loadSpecs, pickDefault, type NamedSpec } from './spec-source';
import { prefetchDictionary } from './dict';
import { DEFAULT_SPEC, type FormatSpec } from './format-rules';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { VirtualScroll } from '@/view/virtual-scroll';
import type { EventBus } from '@/core/event-bus';

/** 타이핑이 멈춘 것으로 보는 시간 — 이보다 짧으면 글자마다 검사가 돌아 산만하다. */
const IDLE_MS = 400;

interface LintHost {
  wasm: WasmBridge;
  getZoom(): number;
  /** 고침 하나를 적용한다 — 한 번의 되돌리기로 되돌아간다 */
  applyFix(it: LintItem): void;
  /** 여러 고침을 **한 번의 되돌리기**로 묶어 적용한다 */
  applyBatch(items: LintItem[]): void;
}

export class LintOverlay {
  private layer: HTMLDivElement;
  private card: HTMLDivElement | null = null;
  private items: LintItem[] = [];
  private ignored = new Set<string>();
  private timer: number | null = null;
  private enabled = true;
  /** 서식 규정 검사 — 기본 꺼짐(실제 문서에서 수백 건이 뜬다, 근거는 items.ts) */
  private formatOn = false;
  /** 센터가 만든 규격 목록(호스트 sc- 에서 받는다) */
  private specs: NamedSpec[] = [];
  private activeSpecId = 'builtin';
  private spec: FormatSpec = DEFAULT_SPEC;
  private panel: LintPanel;
  /** 검사 결과가 갱신될 때마다 부르는 훅 — 우측 패널 견본이 '수정본'을 그린다 */
  onItems: ((items: LintItem[]) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
    private host: LintHost,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'lint-layer';
    // 레이어 자체는 통과시키고 밑줄만 받는다 — 본문 클릭/드래그를 가로채면 안 된다.
    this.layer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:8;';
    this.panel = new LintPanel(container, {
      onApplyAll: () => this.applyAll(),
      onPick: (it) => this.focusItem(it),
      onToggleFormat: (on) => { this.formatOn = on; this.scan(); },
      isFormatOn: () => this.formatOn,
      specs: () => this.specs,
      activeSpecId: () => this.activeSpecId,
      onPickSpec: (id) => this.useSpec(id),
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.items = []; this.closeCard(); this.paint(); this.panel.render([]); }
    else this.scheduleScan(0);
  }

  isEnabled(): boolean { return this.enabled; }

  /** 문서가 바뀌었다 — 타이핑이 멈추면 다시 훑는다(디바운스). */
  scheduleScan(delay = IDLE_MS): void {
    if (!this.enabled) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.scan(); }, delay);
  }

  /**
   * 문서가 새로 열렸을 수 있다 — 아직 예약이 없을 때만 건다.
   * 여기서도 예약을 리셋하면(command-state-changed 는 자주 온다) 검사가 영영 밀린다.
   * ⚠ 문서 로드 완료 신호가 따로 없어 command-state-changed 를 쓴다(우측 패널과 같은 관례).
   */
  armScan(): void {
    if (this.timer === null) this.scheduleScan();
  }

  /** 지금 바로 훑는다(검사 시각 측정·테스트용). 반환값 = 걸린 ms */
  scan(): number {
    if (!this.enabled) return 0;
    const t0 = performance.now();
    try {
      this.items = scanAll(this.host.wasm as never, this.formatOn, this.spec)
        .filter((it) => !this.ignored.has(itemKey(it)));
    } catch {
      this.items = [];
    }
    this.paint();
    this.panel.render(this.items);
    // 우측 패널 견본이 '수정본'을 그릴 수 있게 알린다(오버레이가 UI 를 직접 알 필요는 없다)
    this.onItems?.(this.items);
    return performance.now() - t0;
  }

  /** 좌표만 다시 계산한다 — 줌·스크롤·레이아웃 변경(문서는 그대로) */
  paint(): void {
    this.ensureAttached();
    this.layer.innerHTML = '';
    this.card = null;
    if (!this.enabled || this.items.length === 0) return;
    const scrollContent = this.container.querySelector('#scroll-content') as HTMLElement | null;
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const zoom = this.host.getZoom();

    for (const it of this.items) {
      for (const r of this.rectsOf(it)) {
        if (r.width <= 0) continue;
        const el = document.createElement('div');
        el.className = `lint-mark lint-mark--${it.kind}`;
        el.title = it.detail ? `${it.msg} (${it.detail})` : it.msg;
        const left = this.virtualScroll.getPageLeftResolved(r.pageIndex, contentWidth) + r.x * zoom;
        const top = this.virtualScroll.getPageOffset(r.pageIndex) + r.y * zoom;
        el.style.cssText =
          `position:absolute;left:${left}px;top:${top}px;` +
          `width:${r.width * zoom}px;height:${r.height * zoom}px;pointer-events:auto;cursor:pointer;`;
        el.addEventListener('mousedown', (e) => {
          // 본문 커서 이동을 막고 카드를 연다 — 밑줄은 '읽는 것'이 아니라 '누르는 것'이다.
          e.preventDefault();
          e.stopPropagation();
          this.openCard(it, left, top + r.height * zoom);
        });
        this.layer.appendChild(el);
      }
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.closeCard();
    this.panel.dispose();
    this.layer.remove();
  }

  /** 남은 지적 수 — 상태 표시·테스트용 */
  count(): number { return this.items.length; }

  /** 서식 규정 검사 on/off (도구 리본 · 패널 체크박스 · 테스트) */
  setFormatChecks(on: boolean): void { this.formatOn = on; this.scan(); }
  isFormatChecks(): boolean { return this.formatOn; }

  /**
   * 센터 규격 목록을 받아온다. 실패해도 내장 기본값으로 계속 돈다(spec-source.ts).
   * 규격을 못 받았다고 검사가 멈추면 안 된다.
   */
  async loadCenterSpecs(): Promise<void> {
    this.specs = await loadSpecs();
    const chosen = pickDefault(this.specs);
    this.activeSpecId = chosen.id;
    this.spec = chosen.spec;
    if (this.formatOn) this.scan(); else this.panel.render(this.items);
  }

  /** 쓸 규격을 바꾼다 — 고르는 즉시 다시 검사한다(안 그러면 바꾼 게 안 보인다). */
  useSpec(id: string): void {
    const found = this.specs.find((s) => s.id === id);
    if (!found) return;
    this.activeSpecId = id;
    this.spec = found.spec;
    this.scan();
  }

  /**
   * 고칠 수 있는 것을 전부 적용한다 — **되돌리기 한 번**으로 통째로 복구된다.
   * (건마다 기록하면 20건 고친 뒤 되돌리려면 Ctrl+Z 를 20번 눌러야 한다)
   * 뒤에서부터 고쳐야 글자 치환으로 앞 항목의 오프셋이 밀리지 않는다.
   */
  applyAll(): void {
    this.host.applyBatch(this.items.filter((x) => x.fix).reverse());
    this.closeCard();
    this.scheduleScan(0);
  }

  /** 한 문단의 고침을 한 번에 적용한다 — 견본의 [고치기] 버튼이 쓴다(되돌리기 1회). */
  applyParagraph(sectionIndex: number, paragraphIndex: number): void {
    const target = this.items.filter(
      (it) => it.fix && !it.cell
        && it.sectionIndex === sectionIndex && it.paragraphIndex === paragraphIndex);
    if (target.length === 0) return;
    // 뒤에서부터 — 글자 치환은 길이를 바꿔 앞 항목의 오프셋을 민다.
    this.host.applyBatch(target.reverse());
    this.closeCard();
    this.scheduleScan(0);
  }

  private rectsOf(it: LintItem): Array<{ pageIndex: number; x: number; y: number; width: number; height: number }> {
    try {
      const w = this.host.wasm;
      return it.cell
        ? w.getSelectionRectsInCell(it.sectionIndex, it.cell.ppi, it.cell.ci, it.cell.cei,
            it.cell.cpi, it.charOffset, it.cell.cpi, it.charOffset + it.length)
        : w.getSelectionRects(it.sectionIndex, it.paragraphIndex, it.charOffset,
            it.paragraphIndex, it.charOffset + it.length);
    } catch {
      return [];
    }
  }

  /** 목록에서 항목을 고르면 그 자리로 스크롤하고 카드를 연다 */
  private focusItem(it: LintItem): void {
    const r = this.rectsOf(it)[0];
    if (!r) return;
    const scrollContent = this.container.querySelector('#scroll-content') as HTMLElement | null;
    const zoom = this.host.getZoom();
    const left = this.virtualScroll.getPageLeftResolved(r.pageIndex, scrollContent?.clientWidth ?? 0) + r.x * zoom;
    const top = this.virtualScroll.getPageOffset(r.pageIndex) + r.y * zoom;
    this.container.querySelector('#scroll-container')?.scrollTo({ top: Math.max(0, top - 160), behavior: 'smooth' });
    this.openCard(it, left, top + r.height * zoom);
  }

  private ensureAttached(): void {
    if (this.layer.parentElement) return;
    this.container.querySelector('#scroll-content')?.appendChild(this.layer);
  }

  private closeCard(): void {
    this.card?.remove();
    this.card = null;
  }

  /** 밑줄을 누르면 뜨는 교정 카드 — "이렇게 고칠까요?" */
  private openCard(it: LintItem, left: number, top: number): void {
    this.closeCard();
    const card = document.createElement('div');
    card.className = 'lint-card';
    card.style.cssText = `position:absolute;left:${left}px;top:${top + 4}px;pointer-events:auto;`;

    const msg = document.createElement('div');
    msg.className = 'lint-card-msg';
    msg.textContent = it.msg;
    card.appendChild(msg);

    if (it.detail) {
      const [from, to] = it.detail.split(' → ');
      const diff = document.createElement('div');
      diff.className = 'lint-card-diff';
      const a = document.createElement('span');
      a.className = 'lint-card-from';
      a.textContent = from;
      const b = document.createElement('span');
      b.className = 'lint-card-to';
      b.textContent = to ?? '';
      diff.append(a, document.createTextNode(' → '), b);
      card.appendChild(diff);
    }

    const row = document.createElement('div');
    row.className = 'lint-card-row';
    if (it.fix) {
      row.appendChild(mkBtn('적용', 'is-primary', () => {
        this.host.applyFix(it);
        this.closeCard();
        this.scheduleScan(0);
      }));
    }
    row.appendChild(mkBtn('무시', '', () => this.ignore(it)));
    card.appendChild(row);

    this.layer.appendChild(card);
    this.card = card;
  }

  private ignore(it: LintItem): void {
    this.ignored.add(itemKey(it));
    this.items = this.items.filter((x) => itemKey(x) !== itemKey(it));
    this.closeCard();
    this.paint();
    this.panel.render(this.items);
  }
}

function mkBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `lint-card-btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

/** 고침 한 건을 wasm 에 직접 적용한다(일괄 적용의 스냅샷 안에서 쓴다). */
function applyOne(wasm: WasmBridge, it: LintItem): void {
  if (!it.fix) return;
  if ('text' in it.fix) {
    wasm.replaceText(it.sectionIndex, it.paragraphIndex, it.charOffset, it.length, it.fix.text);
    return;
  }
  const json = JSON.stringify(it.fix.props);
  if (it.cell) {
    wasm.applyCharFormatInCell(it.sectionIndex, it.cell.ppi, it.cell.ci, it.cell.cei,
      it.cell.cpi, it.charOffset, it.charOffset + it.length, json);
  } else {
    wasm.applyCharFormat(it.sectionIndex, it.paragraphIndex, it.charOffset,
      it.charOffset + it.length, json);
  }
}

interface IhLike {
  wasm: WasmBridge;
  executeOperation(d: unknown): unknown;
  applyCharPropsToRange(start: unknown, end: unknown, props: unknown): void;
  viewportManager: { getZoom(): number };
}

/**
 * 배선 한 곳 — main.ts 에서 한 줄로 부른다.
 * 문서 변경은 디바운스 재검사, 줌·스크롤은 좌표만 다시 계산(재검사 없음).
 */
export function attachLinter(
  container: HTMLElement,
  eventBus: EventBus,
  virtualScroll: VirtualScroll,
  getIh: () => IhLike | null,
): LintOverlay {
  const host: LintHost = {
    get wasm() { return getIh()!.wasm; },
    getZoom: () => getIh()?.viewportManager.getZoom() ?? 1,
    applyFix: (it) => {
      const ih = getIh();
      if (!ih || !it.fix) return;
      if ('text' in it.fix) {
        // 기존 맞춤법 대화상자와 **같은 경로** — 스냅샷 1회라 되돌리기 한 번에 복구된다.
        ih.executeOperation({
          kind: 'snapshot',
          operationType: 'lintFix',
          operation: (wasm: WasmBridge) => {
            wasm.replaceText(it.sectionIndex, it.paragraphIndex, it.charOffset, it.length,
              (it.fix as { text: string }).text);
            return null;
          },
        });
        eventBus.emit('document-changed');
        return;
      }
      // 서식 고침 — ApplyCharFormatCommand 가 셀 좌표까지 다루므로 그대로 태운다(undo 포함).
      const pos = (off: number) => it.cell
        ? { sectionIndex: it.sectionIndex, parentParaIndex: it.cell.ppi, controlIndex: it.cell.ci,
            cellIndex: it.cell.cei, cellParaIndex: it.cell.cpi, paragraphIndex: it.cell.cpi, charOffset: off }
        : { sectionIndex: it.sectionIndex, paragraphIndex: it.paragraphIndex, charOffset: off };
      ih.applyCharPropsToRange(pos(it.charOffset), pos(it.charOffset + it.length), it.fix.props);
      eventBus.emit('document-changed');
    },
    applyBatch: (items) => {
      const ih = getIh();
      if (!ih || items.length === 0) return;
      // 스냅샷 하나에 전부 담는다 — 되돌리기 한 번이면 적용 전 문서로 통째로 돌아간다.
      ih.executeOperation({
        kind: 'snapshot',
        operationType: 'lintFixAll',
        operation: (wasm: WasmBridge) => {
          for (const it of items) applyOne(wasm, it);
          return null;
        },
      });
      eventBus.emit('document-changed');
    },
  };
  const overlay = new LintOverlay(container, virtualScroll, host);
  void overlay.loadCenterSpecs();
  // 편집기가 떴으니 문서를 쓸 사람이 확실하다 — 한가할 때 사전을 미리 받아 둔다.
  prefetchDictionary();
  // 우측 패널 견본이 「수정본」을 그린다 — 오버레이는 UI 를 모른 채 결과만 흘린다.
  overlay.onItems = (items) => eventBus.emit('lint:items', items);
  eventBus.on('lint:fix-paragraph', (pos) => {
    const p = pos as { sectionIndex: number; paragraphIndex: number };
    overlay.applyParagraph(p.sectionIndex, p.paragraphIndex);
  });
  eventBus.on('document-changed', () => overlay.scheduleScan());
  // 문서를 **열었을 때도** 검사한다(편집을 해야 밑줄이 뜨던 실측 결함, 2026-07-31)
  eventBus.on('command-state-changed', () => overlay.armScan());
  eventBus.on('zoom-changed', () => overlay.paint());
  eventBus.on('page-layout-changed', () => overlay.paint());
  eventBus.on('lint:toggle-format', () => overlay.setFormatChecks(!overlay.isFormatChecks()));
  return overlay;
}
