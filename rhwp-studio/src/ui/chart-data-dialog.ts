/** [차트 2026-08-13] 차트 데이터 대화상자 — 삽입·편집 공용.
 *
 * 한컴은 차트 데이터를 표 형태 시트로 편집한다. 같은 모양으로: 첫 행이 계열 이름,
 * 첫 열이 항목 이름, 나머지가 값. 엑셀·한컴 표를 통째로 붙여넣을 수 있다
 * (cell-paste 의 parseHtmlTableGrid 재사용).
 *
 * 미리보기는 두지 않는다 — 확인을 누르면 본문 캔버스가 곧 미리보기다(엔진이 화면·PDF
 * 를 같은 경로로 그리므로 별도 미리보기는 필연적으로 본문과 갈린다).
 */

import { ModalDialog } from './dialog';
import { parseHtmlTableGrid } from '../engine/cell-paste';
import type { ChartSpec } from '../core/wasm-bridge-chart';

const TYPES: Array<{ value: ChartSpec['type']; label: string }> = [
  { value: 'column', label: '세로 막대형' },
  { value: 'bar', label: '가로 막대형' },
  { value: 'line', label: '꺾은선형' },
  { value: 'pie', label: '원형' },
];

export class ChartDataDialog extends ModalDialog {
  private spec: ChartSpec;
  private typeSelect!: HTMLSelectElement;
  private titleInput!: HTMLInputElement;
  private grid!: HTMLTableElement;

  /** 확인 시 호출 — 편집된 데이터를 넘긴다 */
  onApply: ((spec: ChartSpec) => void) | null = null;

  constructor(spec: ChartSpec, mode: 'insert' | 'edit' = 'insert') {
    super(mode === 'insert' ? '차트 만들기' : '차트 데이터 편집', 560, false);
    this.titleIcon = 'chart-bar';
    this.confirmLabel = mode === 'insert' ? '만들기' : '적용';
    // 깊은 복사 — 취소해도 원본이 안 바뀌게
    this.spec = {
      type: spec.type,
      title: spec.title,
      categories: [...spec.categories],
      series: spec.series.map((s) => ({ name: s.name, values: [...s.values] })),
    };
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'chart-dialog-body';

    // ── 종류 + 제목 ──
    const head = document.createElement('div');
    head.className = 'chart-dialog-head';

    const typeLabel = document.createElement('label');
    typeLabel.className = 'field-edit-label';
    typeLabel.textContent = '차트 종류';
    this.typeSelect = document.createElement('select');
    this.typeSelect.className = 'field-edit-input';
    for (const t of TYPES) {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      if (t.value === this.spec.type) opt.selected = true;
      this.typeSelect.appendChild(opt);
    }
    this.typeSelect.addEventListener('change', () => {
      this.spec.type = this.typeSelect.value as ChartSpec['type'];
      this.renderGrid(); // 원형은 계열 1개만 쓴다는 안내가 바뀐다
    });

    const titleLabel = document.createElement('label');
    titleLabel.className = 'field-edit-label';
    titleLabel.textContent = '제목';
    this.titleInput = document.createElement('input');
    this.titleInput.type = 'text';
    this.titleInput.className = 'field-edit-input';
    this.titleInput.value = this.spec.title;
    this.titleInput.placeholder = '(없음)';

    head.append(typeLabel, this.typeSelect, titleLabel, this.titleInput);
    body.appendChild(head);

    // ── 데이터 격자 ──
    const gridWrap = document.createElement('div');
    gridWrap.className = 'chart-dialog-grid';
    this.grid = document.createElement('table');
    gridWrap.appendChild(this.grid);
    body.appendChild(gridWrap);
    this.renderGrid();

    // ── 행/열 증감 ──
    const tools = document.createElement('div');
    tools.className = 'chart-dialog-tools';
    const mk = (text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chart-dialog-tool';
      b.textContent = text;
      b.addEventListener('click', () => {
        this.readGrid();
        onClick();
        this.renderGrid();
      });
      return b;
    };
    tools.append(
      mk('항목 추가', () => {
        this.spec.categories.push(`항목 ${this.spec.categories.length + 1}`);
        for (const s of this.spec.series) s.values.push(0);
      }),
      mk('항목 삭제', () => {
        if (this.spec.categories.length <= 1) return;
        this.spec.categories.pop();
        for (const s of this.spec.series) s.values.pop();
      }),
      mk('계열 추가', () => {
        this.spec.series.push({
          name: `계열 ${this.spec.series.length + 1}`,
          values: this.spec.categories.map(() => 0),
        });
      }),
      mk('계열 삭제', () => {
        if (this.spec.series.length <= 1) return;
        this.spec.series.pop();
      }),
    );
    body.appendChild(tools);

    const hint = document.createElement('div');
    hint.className = 'chart-dialog-hint';
    hint.textContent = '엑셀·한글 표를 복사해 격자에 붙여넣을 수 있습니다.';
    body.appendChild(hint);

    // 표 통째 붙여넣기
    gridWrap.addEventListener('paste', (e) => this.handlePaste(e));

    return body;
  }

  /** 현재 spec 으로 격자를 다시 그린다 */
  private renderGrid(): void {
    this.grid.textContent = '';
    const isPie = this.spec.type === 'pie';

    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = '항목';
    head.appendChild(corner);
    this.spec.series.forEach((s, si) => {
      const th = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = s.name;
      input.dataset.series = String(si);
      input.dataset.kind = 'series-name';
      if (isPie && si > 0) input.disabled = true;
      th.appendChild(input);
      head.appendChild(th);
    });
    this.grid.appendChild(head);

    this.spec.categories.forEach((cat, ci) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const catInput = document.createElement('input');
      catInput.type = 'text';
      catInput.value = cat;
      catInput.dataset.category = String(ci);
      catInput.dataset.kind = 'category';
      th.appendChild(catInput);
      tr.appendChild(th);

      this.spec.series.forEach((s, si) => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(s.values[ci] ?? 0);
        input.dataset.series = String(si);
        input.dataset.category = String(ci);
        input.dataset.kind = 'value';
        if (isPie && si > 0) input.disabled = true;
        td.appendChild(input);
        tr.appendChild(td);
      });
      this.grid.appendChild(tr);
    });

    if (isPie && this.spec.series.length > 1) {
      const note = document.createElement('caption');
      note.className = 'chart-dialog-note';
      note.textContent = '원형 차트는 첫 계열만 사용합니다.';
      this.grid.appendChild(note);
    }
  }

  /** 격자 입력값을 spec 으로 거둬들인다 */
  private readGrid(): void {
    for (const el of this.grid.querySelectorAll('input')) {
      const input = el as HTMLInputElement;
      const kind = input.dataset.kind;
      const si = Number(input.dataset.series);
      const ci = Number(input.dataset.category);
      if (kind === 'series-name' && this.spec.series[si]) {
        this.spec.series[si].name = input.value;
      } else if (kind === 'category' && ci < this.spec.categories.length) {
        this.spec.categories[ci] = input.value;
      } else if (kind === 'value' && this.spec.series[si]) {
        const n = Number(input.value);
        this.spec.series[si].values[ci] = Number.isFinite(n) ? n : 0;
      }
    }
    this.spec.title = this.titleInput.value;
    this.spec.type = this.typeSelect.value as ChartSpec['type'];
  }

  /** 엑셀·한글 표 붙여넣기 — 첫 행=계열 이름, 첫 열=항목 */
  private handlePaste(e: ClipboardEvent): void {
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain');
    let grid: string[][] | null = null;
    if (html) grid = parseHtmlTableGrid(html);
    if (!grid && text && text.includes('\t')) {
      grid = text
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => line.split('\t'));
    }
    if (!grid || grid.length < 2 || grid[0].length < 2) return;

    e.preventDefault();
    const seriesNames = grid[0].slice(1);
    const rows = grid.slice(1);
    this.spec.categories = rows.map((r) => r[0] ?? '');
    this.spec.series = seriesNames.map((name, si) => ({
      name: name || `계열 ${si + 1}`,
      values: rows.map((r) => {
        const n = Number(String(r[si + 1] ?? '').replace(/[, ]/g, ''));
        return Number.isFinite(n) ? n : 0;
      }),
    }));
    this.renderGrid();
  }

  protected onConfirm(): boolean {
    this.readGrid();
    if (this.spec.categories.length === 0 || this.spec.series.length === 0) return false;
    this.onApply?.(this.spec);
    return true;
  }
}
