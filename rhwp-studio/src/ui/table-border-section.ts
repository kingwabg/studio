/**
 * 표/셀 「테두리·배경」 섹션 — 오른쪽 패널 전용 (디자인 2c).
 *
 * 왜 새 파일인가: 옛 표/셀 속성 대화상자의 테두리 탭은 ①방향이 좌·우·상·하 4개뿐이라
 * **안쪽·가로선·세로선을 못 만들었고** ②적용이 「확인」에 몰려 있어 패널의 즉시 반영과
 * 맞지 않았다. 그래서 2c 레이아웃(프리셋 10종 + 미리보기)을 새로 그리고,
 * 적용은 셀 단위 setCellProperties 로 직접 한다 —
 * wasm-bridge.applyDefaultTableBorders 가 쓰는 것과 같은 경로(검증된 길)다.
 *
 * ⚠ setTableProperties 는 borderFill 재빌드로 전 셀 배경을 날린다(table-panel-sections 참조).
 * 여기서는 셀 간격을 고칠 때만 부르고, 그 앞뒤로 셀 배경을 스냅샷·복원한다.
 */
import { mkEl, mkButton } from './canva-dom';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { CellBbox, BorderLineInfo, CellProperties } from '@/core/types';
import type { CanvaServices } from './canva-services';

const HWPUNIT_PER_MM = 7200 / 25.4;

/** 선 종류: [이름, HWP type, SVG dasharray('double'=이중선)] */
const LINE_DEFS: Array<[string, number, string]> = [
  ['없음', 0, ''], ['실선', 1, ''], ['파선', 2, '6,3'], ['점선', 3, '2,2'],
  ['일점쇄선', 4, '8,3,2,3'], ['이점쇄선', 5, '8,3,2,3,2,3'],
  ['긴 파선', 6, '12,3'], ['이중', 8, 'double'],
];
/** 굵기: 배열 인덱스가 곧 HWP width 값 */
const LINE_WEIGHTS = ['0.1', '0.12', '0.15', '0.2', '0.25', '0.3', '0.4'];
const INK = ['#201e1d', '#5f5b58', '#a8a4a0', '#0088b0', '#2f8f5b', '#d6006c', '#e08b1f', '#7b5bd6'];
const FILL = ['#ffffff', '#f3f2f2', '#e4f1f6', '#d3ebf3', '#fbe6f0', '#eaf5ee', '#fdf3e3', '#efeafb'];

type Edge = 'T' | 'R' | 'B' | 'L';
type Preset = '모두' | '바깥' | '없음' | '위' | '아래' | '왼쪽' | '오른쪽' | '안쪽' | '가로선' | '세로선';

/** 프리셋 카드: [이름, 미리보기 바깥변 T·R·B·L, 안쪽 비트(1=가로 2=세로)] */
const PRESETS: Array<[Preset, [number, number, number, number], number]> = [
  ['모두', [1, 1, 1, 1], 3], ['바깥', [1, 1, 1, 1], 0], ['없음', [0, 0, 0, 0], 0],
  ['위', [1, 0, 0, 0], 0], ['아래', [0, 0, 1, 0], 0],
  ['왼쪽', [0, 0, 0, 1], 0], ['오른쪽', [0, 1, 0, 0], 0],
  ['안쪽', [0, 0, 0, 0], 3], ['가로선', [0, 0, 0, 0], 1], ['세로선', [0, 0, 0, 0], 2],
];
/** 단일 셀에는 안쪽 선이 없다 — 셀 탭에서 끈다 */
const INNER_ONLY: Preset[] = ['안쪽', '가로선', '세로선'];

/** 스냅샷에 값이 없을 때의 기본선 — 엔진 새 표 기본(실선 0.1mm 검정) */
const DEFAULT_LINE: BorderLineInfo = { type: 1, width: 0, color: '#000000' };

/** 프리셋이 이 셀의 어느 변을 건드리는지 — 표 가장자리 여부로 안쪽/바깥을 가른다 */
function edgesFor(preset: Preset, c: CellBbox, rows: number, cols: number): Edge[] {
  const top = c.row === 0;
  const left = c.col === 0;
  const bottom = c.row + (c.rowSpan || 1) >= rows;
  const right = c.col + (c.colSpan || 1) >= cols;
  const pick = (t: boolean, r: boolean, b: boolean, l: boolean): Edge[] =>
    ([['T', t], ['R', r], ['B', b], ['L', l]] as Array<[Edge, boolean]>)
      .filter(([, on]) => on).map(([e]) => e);
  switch (preset) {
    case '모두': case '없음': return ['T', 'R', 'B', 'L'];
    case '바깥': return pick(top, right, bottom, left);
    case '위': return pick(top, false, false, false);
    case '아래': return pick(false, false, bottom, false);
    case '왼쪽': return pick(false, false, false, left);
    case '오른쪽': return pick(false, right, false, false);
    case '안쪽': return pick(!top, !right, !bottom, !left);
    case '가로선': return pick(!top, false, !bottom, false);
    case '세로선': return pick(false, !right, false, !left);
  }
}

export class TableBorderSection {
  private lineType = 1;
  private weightIdx = 1;      // 0.12mm
  private ink = INK[0];
  private preset: Preset = '바깥';
  private immediate = false;  // 선 모양 바로 적용(I)
  private fillMode: 'none' | 'color' = 'none';
  private fillColor = FILL[2];

  private host!: HTMLElement;
  private wasm!: WasmBridge;
  private services!: CanvaServices;
  private ctx!: { sec: number; ppi: number; ci: number };
  private cellIdx = 0;
  private scope: 'table' | 'cell' = 'table';
  private preview!: HTMLElement;
  private caption!: HTMLElement;

  mount(
    host: HTMLElement, wasm: WasmBridge, services: CanvaServices,
    ctx: { sec: number; ppi: number; ci: number }, cellIdx: number, scope: 'table' | 'cell',
  ): void {
    this.host = host; this.wasm = wasm; this.services = services;
    this.ctx = ctx; this.cellIdx = cellIdx; this.scope = scope;
    // 현재 셀의 선 모양을 초기값으로 — 패널을 열면 지금 상태가 보인다
    try {
      const cp = wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, cellIdx);
      const b = cp.borderTop ?? cp.borderLeft;
      if (b && b.type > 0) { this.lineType = b.type; this.weightIdx = b.width; this.ink = b.color; }
      if (cp.fillType === 'solid' && cp.fillColor) { this.fillMode = 'color'; this.fillColor = cp.fillColor; }
    } catch { /* 조회 실패 시 기본값 */ }
    this.render();
  }

  // ── 그리기 ──────────────────────────────────────

  private render(): void {
    // ⚠ host.className 을 덮어쓰면 자리(.canva-props-host)의 스크롤 설정까지 날아간다.
    // 내 것은 안쪽 래퍼에만 건다.
    this.host.innerHTML = '';
    const box = mkEl('div', 'tbs');
    this.host.appendChild(box);
    box.appendChild(this.buildPresets());
    box.appendChild(this.buildStyleBar());
    box.appendChild(this.buildPreview());
    box.appendChild(this.buildImmediate());
    box.appendChild(this.buildSpacing());
    box.appendChild(this.buildFill());
  }

  private buildPresets(): HTMLElement {
    const grid = mkEl('div', 'tbs-presets');
    for (const [label, edges, inner] of PRESETS) {
      const off = this.scope === 'cell' && INNER_ONLY.includes(label);
      const b = mkButton('tbs-preset', { title: label });
      b.classList.toggle('is-on', !off && label === this.preset);
      b.classList.toggle('is-off', off);
      b.disabled = off;
      const box = mkEl('span', 'tbs-preset-box');
      // 바깥 변 4개는 테두리로, 안쪽 2선은 자식 칸의 변으로 그린다
      box.style.borderTopColor = edges[0] ? 'currentColor' : 'var(--color-border)';
      box.style.borderRightColor = edges[1] ? 'currentColor' : 'var(--color-border)';
      box.style.borderBottomColor = edges[2] ? 'currentColor' : 'var(--color-border)';
      box.style.borderLeftColor = edges[3] ? 'currentColor' : 'var(--color-border)';
      const q = (r: boolean, bo: boolean) => {
        const d = mkEl('i');
        if (r) d.style.borderRight = '1px solid currentColor';
        if (bo) d.style.borderBottom = '1px solid currentColor';
        return d;
      };
      box.append(q(!!(inner & 2), !!(inner & 1)), q(false, !!(inner & 1)), q(!!(inner & 2), false), mkEl('i'));
      b.append(box, mkEl('span', 'tbs-preset-label', label));
      b.addEventListener('click', () => this.applyPreset(label));
      grid.appendChild(b);
    }
    return grid;
  }

  /** 선 종류 한 줄 샘플 SVG — 이름만 보는 드롭다운으로는 파선·점선을 못 고른다 */
  private lineSample(type: number, w = 60): string {
    const dash = LINE_DEFS.find(([, t]) => t === type)?.[2] ?? '';
    if (type === 0) return '<span class="tbs-none">선 없음</span>';
    if (dash === 'double') {
      return `<svg viewBox="0 0 ${w} 8" preserveAspectRatio="none"><line x1="0" y1="2" x2="${w}" y2="2" stroke="currentColor" stroke-width="1"/>`
        + `<line x1="0" y1="6" x2="${w}" y2="6" stroke="currentColor" stroke-width="1"/></svg>`;
    }
    return `<svg viewBox="0 0 ${w} 6" preserveAspectRatio="none"><line x1="0" y1="3" x2="${w}" y2="3"`
      + ` stroke="currentColor" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  }

  /** 펜촉 카드 — 선 종류·굵기 팝오버 + 색 스와치 (디자인 2c) */
  private buildStyleBar(): HTMLElement {
    const card = mkEl('div', 'tbs-pen');
    card.appendChild(mkEl('i', 'ph-duotone ph-pen-nib tbs-pen-icon'));

    const typeName = () => LINE_DEFS.find(([, t]) => t === this.lineType)?.[0] ?? '실선';
    const typeBtn = mkButton('tbs-pick tbs-pick-type');
    const paintType = () => {
      typeBtn.innerHTML = `<span class="tbs-pick-art">${this.lineSample(this.lineType, 44)}</span>`
        + `<span class="tbs-pick-name">${typeName()}</span><i class="ph ph-caret-down"></i>`;
    };
    paintType();
    const typePop = mkEl('div', 'tbs-pop tbs-pop-type');
    for (const [name, type] of LINE_DEFS) {
      const it = mkButton('tbs-pop-item');
      it.classList.toggle('is-on', type === this.lineType);
      it.innerHTML = `<span class="tbs-pop-art">${this.lineSample(type)}</span><span>${name}</span>`;
      it.addEventListener('click', () => {
        this.lineType = type;
        paintType();
        typePop.querySelectorAll('.tbs-pop-item').forEach((e) => e.classList.remove('is-on'));
        it.classList.add('is-on');
        this.onStyleChanged();
      });
      typePop.appendChild(it);
    }
    card.appendChild(this.popover(typeBtn, typePop));

    const wBtn = mkButton('tbs-pick tbs-pick-w');
    const paintW = () => { wBtn.innerHTML = `<span>${LINE_WEIGHTS[this.weightIdx]}mm</span><i class="ph ph-caret-down"></i>`; };
    paintW();
    const wPop = mkEl('div', 'tbs-pop tbs-pop-w');
    LINE_WEIGHTS.forEach((mm, i) => {
      const it = mkButton('tbs-pop-item');
      it.classList.toggle('is-on', i === this.weightIdx);
      // 막대 두께가 곧 그 굵기 — 숫자만으론 0.12 와 0.15 를 구별할 수 없다
      it.innerHTML = `<u class="tbs-pop-bar" style="height:${Math.max(1, parseFloat(mm) * 6)}px"></u><span>${mm}mm</span>`;
      it.addEventListener('click', () => {
        this.weightIdx = i;
        paintW();
        wPop.querySelectorAll('.tbs-pop-item').forEach((e) => e.classList.remove('is-on'));
        it.classList.add('is-on');
        this.onStyleChanged();
      });
      wPop.appendChild(it);
    });
    card.appendChild(this.popover(wBtn, wPop));

    card.appendChild(mkEl('span', 'tbs-pen-sep'));

    const inks = mkEl('div', 'tbs-swatches');
    for (const c of INK) {
      const s = mkButton('tbs-swatch', { title: c });
      s.style.background = c;
      s.classList.toggle('is-on', c === this.ink);
      s.addEventListener('click', () => {
        this.ink = c;
        inks.querySelectorAll('.tbs-swatch').forEach((el) => el.classList.remove('is-on'));
        s.classList.add('is-on');
        this.onStyleChanged();
      });
      inks.appendChild(s);
    }
    card.appendChild(inks);
    return card;
  }

  /** 버튼 + 팝오버 묶음. 바깥을 누르면 닫힌다(리스너는 한 번 쓰고 스스로 사라진다). */
  private popover(btn: HTMLElement, pop: HTMLElement): HTMLElement {
    const wrap = mkEl('div', 'tbs-pop-wrap');
    wrap.append(btn, pop);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('is-open');
      // 다른 팝오버는 닫는다
      for (const w of Array.from(wrap.parentElement?.querySelectorAll('.tbs-pop-wrap') ?? [])) {
        if (w !== wrap) w.classList.remove('is-open');
      }
      if (open) {
        setTimeout(() => document.addEventListener('pointerdown', function close(ev) {
          if (wrap.contains(ev.target as Node)) return;
          wrap.classList.remove('is-open');
          document.removeEventListener('pointerdown', close);
        }), 0);
      }
    });
    pop.addEventListener('click', () => wrap.classList.remove('is-open'));
    return wrap;
  }

  private buildPreview(): HTMLElement {
    const wrap = mkEl('div', 'tbs-preview-wrap');
    this.preview = mkEl('div', 'tbs-preview');
    this.preview.append(mkEl('i'), mkEl('i'), mkEl('i'), mkEl('i'));
    this.caption = mkEl('div', 'tbs-caption');
    wrap.append(this.preview, this.caption);
    this.paintPreview();
    return wrap;
  }

  /** 선택한 변만 현재 선 모양으로 — 디자인 2c 의 prev 규칙 그대로 */
  private paintPreview(): void {
    const [name, , dash] = LINE_DEFS.find(([, t]) => t === this.lineType) ?? LINE_DEFS[1];
    const style = this.lineType === 0 ? 'none'
      : dash === 'double' ? 'double' : dash === '' ? 'solid' : dash.startsWith('2,') ? 'dotted' : 'dashed';
    const px = Math.max(1, Math.round(parseFloat(LINE_WEIGHTS[this.weightIdx]) * 6));
    const on = `${px}px ${style} ${this.ink}`;
    const off = '1px solid var(--color-border)';
    const p = this.preset;
    const all = p === '모두' || p === '바깥';
    const innerAll = p === '모두' || p === '안쪽';
    this.preview.style.borderTop = all || p === '위' ? on : off;
    this.preview.style.borderBottom = all || p === '아래' ? on : off;
    this.preview.style.borderLeft = all || p === '왼쪽' ? on : off;
    this.preview.style.borderRight = all || p === '오른쪽' ? on : off;
    const h = innerAll || p === '가로선' ? on : off;
    const v = innerAll || p === '세로선' ? on : off;
    const q = this.preview.children;
    (q[0] as HTMLElement).style.cssText = `border-right:${v};border-bottom:${h}`;
    (q[1] as HTMLElement).style.cssText = `border-bottom:${h}`;
    (q[2] as HTMLElement).style.cssText = `border-right:${v}`;
    this.caption.textContent = `${name} · ${LINE_WEIGHTS[this.weightIdx]}mm · ${p}`;
  }

  private buildImmediate(): HTMLElement {
    const row = mkEl('label', 'tbs-switch-row');
    const sw = mkEl('input');
    sw.type = 'checkbox';
    sw.checked = this.immediate;
    sw.addEventListener('change', () => { this.immediate = sw.checked; });
    row.append(sw, mkEl('span', 'tbs-switch-track'), mkEl('span', '', '선 모양 바로 적용(I)'));
    row.title = '켜면 선 종류·굵기·색을 바꾸는 즉시 마지막 방향에 다시 적용합니다';
    return row;
  }

  private buildSpacing(): HTMLElement {
    const sec = mkEl('div', 'tbs-sub');
    const row = mkEl('div', 'tbs-row');
    row.appendChild(mkEl('span', 'tbs-label', '셀 간격'));
    const input = mkEl('input', 'tbs-input');
    input.type = 'number';
    input.step = '0.1';
    input.min = '0';
    try {
      const tp = this.wasm.getTableProperties(this.ctx.sec, this.ctx.ppi, this.ctx.ci);
      input.value = (Math.round(tp.cellSpacing * 25.4 / 7200 * 10) / 10).toFixed(1);
    } catch { input.value = '0.0'; }
    input.addEventListener('change', () => this.applySpacing(parseFloat(input.value) || 0));
    row.append(input, mkEl('span', 'tbs-unit', 'mm'));
    sec.append(row, mkEl('div', 'tbs-note', '※ 표 테두리는 [셀 간격]에 값을 입력해야 나타납니다'));
    return sec;
  }

  private buildFill(): HTMLElement {
    const sec = mkEl('div', 'tbs-sub');
    sec.appendChild(mkEl('div', 'tbs-sub-title', '채우기'));
    const seg = mkEl('div', 'tbs-seg');
    for (const [key, label] of [['none', '없음'], ['color', '색']] as const) {
      const b = mkButton('tbs-seg-btn', { text: label });
      b.classList.toggle('is-on', this.fillMode === key);
      b.addEventListener('click', () => {
        this.fillMode = key;
        seg.querySelectorAll('.tbs-seg-btn').forEach((el) => el.classList.remove('is-on'));
        b.classList.add('is-on');
        this.applyFill();
      });
      seg.appendChild(b);
    }
    sec.appendChild(seg);

    const sw = mkEl('div', 'tbs-swatches');
    for (const c of FILL) {
      const s = mkButton('tbs-swatch', { title: c });
      s.style.background = c;
      s.classList.toggle('is-on', c === this.fillColor && this.fillMode === 'color');
      s.addEventListener('click', () => {
        this.fillColor = c;
        this.fillMode = 'color';
        sec.querySelectorAll('.tbs-seg-btn').forEach((el, i) => el.classList.toggle('is-on', i === 1));
        sw.querySelectorAll('.tbs-swatch').forEach((el) => el.classList.remove('is-on'));
        s.classList.add('is-on');
        this.applyFill();
      });
      sw.appendChild(s);
    }
    const more = mkEl('input', 'tbs-color-more');
    more.type = 'color';
    more.value = this.fillColor;
    more.title = '다른 색';
    more.addEventListener('change', () => {
      this.fillColor = more.value;
      this.fillMode = 'color';
      this.applyFill();
    });
    sw.appendChild(more);
    sec.appendChild(sw);
    return sec;
  }

  // ── 적용 ────────────────────────────────────────

  private onStyleChanged(): void {
    this.paintPreview();
    // '바로 적용'이 켜져 있으면 마지막으로 고른 방향에 새 선 모양을 다시 얹는다
    if (this.immediate) this.applyPreset(this.preset, true);
  }

  private applyPreset(preset: Preset, keepStyle = false): void {
    this.preset = preset;
    if (!keepStyle) {
      this.host.querySelectorAll('.tbs-preset').forEach((el) => {
        el.classList.toggle('is-on', (el as HTMLElement).title === preset);
      });
    }
    this.paintPreview();

    const { sec, ppi, ci } = this.ctx;
    const line = preset === '없음'
      ? { type: 0, width: 0, color: this.ink }
      : { type: this.lineType, width: this.weightIdx, color: this.ink };

    const targets: Array<{ idx: number; edges: Edge[] }> = [];
    if (this.scope === 'cell') {
      targets.push({ idx: this.cellIdx, edges: edgesFor(preset, { row: 0, col: 0, rowSpan: 1, colSpan: 1 } as CellBbox, 1, 1) });
    } else {
      const dim = this.wasm.getTableDimensions(sec, ppi, ci);
      const seen = new Set<number>();
      for (const b of this.wasm.getTableCellBboxes(sec, ppi, ci)) {
        if (seen.has(b.cellIdx)) continue;
        seen.add(b.cellIdx);
        targets.push({ idx: b.cellIdx, edges: edgesFor(preset, b, dim.rowCount, dim.colCount) });
      }
    }
    if (!targets.length) return;

    // ⚠ 인접한 두 셀은 맞닿은 변을 **공유**한다(실측 2026-07-29: 셀1의 왼쪽을 고치면
    // 셀0의 오른쪽도 같이 바뀐다). 그래서 "건드릴 변만" 부분 저장하면, 뒤에 저장되는
    // 셀이 자기 옛 값으로 앞 셀의 새 값을 되돌린다. 먼저 전 셀의 현재 네 변을 읽어
    // 메모리에서 프리셋을 적용한 뒤, 모든 셀에 **네 변을 함께** 기록한다.
    const snap = new Map<number, Record<Edge, BorderLineInfo>>();
    for (const t of targets) {
      const cp = this.wasm.getCellProperties(sec, ppi, ci, t.idx);
      snap.set(t.idx, {
        T: cp.borderTop ?? DEFAULT_LINE, R: cp.borderRight ?? DEFAULT_LINE,
        B: cp.borderBottom ?? DEFAULT_LINE, L: cp.borderLeft ?? DEFAULT_LINE,
      });
    }
    for (const t of targets) {
      const s = snap.get(t.idx)!;
      for (const e of t.edges) s[e] = line;
    }

    this.run(() => {
      for (const t of targets) {
        const s = snap.get(t.idx)!;
        this.wasm.setCellProperties(sec, ppi, ci, t.idx, {
          borderTop: s.T, borderRight: s.R, borderBottom: s.B, borderLeft: s.L,
        });
      }
    });
  }

  private applyFill(): void {
    const { sec, ppi, ci } = this.ctx;
    const props: Partial<CellProperties> = this.fillMode === 'none'
      ? { fillType: 'none' }
      : { fillType: 'solid', fillColor: this.fillColor };
    const idxs = this.scope === 'cell' ? [this.cellIdx] : this.allCellIdxs();
    this.run(() => {
      for (const idx of idxs) this.wasm.setCellProperties(sec, ppi, ci, idx, props);
    });
  }

  /** 셀 간격은 표 속성이라 setTableProperties 가 필요하다 — 전 셀 배경을 스냅샷·복원한다 */
  private applySpacing(mm: number): void {
    const { sec, ppi, ci } = this.ctx;
    const fills = new Map<number, Partial<CellProperties>>();
    for (const idx of this.allCellIdxs()) {
      try {
        const cp = this.wasm.getCellProperties(sec, ppi, ci, idx);
        if (cp.fillType && cp.fillType !== 'none') {
          fills.set(idx, { fillType: cp.fillType, fillColor: cp.fillColor, patternColor: cp.patternColor, patternType: cp.patternType });
        }
      } catch { /* 개별 셀 조회 실패는 건너뛴다 */ }
    }
    this.run(() => {
      this.wasm.setTableProperties(sec, ppi, ci, { cellSpacing: Math.round(mm * HWPUNIT_PER_MM) });
      for (const [idx, f] of fills) this.wasm.setCellProperties(sec, ppi, ci, idx, f);
    });
  }

  private allCellIdxs(): number[] {
    try {
      const { sec, ppi, ci } = this.ctx;
      return [...new Set(this.wasm.getTableCellBboxes(sec, ppi, ci).map((b) => b.cellIdx))];
    } catch {
      return [this.cellIdx];
    }
  }

  /** 되돌리기 대상으로 기록한다 — 모달의 objectProps 스냅샷과 같은 계약 */
  private run(fn: () => void): void {
    const ih = this.services?.getInputHandler();
    try {
      if (ih) {
        ih.executeOperation({ kind: 'snapshot', operationType: 'objectProps', operation: () => { fn(); return ih.getCursorPosition(); } });
      } else {
        fn();
      }
    } catch (err) {
      console.warn('[table-border-section] 적용 실패:', err);
    }
  }
}
