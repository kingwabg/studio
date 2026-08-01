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
import { readSourceFile, type SourceDoc } from './table-fill-source';
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

/** 자료를 첨부했을 때만 얹는 규칙 — 첨부가 있으면 "그럴듯한 값"이 아니라 그 값이 답이다. */
const SOURCE_RULE = [
  '',
  '[첨부 자료]가 주어졌다. 이때는 아래가 위 규칙보다 우선한다.',
  'A) 표의 왼쪽 항목명과 같은(또는 거의 같은) 행이 첨부 자료에 있으면, 그 행에서 같은 뜻의',
  '   열 값을 **그대로 옮겨 적는다**. 이것은 판단이 아니라 옮겨 적기다 — 망설이지 않는다.',
  '   (자료의 머리글 행을 보고 어느 열이 수량이고 어느 열이 금액인지 맞춘다.)',
  'B) 옮길 때 값 자체를 바꾸지 않는다. 반올림·재계산 금지(자릿점·단위 표기만 허용).',
  'C) 첨부 자료에 **그 항목의 행 자체가 없을 때만** `(확인 필요)` 로 둔다. 추정 금지.',
  // 실측 실패 2건(2026-08-01): ①본문의 "총 사업비 4,800만원"에 합을 맞추려 첨부의
  // 12,500,000 을 버리고 10,800,000 을 지어냄 ②총액과 안 맞자 아예 (확인 필요)로 보류함.
  // 둘 다 "총액을 맞춰야 한다"는 착각이라 한 줄로 함께 막는다.
  'D) 본문의 총액·목표치와 첨부 값이 안 맞아도 **첨부 값을 그대로 쓴다**.',
  '   합계를 맞추려고 배분·역산하거나, 안 맞는다는 이유로 보류하지 않는다.',
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
  /** 첨부 줄 아래의 갈아끼우는 영역 — say()/paint() 는 여기만 건드린다. */
  private content!: HTMLElement;
  private picker!: HTMLInputElement;
  private srcInfo!: HTMLElement;
  private source: SourceDoc | null = null;
  private grids: TableGrid[] = [];
  private fills: Fill[] = [];
  private rows: Array<{ on: HTMLInputElement; input: HTMLInputElement; fill: Fill }> = [];
  /** AI 도우미가 넘겨준 사용자 지시(예: "강사비는 주 3회 기준") — 1회성 */
  private hint = '';
  /**
   * scan 세대 번호. 자료를 붙이면 scan 이 다시 도는데, **먼저 뜬 호출(자료 없음)의 응답이
   * 늦게 도착해 덮어쓰는** 경합이 실제로 났다 — 첨부를 붙였는데 첨부를 안 본 답이 화면에
   * 남아, 프롬프트 탓으로 오인하기 딱 좋았다(2026-08-01 실측). 옛 세대 결과는 버린다.
   */
  private scanSeq = 0;

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

    // 자료 첨부 — **파일 선택**으로 했다. 브라우저 기본 <input type="file"> 은 접근성·
    // 키보드·모바일이 공짜고, 끌어놓기는 모달 위 드롭존이 편집 캔버스의 drop 과 얽힌다.
    const bar = document.createElement('div');
    bar.className = 'tfill-src';
    const pick = document.createElement('label');
    pick.className = 'tfill-pick';
    pick.innerHTML = '<i class="ph ph-paperclip"></i>자료 첨부';
    this.picker = document.createElement('input');
    this.picker.type = 'file';
    this.picker.accept = '.csv,.xlsx,.txt';
    this.picker.hidden = true;
    this.picker.addEventListener('change', () => void this.attach());
    pick.appendChild(this.picker);
    this.srcInfo = document.createElement('span');
    this.srcInfo.className = 'tfill-srcinfo';
    bar.append(pick, this.srcInfo);
    this.body.appendChild(bar);

    this.content = document.createElement('div');
    this.content.className = 'tfill-content';
    this.body.appendChild(this.content);
    this.resetSrcInfo();
    return this.body;
  }

  show(hint = ''): void {
    this.hint = hint;
    super.show();
    void this.scan();
  }

  private say(html: string): void {
    this.content.innerHTML = `<div class="tfill-msg">${html}</div>`;
  }

  /** 첨부 없음 상태의 안내 — PDF 제외를 여기서 못 박는다(사용자에게 화면으로 알리기). */
  private resetSrcInfo(): void {
    this.srcInfo.className = 'tfill-srcinfo';
    this.srcInfo.textContent = '엑셀(.xlsx)·CSV 만 됩니다 (PDF 제외). 첨부한 자료는 표·본문과 함께 AI 서버로 전송됩니다.';
  }

  /**
   * 고른 파일을 읽어 붙이고 다시 물어본다.
   * ⚠ 자료가 통째로 외부로 나가므로 **몇 행·몇 자가 나가는지** 화면에 숫자로 밝힌다.
   */
  private async attach(): Promise<void> {
    const file = this.picker.files?.[0];
    this.picker.value = ''; // 같은 파일을 다시 골라도 change 가 오게
    if (!file) return;
    if (!canPolish(currentDocKind())) return; // 아동 관찰기록에서는 첨부도 막는다
    try {
      this.source = await readSourceFile(file);
    } catch (err) {
      this.source = null;
      this.srcInfo.className = 'tfill-srcinfo is-error';
      this.srcInfo.textContent = err instanceof Error ? err.message : String(err);
      return;
    }
    const s = this.source;
    this.srcInfo.className = 'tfill-srcinfo is-on';
    this.srcInfo.textContent = `${s.name} · ${s.rows.length}행 ${s.text.length}자 전송`
      + (s.truncated ? ` (전체 ${s.totalRows}행 중 앞 ${s.rows.length}행만)` : '')
      + ' · 이 내용이 AI 서버로 나갑니다';
    const off = document.createElement('button');
    off.className = 'tfill-srcoff';
    off.type = 'button';
    off.textContent = '떼기';
    off.addEventListener('click', () => {
      this.source = null;
      this.resetSrcInfo();
      void this.scan();
    });
    this.srcInfo.appendChild(off);
    void this.scan();
  }

  /** 표를 읽고 빈칸을 세고, 있으면 AI 를 부른다. 빈칸이 없으면 부르지 않는다. */
  private async scan(): Promise<void> {
    const seq = ++this.scanSeq;
    this.rows = [];
    if (!canPolish(currentDocKind())) {
      this.picker.disabled = true; // 자료 첨부 경로로도 못 새게 함께 막는다
      this.source = null;
      this.say('아동 관찰기록에서는 AI 표 채우기를 쓸 수 없습니다.<br>기록 내용이 외부로 나가지 않도록 막아 둔 기능입니다.');
      return;
    }
    this.picker.disabled = false;
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
    const src = this.source
      ? `\n\n[첨부 자료 — ${this.source.name}]\n${this.source.text}`
      : '';
    const mask = maskNames(`${ctx}${refs}${src}${hint}\n\n${grid}`);
    let fills: Array<{ table: number; row: number; col: number; text: string }> = [];
    try {
      const res = await fetch('/api/ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: this.source ? SYSTEM + SOURCE_RULE : SYSTEM },
            { role: 'user', content: mask.masked },
          ],
          temperature: 0.3, // 표 값은 창의성이 아니라 일관성이다
          max_tokens: 2048,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        error?: string | { message?: string };
      };
      if (seq !== this.scanSeq) return; // 그 사이 자료를 붙였다 — 이 답은 헌 것이다
      if (!res.ok) {
        const e = typeof json.error === 'string' ? json.error : json.error?.message;
        this.say(`AI 호출에 실패했습니다.<br>${e ?? res.status}`);
        return;
      }
      const m = json.choices?.[0]?.message;
      const raw = m?.content?.trim() ? m.content : (m?.reasoning_content ?? '');
      fills = parseFills(unmaskNames(raw, mask));
    } catch (err) {
      if (seq !== this.scanSeq) return;
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
    this.content.innerHTML = '';
    const head = document.createElement('p');
    head.className = 'tfill-head';
    head.textContent = `${this.fills.length}칸 제안입니다. 확인하고 고친 뒤 적용하세요 — 이미 채워진 칸은 건드리지 않습니다.`
      + (this.source ? ` (첨부 ${this.source.name} 참조)` : '');
    this.content.appendChild(head);

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
    this.content.appendChild(list);
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
