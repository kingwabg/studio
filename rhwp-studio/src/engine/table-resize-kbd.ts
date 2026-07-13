/** [캔버스 한컴 포크] 표 셀 리사이즈 순수 로직 — input-handler-table.ts에서 분리.
 * 브라우저/wasm 의존 없음(데이터·콜백만) → Node 단위 테스트 가능(tests/table-resize-kbd.test.ts).
 * 마우스 경로(finishResizeDrag 등)와 키보드 경로가 공유하는 기하/클램프 헬퍼의 단일 소스. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CellBbox } from '@/core/types';
import type { BorderEdge } from './table-resize-renderer';

// 표 리사이즈 최소 크기 — 행/열 분리(이전엔 단일 200 HWPUNIT=0.7mm라 무한 찌부러짐).
// 리서치(한컴·Word): 최소는 "한 줄 높이+안여백"(행)·"셀 좌우 안여백+최소 글자폭"(열)이 기준.
export const MIN_ROW_HEIGHT_HWP = 1276; // ≈4.5mm — 기본 한 줄(10pt) + 위/아래 안여백
export const MIN_COL_WIDTH_HWP = 1417;  // ≈5.0mm — 셀 좌우 안여백 3.6mm + 최소 글자폭
export const minCellSizeHwp = (t: 'row' | 'col'): number => (t === 'col' ? MIN_COL_WIDTH_HWP : MIN_ROW_HEIGHT_HWP);
// 키보드 리사이즈 1스텝 ≈1mm (Alt/Shift+방향키).
export const KBD_RESIZE_STEP_HWP = 283;

export interface TableRef { sec: number; ppi: number; ci: number }
export interface CellRange { startRow: number; startCol: number; endRow: number; endCol: number }
export interface KbdResizeUpdate {
  cellIdx: number;
  widthDelta?: number;
  heightDelta?: number;
  localResize?: boolean;
  renderWidth?: number;
  renderHeight?: number;
}
/** getCellProperties만 있으면 되는 최소 인터페이스(테스트에서 mock). */
export interface CellPropsProvider {
  getCellProperties(sec: number, ppi: number, ci: number, cellIdx: number): { width: number; height: number };
}

// ── 정렬 그룹 / 이웃 ──────────────────────────────────────────────

// 경계 좌표가 같은(정렬된) 셀들만 — 열/행 인덱스가 아니라 실제 경계 좌표(±1px)로 묶는다.
export function findAlignedLogicalResizeAffectedCells(
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): number[] {
  const targetBox = bboxes.find(b => b.cellIdx === target.cellIdx);
  if (!targetBox) return [];
  const tolerance = 1.0;
  const rounded = (v: number) => Math.round(v / tolerance) * tolerance;

  if (edge.type === 'col') {
    const boundaryCol = target.side === 'end'
      ? targetBox.col + targetBox.colSpan
      : targetBox.col;
    const targetCoord = rounded(target.side === 'end' ? targetBox.x + targetBox.w : targetBox.x);
    return [...new Set(
      bboxes
        .filter(b =>
          b.col + b.colSpan === boundaryCol &&
          Math.abs(rounded(b.x + b.w) - targetCoord) <= tolerance)
        .map(b => b.cellIdx),
    )];
  }

  const boundaryRow = target.side === 'end'
    ? targetBox.row + targetBox.rowSpan
    : targetBox.row;
  const targetCoord = rounded(target.side === 'end' ? targetBox.y + targetBox.h : targetBox.y);
  return [...new Set(
    bboxes
      .filter(b =>
        b.row + b.rowSpan === boundaryRow &&
        Math.abs(rounded(b.y + b.h) - targetCoord) <= tolerance)
      .map(b => b.cellIdx),
  )];
}

export function findResizeCompensationNeighbor(
  edge: BorderEdge,
  bbox: CellBbox,
  bboxes: CellBbox[],
): number | null {
  if (edge.type === 'col') {
    const neighbor = bboxes.find(b => b.row === bbox.row && b.col === bbox.col + bbox.colSpan);
    return neighbor?.cellIdx ?? null;
  }
  const neighbor = bboxes.find(b => b.col === bbox.col && b.row === bbox.row + bbox.rowSpan);
  return neighbor?.cellIdx ?? null;
}

// ── 크기 조회 ────────────────────────────────────────────────────

export function getCellModelSize(props: { width: number; height: number }, edge: BorderEdge): number {
  return edge.type === 'col' ? props.width : props.height;
}

export function getCellDisplaySize(box: CellBbox, edge: BorderEdge): number {
  return Math.round((edge.type === 'col' ? box.w : box.h) * 75);
}

// ── 클램프(최소 크기 가드) ───────────────────────────────────────

export function clampSingleCellResizeDelta(
  wasm: CellPropsProvider,
  tableRef: TableRef,
  edge: BorderEdge,
  targetCellIdx: number,
  neighborCellIdx: number | null,
  requestedDelta: number,
): number {
  if (neighborCellIdx === null || requestedDelta === 0) return requestedDelta;
  try {
    const targetProps = wasm.getCellProperties(tableRef.sec, tableRef.ppi, tableRef.ci, targetCellIdx);
    const neighborProps = wasm.getCellProperties(tableRef.sec, tableRef.ppi, tableRef.ci, neighborCellIdx);
    const targetSize = edge.type === 'col' ? targetProps.width : targetProps.height;
    const neighborSize = edge.type === 'col' ? neighborProps.width : neighborProps.height;
    if (!Number.isFinite(targetSize) || !Number.isFinite(neighborSize)) return requestedDelta;

    if (requestedDelta > 0) {
      const maxDelta = Math.max(0, Math.round(neighborSize - minCellSizeHwp(edge.type)));
      return Math.min(requestedDelta, maxDelta);
    }
    const maxDelta = Math.max(0, Math.round(targetSize - minCellSizeHwp(edge.type)));
    return -Math.min(Math.abs(requestedDelta), maxDelta);
  } catch {
    return requestedDelta;
  }
}

export function clampSingleCellDisplayDelta(
  edge: BorderEdge,
  targetDisplaySize: number,
  neighborDisplaySize: number | null,
  requestedDelta: number,
): number {
  if (neighborDisplaySize === null || requestedDelta === 0) return requestedDelta;
  if (requestedDelta > 0) {
    const maxDelta = Math.max(0, Math.round(neighborDisplaySize - minCellSizeHwp(edge.type)));
    return Math.min(requestedDelta, maxDelta);
  }
  const maxDelta = Math.max(0, Math.round(targetDisplaySize - minCellSizeHwp(edge.type)));
  return -Math.min(Math.abs(requestedDelta), maxDelta);
}

export function clampCompensatedResizeDelta(
  wasm: CellPropsProvider,
  tableRef: TableRef,
  edge: BorderEdge,
  pairs: Array<{ targetCellIdx: number; neighborCellIdx: number | null }>,
  requestedDelta: number,
): number {
  if (requestedDelta === 0) return 0;
  const finiteLimits: number[] = [];
  for (const pair of pairs) {
    try {
      const targetProps = wasm.getCellProperties(tableRef.sec, tableRef.ppi, tableRef.ci, pair.targetCellIdx);
      const targetSize = edge.type === 'col' ? targetProps.width : targetProps.height;
      if (requestedDelta < 0 && Number.isFinite(targetSize)) {
        finiteLimits.push(Math.max(0, Math.round(targetSize - minCellSizeHwp(edge.type))));
      }
      if (pair.neighborCellIdx !== null) {
        const neighborProps = wasm.getCellProperties(tableRef.sec, tableRef.ppi, tableRef.ci, pair.neighborCellIdx);
        const neighborSize = edge.type === 'col' ? neighborProps.width : neighborProps.height;
        if (requestedDelta > 0 && Number.isFinite(neighborSize)) {
          finiteLimits.push(Math.max(0, Math.round(neighborSize - minCellSizeHwp(edge.type))));
        }
      }
    } catch {
      // 조회 실패 셀은 clamp 대상에서 제외.
    }
  }
  if (finiteLimits.length === 0) return requestedDelta;
  const limit = Math.min(...finiteLimits);
  if (requestedDelta > 0) return Math.min(requestedDelta, limit);
  return -Math.min(Math.abs(requestedDelta), limit);
}

export function clampCompensatedDisplayDelta(
  edge: BorderEdge,
  pairs: Array<{ targetBox: CellBbox; neighborBox: CellBbox | null }>,
  requestedDelta: number,
): number {
  if (requestedDelta === 0) return 0;
  const finiteLimits: number[] = [];
  for (const pair of pairs) {
    if (requestedDelta > 0) {
      if (!pair.neighborBox) continue;
      finiteLimits.push(Math.max(0, getCellDisplaySize(pair.neighborBox, edge) - minCellSizeHwp(edge.type)));
    } else {
      finiteLimits.push(Math.max(0, getCellDisplaySize(pair.targetBox, edge) - minCellSizeHwp(edge.type)));
    }
  }
  if (finiteLimits.length === 0) return requestedDelta;
  const limit = Math.min(...finiteLimits);
  if (requestedDelta > 0) return Math.min(requestedDelta, limit);
  return -Math.min(Math.abs(requestedDelta), limit);
}

// ── localResize(render override) 힌트 ────────────────────────────

export function pushLocalResizeWidthHint(
  updates: KbdResizeUpdate[],
  cellIdx: number,
  renderWidth: number,
  widthDelta = 0,
): void {
  const existing = updates.find(update => update.cellIdx === cellIdx);
  if (existing) {
    existing.localResize = true;
    existing.renderWidth = renderWidth;
    if (widthDelta !== 0) existing.widthDelta = widthDelta;
    return;
  }
  updates.push({ cellIdx, widthDelta, localResize: true, renderWidth });
}

export function pushLocalResizeHeightHint(
  updates: KbdResizeUpdate[],
  cellIdx: number,
  renderHeight: number,
  heightDelta = 0,
): void {
  const existing = updates.find(update => update.cellIdx === cellIdx);
  if (existing) {
    existing.localResize = true;
    existing.renderHeight = renderHeight;
    if (heightDelta !== 0) existing.heightDelta = heightDelta;
    return;
  }
  updates.push({ cellIdx, heightDelta, localResize: true, renderHeight });
}

export function pushLocalResizeDisplayHint(
  updates: KbdResizeUpdate[],
  edge: BorderEdge,
  cellIdx: number,
  renderSize: number,
  sizeDelta = 0,
): void {
  if (edge.type === 'col') {
    pushLocalResizeWidthHint(updates, cellIdx, renderSize, sizeDelta);
  } else {
    pushLocalResizeHeightHint(updates, cellIdx, renderSize, sizeDelta);
  }
}

// ── 흡착 ─────────────────────────────────────────────────────────

// 이동한 경계가 어긋난 세그먼트(같은 축, 다른 위치)에 SNAP_PX 이내로 가까우면 그 위치로 재정렬.
// 현재 위치(정렬된 것)와 ALIGN_TOL 이내인 경계는 제외(이미 정렬됨).
export function snapKbdBoundaryDelta(edge: BorderEdge, targetBox: CellBbox, bboxes: CellBbox[], delta: number): number {
  if (delta === 0) return 0;
  const isHoriz = edge.type === 'col';
  const boundaryLine = isHoriz ? targetBox.col + targetBox.colSpan : targetBox.row + targetBox.rowSpan;
  const origPx = isHoriz ? targetBox.x + targetBox.w : targetBox.y + targetBox.h;
  const newPx = origPx + delta / 75; // delta(HWPUNIT) → px (75 HWPUNIT = 1px)
  const SNAP_PX = KBD_RESIZE_STEP_HWP / 75;
  const ALIGN_TOL = 1.5; // 이 이내면 "현재와 정렬됨" 간주 → 흡착 제외 (findAligned 1px + 여유)
  let best: number | null = null;
  let bestDist = SNAP_PX + 0.01;
  for (const b of bboxes) {
    const bLine = isHoriz ? b.col + b.colSpan : b.row + b.rowSpan;
    if (bLine !== boundaryLine || b.cellIdx === targetBox.cellIdx) continue;
    const p = isHoriz ? b.x + b.w : b.y + b.h;
    if (Math.abs(p - origPx) < ALIGN_TOL) continue; // 현재 위치와 같은(정렬된) 경계는 제외
    const dist = Math.abs(newPx - p);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  return best === null ? delta : Math.round((best - origPx) * 75);
}

// ── 빌더: 셀 선택 키보드 리사이즈 → resizeTableCells updates 배열 ──

// Alt = 경계 좌표가 같은(정렬된) 셀들의 경계선을 통째 이동(이웃 보상, 표 크기 유지).
export function buildKbdWholeUpdates(
  ctx: TableRef,
  range: CellRange,
  isHoriz: boolean,
  step: number,
  bboxes: CellBbox[],
  wasm: CellPropsProvider,
): KbdResizeUpdate[] {
  const edge: BorderEdge = { type: isHoriz ? 'col' : 'row', index: 0, pageIndex: 0 };
  const line = isHoriz ? range.endCol : range.endRow;
  const targetBox = bboxes.find(b =>
    b.row >= range.startRow && b.row <= range.endRow && b.col >= range.startCol && b.col <= range.endCol &&
    (isHoriz ? b.col + b.colSpan - 1 === line : b.row + b.rowSpan - 1 === line));
  if (!targetBox) return [];
  const alignedIdxs = findAlignedLogicalResizeAffectedCells(edge, { cellIdx: targetBox.cellIdx, side: 'end' }, bboxes);
  if (alignedIdxs.length === 0) return [];
  const pairs = alignedIdxs.map(idx => {
    const b = bboxes.find(x => x.cellIdx === idx) as CellBbox;
    return { targetCellIdx: idx, neighborCellIdx: findResizeCompensationNeighbor(edge, b, bboxes) };
  });
  let delta = snapKbdBoundaryDelta(edge, targetBox, bboxes, step); // 흡착(어긋난 세그먼트 재정렬)
  delta = clampCompensatedResizeDelta(wasm, ctx, edge, pairs, delta);
  if (delta === 0) return [];
  const updates: KbdResizeUpdate[] = [];
  const added = new Set<number>();
  for (const p of pairs) {
    updates.push(isHoriz ? { cellIdx: p.targetCellIdx, widthDelta: delta } : { cellIdx: p.targetCellIdx, heightDelta: delta });
    if (p.neighborCellIdx !== null && !added.has(p.neighborCellIdx)) {
      added.add(p.neighborCellIdx);
      updates.push(isHoriz ? { cellIdx: p.neighborCellIdx, widthDelta: -delta } : { cellIdx: p.neighborCellIdx, heightDelta: -delta });
    }
  }
  return updates;
}

// Shift = 선택 셀의 단일 경계만 이동. 가로(열 폭)=순수 모델(그 행 경계만·override 안 남김·Alt와
// 합성). 세로(행 높이)=모델 높이가 자동확장 최소값이라 renderHeight(localResize)로 표시만 강제.
export function buildKbdSingleUpdates(
  ctx: TableRef,
  range: CellRange,
  isHoriz: boolean,
  requestedDelta: number,
  bboxes: CellBbox[],
  wasm: CellPropsProvider,
): KbdResizeUpdate[] {
  const edge: BorderEdge = { type: isHoriz ? 'col' : 'row', index: 0, pageIndex: 0 };
  const line = isHoriz ? range.endCol : range.endRow;
  const targets: CellBbox[] = [];
  const seen = new Set<number>();
  for (const b of bboxes) {
    const inSel = b.row >= range.startRow && b.row <= range.endRow && b.col >= range.startCol && b.col <= range.endCol;
    const endLine = isHoriz ? b.col + b.colSpan - 1 : b.row + b.rowSpan - 1;
    if (!inSel || endLine !== line || seen.has(b.cellIdx)) continue;
    seen.add(b.cellIdx);
    targets.push(b);
  }
  if (targets.length === 0) return [];
  const updates: KbdResizeUpdate[] = [];
  const doneLines = new Set<number>(); // 이미 처리한 행(가로)/열(세로) — 한 세그먼트만
  for (const target of targets) {
    const lineKey = isHoriz ? target.row : target.col;
    if (doneLines.has(lineKey)) continue;
    doneLines.add(lineKey);
    const neighborIdx = findResizeCompensationNeighbor(edge, target, bboxes);
    if (isHoriz) {
      // 순수 모델(target +delta / neighbor -delta). 예전 localResize는 자국이 wasm에 남아 이후
      // Alt(모델 경계 통째)가 그 셀에만 안 먹었다 — Shift로 어긋냈다 흡착 복귀 후 Alt가 그 열만
      // 빼먹는 버그(실측 2026-07-14). 모델 widthDelta는 셀별 독립이라 그 행 경계만 움직이며 자국 無.
      let delta = snapKbdBoundaryDelta(edge, target, bboxes, requestedDelta); // 흡착
      delta = clampSingleCellResizeDelta(wasm, ctx, edge, target.cellIdx, neighborIdx, delta);
      if (delta === 0) continue;
      updates.push({ cellIdx: target.cellIdx, widthDelta: delta });
      if (neighborIdx !== null) updates.push({ cellIdx: neighborIdx, widthDelta: -delta });
    } else {
      // 세로(행 높이)는 renderHeight(localResize)로 표시만 강제(단일 셀). 마우스 Shift+드래그와 동일.
      const neighborBox = neighborIdx === null ? null : bboxes.find(b => b.cellIdx === neighborIdx) ?? null;
      const targetDisplay = getCellDisplaySize(target, edge);
      const snapped = snapKbdBoundaryDelta(edge, target, bboxes, requestedDelta); // 흡착
      let applied = Math.max(minCellSizeHwp(edge.type), targetDisplay + snapped) - targetDisplay;
      if (neighborBox) {
        const nDisplay = getCellDisplaySize(neighborBox, edge);
        applied = nDisplay - Math.max(minCellSizeHwp(edge.type), nDisplay - applied); // 이웃 최소 클램프
      }
      if (applied === 0) continue;
      const tFinal = targetDisplay + applied;
      pushLocalResizeHeightHint(updates, target.cellIdx, tFinal, 0);
      if (neighborBox) {
        const nFinal = getCellDisplaySize(neighborBox, edge) - applied;
        pushLocalResizeHeightHint(updates, neighborBox.cellIdx, nFinal, 0);
      }
      // 같은 열의 나머지 셀은 현재 높이로 보존(localResize)
      for (const b of bboxes) {
        if (b.col !== lineKey) continue;
        if (b.cellIdx === target.cellIdx || b.cellIdx === neighborIdx) continue;
        pushLocalResizeHeightHint(updates, b.cellIdx, getCellDisplaySize(b, edge));
      }
    }
  }
  return updates;
}
