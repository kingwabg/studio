/**
 * [캔버스 한컴 포크] 표 격자 읽기 — 의존성 0(DOM·다이얼로그 없음).
 *
 * table-fill.ts 에서 추출(2026-08-05). 사용처가 둘이 됐다:
 *   · 표 빈칸 채우기 대화상자(table-fill.ts)
 *   · AI 문서 에이전트(canva-ai-agent.ts) — 채팅으로 표를 읽고 고칠 때
 * 에이전트 테스트가 Node strip 모드로 돌아 DOM 의존(ModalDialog)을 못 끌고 온다 —
 * 그래서 순수 로직만 이 파일로 뗐다.
 *
 * ⚠ 좌표는 getTableCellBboxes 가 주는 row/col 만 쓴다 — cellIdx 를 행×열로 계산하면
 *   병합된 표에서 어긋난다. 외부 공모 서식에서 "있는 텍스트를 빈칸으로 오인"하는
 *   실사고의 원인이 정확히 그 산술이었다(2026-08-05).
 */

export interface GridCell { row: number; col: number; cellIdx: number; text: string }
export interface TableGrid {
  para: number; controlIdx: number; rowCount: number; colCount: number; cells: GridCell[];
}

export interface TableGridWasm {
  getTableCellBboxes(s: number, p: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
  getCellParagraphCount(s: number, p: number, ci: number, cell: number): number;
  getCellParagraphLength(s: number, p: number, ci: number, cell: number, cp: number): number;
  getTextInCell(s: number, p: number, ci: number, cell: number, cp: number, off: number, n: number): string;
}

/** 실제 존재하는 셀만 열거해 텍스트까지 읽는다(병합 안전). */
export function readTable(w: TableGridWasm, sec: number, t: {
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
    } catch { /* 못 읽는 셀(중첩 표 등)은 빈 칸이 아니라 '모름' — 부르는 쪽에서 제외한다 */ }
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
