/**
 * 표 빈칸 AI 채우기 — 문서에 이미 있는 표의 **빈 셀만** 골라 AI 가 채운다.
 * (사용자 요청 2026-08-01, 계기 = inline AI "정확한 곳에 정확한 내용을")
 *
 * 새 표를 만드는 ai-doc-insert 와 정반대다. 여기서는 사업계획서·평가지 같은
 * **양식이 이미 있는 문서**의 빈칸을 채운다 — 실제 사무 노동의 대부분이 이것이다.
 *
 * ⚠ 채워진 셀은 **절대 건드리지 않는다**. AI 가 사업계획서 숫자를 말없이 고쳐 쓰면
 *   사고다. 빈 셀만 대상이고, 결과도 자동 적용이 아니라 체크·수정 후 적용이다.
 * ⚠ 문서 텍스트가 밖으로 나가는 경로다 — 이름은 가리고(maskNames),
 *   아동 관찰기록(`?docKind=child-record`)에서는 아예 막는다.
 */
import { ModalDialog } from './dialog';
import { currentDocKind, canPolish, maskNames, unmaskNames } from './sentence-polish';
import type { CommandServices } from '@/command/types';

/** 한 번에 볼 표 개수 상한 — 넘으면 알리고 자른다(조용한 누락 금지). */
const MAX_TABLES = 5;

export interface GridCell { row: number; col: number; cellIdx: number; text: string }
export interface TableGrid {
  para: number; controlIdx: number; rowCount: number; colCount: number; cells: GridCell[];
}
export interface Fill { table: number; row: number; col: number; cellIdx: number; text: string }

interface TableWasm {
  getTables(sec: number): Array<{ para: number; controlIdx: number; rowCount: number; colCount: number }>;
  getTableCellBboxes(s: number, p: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
  getCellParagraphCount(s: number, p: number, ci: number, cell: number): number;
  getCellParagraphLength(s: number, p: number, ci: number, cell: number, cp: number): number;
  getTextInCell(s: number, p: number, ci: number, cell: number, cp: number, off: number, n: number): string;
  insertTextInCell(s: number, p: number, ci: number, cell: number, cp: number, off: number, t: string): unknown;
}

/**
 * 표 하나를 격자로 읽는다.
 * ⚠ 좌표는 getTableCellBboxes 가 주는 row/col 만 쓴다 — cellIdx 를 행×열로 계산하면
 *   병합된 표에서 어긋난다(ai-doc-insert 와 같은 원칙).
 */
export function readTable(w: TableWasm, sec: number, t: {
  para: number; controlIdx: number; rowCount: number; colCount: number;
}): TableGrid {
  const cells: GridCell[] = [];
  const seen = new Set<number>();
  for (const b of w.getTableCellBboxes(sec, t.para, t.controlIdx)) {
    if (seen.has(b.cellIdx)) continue;
    seen.add(b.cellIdx);
    let text = '';
    try {
      const n = w.getCellParagraphCount(sec, t.para, t.controlIdx, b.cellIdx);
      const parts: string[] = [];
      for (let cp = 0; cp < n; cp++) {
        const len = w.getCellParagraphLength(sec, t.para, t.controlIdx, b.cellIdx, cp);
        if (len > 0) parts.push(w.getTextInCell(sec, t.para, t.controlIdx, b.cellIdx, cp, 0, len));
      }
      text = parts.join(' ').trim();
    } catch { /* 못 읽는 셀(중첩 표 등)은 빈 칸이 아니라 '모름' — 아래에서 제외한다 */ }
    cells.push({ row: b.row, col: b.col, cellIdx: b.cellIdx, text });
  }
  return { para: t.para, controlIdx: t.controlIdx, rowCount: t.rowCount, colCount: t.colCount, cells };
}

/** 빈 셀 목록 — 공백만 있는 칸도 빈 칸으로 본다. */
export function blankCells(g: TableGrid): GridCell[] {
  return g.cells.filter((c) => c.text.length === 0);
}

/**
 * 모델에게 줄 격자 문자열. 채운 칸은 값을, 빈 칸은 `{{r,c}}` 를 넣어
 * **어디를 채워야 하는지 좌표로** 알려준다(자연어 설명보다 어긋날 여지가 적다).
 */
export function gridToPrompt(g: TableGrid, index: number): string {
  const lines: string[] = [`[표 ${index + 1}] ${g.rowCount}행 × ${g.colCount}열`];
  for (let r = 0; r < g.rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < g.colCount; c++) {
      const cell = g.cells.find((x) => x.row === r && x.col === c);
      if (!cell) { row.push(''); continue; }
      row.push(cell.text.length ? cell.text : `{{${r},${c}}}`);
    }
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  '당신은 한국 공공·복지기관의 문서 담당자다. 표의 빈칸을 채우는 일만 한다.',
  '규칙:',
  '1) `{{행,열}}` 로 표시된 칸만 채운다. 이미 값이 있는 칸은 절대 바꾸지 않는다.',
  '2) 같은 행의 항목명과 같은 열의 머리글을 보고 그 칸에 들어갈 값을 정한다.',
  '3) 금액·인원·날짜 칸이면 숫자 형식(1,000원 / 15명 / 2026-03-01)으로 쓴다.',
  '4) 근거 없이 지어낼 수 없는 칸(고유 명칭·실제 실적 수치)은 `(확인 필요)` 로 둔다.',
  '5) 한 칸은 짧게 — 표 칸에 들어갈 분량이다. 문장을 늘어놓지 않는다.',
  '출력은 JSON 하나만: {"fills":[{"table":1,"row":0,"col":2,"text":"..."}]}',
  '설명·코드펜스·인사말을 붙이지 않는다.',
].join('\n');

/** 모델 응답에서 채울 값 목록을 꺼낸다. 코드펜스·앞뒤 잡담을 방어한다. */
export function parseFills(raw: string): Array<{ table: number; row: number; col: number; text: string }> {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return [];
  try {
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { fills?: unknown };
    if (!Array.isArray(parsed.fills)) return [];
    return parsed.fills.flatMap((f) => {
      const o = f as Record<string, unknown>;
      const table = Number(o.table);
      const row = Number(o.row);
      const col = Number(o.col);
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!Number.isFinite(row) || !Number.isFinite(col) || !text) return [];
      return [{ table: Number.isFinite(table) ? table : 1, row, col, text }];
    });
  } catch {
    return [];
  }
}

/**
 * 고른 값을 셀에 쓴다. 스냅샷 1회 — 되돌리기 한 번이면 통째로 사라진다.
 * (다이얼로그 밖으로 뺀 이유: AI 없이도 검사할 수 있어야 한다 — e2e 판정식 2·4)
 */
export function applyFills(ih: { executeOperation(d: unknown): unknown }, grids: TableGrid[], picked: Fill[]): void {
  if (picked.length === 0) return;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'tableFill',
    operation: (wasm: TableWasm) => {
      for (const f of picked) {
        const g = grids[f.table];
        if (!g) continue;
        try {
          wasm.insertTextInCell(0, g.para, g.controlIdx, f.cellIdx, 0, 0, f.text);
        } catch { /* 한 칸이 실패해도 나머지는 넣는다 */ }
      }
      return null;
    },
  });
}

export class TableFillDialog extends ModalDialog {
  private body!: HTMLElement;
  private grids: TableGrid[] = [];
  private fills: Fill[] = [];
  private rows: Array<{ on: HTMLInputElement; input: HTMLInputElement; fill: Fill }> = [];
  /** AI 도우미가 넘겨준 사용자 지시(예: "강사비는 주 3회 기준") — 1회성 */
  private hint = '';

  constructor(private services: CommandServices) {
    super('표 빈칸 채우기', 620);
    this.titleIcon = 'table';
    this.confirmLabel = '적용';
  }

  /** 확인 = 적용. 제안이 아직 없으면 그냥 닫는다. */
  protected onConfirm(): boolean {
    this.apply();
    return true;
  }

  protected createBody(): HTMLElement {
    this.body = document.createElement('div');
    this.body.className = 'tfill';
    return this.body;
  }

  show(hint = ''): void {
    this.hint = hint;
    super.show();
    void this.scan();
  }

  private say(html: string): void {
    this.body.innerHTML = `<div class="tfill-msg">${html}</div>`;
  }

  /** 표를 읽고 빈칸을 세고, 있으면 AI 를 부른다. 빈칸이 없으면 부르지 않는다. */
  private async scan(): Promise<void> {
    this.rows = [];
    if (!canPolish(currentDocKind())) {
      this.say('아동 관찰기록에서는 AI 표 채우기를 쓸 수 없습니다.<br>기록 내용이 외부로 나가지 않도록 막아 둔 기능입니다.');
      return;
    }
    const wasm = this.services.wasm as unknown as TableWasm;
    let tables: TableGrid[] = [];
    try {
      const all = wasm.getTables(0);
      if (all.length > MAX_TABLES) {
        this.say(`표가 ${all.length}개입니다. 앞의 ${MAX_TABLES}개만 봅니다…`);
      }
      tables = all.slice(0, MAX_TABLES).map((t) => readTable(wasm, 0, t));
    } catch {
      this.say('표를 읽지 못했습니다.');
      return;
    }
    this.grids = tables.filter((g) => blankCells(g).length > 0);
    // 이미 채워진 표는 채울 대상이 아니라 **참고자료**다 — 총괄표를 보고 세부표를
    // 채우는 표 간 일관성이 여기서 나온다.
    const refTables = tables.filter((g) => blankCells(g).length === 0);
    const blanks = this.grids.reduce((n, g) => n + blankCells(g).length, 0);
    if (blanks === 0) {
      // 판정식 5 — 채울 게 없으면 AI 를 부르지 않는다(무의미한 과금 방지).
      this.say('채울 빈칸이 없습니다.');
      return;
    }
    this.say(`빈칸 ${blanks}개를 찾았습니다. AI 에게 물어보는 중…`);

    const grid = this.grids.map((g, i) => gridToPrompt(g, i)).join('\n\n');
    const refs = refTables.length
      ? '\n\n[참고 — 이미 완성된 표(수정 금지, 근거로만)]\n'
        + refTables.map((g, i) => gridToPrompt(g, this.grids.length + i)).join('\n\n')
      : '';
    // 표만 보면 무슨 문서인지 모른다 — 본문 전체를 문맥으로 함께 준다.
    const ctx = this.docContext();
    const hint = this.hint ? `\n\n[사용자 지시 — 최우선으로 따를 것]\n${this.hint}` : '';
    const mask = maskNames(`${ctx}${refs}${hint}\n\n${grid}`);
    let fills: Array<{ table: number; row: number; col: number; text: string }> = [];
    try {
      const res = await fetch('/api/ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: mask.masked }],
          temperature: 0.3, // 표 값은 창의성이 아니라 일관성이다
          max_tokens: 2048,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        error?: string | { message?: string };
      };
      if (!res.ok) {
        const e = typeof json.error === 'string' ? json.error : json.error?.message;
        this.say(`AI 호출에 실패했습니다.<br>${e ?? res.status}`);
        return;
      }
      const m = json.choices?.[0]?.message;
      const raw = m?.content?.trim() ? m.content : (m?.reasoning_content ?? '');
      fills = parseFills(unmaskNames(raw, mask));
    } catch (err) {
      this.say(`AI 호출에 실패했습니다.<br>${String(err)}`);
      return;
    }
    this.paint(fills);
  }

  /**
   * 문서 본문 전체(상한 4000자) — "문서를 파악한 후 채운다"의 파악이 이것이다.
   * 1쪽 개요의 수치("총 사업비 4,800만원")가 3쪽 표의 답이 되는 일이 흔해서,
   * 앞부분만 주면 뒤쪽 표를 채울 근거가 끊긴다(1차: 12문단 → 전체로 확장).
   */
  private docContext(): string {
    const w = this.services.wasm as unknown as {
      getParagraphCount(s: number): number;
      getParagraphLength(s: number, p: number): number;
      getTextRange(s: number, p: number, a: number, b: number): string;
    };
    const out: string[] = [];
    let total = 0;
    try {
      const n = w.getParagraphCount(0);
      for (let p = 0; p < n && total < 4000; p++) {
        const len = w.getParagraphLength(0, p);
        if (len === 0) continue;
        const t = w.getTextRange(0, p, 0, len);
        out.push(t);
        total += t.length;
      }
      if (total >= 4000) out.push('…(본문이 길어 뒷부분 생략)');
    } catch { /* 문맥은 있으면 좋은 것 — 못 읽어도 표만으로 진행한다 */ }
    return out.join('\n').slice(0, 4200);
  }

  /** 제안을 체크박스 + 수정 가능한 입력칸으로 보여준다(자동 적용 금지). */
  private paint(raw: Array<{ table: number; row: number; col: number; text: string }>): void {
    // 제안을 실제 셀에 맞춘다 — **빈 셀이 아니면 버린다**(판정식 1: 채워진 셀 불변).
    this.fills = raw.flatMap((f) => {
      const g = this.grids[f.table - 1];
      if (!g) return [];
      const cell = blankCells(g).find((c) => c.row === f.row && c.col === f.col);
      if (!cell) return [];
      return [{ table: f.table - 1, row: f.row, col: f.col, cellIdx: cell.cellIdx, text: f.text }];
    });
    if (this.fills.length === 0) {
      this.say('AI 가 채울 값을 내놓지 못했습니다. 다시 시도해 보세요.');
      return;
    }
    this.body.innerHTML = '';
    const head = document.createElement('p');
    head.className = 'tfill-head';
    head.textContent = `${this.fills.length}칸 제안입니다. 확인하고 고친 뒤 적용하세요 — 이미 채워진 칸은 건드리지 않습니다.`;
    this.body.appendChild(head);

    const list = document.createElement('div');
    list.className = 'tfill-list';
    for (const f of this.fills) {
      const row = document.createElement('label');
      row.className = 'tfill-row';
      const on = document.createElement('input');
      on.type = 'checkbox';
      on.checked = !f.text.includes('확인 필요'); // 지어낼 수 없다고 한 칸은 기본 해제
      const where = document.createElement('span');
      where.className = 'tfill-where';
      where.textContent = `표${f.table + 1} ${f.row + 1}행 ${f.col + 1}열`;
      const input = document.createElement('input');
      input.className = 'tfill-text';
      input.value = f.text;
      row.append(on, where, input);
      list.appendChild(row);
      this.rows.push({ on, input, fill: f });
    }
    this.body.appendChild(list);
  }

  /** 체크된 칸만 쓴다. */
  private apply(): void {
    const picked = this.rows
      .filter((r) => r.on.checked && r.input.value.trim())
      .map((r) => ({ ...r.fill, text: r.input.value.trim() }));
    const ih = this.services.getInputHandler();
    if (ih && picked.length > 0) {
      applyFills(ih as unknown as { executeOperation(d: unknown): unknown }, this.grids, picked);
      this.services.eventBus.emit('document-changed');
    }
  }
}

/* ── 진입점 공유 ─────────────────────────────────────────── */

let dialog: TableFillDialog | null = null;

/**
 * 도구 리본과 AI 도우미가 같은 대화상자를 연다.
 * 도우미 경로는 사용자의 말(hint)을 프롬프트에 얹는다 — "강사비는 주 3회 기준으로"
 * 같은 재요청이 대화만으로 가능해진다.
 */
export function openTableFill(services: CommandServices, hint = ''): void {
  if (!dialog) dialog = new TableFillDialog(services);
  dialog.show(hint);
}
