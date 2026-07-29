/**
 * 표/셀 속성 패널 — 테두리·배경 외 나머지 섹션 (디자인 2c).
 *
 * 왜 새로 쓰나: 모달 폼(table-cell-props-dialog)은 6탭 한 덩어리라 "지금 고른 섹션만"
 * 보여줄 수 없고, 확인 버튼이 없는 패널과 저장 시점도 맞지 않는다. 그래서 섹션별로
 * 필요한 컨트롤만 그리고, **바뀐 값 하나만** 즉시 저장한다.
 *
 * ⚠ 저장 규약 두 가지(모달에서 실측으로 굳은 것 — 어기면 회귀한다):
 *  ① setTableProperties 는 borderFill 을 재빌드해 전 셀 배경을 날린다 → 앞뒤로 스냅샷·복원.
 *  ② border/fill 키는 **절대 실어 보내지 않는다** — 키 존재만으로 전 셀 테두리가
 *     표 기본으로 덮어써진다(배치만 바꿔도 셀 테두리가 회색으로 회귀했던 사고).
 */
import { mkEl, mkButton } from './canva-dom';
import { clampFloatingTableToPage } from '@/engine/canvas-snap';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { CellProperties, TableProperties } from '@/core/types';
import type { CanvaServices } from './canva-services';

const HWPUNIT_PER_MM = 7200 / 25.4;
const toMm = (hu: number | undefined): string => ((hu ?? 0) * 25.4 / 7200).toFixed(2);
const fromMm = (v: string): number => Math.round((parseFloat(v) || 0) * HWPUNIT_PER_MM);

/** 값-라벨 쌍 목록 (세그먼트/드롭다운 공용) */
type Opt<T> = [T, string];

const WRAP: Opt<string>[] = [['Square', '어울림'], ['TopAndBottom', '자리 차지'], ['BehindText', '글 뒤로'], ['InFrontOfText', '글 앞으로']];
const FLOW: Opt<string>[] = [['BothSides', '양쪽'], ['LeftOnly', '왼쪽'], ['RightOnly', '오른쪽'], ['LargestOnly', '큰 쪽']];
const H_REL: Opt<string>[] = [['Paper', '종이'], ['Page', '쪽'], ['Column', '단'], ['Para', '문단']];
const H_ALIGN: Opt<string>[] = [['Left', '왼쪽'], ['Center', '가운데'], ['Right', '오른쪽'], ['Inside', '안쪽'], ['Outside', '바깥쪽']];
const V_REL: Opt<string>[] = [['Paper', '종이'], ['Page', '쪽'], ['Para', '문단']];
const V_ALIGN: Opt<string>[] = [['Top', '위'], ['Center', '가운데'], ['Bottom', '아래']];
/** 쪽 경계에서 — 2=나눔, 1=셀 단위로 나눔, 0=나누지 않음 */
const PAGE_BREAK: Array<[number, string, string]> = [
  [2, '나눔', '표가 쪽 경계에서 잘려 이어집니다'],
  [1, '셀 단위로 나눔', '셀 하나는 자르지 않고 통째로 넘깁니다'],
  [0, '나누지 않음', '표 전체를 다음 쪽으로 넘깁니다'],
];
/** 캡션 3×3 — [세로위치 dir, 보조 sub, 툴팁]. dir -1 = 캡션 없음 */
const CAPTION_GRID: Array<[number, number, string]> = [
  [0, 0, '왼쪽 위'], [2, 0, '위'], [1, 0, '오른쪽 위'],
  [0, 1, '왼쪽 가운데'], [-1, 0, '캡션 없음'], [1, 1, '오른쪽 가운데'],
  [0, 2, '왼쪽 아래'], [3, 0, '아래'], [1, 2, '오른쪽 아래'],
];
const QUAD_SIDES: Array<['Top' | 'Bottom' | 'Left' | 'Right', string]> = [
  ['Top', '위'], ['Left', '왼쪽'], ['Right', '오른쪽'], ['Bottom', '아래'],
];

export class TablePanelSections {
  private host!: HTMLElement;
  private wasm!: WasmBridge;
  private services!: CanvaServices;
  private ctx!: { sec: number; ppi: number; ci: number };
  private cellIdx = 0;
  private tp!: TableProperties;
  private cp!: CellProperties;

  /** @returns 이 섹션을 그렸으면 true (모르는 섹션이면 false — 호출자가 폴백) */
  mount(
    host: HTMLElement, wasm: WasmBridge, services: CanvaServices,
    ctx: { sec: number; ppi: number; ci: number }, cellIdx: number,
    tab: 'table' | 'cell', section: string,
  ): boolean {
    this.host = host; this.wasm = wasm; this.services = services;
    this.ctx = ctx; this.cellIdx = cellIdx;
    try {
      this.tp = wasm.getTableProperties(ctx.sec, ctx.ppi, ctx.ci);
      this.cp = wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, cellIdx);
    } catch {
      return false;
    }
    host.innerHTML = '';
    host.className = 'tps';
    const build = (tab === 'table' ? this.tableSections() : this.cellSections())[section];
    if (!build) return false;
    build();
    return true;
  }

  private tableSections(): Record<string, () => void> {
    return {
      위치: () => this.buildPosition(),
      크기: () => this.buildTableSize(),
      여백: () => this.buildOuterMargin(),
      '쪽 넘김': () => this.buildPageBreak(),
      캡션: () => this.buildCaption(),
    };
  }

  private cellSections(): Record<string, () => void> {
    return {
      크기: () => this.buildCellSize(),
      여백: () => this.buildCellPadding(),
      정렬: () => this.buildCellAlign(),
      속성: () => this.buildCellFlags(),
      필드: () => this.buildCellField(),
    };
  }

  // ── 섹션 ────────────────────────────────────────

  /** 표 위치 — 글자처럼 취급 / 배치 / 가로·세로 기준 / 겹침 규칙 */
  private buildPosition(): void {
    const inline = this.tp.treatAsChar ?? false;
    // 글자처럼 취급이면 아래 배치 컨트롤은 의미가 없다 — 통째로 흐려 끈다
    this.host.appendChild(this.switchRow('글자처럼 취급', inline, (v) => this.patchTable({ treatAsChar: v })));

    const dep = mkEl('div', 'tps-dep');
    dep.classList.toggle('is-off', inline);

    dep.appendChild(this.segRow('본문과의 배치', WRAP, this.tp.textWrap ?? 'Square',
      (v) => this.patchTable({ textWrap: v })));

    // 본문 위치는 '어울림'일 때만 의미가 있다
    const flowRow = this.segRow('본문 위치', FLOW, this.tp.textFlow ?? 'BothSides',
      (v) => this.patchTable({ textFlow: v }));
    flowRow.classList.toggle('is-off', (this.tp.textWrap ?? 'Square') !== 'Square');
    dep.appendChild(flowRow);

    dep.appendChild(this.composeRow('가로', 'arrows-horizontal',
      H_REL, this.tp.horzRelTo ?? 'Column', (v) => this.patchTable({ horzRelTo: v }),
      H_ALIGN, this.tp.horzAlign ?? 'Left', (v) => this.patchTable({ horzAlign: v }),
      toMm(this.tp.horzOffset), (v) => this.patchTable({ horzOffset: fromMm(v) })));
    dep.appendChild(this.composeRow('세로', 'arrows-vertical',
      V_REL, this.tp.vertRelTo ?? 'Para', (v) => this.patchTable({ vertRelTo: v }),
      V_ALIGN, this.tp.vertAlign ?? 'Top', (v) => this.patchTable({ vertAlign: v }),
      toMm(this.tp.vertOffset), (v) => this.patchTable({ vertOffset: fromMm(v) })));
    dep.appendChild(mkEl('div', 'tps-help', '단: 글이 흐르는 단(칼럼)이 기준이에요 · 쪽: 여백을 뺀 본문 영역이 기준이에요'));

    dep.appendChild(this.switchRow('쪽 영역 안으로 제한', this.tp.restrictInPage ?? true, (v) => this.patchTable({ restrictInPage: v })));
    dep.appendChild(this.switchRow('서로 겹침 허용', this.tp.allowOverlap ?? false, (v) => this.patchTable({ allowOverlap: v })));
    dep.appendChild(this.switchRow('개체와 조판부호를 항상 같은 쪽에 놓기', this.tp.keepWithAnchor ?? false, (v) => this.patchTable({ keepWithAnchor: v })));
    this.host.appendChild(dep);
  }

  /** 표 크기 — 엔진이 셀 크기의 합으로 계산하므로 읽기 전용 */
  private buildTableSize(): void {
    const row = mkEl('div', 'tps-row');
    row.appendChild(mkEl('span', 'tps-label', '크기'));
    for (const [cap, hu] of [['너비', this.tp.tableWidth], ['높이', this.tp.tableHeight]] as const) {
      const f = mkEl('span', 'tps-pair');
      f.append(mkEl('span', 'tps-sub', cap), mkEl('span', 'tps-ro', `${toMm(hu)} mm`));
      row.appendChild(f);
    }
    this.host.append(row, mkEl('div', 'tps-note', '※ 표 크기는 읽기 전용입니다 (셀 크기의 합)'));
  }

  /** 표 바깥 여백 */
  private buildOuterMargin(): void {
    this.host.appendChild(this.quad({
      Top: toMm(this.tp.outerTop), Bottom: toMm(this.tp.outerBottom),
      Left: toMm(this.tp.outerLeft), Right: toMm(this.tp.outerRight),
    }, (side, v) => this.patchTable({ [`outer${side}`]: fromMm(v) } as Partial<TableProperties>)));
  }

  private buildPageBreak(): void {
    const grid = mkEl('div', 'tps-cards');
    const cur = this.tp.pageBreak ?? 2;
    for (const [value, label, tip] of PAGE_BREAK) {
      const b = mkButton('tps-card', { title: tip });
      b.classList.toggle('is-on', value === cur);
      // 쪽 두 장 위에 표가 어떻게 걸리는지 그림으로 — 값 이름만으론 구분이 안 된다
      b.appendChild(this.breakArt(value));
      b.appendChild(mkEl('span', 'tps-card-label', label));
      b.addEventListener('click', () => {
        grid.querySelectorAll('.tps-card').forEach((e) => e.classList.remove('is-on'));
        b.classList.add('is-on');
        this.patchTable({ pageBreak: value });
      });
      grid.appendChild(b);
    }
    this.host.appendChild(grid);
    this.host.appendChild(this.switchRow('제목 줄 자동 반복', this.tp.repeatHeader ?? false,
      (v) => this.patchTable({ repeatHeader: v })));
  }

  private buildCaption(): void {
    const has = this.tp.hasCaption ?? false;
    const dir = has ? (this.tp.captionDirection ?? 3) : -1;
    const sub = this.tp.captionVertAlign ?? 0;

    const grid = mkEl('div', 'tps-capgrid');
    const fields = mkEl('div', 'tps-dep');
    for (const [d, s, tip] of CAPTION_GRID) {
      const b = mkButton('tps-cap', { title: tip });
      b.classList.toggle('is-on', d === dir && (d === 2 || d === 3 || d === -1 ? true : s === sub));
      b.appendChild(this.captionArt(d, s));
      b.addEventListener('click', () => {
        grid.querySelectorAll('.tps-cap').forEach((e) => e.classList.remove('is-on'));
        b.classList.add('is-on');
        fields.classList.toggle('is-off', d === -1);
        this.patchTable(d === -1
          ? { hasCaption: false }
          : { hasCaption: true, captionDirection: d, captionVertAlign: s });
      });
      grid.appendChild(b);
    }
    this.host.appendChild(grid);

    fields.classList.toggle('is-off', !has);
    fields.appendChild(this.numRow('간격', toMm(this.tp.captionSpacing), 'mm',
      (v) => this.patchTable({ captionSpacing: fromMm(v) })));
    fields.appendChild(this.numRow('캡션 크기', toMm(this.tp.captionWidth), 'mm',
      (v) => this.patchTable({ captionWidth: fromMm(v) })));
    this.host.appendChild(fields);
  }

  private buildCellSize(): void {
    this.host.appendChild(this.numRow('너비', toMm(this.cp.width), 'mm',
      (v) => this.patchCell({ width: fromMm(v) })));
    this.host.appendChild(this.numRow('높이', toMm(this.cp.height), 'mm',
      (v) => this.patchCell({ height: fromMm(v) })));
    this.host.appendChild(mkEl('div', 'tps-note', '※ 셀 하나의 크기를 바꾸면 같은 줄·칸이 함께 조정됩니다'));
  }

  private buildCellPadding(): void {
    const apply = this.cp.applyInnerMargin ?? false;
    const box = this.quad({
      Top: toMm(this.cp.paddingTop), Bottom: toMm(this.cp.paddingBottom),
      Left: toMm(this.cp.paddingLeft), Right: toMm(this.cp.paddingRight),
    }, (side, v) => this.patchCell({
      applyInnerMargin: true,
      [`padding${side}`]: fromMm(v),
    } as Partial<CellProperties>));
    box.classList.toggle('is-off', !apply);
    this.host.appendChild(this.switchRow('안 여백 지정', apply, (v) => {
      box.classList.toggle('is-off', !v);
      this.patchCell({ applyInnerMargin: v });
    }));
    this.host.appendChild(box);
  }

  private buildCellAlign(): void {
    this.host.appendChild(this.segRow('세로 정렬',
      [[0, '위쪽'], [1, '가운데'], [2, '아래쪽']] as Opt<number>[],
      this.cp.verticalAlign ?? 0, (v) => this.patchCell({ verticalAlign: v })));
    this.host.appendChild(this.segRow('글 방향',
      [[0, '가로쓰기'], [1, '세로쓰기']] as Opt<number>[],
      this.cp.textDirection ?? 0, (v) => this.patchCell({ textDirection: v })));
  }

  private buildCellFlags(): void {
    this.host.appendChild(this.switchRow('셀 보호', this.cp.cellProtect ?? false,
      (v) => this.patchCell({ cellProtect: v })));
    this.host.appendChild(this.switchRow('제목 셀', this.cp.isHeader ?? false,
      (v) => this.patchCell({ isHeader: v })));
  }

  private buildCellField(): void {
    const row = mkEl('div', 'tps-row');
    row.appendChild(mkEl('span', 'tps-label', '필드 이름'));
    const input = mkEl('input', 'tps-input tps-input-wide');
    input.type = 'text';
    input.value = this.cp.fieldName ?? '';
    input.addEventListener('change', () => this.patchCell({ fieldName: input.value }));
    row.appendChild(input);
    this.host.append(row, this.switchRow('양식 모드에서 편집 가능', this.cp.editableInForm ?? false,
      (v) => this.patchCell({ editableInForm: v })));
  }

  // ── 컨트롤 ──────────────────────────────────────

  private switchRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = mkEl('label', 'tps-switch-row');
    const input = mkEl('input');
    input.type = 'checkbox';
    input.checked = on;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, mkEl('span', 'tps-switch-track'), mkEl('span', 'tps-switch-label', label));
    return row;
  }

  private segRow<T>(label: string, opts: Opt<T>[], cur: T, onChange: (v: T) => void): HTMLElement {
    const row = mkEl('div', 'tps-field');
    if (label) row.appendChild(mkEl('span', 'tps-label', label));
    const seg = mkEl('div', 'tps-seg');
    for (const [value, text] of opts) {
      const b = mkButton('tps-seg-btn', { text });
      b.classList.toggle('is-on', value === cur);
      b.addEventListener('click', () => {
        seg.querySelectorAll('.tps-seg-btn').forEach((e) => e.classList.remove('is-on'));
        b.classList.add('is-on');
        onChange(value);
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }

  private numRow(label: string, value: string, unit: string, onChange: (v: string) => void): HTMLElement {
    const row = mkEl('div', 'tps-row');
    row.appendChild(mkEl('span', 'tps-label', label));
    const input = mkEl('input', 'tps-input');
    input.type = 'number';
    input.step = '0.1';
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    row.append(input, mkEl('span', 'tps-unit', unit));
    return row;
  }

  private select<T extends string>(opts: Opt<T>[], cur: T, onChange: (v: T) => void): HTMLSelectElement {
    const sel = mkEl('select', 'tps-select');
    for (const [value, text] of opts) {
      const o = mkEl('option', '', text);
      o.value = value;
      sel.appendChild(o);
    }
    sel.value = cur;
    sel.addEventListener('change', () => onChange(sel.value as T));
    return sel;
  }

  /** "단 의 왼쪽 기준 0.00mm" 처럼 한 줄로 읽히는 위치 행 */
  private composeRow(
    label: string, icon: string,
    relOpts: Opt<string>[], rel: string, onRel: (v: string) => void,
    alignOpts: Opt<string>[], align: string, onAlign: (v: string) => void,
    offset: string, onOffset: (v: string) => void,
  ): HTMLElement {
    const row = mkEl('div', 'tps-compose');
    const head = mkEl('span', 'tps-label');
    head.innerHTML = `<i class="ph-duotone ph-${icon}"></i>${label}`;
    const input = mkEl('input', 'tps-input tps-input-sm');
    input.type = 'number';
    input.step = '0.1';
    input.value = offset;
    input.addEventListener('change', () => onOffset(input.value));
    row.append(head,
      this.select(relOpts, rel, onRel), mkEl('span', 'tps-txt', '의'),
      this.select(alignOpts, align, onAlign), mkEl('span', 'tps-txt', '기준'),
      input, mkEl('span', 'tps-unit', 'mm'));
    return row;
  }

  /** 상·하·좌·우를 네모 둘레에 배치한 여백 상자 */
  private quad(
    values: Record<'Top' | 'Bottom' | 'Left' | 'Right', string>,
    onChange: (side: 'Top' | 'Bottom' | 'Left' | 'Right', v: string) => void,
  ): HTMLElement {
    const box = mkEl('div', 'tps-quad');
    for (const [side, label] of QUAD_SIDES) {
      const cell = mkEl('label', `tps-quad-${side.toLowerCase()}`);
      const input = mkEl('input', 'tps-input tps-input-sm');
      input.type = 'number';
      input.step = '0.1';
      input.value = values[side];
      input.addEventListener('change', () => onChange(side, input.value));
      cell.append(mkEl('span', 'tps-quad-label', label), input);
      box.appendChild(cell);
    }
    box.appendChild(mkEl('span', 'tps-quad-mid'));
    return box;
  }

  /** 쪽 경계 카드 그림 — 쪽 두 장에 표가 걸친 모습 */
  private breakArt(mode: number): HTMLElement {
    const art = mkEl('span', 'tps-card-art');
    const a = mkEl('i', 'tps-sheet');
    const b = mkEl('i', 'tps-sheet');
    // 2=나눔: 두 쪽 모두에 표 조각 / 1=셀 단위: 왼쪽만 온전 / 0=넘김: 오른쪽에 통째로
    if (mode === 2) { a.appendChild(mkEl('u', 'tps-bar tps-bar-cut')); b.appendChild(mkEl('u', 'tps-bar')); }
    else if (mode === 1) { a.appendChild(mkEl('u', 'tps-bar')); b.appendChild(mkEl('u', 'tps-bar')); }
    else { b.appendChild(mkEl('u', 'tps-bar tps-bar-tall')); }
    art.append(a, b);
    return art;
  }

  /** 캡션 위치 아이콘 — 표 네모 + 캡션 막대 */
  private captionArt(dir: number, sub: number): HTMLElement {
    const art = mkEl('span', 'tps-cap-art');
    if (dir === -1) { art.classList.add('is-none'); return art; }
    const bar = mkEl('u', 'tps-cap-bar');
    art.classList.add(`is-${['left', 'right', 'top', 'bottom'][dir]}`);
    if (dir === 0 || dir === 1) art.classList.add(`is-sub${sub}`);
    art.appendChild(bar);
    return art;
  }

  // ── 저장 ────────────────────────────────────────

  private patchTable(partial: Partial<TableProperties>): void {
    const { sec, ppi, ci } = this.ctx;
    // ① 셀 배경 스냅샷 — setTableProperties 가 borderFill 을 재빌드하며 전 셀 fill 을 날린다
    const fills = new Map<number, Partial<CellProperties>>();
    let idxs: number[] = [];
    try {
      idxs = [...new Set(this.wasm.getTableCellBboxes(sec, ppi, ci).map((b) => b.cellIdx))];
    } catch { /* 열거 실패 시 복원 없이 진행 */ }
    for (const idx of idxs) {
      try {
        const cp = this.wasm.getCellProperties(sec, ppi, ci, idx);
        if (cp.fillType && cp.fillType !== 'none') {
          fills.set(idx, { fillType: cp.fillType, fillColor: cp.fillColor, patternColor: cp.patternColor, patternType: cp.patternType });
        }
      } catch { /* 개별 셀 조회 실패는 건너뛴다 */ }
    }
    this.run(() => {
      // ② border/fill 키는 싣지 않는다 — partial 에 들어올 일이 없도록 호출부가 보장한다
      this.wasm.setTableProperties(sec, ppi, ci, partial);
      for (const [idx, f] of fills) this.wasm.setCellProperties(sec, ppi, ci, idx, f);
      if (partial.treatAsChar === false) clampFloatingTableToPage(this.wasm, sec, ppi, ci);
    });
    Object.assign(this.tp, partial);
  }

  private patchCell(partial: Partial<CellProperties>): void {
    const { sec, ppi, ci } = this.ctx;
    this.run(() => this.wasm.setCellProperties(sec, ppi, ci, this.cellIdx, partial));
    Object.assign(this.cp, partial);
  }

  /** 되돌리기 대상으로 기록 — 모달의 objectProps 스냅샷과 같은 계약 */
  private run(fn: () => void): void {
    const ih = this.services?.getInputHandler();
    try {
      if (ih) {
        ih.executeOperation({ kind: 'snapshot', operationType: 'objectProps', operation: () => { fn(); return ih.getCursorPosition(); } });
      } else {
        fn();
      }
    } catch (err) {
      console.warn('[table-panel-sections] 적용 실패:', err);
    }
  }
}
