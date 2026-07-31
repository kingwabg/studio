/**
 * AI 본문 삽입 — 줄을 **제목/소제목/본문으로 나눠 서식을 입혀** 넣는다.
 *
 * 그냥 통째로 넣으면(insertPlainTextAtCursor) 제목도 10pt 평문이라, 사용자가 다시
 * 한 줄씩 굵게·크게 만들어야 한다. 문서 도우미가 할 일의 절반이 서식이다.
 *
 * 분류는 **AI 에게 시킨 형식**을 그대로 읽는다(canva-ai-panel 의 SYSTEM_PROMPT):
 *   첫 줄        → 문서 제목
 *   `1. ` `2. `  → 대제목
 *   `가. ` `나. `→ 소제목
 *   그 외        → 본문
 * ⚠ 마크다운(#·**)은 프롬프트에서 금지했지만 모델이 흘릴 때가 있어 여기서 걷어낸다.
 *
 * 전체가 스냅샷 1회 — 되돌리기 한 번이면 통째로 사라진다.
 */

export type LineKind = 'title' | 'head1' | 'head2' | 'body' | 'table';

export interface DocLine {
  text: string;
  kind: LineKind;
  /** kind==='table' 일 때만 — 행×열 문자열 */
  rows?: string[][];
}

/**
 * 줄 종류별 서식(HWP 단위: pt×100, 문단 간격은 1/100pt).
 * 한글 공문서의 흔한 값에 맞췄다 — 제목은 가운데, 제목 앞뒤에 여백을 준다.
 */
const STYLE: Record<LineKind, {
  fontSize: number; bold: boolean;
  align: 'left' | 'center'; before?: number; after?: number;
}> = {
  title: { fontSize: 1600, bold: true, align: 'center', after: 800 },
  head1: { fontSize: 1300, bold: true, align: 'left', before: 600, after: 200 },
  head2: { fontSize: 1100, bold: true, align: 'left', before: 300, after: 100 },
  body: { fontSize: 1000, bold: false, align: 'left', after: 100 },
  table: { fontSize: 1000, bold: false, align: 'left' },
};
// ⚠ 정렬을 **모든 줄에 명시**한다. 문단을 자르면 앞 문단의 서식이 상속돼,
//   제목만 가운데로 두면 그 아래가 전부 가운데가 된다(실측 2026-08-01).

/** 모델이 흘린 마크다운 흔적을 걷어낸다 — 한글 문서엔 기호가 그대로 찍힌다. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*+]\s+/, '· ')
    .trim();
}

/** `|항목|내용|` 형태인가 — 표 한 줄. */
function isTableRow(line: string): boolean {
  return line.startsWith('|') && line.slice(1).includes('|');
}

/** `|a|b|` → ['a','b']. 마크다운 구분선(|---|)은 버린다. */
function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/**
 * AI 출력 한 덩어리를 줄별 종류로 나눈다.
 * 빈 줄은 버린다 — 문단 사이 여백은 여기서 넣는 게 아니라 문단 서식(before/after)이 만든다.
 * ⚠ 연속한 `|` 줄은 **한 덩어리(표)** 로 묶는다. 줄마다 문단으로 넣으면 표가 아니라
 *   막대기만 늘어선 본문이 된다.
 */
export function classifyLines(raw: string): DocLine[] {
  const lines = raw.split('\n').map(stripMarkdown).filter((l) => l.length > 0);
  const out: DocLine[] = [];
  let i = 0;
  let first = true;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]);
        // 마크다운 구분선(|---|---|)은 표 데이터가 아니다
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) out.push({ text: '', kind: 'table', rows });
      continue;
    }
    const text = lines[i];
    const kind: LineKind = first ? 'title'
      : /^\d+[.)]\s/.test(text) ? 'head1'
      : /^[가-힣][.)]\s/.test(text) ? 'head2'
      : 'body';
    out.push({ text, kind });
    first = false;
    i += 1;
  }
  return out;
}

interface Ih {
  getCursorPosition(): { sectionIndex: number; paragraphIndex: number; charOffset: number };
  executeOperation(d: unknown): unknown;
}

/**
 * 커서 자리에 서식을 입혀 넣는다. 반환 = 넣은 줄 수.
 *
 * ⚠ 한 번의 스냅샷으로 묶는다 — 줄마다 기록하면 20줄짜리 초안을 되돌리는 데
 *   Ctrl+Z 를 20번 눌러야 한다(「전부 적용」에서 같은 판단을 했다).
 */
export function insertFormatted(ih: Ih, raw: string): number {
  const lines = classifyLines(raw);
  if (lines.length === 0) return 0;
  const pos = ih.getCursorPosition();

  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'aiDocInsert',
    operation: (wasm: {
      insertText(s: number, p: number, o: number, t: string): unknown;
      splitParagraph(s: number, p: number, o: number): unknown;
      applyCharFormat(s: number, p: number, from: number, to: number, json: string): unknown;
      applyParaFormat(s: number, p: number, json: string): unknown;
      createTableEx(o: Record<string, unknown>): { paraIdx?: number; controlIdx?: number };
      insertTextInCell(s: number, pp: number, ci: number, cei: number, cpi: number, o: number, t: string): unknown;
      getTableCellBboxes(s: number, pp: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
    }) => {
      const sec = pos.sectionIndex;
      let para = pos.paragraphIndex;
      let offset = pos.charOffset;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.kind === 'table' && line.rows?.length) {
          // 표가 놓일 문단의 정렬을 먼저 왼쪽으로 — 앞 문단(제목)에서 상속된 가운데가 남는다
          try { wasm.applyParaFormat(sec, para, JSON.stringify({ alignment: 'left' })); } catch { /* 표시용 */ }
          insertTable(wasm, sec, para, offset, line.rows);
          // ⚠ 글자취급 표는 **글자 한 칸**을 차지한다. offset 에서 자르면 표 앞이 잘려
          //   표가 다음 문단으로 밀리고 뒤 글자가 표 앞에 붙는다(실측 2026-08-01).
          //   표 뒤(offset + 1)에서 잘라야 이어 쓸 자리가 생긴다.
          if (i < lines.length - 1) {
            wasm.splitParagraph(sec, para, offset + 1);
            para += 1;
            offset = 0;
          }
          continue;
        }

        const { text, kind } = line;
        wasm.insertText(sec, para, offset, text);
        // 글자 수는 코드포인트 기준 — str.length 는 UTF-16 이라 이모지에서 어긋난다.
        const len = [...text].length;
        const st = STYLE[kind];
        wasm.applyCharFormat(sec, para, offset, offset + len,
          JSON.stringify({ fontSize: st.fontSize, bold: st.bold }));
        // 문단 서식은 문단 전체 속성이라 offset 과 무관하다
        // ⚠ 키 이름은 `alignment` 다 — `align` 으로 보내면 조용히 무시된다(실측 2026-08-01).
        const para_props: Record<string, unknown> = { alignment: st.align };
        if (st.before !== undefined) para_props.before = st.before;
        if (st.after !== undefined) para_props.after = st.after;
        if (Object.keys(para_props).length > 0) {
          try { wasm.applyParaFormat(sec, para, JSON.stringify(para_props)); } catch { /* 서식 실패가 삽입을 막지 않는다 */ }
        }

        if (i < lines.length - 1) {
          wasm.splitParagraph(sec, para, offset + len);
          para += 1;
          offset = 0;
        }
      }
      return null;
    },
  });
  return lines.length;
}

/**
 * 표 하나를 만들고 셀을 채운다.
 * ⚠ 셀 좌표는 `getTableCellBboxes` 가 주는 row/col 로 찾는다 — cellIdx 를 행×열로
 *   계산하면 병합된 표에서 어긋난다(다른 기능에서 같은 방식을 쓴다).
 */
function insertTable(
  wasm: {
    createTableEx(o: Record<string, unknown>): { paraIdx?: number; controlIdx?: number };
    insertTextInCell(s: number, pp: number, ci: number, cei: number, cpi: number, o: number, t: string): unknown;
    getTableCellBboxes(s: number, pp: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
  },
  sec: number, para: number, offset: number, rows: string[][],
): void {
  const rowCount = rows.length;
  const colCount = Math.max(...rows.map((r) => r.length));
  const res = wasm.createTableEx({
    sectionIdx: sec, paraIdx: para, charOffset: offset,
    rowCount, colCount, treatAsChar: true,
  });
  const pp = res.paraIdx ?? para;
  const ci = res.controlIdx;
  if (ci === undefined) return;
  const seen = new Set<number>();
  for (const b of wasm.getTableCellBboxes(sec, pp, ci)) {
    if (seen.has(b.cellIdx)) continue;
    seen.add(b.cellIdx);
    const text = rows[b.row]?.[b.col] ?? '';
    if (text) wasm.insertTextInCell(sec, pp, ci, b.cellIdx, 0, 0, text);
  }
}
