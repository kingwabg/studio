/**
 * 오른쪽 패널 「스타일」 탭 — 스타일 대화상자와 같은 구조를, 대화상자를 열지 않고.
 * (사용자 지시 2026-08-03: 패널을 대화상자 이미지처럼 만들고, 수정 버튼으로 패널에서 직접 고치게)
 *
 * 보기 모드: [목록] + [문단 모양 / 글자 모양 / 번호·글머리표] 정보 카드 3장 + [+ ✎ −]
 * 편집 모드: 같은 자리에서 카드가 입력칸으로 바뀐다(모달 없음). 저장/취소 바가 위에 뜬다.
 *
 * 저장은 스타일 본래 뜻대로 **그 스타일을 쓰는 문단 전체**에 반영된다
 * (wasm.updateStyleShapes + updateStyle 이 그렇게 동작한다).
 *
 * 정보 문구는 ui/style-info.ts 를 대화상자와 **함께** 쓴다 — 두 벌로 쓰면 어긋난다.
 */
import { mkEl, mkButton } from './canva-dom';
import { charInfoLines, headInfoLine, paraInfoLines, ALIGN_LABELS } from './style-info';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { EventBus } from '@/core/event-bus';
import type { CharProperties, ParaProperties } from '@/core/types';

interface StyleRow {
  id: number; name: string; englishName: string; type: number;
  nextStyleId: number; paraShapeId: number; charShapeId: number;
}

export interface StylePanelDeps {
  wasm: WasmBridge;
  eventBus: EventBus;
  /** 카드를 눌러 스타일을 커서 문단에 입힌다 */
  applyStyle: (id: number) => void;
  /** 새로 만들기·삭제는 기존 대화상자 경로를 그대로 쓴다 */
  dispatch: (cmd: string) => void;
  /**
   * 편집 중 바를 붙일 자리 —「본문 편집」 헤더 오른쪽(사용자 지시 2026-08-03).
   * 목록 위에 두면 목록이 아래로 밀려 고르던 자리를 잃는다. 헤더는 안 움직인다.
   */
  headerSlot?: HTMLElement;
}

const PT = (px: number | undefined): number => Math.round(((px ?? 0) * 72) / 96 * 10) / 10;

/**
 * pt → 스타일 저장 단위.
 *
 * ⚠ `updateStyleShapes` 는 문단 서식 경로(`applyParaFormat`)와 달리 **px→저장단위 변환을
 *   안 거친다**(wasm_api.rs update_style_shapes 는 parse_para_shape_mods 를 그대로 쓴다).
 *   그래서 px 로 보내면 여백이 0 으로 먹힌다(2026-08-03 실측: 20pt 넣었는데 0 유지).
 *   엔진의 px_para_mods_to_stored 와 같은 식으로 여기서 미리 바꿔 보낸다:
 *   px → HWPUNIT(px/96×7200) → ×2.
 */
const PT_TO_STORED = (pt: number): number => Math.round(((pt * 96) / 72 / 96) * 7200 * 2);

export function buildStylePanel(host: HTMLElement, deps: StylePanelDeps): void {
  let styles: StyleRow[] = [];
  try {
    styles = deps.wasm.pageCount > 0 ? (deps.wasm.getStyleList() as StyleRow[]) : [];
  } catch { styles = []; }

  if (styles.length === 0) {
    host.appendChild(mkEl('div', 'canva-hint', '문서를 열면 스타일 목록이 여기 표시됩니다.'));
    return;
  }

  // 커서 문단의 스타일을 처음 선택으로 — "지금 이거 고치려던 거잖아"
  let selectedId = styles[0].id;
  try {
    const cur = (deps.wasm as any).getCurrentStyleId?.();
    if (typeof cur === 'number' && styles.some((s) => s.id === cur)) selectedId = cur;
  } catch { /* 없으면 첫 스타일 */ }

  let editing = false;

  const wrap = mkEl('div', 'sp-wrap');
  host.appendChild(wrap);

  const render = (): void => {
    wrap.replaceChildren();

    // ── 편집 중 바 ──「본문 편집」 헤더 오른쪽에 붙인다 ──────────────
    paintHeaderBar();

    // ── 스타일 목록 ────────────────────────────────
    const listLabel = mkEl('div', 'sp-label', '스타일 목록');
    wrap.appendChild(listLabel);
    const list = mkEl('div', 'sp-list');
    for (const s of styles) {
      const row = mkButton('sp-item', { title: s.name });
      row.textContent = `¶ ${s.name}`;
      if (s.id === selectedId) row.classList.add('is-sel');
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (editing) return; // 편집 중엔 선택을 바꾸지 않는다(고치던 걸 잃는다)
        selectedId = s.id;
        render();
      });
      // 한 번 더 누르면 문단에 입힌다 — 목록이 곧 적용 버튼
      row.addEventListener('dblclick', (e) => { e.preventDefault(); deps.applyStyle(s.id); });
      list.appendChild(row);
    }
    wrap.appendChild(list);

    // ── + ✎ − ─────────────────────────────────────
    const tools = mkEl('div', 'sp-tools');
    const add = mkButton('sp-tool', { text: '+', title: '스타일 추가' });
    const edit = mkButton('sp-tool', { text: '✎', title: '이 스타일 고치기 (여기서 바로)' });
    const del = mkButton('sp-tool', { text: '−', title: '스타일 지우기' });
    add.addEventListener('click', () => deps.dispatch('format:style-dialog'));
    del.addEventListener('click', () => deps.dispatch('format:style-dialog'));
    edit.addEventListener('click', () => { editing = !editing; render(); });
    if (editing) edit.classList.add('is-on');
    tools.append(add, edit, del);
    wrap.appendChild(tools);

    // ── 정보 카드 / 편집 폼 ────────────────────────
    const style = styles.find((s) => s.id === selectedId);
    let detail: { charProps: CharProperties; paraProps: ParaProperties } | null = null;
    try { detail = deps.wasm.getStyleDetail(selectedId); } catch { detail = null; }
    if (!detail || !style) {
      wrap.appendChild(mkEl('div', 'canva-hint', '속성 조회 실패'));
      return;
    }

    if (!editing) {
      const nextName = styles.find((s) => s.id === style.nextStyleId)?.name ?? style.name;
      if (style.type === 0) card('문단 모양 정보', paraInfoLines(detail.paraProps, nextName));
      card('글자 모양 정보', charInfoLines(detail.charProps));
      card('문단 번호/글머리표 정보', [headInfoLine(detail.paraProps)]);
    } else {
      buildForm(style, detail);
    }

    // 현재 커서 위치 스타일
    const foot = mkEl('div', 'sp-foot');
    foot.append(
      mkEl('span', '', '현재 커서 위치 스타일: '),
      mkEl('b', '', styles.find((s) => s.id === selectedId)?.name ?? ''),
    );
    wrap.appendChild(foot);
  };

  /**
   * 편집 중 바를 헤더 오른쪽에 그린다(없으면 지운다).
   * 헤더는 패널이 다시 그릴 때 innerHTML 로 갈아엎히므로, 우리 바는 매번 다시 붙인다.
   */
  function paintHeaderBar(): void {
    const slot = deps.headerSlot;
    if (!slot) return;
    slot.querySelector('.sp-editbar')?.remove();
    if (!editing) {
      slot.classList.remove('has-sp-editbar');
      return;
    }
    slot.classList.add('has-sp-editbar');
    const bar = mkEl('div', 'sp-editbar');
    bar.appendChild(mkEl('span', 'sp-editmark', '✎ 스타일 편집 중'));
    const save = mkButton('sp-btn sp-btn-primary', { text: '저장' });
    const cancel = mkButton('sp-btn', { text: '취소' });
    save.addEventListener('click', () => { commit(); editing = false; render(); });
    cancel.addEventListener('click', () => { editing = false; render(); });
    bar.append(save, cancel);
    slot.appendChild(bar);
  }

  function card(title: string, lines: string[]): void {
    const c = mkEl('div', 'sp-card');
    c.appendChild(mkEl('div', 'sp-card-title', title));
    const body = mkEl('div', 'sp-card-body');
    for (const l of lines) body.appendChild(mkEl('div', '', l));
    c.appendChild(body);
    wrap.appendChild(c);
  }

  // ── 편집 폼 ───────────────────────────────────────
  let form: {
    name: HTMLInputElement; next: HTMLSelectElement;
    ml: HTMLInputElement; mr: HTMLInputElement; indent: HTMLInputElement;
    align: HTMLSelectElement; ls: HTMLInputElement;
    font: HTMLInputElement; size: HTMLInputElement;
    ratio: HTMLInputElement; spacing: HTMLInputElement;
  } | null = null;

  function field(parent: HTMLElement, label: string, el: HTMLElement): void {
    const row = mkEl('div', 'sp-field');
    row.appendChild(mkEl('label', 'sp-field-label', label));
    row.appendChild(el);
    parent.appendChild(row);
  }

  function num(value: number, step = 0.5): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number'; i.className = 'sp-input'; i.step = String(step);
    i.value = String(value);
    return i;
  }

  function buildForm(style: StyleRow, d: { charProps: CharProperties; paraProps: ParaProperties }): void {
    const pp = d.paraProps, cp = d.charProps;

    // 이름·다음 스타일 (선택 B — 패널에서 전부 고친다)
    const idCard = mkEl('div', 'sp-card');
    idCard.appendChild(mkEl('div', 'sp-card-title', '스타일'));
    const idBody = mkEl('div', 'sp-card-body');
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.className = 'sp-input'; nameInput.value = style.name;
    const nextSel = document.createElement('select');
    nextSel.className = 'sp-input';
    for (const s of styles) {
      const o = document.createElement('option');
      o.value = String(s.id); o.textContent = s.name;
      if (s.id === style.nextStyleId) o.selected = true;
      nextSel.appendChild(o);
    }
    field(idBody, '이름', nameInput);
    field(idBody, '다음 스타일', nextSel);
    idCard.appendChild(idBody);
    wrap.appendChild(idCard);

    // 문단 모양
    const paraCard = mkEl('div', 'sp-card');
    paraCard.appendChild(mkEl('div', 'sp-card-title', '문단 모양'));
    const paraBody = mkEl('div', 'sp-card-body');
    const ml = num(PT(pp.marginLeft));
    const mr = num(PT(pp.marginRight));
    const indent = num(PT(pp.indent));
    const align = document.createElement('select');
    align.className = 'sp-input';
    for (const [k, label] of Object.entries(ALIGN_LABELS)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = label;
      if ((pp.alignment ?? 'justify') === k) o.selected = true;
      align.appendChild(o);
    }
    const ls = num(Math.round(pp.lineSpacing ?? 160), 5);
    field(paraBody, '왼쪽 여백 (pt)', ml);
    field(paraBody, '오른쪽 여백 (pt)', mr);
    field(paraBody, '첫 줄 (pt · 음수는 내어쓰기)', indent);
    field(paraBody, '정렬', align);
    field(paraBody, '줄 간격 (%)', ls);
    paraCard.appendChild(paraBody);
    wrap.appendChild(paraCard);

    // 글자 모양
    const charCard = mkEl('div', 'sp-card');
    charCard.appendChild(mkEl('div', 'sp-card-title', '글자 모양'));
    const charBody = mkEl('div', 'sp-card-body');
    const font = document.createElement('input');
    font.type = 'text'; font.className = 'sp-input'; font.value = cp.fontFamily ?? '';
    const size = num((cp.fontSize ?? 1000) / 100, 0.5);
    const ratio = num(cp.ratios?.[0] ?? 100, 1);
    const spacing = num(cp.spacings?.[0] ?? 0, 1);
    field(charBody, '글꼴', font);
    field(charBody, '크기 (pt)', size);
    field(charBody, '장평 (%)', ratio);
    field(charBody, '자간 (%)', spacing);
    charCard.appendChild(charBody);
    wrap.appendChild(charCard);

    form = { name: nameInput, next: nextSel, ml, mr, indent, align, ls, font, size, ratio, spacing };
  }

  /** 저장 — 모양은 updateStyleShapes, 이름·다음 스타일은 updateStyle */
  function commit(): void {
    if (!form) return;
    const style = styles.find((s) => s.id === selectedId);
    if (!style) return;
    const n = (el: HTMLInputElement, dflt = 0): number => {
      const v = parseFloat(el.value);
      return Number.isFinite(v) ? v : dflt;
    };
    const paraMods: Record<string, unknown> = {
      marginLeft: PT_TO_STORED(n(form.ml)),
      marginRight: PT_TO_STORED(n(form.mr)),
      indent: PT_TO_STORED(n(form.indent)),
      alignment: form.align.value,
      lineSpacing: n(form.ls, 160),
      lineSpacingType: 'Percent',
    };
    const charMods: Record<string, unknown> = {
      fontSize: Math.round(n(form.size, 10) * 100),
      ratios: Array(7).fill(Math.round(n(form.ratio, 100))),
      spacings: Array(7).fill(Math.round(n(form.spacing, 0))),
    };
    const fontName = form.font.value.trim();
    if (fontName) charMods.fontFamily = fontName;

    try {
      deps.wasm.updateStyleShapes(selectedId, JSON.stringify(charMods), JSON.stringify(paraMods));
      const newName = form.name.value.trim();
      const nextId = parseInt(form.next.value, 10) || style.nextStyleId;
      if (newName && (newName !== style.name || nextId !== style.nextStyleId)) {
        deps.wasm.updateStyle(selectedId, JSON.stringify({
          name: newName, englishName: style.englishName,
          type: style.type, nextStyleId: nextId,
        }));
      }
      // 목록을 다시 읽고(이름이 바뀌었을 수 있다) 문서를 다시 그린다
      styles = deps.wasm.getStyleList() as StyleRow[];
      deps.eventBus.emit('style-list-changed');
      deps.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[style-panel] 저장 실패:', err);
    }
  }

  render();
}
