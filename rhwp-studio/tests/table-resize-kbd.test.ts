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

test('Alt 정렬 그룹은 논리 경계 기준 — 어긋난 세그먼트도 줄 전체가 함께 움직인다', () => {
  // [2026-08-04 재설계 정본] 좌표(±1px) 필터는 어긋난 표에서 그룹을 한 셀로 무너뜨려 제거됐다.
  // 한컴: 경계선은 줄 전체가 움직인다 — px 로 어긋난 세그먼트(row1 폭 44)도 그룹에 남는다.
  // (이 테스트는 07-14 좌표 필터 시절 기대값으로 남아 있던 낡은 핀 — 2026-08-12 현행화)
  const misaligned = grid3x3({ 4: { w: 44 } });
  assert.deepEqual(
    findAlignedLogicalResizeAffectedCells(COL, { cellIdx: 1, side: 'end' }, misaligned).sort((a, b) => a - b),
    [1, 4, 7],
  );
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

test('buildKbdWholeUpdates(Alt) 세로는 display+renderHeight 로 움직인다 — 모델 최소 무동작(F5 신고) 회귀 가드', () => {
  const cells = grid3x3();
  // 모델 높이 = 한컴 빈 셀 저장 규약(패딩만 284). 예전엔 모델 클램프(284-1276<0 → 0)로 항상 무동작.
  const wasm = mockWasm(cells, Object.fromEntries([...Array(9).keys()].map(i => [i, { height: 284 }])));
  const updates = buildKbdWholeUpdates(ref, sel(0, 0), false, STEP, cells, wasm);
  assert.ok(updates.length > 0, 'Alt+세로가 무동작이면 안 된다(2026-08-12 신고)');
  const byIdx = Object.fromEntries(updates.map(u => [u.cellIdx, u]));
  const delta = (byIdx[0].renderHeight ?? 0) - 1500; // 표시 20px = 1500HU
  assert.ok(delta > 0, '경계가 이동해야 한다');
  for (const i of [0, 1, 2]) assert.equal(byIdx[i].renderHeight, 1500 + delta, '대상 행(0) 확대');
  for (const i of [3, 4, 5]) assert.equal(byIdx[i].renderHeight, 1500 - delta, '반대편 행(1) 보상 축소');
  for (const i of [6, 7, 8]) assert.equal(byIdx[i].renderHeight, 1500, '나머지 행 표시 보존');
  // 표 높이 보존: renderHeight 합 = 원래 합
  const sum = updates.reduce((a, u) => a + (u.renderHeight ?? 0), 0);
  assert.equal(sum, 1500 * 9);
});

test('buildKbdWholeUpdates(Alt) 세로 축소 한계 = 콘텐츠 글줄 바닥(contentFloors) — 유령 공간 가드', () => {
  const cells = grid3x3();
  const wasm = mockWasm(cells);
  const floors = Array(9).fill(1484); // 12pt 글줄 바닥
  const updates = buildKbdWholeUpdates(ref, sel(0, 0), false, STEP, cells, wasm, floors);
  const byIdx = Object.fromEntries(updates.map(u => [u.cellIdx, u]));
  // 반대편(row1, 1500)은 1484 밑으로 못 줄어듦 → delta 는 16으로 클램프
  assert.equal(byIdx[3].renderHeight, 1484, '보상측이 글줄 바닥에서 멈춰야 한다');
  assert.equal(byIdx[0].renderHeight, 1516);
});

test('buildKbdWholeUpdates(Alt) 가로: 걸침(span) 반대편도 보상된다 — 표 폭 증가(어긋난 표) 회귀 가드', () => {
  // col1 이 rows0-1 을 걸치는 병합 셀(cellIdx 1, rowSpan 2) — row1 의 col0(3) 이웃 페어 탐색은
  // b.row===1 정확일치라 이 걸침 셀을 놓친다(구현 종전 결함). 보상 집합 방식이면 잡힌다.
  const cells = grid3x3().filter(c => c.cellIdx !== 4);
  const span = cells.find(c => c.cellIdx === 1)!;
  Object.assign(span, { rowSpan: 2, h: 40 });
  const wasm = mockWasm(cells);
  const updates = buildKbdWholeUpdates(ref, sel(0, 0), true, STEP, cells, wasm);
  const byIdx = Object.fromEntries(updates.map(u => [u.cellIdx, u.widthDelta]));
  assert.equal(byIdx[0], STEP); assert.equal(byIdx[3], STEP); assert.equal(byIdx[6], STEP);
  assert.equal(byIdx[1], -STEP, '걸침 반대편 셀 보상');
  assert.equal(byIdx[7], -STEP);
  // 표 폭 보존: 델타 합 = 0 이 아니라, 열폭(max) 기준 +d/−d 대칭이 성립해야 한다
  const plus = updates.filter(u => (u.widthDelta ?? 0) > 0).length;
  const minus = updates.filter(u => (u.widthDelta ?? 0) < 0).length;
  assert.ok(plus > 0 && minus > 0);
});
