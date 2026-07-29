// [한컴 대조 실측 2026-07-30] 표 셀 단위 클립보드 조작 — cell-copy.ts 가 남긴 "미확정" 구멍을
// 한컴 실조작 오라클로 확정해 채운 모듈.
//
// 한컴 실측 결과(webhwp 새 한글):
//  · 셀 블록 Ctrl+X → 표 구조는 그대로, **셀 내용만** 잘라낸다(클립보드엔 TSV/표 HTML).
//  · 셀 안에 표를 붙여넣으면 「셀 붙이기」 대화상자로 7가지를 묻는다 —
//    위/왼쪽/오른쪽/아래로 밀어내기 4종 · 덮어쓰기(기본) · 내용만 덮어쓰기 · 셀 안에 표로 넣기.
// 이 모듈은 그 중 **덮어쓰기(기본값)** 의미론을 구현한다: 커서 셀을 좌상단 기준으로 삼아
// 원본 그리드를 셀별로 채운다. 밀어내기 3종·셀 안에 표로 넣기는 표 구조 변경이 필요해
// 별도 작업(대화상자 UI와 함께) — 범위 결정은 사용자 몫이라 여기서 임의 축소하지 않고 남긴다.
//
// 순수 파서(parseHtmlTableGrid)와 wasm 의존부(fillCells/clearCells)를 분리해 단위 테스트 가능하게 둔다
// (cell-copy.ts 와 같은 분리 패턴).

import type { WasmBridge } from '@/core/wasm-bridge';
import type { CellBbox } from '@/core/types';
import type { CellTableContext, CellRange } from './cell-copy';

/**
 * 붙여넣기 HTML 이 표 하나면 셀 텍스트 그리드로 파싱한다. 표가 아니면 null.
 * 병합(colspan/rowspan)은 원본 자리만 채우고 연장 자리는 빈 칸으로 둔다(덮어쓰기 기본값에서
 * 병합 구조까지 이식하려면 표 재구성이 필요 — 그건 대화상자 작업의 몫).
 */
export function parseHtmlTableGrid(html: string): string[][] | null {
  if (!html || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const grid: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const row: string[] = [];
    for (const td of Array.from(tr.querySelectorAll('td, th'))) {
      row.push((td.textContent ?? '').replace(/\s+/g, ' ').trim());
      const colSpan = Number((td as HTMLTableCellElement).getAttribute('colspan') ?? '1') || 1;
      for (let i = 1; i < colSpan; i++) row.push('');
    }
    if (row.length > 0) grid.push(row);
  }
  return grid.length > 0 ? grid : null;
}

function bboxes(wasm: WasmBridge, ctx: CellTableContext): CellBbox[] {
  const { sec, ppi, ci, cellPath } = ctx;
  return cellPath && cellPath.length > 0
    ? (wasm.getTableCellBboxesByPath(sec, ppi, JSON.stringify(cellPath)) as CellBbox[])
    : (wasm.getTableCellBboxes(sec, ppi, ci) as CellBbox[]);
}

/** 셀 하나의 모든 문단 텍스트를 지운다(문단 구조는 유지 — 한컴 셀 오려두기와 같다). */
function clearOneCell(wasm: WasmBridge, ctx: CellTableContext, cellIdx: number): void {
  const { sec, ppi, ci } = ctx;
  const paraCount = wasm.getCellParagraphCount(sec, ppi, ci, cellIdx);
  for (let p = 0; p < paraCount; p++) {
    const len = wasm.getCellParagraphLength(sec, ppi, ci, cellIdx, p);
    if (len > 0) wasm.deleteTextInCell(sec, ppi, ci, cellIdx, p, 0, len);
  }
}

/** 선택된 셀 범위의 내용을 지운다(표 구조 유지). 지운 셀 수를 반환. */
export function clearCellRange(
  wasm: WasmBridge, ctx: CellTableContext, range: CellRange, excluded?: Set<string>,
): number {
  let cleared = 0;
  for (const b of bboxes(wasm, ctx)) {
    if (b.row < range.startRow || b.row > range.endRow) continue;
    if (b.col < range.startCol || b.col > range.endCol) continue;
    if (excluded?.has(`${b.row},${b.col}`)) continue;
    clearOneCell(wasm, ctx, b.cellIdx);
    cleared++;
  }
  return cleared;
}

/**
 * 커서 셀을 좌상단으로 삼아 그리드를 셀별로 덮어쓴다(한컴 「셀 붙이기 → 덮어쓰기」).
 * 표 경계를 넘는 부분은 버린다(한컴도 표를 늘리지 않는다). 채운 셀 수를 반환.
 */
export function fillCellsFrom(
  wasm: WasmBridge, ctx: CellTableContext, anchorCellIdx: number, grid: string[][],
): number {
  const all = bboxes(wasm, ctx);
  const anchor = all.find((b) => b.cellIdx === anchorCellIdx);
  if (!anchor) return 0;
  let filled = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const target = all.find((b) => b.row === anchor.row + r && b.col === anchor.col + c);
      if (!target) continue; // 표 밖 — 버린다
      clearOneCell(wasm, ctx, target.cellIdx);
      const value = grid[r][c];
      if (value) wasm.insertTextInCell(ctx.sec, ctx.ppi, ctx.ci, target.cellIdx, 0, 0, value);
      filled++;
    }
  }
  return filled;
}
