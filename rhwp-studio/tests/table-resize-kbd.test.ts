import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKbdWholeUpdates,
  buildKbdSingleUpdates,
  snapKbdBoundaryDelta,
  clampSingleCellResizeDelta,
  clampCompensatedResizeDelta,
  findAlignedLogicalResizeAffectedCells,
  MIN_COL_WIDTH_HWP,
  KBD_RESIZE_STEP_HWP,
  type CellRange,
  type TableRef,
  type CellPropsProvider,
} from '../src/engine/table-resize-kbd.ts';
import type { CellBbox } from '../src/core/types.ts';
import type { BorderEdge } from '../src/engine/table-resize-renderer.ts';

const ref: TableRef = { sec: 0, ppi: 0, ci: 2 };
const STEP = KBD_RESIZE_STEP_HWP;
const COL: BorderEdge = { type: 'col', index: 0, pageIndex: 0 };

// 3×3 표 mock — 각 열 40px·각 행 20px, 좌상단(0,0). cellIdx = row*3+col.
// 기본 상태에서 col1의 오른쪽 경계(x+w)는 세 행 모두 80(정렬), 마찬가지로 각 행 바닥은 정렬.
function grid3x3(overrides: Record<number, Partial<CellBbox>> = {}): CellBbox[] {
  const colX = [0, 40, 80];
  const rowY = [0, 20, 40];
  const cells: CellBbox[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells.push({ cellIdx: r * 3 + c, row: r, col: c, rowSpan: 1, colSpan: 1, pageIndex: 0, x: colX[c], y: rowY[r], w: 40, h: 20 });
    }
  }
  for (const [idx, o] of Object.entries(overrides)) Object.assign(cells[Number(idx)], o);
  return cells;
}

// getCellProperties만 있으면 되는 mock. 기본 모델 크기 = 표시 px * 75(1px=75HWPUNIT), override 가능.
function mockWasm(cells: CellBbox[], modelOverrides: Record<number, Partial<{ width: number; height: number }>> = {}): CellPropsProvider {
  return {
    getCellProperties(_s, _p, _c, cellIdx) {
      const cell = cells.find(x => x.cellIdx === cellIdx)!;
      return { width: Math.round(cell.w * 75), height: Math.round(cell.h * 75), ...(modelOverrides[cellIdx] || {}) };
    },
  };
}

const sel = (r: number, c: number): CellRange => ({ startRow: r, startCol: c, endRow: r, endCol: c });

test('buildKbdSingleUpdates 가로(Shift)는 순수 모델 widthDelta만 낸다 — localResize 자국 없음(Alt와 합성의 핵심)', () => {
  const cells = grid3x3();
  const updates = buildKbdSingleUpdates(ref, sel(1, 1), true, STEP, cells, mockWasm(cells));
  assert.deepEqual(updates, [
    { cellIdx: 4, widthDelta: STEP },
    { cellIdx: 5, widthDelta: -STEP },
  ]);
  // 회귀 가드: render override가 붙으면(예전 버그) 이후 Alt가 이 셀을 못 움직인다
  assert.ok(updates.every(u => u.localResize === undefined && u.renderWidth === undefined));
});

test('buildKbdSingleUpdates 세로(Shift)는 localResize renderHeight를 쓴다 — 모델 행높이 자동확장 회피', () => {
  const cells = grid3x3();
  const updates = buildKbdSingleUpdates(ref, sel(1, 1), false, STEP, cells, mockWasm(cells));
  const target = updates.find(u => u.cellIdx === 4);
  assert.ok(target, 'target 셀 업데이트 존재');
  assert.equal(target!.localResize, true);
  assert.equal(typeof target!.renderHeight, 'number');
  // 모델 높이 델타(heightDelta 비0)로 처리하면 안 된다
  assert.ok(updates.every(u => u.heightDelta === undefined || u.heightDelta === 0));
});

test('buildKbdWholeUpdates(Alt)는 정렬된 세 행 전부에 모델 widthDelta + 이웃 보상을 낸다', () => {
  const cells = grid3x3();
  const updates = buildKbdWholeUpdates(ref, sel(0, 1), true, STEP, cells, mockWasm(cells));
  const byIdx = Object.fromEntries(updates.map(u => [u.cellIdx, u.widthDelta]));
  assert.equal(byIdx[1], STEP); assert.equal(byIdx[4], STEP); assert.equal(byIdx[7], STEP);
  assert.equal(byIdx[2], -STEP); assert.equal(byIdx[5], -STEP); assert.equal(byIdx[8], -STEP);
  assert.ok(updates.every(u => u.localResize === undefined));
});

test('Alt 정렬 그룹: 어긋난 행은 빠지고, 흡착 복귀하면 다시 포함된다 (합성 버그 회귀 가드)', () => {
  // row1 col1이 어긋남(폭 44 → 오른쪽 경계 84): 정렬 그룹에서 빠져야
  const misaligned = grid3x3({ 4: { w: 44 } });
  assert.deepEqual(
    findAlignedLogicalResizeAffectedCells(COL, { cellIdx: 1, side: 'end' }, misaligned).sort((a, b) => a - b),
    [1, 7],
  );
  // 흡착 복귀(폭 40 → 경계 80): 세 행 모두 다시 포함 → Alt가 통째로 움직인다
  assert.deepEqual(
    findAlignedLogicalResizeAffectedCells(COL, { cellIdx: 1, side: 'end' }, grid3x3()).sort((a, b) => a - b),
    [1, 4, 7],
  );
});

test('snapKbdBoundaryDelta는 가까운 어긋난 경계로 흡착하고, 이미 정렬된 경계는 제외한다', () => {
  // row0 col1(경계 80) 이동 시, row1 col1이 83.5로 어긋나 있으면 그리로 흡착
  const cells = grid3x3({ 4: { w: 43.5 } }); // row1 col1 오른쪽 경계 = 83.5
  const target = cells.find(c => c.cellIdx === 1)!;
  assert.equal(snapKbdBoundaryDelta(COL, target, cells, STEP), Math.round((83.5 - 80) * 75)); // 263
  // 어긋남이 없으면(전부 정렬) 흡착 안 함 → delta 그대로
  assert.equal(snapKbdBoundaryDelta(COL, target, grid3x3(), STEP), STEP);
});

test('clampSingleCellResizeDelta / clampCompensatedResizeDelta는 최소 크기(이웃)를 지킨다', () => {
  const cells = grid3x3();
  // 이웃 col2를 최소+100으로 → 100까지만 줄일 수 있음
  const wasm = mockWasm(cells, { 5: { width: MIN_COL_WIDTH_HWP + 100 } });
  assert.equal(clampSingleCellResizeDelta(wasm, ref, COL, 4, 5, 1000), 100);
  assert.equal(clampCompensatedResizeDelta(wasm, ref, COL, [{ targetCellIdx: 4, neighborCellIdx: 5 }], 1000), 100);
});
