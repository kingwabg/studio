/**
 * 인라인 검사 — 맞춤법·서식 위반을 **캔버스 위 밑줄로 바로** 보여주고, 눌러서 고친다.
 * 스펙: studio `docs/plans/format-linter.md` (1차 = 뼈대)
 *
 * 왜 만들었나: 검사기 자체는 이미 있었다(`ui/spell-dialog.ts` — 규칙·검사·교정 전부).
 * 빠진 건 "대화상자를 열어야 보인다"는 것뿐이었다. 그래서 이 파일은 **표시와 조작**만
 * 맡고, 규칙·검사·교정은 전부 기존 것을 그대로 쓴다(중복 정의 금지).
 *
 * ⚠ 조판을 건드리지 않는다 — 페이지 렌더 파이프라인 밖의 별도 레이어에 그린다.
 * (렌더에 손대면 조판 회귀가 나는 게 이 저장소의 반복 함정)
 * 좌표 변환은 TrackOverlay(engine/track-review.ts)와 같은 방식:
 * getSelectionRects → 쪽 좌표 → virtualScroll 로 화면 좌표.
 */
import { scanDocument, type SpellHit } from '@/ui/spell-dialog';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { VirtualScroll } from '@/view/virtual-scroll';
import type { EventBus } from '@/core/event-bus';

/** 타이핑이 멈춘 것으로 보는 시간 — 이보다 짧으면 글자마다 검사가 돌아 산만하다. */
const IDLE_MS = 400;

/** 무시한 항목 키 — 같은 문단의 같은 글자를 다시 지적하지 않는다. */
function hitKey(h: SpellHit): string {
  return `${h.sectionIndex}:${h.paragraphIndex}:${h.text}:${h.msg}`;
}

/**
 * 규칙 둘이 같은 글자를 물면 앞의 것만 남긴다.
 * 겹친 채로 [전부 적용]을 하면 뒤 교정이 이미 바뀐 글자를 덮어 문장이 깨진다.
 * (입력은 (구역, 문단, 오프셋) 오름차순 — scanDocument 가 정렬해서 준다)
 */
function dropOverlaps(hits: SpellHit[]): SpellHit[] {
  const out: SpellHit[] = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    const sameP = prev && prev.sectionIndex === h.sectionIndex
      && prev.paragraphIndex === h.paragraphIndex;
    if (sameP && h.charOffset < prev.charOffset + prev.length) continue;
    out.push(h);
  }
  return out;
}

interface LintHost {
  wasm: WasmBridge;
  getZoom(): number;
  /** 고침 하나를 적용한다 — 스냅샷 1회로 기록되어 Ctrl+Z 한 번에 되돌아간다 */
  applyFix(h: SpellHit): void;
}

export class LintOverlay {
  private layer: HTMLDivElement;
  private card: HTMLDivElement | null = null;
  private hits: SpellHit[] = [];
  private ignored = new Set<string>();
  private timer: number | null = null;
  private enabled = true;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
    private host: LintHost,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'lint-layer';
    // 레이어 자체는 통과시키고 밑줄만 받는다 — 본문 클릭/드래그를 가로채면 안 된다.
    this.layer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:8;';
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.hits = []; this.closeCard(); this.paint(); }
    else this.scheduleScan(0);
  }

  isEnabled(): boolean { return this.enabled; }

  /** 문서가 바뀌었다 — 타이핑이 멈추면 다시 훑는다(디바운스). */
  scheduleScan(delay = IDLE_MS): void {
    if (!this.enabled) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.scan(); }, delay);
  }

  /** 지금 바로 훑는다(검사 시각 측정·테스트용). 반환값 = 걸린 ms */
  scan(): number {
    if (!this.enabled) return 0;
    const t0 = performance.now();
    try {
      this.hits = dropOverlaps(
        scanDocument(this.host.wasm).filter((h) => !this.ignored.has(hitKey(h))));
    } catch {
      this.hits = [];
    }
    this.paint();
    return performance.now() - t0;
  }

  /** 좌표만 다시 계산한다 — 줌·스크롤·레이아웃 변경(문서는 그대로) */
  paint(): void {
    this.ensureAttached();
    this.layer.innerHTML = '';
    if (!this.enabled || this.hits.length === 0) return;
    const scrollContent = this.container.querySelector('#scroll-content') as HTMLElement | null;
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const zoom = this.host.getZoom();

    this.hits.forEach((h, i) => {
      let rects: Array<{ pageIndex: number; x: number; y: number; width: number; height: number }> = [];
      try {
        rects = this.host.wasm.getSelectionRects(
          h.sectionIndex, h.paragraphIndex, h.charOffset,
          h.paragraphIndex, h.charOffset + h.length);
      } catch { return; }
      for (const r of rects) {
        if (r.width <= 0) continue;
        const el = document.createElement('div');
        el.className = 'lint-mark lint-mark--spell';
        el.dataset.lintIdx = String(i);
        el.title = h.msg;
        const left = this.virtualScroll.getPageLeftResolved(r.pageIndex, contentWidth) + r.x * zoom;
        const top = this.virtualScroll.getPageOffset(r.pageIndex) + r.y * zoom;
        el.style.cssText =
          `position:absolute;left:${left}px;top:${top}px;` +
          `width:${r.width * zoom}px;height:${r.height * zoom}px;pointer-events:auto;cursor:pointer;`;
        el.addEventListener('mousedown', (e) => {
          // 본문 커서 이동을 막고 카드를 연다 — 밑줄은 '읽는 것'이 아니라 '누르는 것'이다.
          e.preventDefault();
          e.stopPropagation();
          this.openCard(h, left, top + r.height * zoom);
        });
        this.layer.appendChild(el);
      }
    });
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.closeCard();
    this.layer.remove();
  }

  /** 남은 지적 수 — 상태 표시·테스트용 */
  count(): number { return this.hits.length; }

  /** 고칠 수 있는 것을 전부 적용한다. 뒤에서부터 고쳐야 앞 항목 오프셋이 안 밀린다. */
  applyAll(): void {
    const fixable = this.hits.filter((h) => h.suggestion != null).reverse();
    for (const h of fixable) this.host.applyFix(h);
    this.closeCard();
    this.scheduleScan(0);
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
  private openCard(h: SpellHit, left: number, top: number): void {
    this.closeCard();
    const card = document.createElement('div');
    card.className = 'lint-card';
    card.style.cssText = `position:absolute;left:${left}px;top:${top + 4}px;pointer-events:auto;`;

    const msg = document.createElement('div');
    msg.className = 'lint-card-msg';
    msg.textContent = h.msg;
    card.appendChild(msg);

    if (h.suggestion != null) {
      const diff = document.createElement('div');
      diff.className = 'lint-card-diff';
      const from = document.createElement('span');
      from.className = 'lint-card-from';
      from.textContent = h.text;
      const to = document.createElement('span');
      to.className = 'lint-card-to';
      to.textContent = h.suggestion;
      diff.append(from, document.createTextNode(' → '), to);
      card.appendChild(diff);
    }

    const row = document.createElement('div');
    row.className = 'lint-card-row';
    if (h.suggestion != null) {
      row.appendChild(this.mkBtn('적용', 'is-primary', () => {
        this.host.applyFix(h);
        this.closeCard();
        this.scheduleScan(0);
      }));
    }
    row.appendChild(this.mkBtn('무시', '', () => { this.ignore(h); }));
    card.appendChild(row);

    this.layer.appendChild(card);
    this.card = card;
  }

  private ignore(h: SpellHit): void {
    this.ignored.add(hitKey(h));
    this.hits = this.hits.filter((x) => hitKey(x) !== hitKey(h));
    this.closeCard();
    this.paint();
  }

  private mkBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `lint-card-btn ${cls}`.trim();
    b.textContent = label;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }
}

/**
 * 배선 한 곳 — main.ts 에서 한 줄로 부른다.
 * 문서 변경은 디바운스 재검사, 줌·스크롤은 좌표만 다시 계산(재검사 없음).
 */
export function attachLinter(
  container: HTMLElement,
  eventBus: EventBus,
  virtualScroll: VirtualScroll,
  getIh: () => { wasm: WasmBridge; executeOperation(d: unknown): unknown;
                 viewportManager: { getZoom(): number } } | null,
): LintOverlay {
  const host: LintHost = {
    get wasm() { return getIh()!.wasm; },
    getZoom: () => getIh()?.viewportManager.getZoom() ?? 1,
    applyFix: (h) => {
      const ih = getIh();
      if (!ih || h.suggestion == null) return;
      // 기존 맞춤법 대화상자와 **같은 경로** — 스냅샷 1회라 Ctrl+Z 한 번에 되돌아간다.
      ih.executeOperation({
        kind: 'snapshot',
        operationType: 'lintFix',
        operation: (wasm: WasmBridge) => {
          wasm.replaceText(h.sectionIndex, h.paragraphIndex, h.charOffset, h.length, h.suggestion!);
          return null;
        },
      });
      eventBus.emit('document-changed');
    },
  };
  const overlay = new LintOverlay(container, virtualScroll, host);
  eventBus.on('document-changed', () => overlay.scheduleScan());
  eventBus.on('zoom-changed', () => overlay.paint());
  eventBus.on('page-layout-changed', () => overlay.paint());
  return overlay;
}
