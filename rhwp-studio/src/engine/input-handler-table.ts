/** input-handler table methods — extracted from InputHandler class */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { MoveTableCommand, MovePictureCommand, MoveShapeCommand } from './command';
import { getObjectProperties, setObjectProperties } from './input-handler-picture';
import type { CellBbox } from '@/core/types';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { BorderEdge } from './table-resize-renderer';
import { showToast } from '@/ui/toast';
import { snapLayerFor as _snapLayerFor, tableHoverFor as _tableHoverFor } from './canvas-snap'; // [캔버스 한컴 포크]
import { showConfirm } from '@/ui/confirm-dialog';
import { showCellClearChoice } from '@/ui/cell-clear-dialog';

// [캔버스 한컴 포크] 표 리사이즈 순수 로직은 table-resize-kbd.ts로 분리(Node 단위 테스트 가능).
import {
  MIN_ROW_HEIGHT_HWP, MIN_COL_WIDTH_HWP, minCellSizeHwp, KBD_RESIZE_STEP_HWP,
  findAlignedLogicalResizeAffectedCells, findResizeCompensationNeighbor,
  getCellModelSize, getCellDisplaySize,
  clampSingleCellResizeDelta, clampSingleCellDisplayDelta, clampCompensatedResizeDelta, clampCompensatedDisplayDelta,
  pushLocalResizeWidthHint, pushLocalResizeHeightHint, pushLocalResizeDisplayHint,
  buildKbdWholeUpdates, buildKbdSingleUpdates,
} from './table-resize-kbd';

// [캔버스 한컴 포크] 내부 경계선 조절 스냅 (합체 4단계-③)
// "① 셀 경계선 조절"은 표 크기를 유지한 채 옆 셀과 재분배한다. 여기에만 스냅을 건다 —
// 드래그 중인 경계선이 표 안 다른 행/열의 경계선(같은 축)과 ±EPS로 겹치면 착 붙어 어긋난
// 표를 정렬한다. "② 외곽 핸들 리사이즈"(표 전체 성장)와는 완전히 분리된 경로다.
const BOUNDARY_SNAP_EPS_PX = 4;
export function applyBoundarySnap(
  state: { snapTargets?: number[]; minResizePos: number; maxResizePos: number },
  newPos: number,
  altKey: boolean,
): { pos: number; hit: boolean } {
  if (altKey || !state.snapTargets?.length) return { pos: newPos, hit: false };
  let best: { d: number; t: number } | null = null;
  for (const t of state.snapTargets) {
    if (t < state.minResizePos || t > state.maxResizePos) continue; // 이웃을 넘는 스냅 금지
    const d = Math.abs(t - newPos);
    if (d <= BOUNDARY_SNAP_EPS_PX && (!best || d < best.d)) best = { d, t };
  }
  return best ? { pos: best.t, hit: true } : { pos: newPos, hit: false };
}

function isOuterResizeEdge(self: any, edge: BorderEdge, pageBboxes: CellBbox[]): boolean {
  try {
    const { rowLines, colLines } = self.tableResizeRenderer.computeBorderLines(pageBboxes);
    if (edge.type === 'row') {
      return edge.index === 0 || edge.index === rowLines.length - 1;
    }
    return edge.index === 0 || edge.index === colLines.length - 1;
  } catch {
    return false;
  }
}

function computeResizePositionBounds(
  self: any,
  edge: BorderEdge,
  pageBboxes: CellBbox[],
  singleCellTarget?: { cellIdx: number; side: 'start' | 'end' } | null,
  bboxes?: CellBbox[],
): { min: number; max: number } {
  const minSizePx = minCellSizeHwp(edge.type) / 75;
  if (singleCellTarget && bboxes) {
    const targetBox = bboxes.find(b => b.cellIdx === singleCellTarget.cellIdx);
    if (targetBox) {
      const neighborIdx = findSingleCellResizeNeighbor(edge, singleCellTarget, bboxes);
      const neighborBox = neighborIdx === null
        ? null
        : bboxes.find(b => b.cellIdx === neighborIdx) ?? null;
      const minX = Math.min(...bboxes.map(b => b.x));
      const maxX = Math.max(...bboxes.map(b => b.x + b.w));
      const minY = Math.min(...bboxes.map(b => b.y));
      const maxY = Math.max(...bboxes.map(b => b.y + b.h));

      if (edge.type === 'col') {
        if (singleCellTarget.side === 'end') {
          return {
            min: targetBox.x + minSizePx,
            max: neighborBox ? neighborBox.x + neighborBox.w - minSizePx : maxX,
          };
        }
        return {
          min: neighborBox ? neighborBox.x + minSizePx : minX,
          max: targetBox.x + targetBox.w - minSizePx,
        };
      }

      if (singleCellTarget.side === 'end') {
        return {
          min: targetBox.y + minSizePx,
          max: neighborBox ? neighborBox.y + neighborBox.h - minSizePx : maxY,
        };
      }
      return {
        min: neighborBox ? neighborBox.y + minSizePx : minY,
        max: targetBox.y + targetBox.h - minSizePx,
      };
    }
  }

  const { rowLines, colLines } = self.tableResizeRenderer.computeBorderLines(pageBboxes);
  const lines = edge.type === 'row'
    ? rowLines.map((line: any) => ({ pos: line.y, index: line.index }))
    : colLines.map((line: any) => ({ pos: line.x, index: line.index }));
  const lineIdx = lines.findIndex((line: any) => line.index === edge.index);
  if (lineIdx < 0) return { min: -Infinity, max: Infinity };

  const prev = lines[lineIdx - 1]?.pos;
  const next = lines[lineIdx + 1]?.pos;
  return {
    min: prev === undefined ? -Infinity : prev + minSizePx,
    max: next === undefined ? Infinity : next - minSizePx,
  };
}

function computeAffectedResizePositionBounds(
  edge: BorderEdge,
  affectedCellIndices: number[],
  bboxes: CellBbox[],
): { min: number; max: number } | null {
  const minSizePx = minCellSizeHwp(edge.type) / 75;
  const minX = Math.min(...bboxes.map(b => b.x));
  const maxX = Math.max(...bboxes.map(b => b.x + b.w));
  const minY = Math.min(...bboxes.map(b => b.y));
  const maxY = Math.max(...bboxes.map(b => b.y + b.h));
  let min = -Infinity;
  let max = Infinity;
  let found = false;

  for (const cellIdx of affectedCellIndices) {
    const targetBox = bboxes.find(b => b.cellIdx === cellIdx);
    if (!targetBox) continue;
    const neighborIdx = findResizeCompensationNeighbor(edge, targetBox, bboxes);
    const neighborBox = neighborIdx === null
      ? null
      : bboxes.find(b => b.cellIdx === neighborIdx) ?? null;

    if (edge.type === 'col') {
      min = Math.max(min, targetBox.x + minSizePx);
      max = Math.min(max, neighborBox ? neighborBox.x + neighborBox.w - minSizePx : maxX);
    } else {
      min = Math.max(min, targetBox.y + minSizePx);
      max = Math.min(max, neighborBox ? neighborBox.y + neighborBox.h - minSizePx : maxY);
    }
    found = true;
  }

  if (!found) return null;
  if (!Number.isFinite(min)) min = edge.type === 'col' ? minX : minY;
  if (!Number.isFinite(max)) max = edge.type === 'col' ? maxX : maxY;
  return { min, max };
}

function promoteResizeDragToSingleCell(self: any, state: any, shiftKey: boolean): { cellIdx: number; side: 'start' | 'end' } | null {
  if (state.singleCellTarget) return state.singleCellTarget;
  if (!shiftKey || !state.resizeTarget) return null;

  state.singleCellTarget = state.resizeTarget;
  state.shiftResize = true;
  const resizeBounds = computeResizePositionBounds(
    self,
    state.edge,
    state.pageBboxes,
    state.singleCellTarget,
    state.bboxes,
  );
  state.minResizePos = resizeBounds.min;
  state.maxResizePos = resizeBounds.max;
  return state.singleCellTarget;
}

function clampResizePosition(pos: number, bounds: { min: number; max: number }): number {
  return Math.min(Math.max(pos, bounds.min), bounds.max);
}

function selectTableObjectFromResize(this: any, tableRef: { sec: number; ppi: number; ci: number }): void {
  this.cursor.clearSelection();
  this.cursor.exitCellSelectionMode();
  this.cellSelectionRenderer?.clear();
  this.exitPictureObjectSelectionIfNeeded();
  this.cursor.enterTableObjectSelectionDirect(tableRef.sec, tableRef.ppi, tableRef.ci);
  this.active = true;
  this.caret.hide();
  this.fieldMarker.hide();
  this.selectionRenderer.clear();
  this.renderTableObjectSelection();
  this.eventBus.emit('table-object-selection-changed', true);
  this.eventBus.emit('command-state-changed');
  this.textarea.focus();
}

function findSingleCellResizeTarget(
  edge: BorderEdge,
  pageX: number,
  pageY: number,
  bboxes: CellBbox[],
  borderOriginalPos: number,
): { cellIdx: number; side: 'start' | 'end' } | null {
  const tolerance = 4.0;
  const rounded = (v: number) => Math.round(v * 10) / 10;
  const border = rounded(borderOriginalPos);
  const candidates: Array<{ cellIdx: number; side: 'start' | 'end'; score: number }> = [];

  for (const b of bboxes) {
    if (edge.type === 'col') {
      if (pageY < b.y - tolerance || pageY > b.y + b.h + tolerance) continue;
      const startDistance = Math.abs(rounded(b.x) - border);
      const endDistance = Math.abs(rounded(b.x + b.w) - border);
      if (startDistance <= tolerance) {
        candidates.push({ cellIdx: b.cellIdx, side: 'start', score: Math.abs(pageY - (b.y + b.h / 2)) });
      }
      if (endDistance <= tolerance) {
        candidates.push({ cellIdx: b.cellIdx, side: 'end', score: Math.abs(pageY - (b.y + b.h / 2)) });
      }
    } else {
      if (pageX < b.x - tolerance || pageX > b.x + b.w + tolerance) continue;
      const startDistance = Math.abs(rounded(b.y) - border);
      const endDistance = Math.abs(rounded(b.y + b.h) - border);
      if (startDistance <= tolerance) {
        candidates.push({ cellIdx: b.cellIdx, side: 'start', score: Math.abs(pageX - (b.x + b.w / 2)) });
      }
      if (endDistance <= tolerance) {
        candidates.push({ cellIdx: b.cellIdx, side: 'end', score: Math.abs(pageX - (b.x + b.w / 2)) });
      }
    }
  }

  if (candidates.length === 0) return null;

  const preferredSide: 'start' | 'end' =
    (edge.type === 'col' ? pageX : pageY) <= borderOriginalPos ? 'end' : 'start';
  const preferred = candidates
    .filter(c => c.side === preferredSide)
    .sort((a, b) => a.score - b.score)[0];
  if (preferred) return { cellIdx: preferred.cellIdx, side: preferred.side };

  const fallback = candidates.sort((a, b) => a.score - b.score)[0];
  return { cellIdx: fallback.cellIdx, side: fallback.side };
}

function findSingleCellResizeNeighbor(
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): number | null {
  const targetBox = bboxes.find(b => b.cellIdx === target.cellIdx);
  if (!targetBox) return null;

  if (edge.type === 'col') {
    const neighbor = target.side === 'end'
      ? bboxes.find(b => b.row === targetBox.row && b.col === targetBox.col + targetBox.colSpan)
      : bboxes.find(b => b.row === targetBox.row && b.col + b.colSpan === targetBox.col);
    return neighbor?.cellIdx ?? null;
  }

  const neighbor = target.side === 'end'
    ? bboxes.find(b => b.col === targetBox.col && b.row === targetBox.row + targetBox.rowSpan)
    : bboxes.find(b => b.col === targetBox.col && b.row + b.rowSpan === targetBox.row);
  return neighbor?.cellIdx ?? null;
}

function localResizeSegmentKey(
  tableRef: { sec: number; ppi: number; ci: number },
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): string | null {
  const targetBox = bboxes.find(b => b.cellIdx === target.cellIdx);
  if (!targetBox) return null;

  if (edge.type === 'col') {
    const boundaryCol = target.side === 'end'
      ? targetBox.col + targetBox.colSpan
      : targetBox.col;
    return [
      tableRef.sec,
      tableRef.ppi,
      tableRef.ci,
      'col',
      boundaryCol,
      targetBox.row,
      targetBox.rowSpan,
    ].join(':');
  }

  const boundaryRow = target.side === 'end'
    ? targetBox.row + targetBox.rowSpan
    : targetBox.row;
  return [
    tableRef.sec,
    tableRef.ppi,
    tableRef.ci,
    'row',
    boundaryRow,
    targetBox.col,
    targetBox.colSpan,
  ].join(':');
}

function isSegmentSeparatedFromLogicalBoundary(
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): boolean {
  const targetBox = bboxes.find(b => b.cellIdx === target.cellIdx);
  if (!targetBox) return false;
  const tolerance = 1.0;
  const rounded = (v: number) => Math.round(v / tolerance) * tolerance;

  if (edge.type === 'col') {
    const boundaryCol = target.side === 'end'
      ? targetBox.col + targetBox.colSpan
      : targetBox.col;
    const boundaryCells = bboxes.filter(b => b.col + b.colSpan === boundaryCol);
    if (boundaryCells.length <= 1) return true;
    const counts = new Map<number, number>();
    for (const b of boundaryCells) {
      const coord = rounded(b.x + b.w);
      counts.set(coord, (counts.get(coord) ?? 0) + 1);
    }
    const targetCoord = rounded(target.side === 'end' ? targetBox.x + targetBox.w : targetBox.x);
    const targetCount = counts.get(targetCoord) ?? 0;
    const maxCount = Math.max(...counts.values());
    return targetCount < maxCount;
  }

  const boundaryRow = target.side === 'end'
    ? targetBox.row + targetBox.rowSpan
    : targetBox.row;
  const boundaryCells = bboxes.filter(b => b.row + b.rowSpan === boundaryRow);
  if (boundaryCells.length <= 1) return true;
  const counts = new Map<number, number>();
  for (const b of boundaryCells) {
    const coord = rounded(b.y + b.h);
    counts.set(coord, (counts.get(coord) ?? 0) + 1);
  }
  const targetCoord = rounded(target.side === 'end' ? targetBox.y + targetBox.h : targetBox.y);
  const targetCount = counts.get(targetCoord) ?? 0;
  const maxCount = Math.max(...counts.values());
  return targetCount < maxCount;
}

function isKnownLocalResizeSegment(
  self: any,
  tableRef: { sec: number; ppi: number; ci: number },
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): boolean {
  const key = localResizeSegmentKey(tableRef, edge, target, bboxes);
  if (!key) return false;
  return self.tableLocalResizeSegments?.has(key) === true &&
    isSegmentSeparatedFromLogicalBoundary(edge, target, bboxes);
}

function hasLocalResizeHistory(
  self: any,
  tableRef: { sec: number; ppi: number; ci: number },
): boolean {
  const segments = self.tableLocalResizeSegments;
  if (!segments) return false;
  const prefix = `${tableRef.sec}:${tableRef.ppi}:${tableRef.ci}:`;
  for (const key of segments) {
    if (typeof key === 'string' && key.startsWith(prefix)) return true;
  }
  return false;
}

function rememberLocalResizeSegment(
  self: any,
  tableRef: { sec: number; ppi: number; ci: number },
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): void {
  const key = localResizeSegmentKey(tableRef, edge, target, bboxes);
  if (!key) return;
  if (!self.tableLocalResizeSegments) self.tableLocalResizeSegments = new Set<string>();
  self.tableLocalResizeSegments.add(key);
}

export function startResizeDrag(this: any,
  edge: BorderEdge,
  pageX: number, pageY: number,
  pageBboxes: CellBbox[],
  shiftResize = false,
): void {
  if (!this.cachedTableRef || !this.cachedCellBboxes || !this.tableResizeRenderer) return;

  // 경계선 원래 위치 계산
  const { rowLines, colLines } = this.tableResizeRenderer.computeBorderLines(pageBboxes);
  let borderOriginalPos: number;
  if (edge.type === 'row') {
    const line = rowLines.find((l: any) => l.index === edge.index);
    if (!line) return;
    borderOriginalPos = line.y;
  } else {
    const line = colLines.find((l: any) => l.index === edge.index);
    if (!line) return;
    borderOriginalPos = line.x;
  }

  // [캔버스 한컴 포크] 스냅 타깃 = 같은 축 다른 경계선 위치(자기 자신 제외). 정렬된 표에선
  // 이웃이 한 칸 떨어져 있어 스냅이 안 뜨고, 어긋난 표에서만 다른 행/열 선에 착 붙는다.
  const snapTargets: number[] = (edge.type === 'row' ? rowLines : colLines)
    .map((l: any) => (edge.type === 'row' ? l.y : l.x))
    .filter((p: number) => Math.abs(p - borderOriginalPos) > 0.5);

  // 영향받는 셀: 경계선에 해당하는 edge에 맞닿은 셀
  const tolerance = 1.0;
  const ry = (v: number) => Math.round(v * 10) / 10;
  const coordinateAffectedCellIndices: number[] = [];

  for (const b of this.cachedCellBboxes) {
    if (edge.type === 'col') {
      if (Math.abs(ry(b.x + b.w) - ry(borderOriginalPos)) <= tolerance) {
        coordinateAffectedCellIndices.push(b.cellIdx);
      }
    } else {
      if (Math.abs(ry(b.y + b.h) - ry(borderOriginalPos)) <= tolerance) {
        coordinateAffectedCellIndices.push(b.cellIdx);
      }
    }
  }

  const resizeTarget = findSingleCellResizeTarget(
    edge,
    pageX,
    pageY,
    this.cachedCellBboxes,
    borderOriginalPos,
  );
  if (!resizeTarget) return;
  const shouldResizeSingleCell = shiftResize ||
    isKnownLocalResizeSegment(this, this.cachedTableRef, edge, resizeTarget, this.cachedCellBboxes);
  const singleCellTarget = shouldResizeSingleCell ? resizeTarget : null;
  const logicalAffectedCellIndices = !shouldResizeSingleCell
    ? findAlignedLogicalResizeAffectedCells(edge, resizeTarget, this.cachedCellBboxes)
    : [];
  const affectedCellIndices = logicalAffectedCellIndices.length > 0
    ? logicalAffectedCellIndices
    : coordinateAffectedCellIndices;
  if (affectedCellIndices.length === 0 && !singleCellTarget) return;
  const affectedBounds = !singleCellTarget && hasLocalResizeHistory(this, this.cachedTableRef)
    ? computeAffectedResizePositionBounds(edge, affectedCellIndices, this.cachedCellBboxes)
    : null;
  const resizeBounds = affectedBounds ?? computeResizePositionBounds(
    this,
    edge,
    pageBboxes,
    singleCellTarget,
    this.cachedCellBboxes,
  );

  this.isResizeDragging = true;
  this.resizeDragState = {
    edge,
    tableRef: { ...this.cachedTableRef },
    bboxes: this.cachedCellBboxes,
    pageBboxes,
    affectedCellIndices,
    borderOriginalPos,
    minResizePos: resizeBounds.min,
    maxResizePos: resizeBounds.max,
    resizeTarget,
    singleCellTarget,
    shiftResize: shouldResizeSingleCell,
    snapTargets, // [캔버스 한컴 포크]
  };

  // mouseup 리스너 등록 (document 레벨)
  document.addEventListener('mouseup', this.onMouseUpBound, { once: true });
}

export function updateResizeDrag(this: any, e: MouseEvent): void {
  if (!this.resizeDragState || !this.tableResizeRenderer) return;

  const zoom = this.viewportManager.getZoom();
  const scrollContent = this.container.querySelector('#scroll-content');
  if (!scrollContent) return;
  const contentRect = scrollContent.getBoundingClientRect();
  const contentX = e.clientX - contentRect.left;
  const contentY = e.clientY - contentRect.top;
  const pageIdx = this.resizeDragState.edge.pageIndex;
  const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
  const pageDisplayWidth = this.virtualScroll.getPageWidth(pageIdx);
  const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
  const pageX = (contentX - pageLeft) / zoom;
  const pageY = (contentY - pageOffset) / zoom;
  const singleCellTarget = promoteResizeDragToSingleCell(this, this.resizeDragState, e.shiftKey);

  const rawNewPos = this.resizeDragState.edge.type === 'row' ? pageY : pageX;
  const clamped = clampResizePosition(rawNewPos, {
    min: this.resizeDragState.minResizePos,
    max: this.resizeDragState.maxResizePos,
  });
  // [캔버스 한컴 포크] 다른 경계선에 스냅(Alt=해제). 스냅되면 전체 페이지 관통 accent 선으로
  // "캐치"를 명확히 알린다(표 범위만 도는 드래그 마커와 색·길이로 구분).
  const snap = applyBoundarySnap(this.resizeDragState, clamped, e.altKey);
  const newPos = snap.pos;
  this.resizeDragState.snappedPos = newPos;
  const layer = _snapLayerFor(this.container);
  if (snap.hit) {
    layer.show([{ axis: this.resizeDragState.edge.type === 'row' ? 'y' : 'x', pos: newPos }], {
      zoom,
      pageLeft: this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth),
      pageTop: this.virtualScroll.getPageOffset(pageIdx),
      pageWpx: this.virtualScroll.getPageWidth(pageIdx) / zoom,
      pageHpx: this.virtualScroll.getPageHeight(pageIdx) / zoom,
    });
  } else {
    layer.clear();
  }
  const markerBboxes = singleCellTarget
    ? this.resizeDragState.bboxes.filter((b: CellBbox) =>
      b.cellIdx === singleCellTarget.cellIdx)
    : undefined;

  // 드래그 마커 표시
  this.tableResizeRenderer.showDragMarker(
    this.resizeDragState.edge.type,
    newPos,
    pageIdx,
    this.resizeDragState.pageBboxes,
    zoom,
    markerBboxes,
  );
}

export function finishResizeDrag(this: any, e: MouseEvent): void {
  if (!this.resizeDragState || !this.tableResizeRenderer) {
    this.cleanupResizeDrag();
    return;
  }

  const state = this.resizeDragState;

  // mouseup 이벤트 좌표에서 page 좌표 계산
  const zoom = this.viewportManager.getZoom();
  const scrollContent = this.container.querySelector('#scroll-content');
  if (!scrollContent) {
    this.cleanupResizeDrag();
    return;
  }
  const contentRect = scrollContent.getBoundingClientRect();
  const contentX = e.clientX - contentRect.left;
  const contentY = e.clientY - contentRect.top;
  const pageIdx = state.edge.pageIndex;
  const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
  const pageDisplayWidth = this.virtualScroll.getPageWidth(pageIdx);
  const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
  const pageX = (contentX - pageLeft) / zoom;
  const pageY = (contentY - pageOffset) / zoom;
  const singleCellTarget = promoteResizeDragToSingleCell(this, state, e.shiftKey);

  const rawNewPos = state.edge.type === 'row' ? pageY : pageX;
  const clamped = clampResizePosition(rawNewPos, {
    min: state.minResizePos,
    max: state.maxResizePos,
  });
  // [캔버스 한컴 포크] 커밋도 스냅된 위치 기준(update와 동일 규칙) — 스냅선 정리
  const newPos = applyBoundarySnap(state, clamped, e.altKey).pos;
  _snapLayerFor(this.container).clear();
  const deltaPagePx = newPos - state.borderOriginalPos;
  // 1 page px (96 DPI) = 75 HWPUNIT (7200/96)
  const deltaHwpUnit = Math.round(deltaPagePx * 75);

  // 너무 작은 드래그는 무시 (1px 미만)
  if (Math.abs(deltaHwpUnit) < 75) {
    const shouldSelectTable = isOuterResizeEdge(this, state.edge, state.pageBboxes);
    const tableRef = { ...state.tableRef };
    this.cleanupResizeDrag();
    if (shouldSelectTable && !singleCellTarget) {
      selectTableObjectFromResize.call(this, tableRef);
    }
    return;
  }

  // Shift 단일 셀 resize는 가로/세로 모두 singleCellTarget 분기에서 처리한다.
  // 일반 세로 경계는 셀 선택 상태와 무관하게 행 전체 높이 조절로 처리한다.
  let updates: Array<{
    cellIdx: number;
    widthDelta?: number;
    heightDelta?: number;
    localResize?: boolean;
    renderWidth?: number;
    renderHeight?: number;
  }>;
  const inCellSel = this.cursor.isInCellSelectionMode();
  const range = inCellSel ? this.cursor.getSelectedCellRange() : null;

  if (state.singleCellTarget) {
    const neighborIdx = findSingleCellResizeNeighbor(
      state.edge,
      state.singleCellTarget,
      state.bboxes,
    );
    const requestedDelta = state.singleCellTarget.side === 'end' ? deltaHwpUnit : -deltaHwpUnit;
    const targetBox = state.bboxes.find((b: CellBbox) => b.cellIdx === state.singleCellTarget?.cellIdx);
    const neighborBox = neighborIdx === null
      ? null
      : state.bboxes.find((b: CellBbox) => b.cellIdx === neighborIdx) ?? null;
    if (!targetBox) {
      this.cleanupResizeDrag();
      return;
    }
    const targetDisplaySize = getCellDisplaySize(targetBox, state.edge);
    const neighborDisplaySize = neighborBox ? getCellDisplaySize(neighborBox, state.edge) : null;
    const delta = neighborBox
      ? clampSingleCellDisplayDelta(state.edge, targetDisplaySize, neighborDisplaySize, requestedDelta)
      : clampSingleCellResizeDelta(
        this.wasm,
        state.tableRef,
        state.edge,
        state.singleCellTarget.cellIdx,
        neighborIdx,
        requestedDelta,
      );
    if (delta === 0) {
      this.cleanupResizeDrag();
      return;
    }
    const targetProps = this.wasm.getCellProperties(
      state.tableRef.sec,
      state.tableRef.ppi,
      state.tableRef.ci,
      state.singleCellTarget.cellIdx,
    );
    const targetDesiredSize = Math.max(minCellSizeHwp(state.edge.type), targetDisplaySize + delta);
    const targetModelDelta = state.edge.type === 'col'
      ? targetDesiredSize - getCellModelSize(targetProps, state.edge)
      : 0;
    updates = state.edge.type === 'col'
      ? [{
        cellIdx: state.singleCellTarget.cellIdx,
        widthDelta: targetModelDelta,
        localResize: true,
        renderWidth: targetDesiredSize,
      }]
      : [{
        cellIdx: state.singleCellTarget.cellIdx,
        heightDelta: 0,
        localResize: true,
        renderHeight: targetDesiredSize,
      }];
    if (neighborIdx !== null && neighborBox) {
      const neighborProps = this.wasm.getCellProperties(
        state.tableRef.sec,
        state.tableRef.ppi,
      state.tableRef.ci,
      neighborIdx,
    );
    const neighborDesiredSize = Math.max(
      minCellSizeHwp(state.edge.type),
      getCellDisplaySize(neighborBox, state.edge) - delta,
      );
      const neighborModelDelta = state.edge.type === 'col'
        ? neighborDesiredSize - getCellModelSize(neighborProps, state.edge)
        : 0;
      updates.push(state.edge.type === 'col'
        ? {
          cellIdx: neighborIdx,
          widthDelta: neighborModelDelta,
          localResize: true,
          renderWidth: neighborDesiredSize,
        }
        : {
          cellIdx: neighborIdx,
          heightDelta: 0,
          localResize: true,
          renderHeight: neighborDesiredSize,
        });
    }
    if (state.edge.type === 'col') {
      for (const box of state.bboxes) {
        if (box.row !== targetBox.row) continue;
        if (box.cellIdx === state.singleCellTarget.cellIdx) continue;
        if (neighborIdx !== null && box.cellIdx === neighborIdx) continue;
        pushLocalResizeWidthHint(updates, box.cellIdx, getCellDisplaySize(box, state.edge));
      }
    } else {
      for (const box of state.bboxes) {
        if (box.col !== targetBox.col) continue;
        if (box.cellIdx === state.singleCellTarget.cellIdx) continue;
        if (neighborIdx !== null && box.cellIdx === neighborIdx) continue;
        pushLocalResizeHeightHint(updates, box.cellIdx, getCellDisplaySize(box, state.edge));
      }
    }
    updates = updates.filter(update => {
      const d = state.edge.type === 'col' ? update.widthDelta : update.heightDelta;
      return d !== 0 || update.localResize === true;
    });
    if (updates.length === 0) {
      this.cleanupResizeDrag();
      return;
    }
  } else if (state.edge.type === 'col' && inCellSel && range) {
    // 선택 셀만 추출
    const selectedBboxes = state.affectedCellIndices
      .map((cellIdx: any) => state.bboxes.find((b: any) => b.cellIdx === cellIdx))
      .filter((b: any): b is CellBbox =>
        b !== undefined &&
        b.row >= range.startRow && b.row <= range.endRow &&
        b.col >= range.startCol && b.col <= range.endCol);
    if (selectedBboxes.length === 0) {
      this.cleanupResizeDrag();
      return;
    }
    updates = [];
    const addedNeighbors = new Set<number>();
    for (const bbox of selectedBboxes) {
      if (state.edge.type === 'col') {
        updates.push({ cellIdx: bbox.cellIdx, widthDelta: deltaHwpUnit });
        // 같은 행의 오른쪽 이웃 셀에 반대 delta
        const neighbor = state.bboxes.find((b: any) =>
          b.row === bbox.row && b.col === bbox.col + bbox.colSpan);
        if (neighbor && !addedNeighbors.has(neighbor.cellIdx)) {
          updates.push({ cellIdx: neighbor.cellIdx, widthDelta: -deltaHwpUnit });
          addedNeighbors.add(neighbor.cellIdx);
        }
      } else {
        updates.push({ cellIdx: bbox.cellIdx, heightDelta: deltaHwpUnit });
        // 같은 열의 아래쪽 이웃 셀에 반대 delta
        const neighbor = state.bboxes.find((b: any) =>
          b.col === bbox.col && b.row === bbox.row + bbox.rowSpan);
        if (neighbor && !addedNeighbors.has(neighbor.cellIdx)) {
          updates.push({ cellIdx: neighbor.cellIdx, heightDelta: -deltaHwpUnit });
          addedNeighbors.add(neighbor.cellIdx);
        }
      }
    }
    if (updates.length === 0) {
      this.cleanupResizeDrag();
      return;
    }
  } else {
    // 일반 모드: 균일한 내부 경계 전체를 움직이되, 반대편 이웃 셀을 보상해 표 외곽을 유지
    if (state.affectedCellIndices.length === 0) {
      this.cleanupResizeDrag();
      return;
    }
    const targetBboxes = state.affectedCellIndices
      .map((cellIdx: any) => state.bboxes.find((b: any) => b.cellIdx === cellIdx))
      .filter((b: any): b is CellBbox => b !== undefined);
    const pairs: Array<{ targetCellIdx: number; neighborCellIdx: number | null }> =
      targetBboxes.map((bbox: CellBbox) => ({
      targetCellIdx: bbox.cellIdx,
      neighborCellIdx: findResizeCompensationNeighbor(state.edge, bbox, state.bboxes),
    }));
    const pairBoxes = pairs
      .map((pair: { targetCellIdx: number; neighborCellIdx: number | null }) => ({
        targetCellIdx: pair.targetCellIdx,
        neighborCellIdx: pair.neighborCellIdx,
        targetBox: state.bboxes.find((b: CellBbox) => b.cellIdx === pair.targetCellIdx),
        neighborBox: pair.neighborCellIdx === null
          ? null
          : state.bboxes.find((b: CellBbox) => b.cellIdx === pair.neighborCellIdx) ?? null,
      }))
      .filter((pair): pair is {
        targetCellIdx: number;
        neighborCellIdx: number | null;
        targetBox: CellBbox;
        neighborBox: CellBbox | null;
      } => pair.targetBox !== undefined);
    const hasLocalHistory = hasLocalResizeHistory(this, state.tableRef);
    const delta = hasLocalHistory
      ? clampCompensatedDisplayDelta(state.edge, pairBoxes, deltaHwpUnit)
      : clampCompensatedResizeDelta(
        this.wasm,
        state.tableRef,
        state.edge,
        pairs,
        deltaHwpUnit,
      );
    if (delta === 0) {
      this.cleanupResizeDrag();
      return;
    }
    updates = [];
    if (hasLocalHistory) {
      const updatedCells = new Set<number>();
      for (const pair of pairBoxes) {
        const targetProps = this.wasm.getCellProperties(
          state.tableRef.sec,
          state.tableRef.ppi,
          state.tableRef.ci,
          pair.targetCellIdx,
        );
        const targetDesiredSize = Math.max(
          minCellSizeHwp(state.edge.type),
          getCellDisplaySize(pair.targetBox, state.edge) + delta,
        );
        pushLocalResizeDisplayHint(
          updates,
          state.edge,
          pair.targetCellIdx,
          targetDesiredSize,
          targetDesiredSize - getCellModelSize(targetProps, state.edge),
        );
        updatedCells.add(pair.targetCellIdx);

        if (pair.neighborCellIdx !== null && pair.neighborBox && !updatedCells.has(pair.neighborCellIdx)) {
          const neighborProps = this.wasm.getCellProperties(
            state.tableRef.sec,
            state.tableRef.ppi,
            state.tableRef.ci,
            pair.neighborCellIdx,
          );
          const neighborDesiredSize = Math.max(
            minCellSizeHwp(state.edge.type),
            getCellDisplaySize(pair.neighborBox, state.edge) - delta,
          );
          pushLocalResizeDisplayHint(
            updates,
            state.edge,
            pair.neighborCellIdx,
            neighborDesiredSize,
            neighborDesiredSize - getCellModelSize(neighborProps, state.edge),
          );
          updatedCells.add(pair.neighborCellIdx);
        }
      }
      for (const box of state.bboxes) {
        if (updatedCells.has(box.cellIdx)) continue;
        pushLocalResizeDisplayHint(
          updates,
          state.edge,
          box.cellIdx,
          getCellDisplaySize(box, state.edge),
        );
      }
      updates = updates.filter(update => {
        const d = state.edge.type === 'col' ? update.widthDelta : update.heightDelta;
        return d !== 0 || update.localResize === true;
      });
    } else {
      const addedNeighbors = new Set<number>();
      for (const pair of pairs) {
        if (state.edge.type === 'col') {
          updates.push({ cellIdx: pair.targetCellIdx, widthDelta: delta });
          if (pair.neighborCellIdx !== null && !addedNeighbors.has(pair.neighborCellIdx)) {
            updates.push({ cellIdx: pair.neighborCellIdx, widthDelta: -delta });
            addedNeighbors.add(pair.neighborCellIdx);
          }
        } else {
          updates.push({ cellIdx: pair.targetCellIdx, heightDelta: delta });
          if (pair.neighborCellIdx !== null && !addedNeighbors.has(pair.neighborCellIdx)) {
            updates.push({ cellIdx: pair.neighborCellIdx, heightDelta: -delta });
            addedNeighbors.add(pair.neighborCellIdx);
          }
        }
      }
    }
  }

  // WASM 배치 API 호출 (복합 셀 보상 변경은 스냅샷으로 Undo 기록)
  try {
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'resizeTableCells',
      operation: (wasm: any) => {
        wasm.resizeTableCells(
          state.tableRef.sec,
          state.tableRef.ppi,
          state.tableRef.ci,
          updates,
        );
        return this.cursor.getPosition();
      },
    });
    if (state.shiftResize && state.singleCellTarget) {
      rememberLocalResizeSegment(
        this,
        state.tableRef,
        state.edge,
        state.singleCellTarget,
        state.bboxes,
      );
    }
    if (inCellSel) this.updateCellSelection();
  } catch (err) {
    console.warn('[InputHandler] resizeTableCells 실패:', err);
  }

  this.cleanupResizeDrag();
}

export function cleanupResizeDrag(this: any): void {
  this.isResizeDragging = false;
  this.resizeDragState = null;
  this.tableResizeRenderer?.clear();
  _snapLayerFor(this.container).clear(); // [캔버스 한컴 포크] 경계선 스냅 가이드 정리
  this.container.style.cursor = '';
  // 캐시 무효화 (크기 변경 후 bbox가 stale)
  this.cachedTableRef = null;
  this.cachedCellBboxes = null;
  if (this.dragRafId) {
    cancelAnimationFrame(this.dragRafId);
    this.dragRafId = 0;
  }
}

export function cancelImagePlacement(this: any): void {
  this.imagePlacementMode = false;
  this.imagePlacementData = null;
  this.imagePlacementDrag = null;
  this.hideImagePlacementOverlay();
  this.container.style.cursor = '';
}

export function showImagePlacementOverlay(this: any, x1: number, y1: number, x2: number, y2: number): void {
  if (!this.imagePlacementOverlay) {
    this.imagePlacementOverlay = document.createElement('div');
    this.imagePlacementOverlay.style.cssText =
      'position:fixed;border:2px dashed #0078d7;background:rgba(0,120,215,0.08);pointer-events:none;z-index:9999;';
    document.body.appendChild(this.imagePlacementOverlay);
  }
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  this.imagePlacementOverlay.style.left = `${left}px`;
  this.imagePlacementOverlay.style.top = `${top}px`;
  this.imagePlacementOverlay.style.width = `${w}px`;
  this.imagePlacementOverlay.style.height = `${h}px`;
}

export function hideImagePlacementOverlay(this: any): void {
  if (this.imagePlacementOverlay) {
    this.imagePlacementOverlay.remove();
    this.imagePlacementOverlay = null;
  }
}

export function finishImagePlacement(this: any, e: MouseEvent): void {
  const drag = this.imagePlacementDrag;
  const imgData = this.imagePlacementData;
  if (!drag || !imgData) { this.cancelImagePlacement(); return; }

  this.hideImagePlacementOverlay();

  // 클릭 위치에서 hitTest → 삽입할 문단 결정
  const hit = this.hitTestFromEvent(e);
  if (!hit) {
    this.imagePlacementDrag = null;
    this.container.style.cursor = 'crosshair';
    showToast({
      message: '그림을 넣을 문단을 찾지 못했습니다.\n문서 본문이나 표 셀 안쪽을 다시 클릭하세요.',
      durationMs: 5000,
    });
    return;
  }

  const sec = hit.sectionIndex;
  // 표 셀/글상자 안 클릭: cellPath 와 parentParaIndex (= 소유 본문 paragraph) 를 사용한다.
  // 표 셀은 기존 #1151 경로처럼 parent paragraph sibling floating 으로 삽입되고,
  // 글상자는 #1322 보강 경로에서 text_box 내부 paragraph control 로 삽입된다.
  const isTextBoxHit = hit.isTextBox === true;
  const inCell = (hit.cellPath?.length ?? 0) > 0 && hit.parentParaIndex !== undefined && !isTextBoxHit;
  const inTextBox = isTextBoxHit && (hit.cellPath?.length ?? 0) > 0 && hit.parentParaIndex !== undefined;
  const textBoxControlIdx = hit.controlIndex ?? hit.cellPath?.[0]?.controlIdx ?? hit.cellPath?.[0]?.controlIndex;
  // 표 셀: 외곽 표 소유 본문 para, 글상자: 글상자 소유 본문 para, 본문: 클릭 문단.
  const useParentPara = (inCell || inTextBox) && hit.parentParaIndex !== undefined;
  const paraIdx = useParentPara ? hit.parentParaIndex! : hit.paragraphIndex;
  const charOffset = hit.charOffset;
  const cellPathJson = (inCell || inTextBox) ? JSON.stringify(hit.cellPath) : '';

  // 크기 결정
  const zoom = this.viewportManager.getZoom();
  let wPx: number, hPx: number;
  if (drag.isDragging) {
    // 드래그 영역 크기 (화면 px → 페이지 px)
    wPx = Math.abs(drag.currentClientX - drag.startClientX) / zoom;
    hPx = Math.abs(drag.currentClientY - drag.startClientY) / zoom;
    if (wPx < 10) wPx = 10;
    if (hPx < 10) hPx = 10;
  } else {
    // 클릭만 한 경우: 원본 크기 100%
    wPx = imgData.naturalWidth;
    hPx = imgData.naturalHeight;
  }

  // px → HWPUNIT (1px = 75 HWPUNIT at 96 DPI)
  let wHwp = Math.round(wPx * 75);
  let hHwp = Math.round(hPx * 75);

  // [Task #1151 v8 결함 C / v9 결함 E] 셀 안 + 본문 floating picture 의 paper-relative
  // offset 계산. 사용자가 드래그/클릭한 위치 (drag.startClientX/Y) 를 page (= paper)
  // 좌표로 변환. v9 결함 E 후 본문 path 도 floating sibling 으로 통합되었으므로
  // inCell 제한 제거 — 본문에서도 사용자 클릭 위치 전달 필요.
  let paperOffsetXHu: number | undefined;
  let paperOffsetYHu: number | undefined;
  {
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) {
      const contentRect = scrollContent.getBoundingClientRect();
      const dragContentX = drag.startClientX - contentRect.left;
      const dragContentY = drag.startClientY - contentRect.top;
      const pageIdx = this.virtualScroll.getPageAtPoint(dragContentX, dragContentY);
      const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
      const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
      const dragPageX = (dragContentX - pageLeft) / zoom;
      const dragPageY = (dragContentY - pageOffset) / zoom;
      if (inTextBox) {
        paperOffsetXHu = 0;
        paperOffsetYHu = 0;
        try {
          const layout = this.wasm.getPageControlLayout(pageIdx);
          const shape = layout.controls.find((ctrl: any) =>
            ctrl.type === 'shape' &&
            ctrl.secIdx === sec &&
            ctrl.paraIdx === paraIdx &&
            ctrl.controlIdx === textBoxControlIdx
          );
          if (shape) {
            const props = this.wasm.getShapeProperties(sec, paraIdx, textBoxControlIdx);
            const marginLeftPx = ((props as any).tbMarginLeft ?? 0) / 75;
            const marginTopPx = ((props as any).tbMarginTop ?? 0) / 75;
            paperOffsetXHu = Math.max(0, Math.round((dragPageX - shape.x - marginLeftPx) * 75));
            paperOffsetYHu = Math.max(0, Math.round((dragPageY - shape.y - marginTopPx) * 75));
          }
        } catch {
          // 글상자 bbox 조회 실패 시 글상자 내부 좌상단 삽입으로 fallback.
          paperOffsetXHu = 0;
          paperOffsetYHu = 0;
        }
      } else {
        paperOffsetXHu = Math.round(dragPageX * 75);
        paperOffsetYHu = Math.round(dragPageY * 75);
      }
    }
  }

  // 열 폭 초과 시 비례 축소
  try {
    const pageDef = this.wasm.getPageDef(sec);
    const colWidth = pageDef.width - pageDef.marginLeft - pageDef.marginRight;
    if (wHwp > colWidth) {
      const ratio = colWidth / wHwp;
      wHwp = Math.round(colWidth);
      hHwp = Math.round(hHwp * ratio);
    }
  } catch { /* 페이지 정보 없으면 그대로 */ }

  // 개체 설명문 생성 (한컴 기본 패턴)
  const desc = `그림입니다.\r\n원본 그림의 이름: ${imgData.fileName}\r\n원본 그림의 크기: 가로 ${imgData.naturalWidth}pixel, 세로 ${imgData.naturalHeight}pixel`;

  // WASM 호출 — 스냅샷으로 기록 (Undo 지원, pasteImage 경로와 동일 패턴)
  try {
    let insertFailedMsg: string | null = null;
    this.executeOperation({ kind: 'snapshot', operationType: 'insertPicture', operation: (wasm: WasmBridge) => {
      const result = wasm.insertPicture(
        sec, paraIdx, charOffset, cellPathJson, imgData.data,
        wHwp, hHwp, imgData.naturalWidth, imgData.naturalHeight,
        imgData.ext, desc,
        paperOffsetXHu, paperOffsetYHu,
      );
      if (!result.ok) {
        insertFailedMsg = (result as any).error || '삽입 위치 또는 이미지 정보를 확인할 수 없습니다.';
        console.warn('[InputHandler] 그림 삽입 실패:', result);
      }
      return this.cursor.getPosition();
    }});
    if (insertFailedMsg) {
      showToast({
        message: `그림 삽입에 실패했습니다.\n${insertFailedMsg}`,
        durationMs: 6000,
      });
    }
  } catch (err) {
    console.warn('[InputHandler] 그림 삽입 실패:', err);
    const msg = err instanceof Error ? err.message : String(err);
    showToast({
      message: `그림 삽입에 실패했습니다.\n${msg}`,
      durationMs: 6000,
    });
  }

  // 모드 종료
  this.imagePlacementMode = false;
  this.imagePlacementData = null;
  this.imagePlacementDrag = null;
  this.container.style.cursor = '';
}

export function moveSelectedTable(this: any, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const ref = this.cursor.getSelectedTableRef();
  if (!ref) return;

  const step = Math.round(this.gridStepMm * 7200 / 25.4); // mm → HWPUNIT
  let deltaH = 0;
  let deltaV = 0;
  switch (key) {
    case 'ArrowLeft':  deltaH = -step; break;
    case 'ArrowRight': deltaH = step;  break;
    case 'ArrowUp':    deltaV = -step; break;
    case 'ArrowDown':  deltaV = step;  break;
  }

  try {
    const result = this.wasm.moveTableOffset(ref.sec, ref.ppi, ref.ci, deltaH, deltaV);
    // Undo 기록
    this.executeOperation({ kind: 'record', command:
      new MoveTableCommand(ref.sec, ref.ppi, ref.ci, deltaH, deltaV, result.ppi, result.ci),
    });
    // 문단 경계를 넘어 이동한 경우 selectedTableRef 갱신
    if (result.ppi !== ref.ppi || result.ci !== ref.ci) {
      this.cursor.updateSelectedTableRef(ref.sec, result.ppi, result.ci);
    }
    this.eventBus.emit('document-changed');
    this.renderTableObjectSelection();
  } catch (err) {
    console.warn('[InputHandler] 표 이동 실패:', err);
  }
}

export function moveSelectedPicture(this: any, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const refs = this.cursor.getSelectedPictureRefs();
  const ref = this.cursor.getSelectedPictureRef();
  if (!ref) return;

  const step = Math.round(this.gridStepMm * 7200 / 25.4); // mm → HWPUNIT
  let deltaH = 0;
  let deltaV = 0;
  switch (key) {
    case 'ArrowLeft':  deltaH = -step; break;
    case 'ArrowRight': deltaH = step;  break;
    case 'ArrowUp':    deltaV = -step; break;
    case 'ArrowDown':  deltaV = step;  break;
  }

  // 다중 선택: 모든 선택된 개체를 동일 delta만큼 이동
  const targets = refs.length > 1 ? refs : [ref];
  try {
    for (const r of targets) {
      const props = getObjectProperties.call(this, r);
      if (props.treatAsChar) continue; // treat_as_char 개체는 이동 불가
      const newHorzOffset = props.horzOffset + deltaH;
      const newVertOffset = props.vertOffset + deltaV;
      setObjectProperties.call(this, r, {
        horzOffset: newHorzOffset,
        vertOffset: newVertOffset,
      });
      const CmdClass = r.type === 'shape' || r.type === 'line' || r.type === 'group' ? MoveShapeCommand : MovePictureCommand;
      this.executeOperation({ kind: 'record', command:
        new CmdClass(r.sec, r.ppi, r.ci, deltaH, deltaV, props.horzOffset, props.vertOffset, r.cellPath),
      });
    }
    // 연결선 자동 추적
    try { this.wasm.updateConnectorsInSection(targets[0].sec); } catch { /* ignore */ }
    this.eventBus.emit('document-changed');
    this.renderPictureObjectSelection();
  } catch (err) {
    console.warn('[InputHandler] 개체 이동 실패:', err);
  }
}

export function updateMoveDrag(this: any, e: MouseEvent): void {
  if (!this.moveDragState) return;
  const zoom = this.viewportManager.getZoom();
  const sc = this.container.querySelector('#scroll-content');
  if (!sc) return;
  const cr = sc.getBoundingClientRect();
  const cx = e.clientX - cr.left;
  const cy = e.clientY - cr.top;
  const pi = this.virtualScroll.getPageAtPoint(cx, cy);
  const po = this.virtualScroll.getPageOffset(pi);
  const pw = this.virtualScroll.getPageWidth(pi);
  const pl = this.virtualScroll.getPageLeftResolved(pi, sc.clientWidth);
  const px = (cx - pl) / zoom;
  const py = (cy - po) / zoom;

  if (!this.moveDragState.hasMoved) {
    const threshold = 3 / Math.max(zoom, 0.1);
    const dxFromStart = px - this.moveDragState.startPageX;
    const dyFromStart = py - this.moveDragState.startPageY;
    if (Math.hypot(dxFromStart, dyFromStart) < threshold) return;
    this.moveDragState.hasMoved = true;
  }

  // 이전 위치와의 차이를 HWPUNIT으로 변환 (1px = 7200/96 = 75 HWPUNIT)
  const deltaXpx = px - this.moveDragState.lastPageX;
  const deltaYpx = py - this.moveDragState.lastPageY;
  const deltaH = Math.round(deltaXpx * 75);
  const deltaV = Math.round(deltaYpx * 75);

  if (deltaH === 0 && deltaV === 0) return;

  try {
    const ref = this.moveDragState.tableRef;
    const result = this.wasm.moveTableOffset(ref.sec, ref.ppi, ref.ci, deltaH, deltaV);
    if (result.ppi !== ref.ppi || result.ci !== ref.ci) {
      this.moveDragState.tableRef = { sec: ref.sec, ppi: result.ppi, ci: result.ci };
      this.cursor.updateSelectedTableRef(ref.sec, result.ppi, result.ci);
    }
    this.moveDragState.lastPageX = px;
    this.moveDragState.lastPageY = py;
    this.moveDragState.totalDeltaH += deltaH;
    this.moveDragState.totalDeltaV += deltaV;
    this.eventBus.emit('document-changed');
    this.renderTableObjectSelection();
  } catch (err) {
    console.warn('[InputHandler] 표 이동 드래그 실패:', err);
  }
}

export function finishMoveDrag(this: any): void {
  const state = this.moveDragState;

  // Undo 기록: 드래그 전체를 하나의 명령으로 기록
  if (state) {
    const { totalDeltaH, totalDeltaV, startPpi, tableRef } = state;
    if (totalDeltaH !== 0 || totalDeltaV !== 0) {
      this.executeOperation({ kind: 'record', command:
        new MoveTableCommand(
          tableRef.sec, startPpi, tableRef.ci,
          totalDeltaH, totalDeltaV,
          tableRef.ppi, tableRef.ci,
        ),
      });
    }
  }
  this.isMoveDragging = false;
  this.moveDragState = null;
  if (this.dragRafId) {
    cancelAnimationFrame(this.dragRafId);
    this.dragRafId = 0;
  }
  this.container.style.cursor = '';

  if (state?.pendingEnterCellHit && !state.hasMoved && state.totalDeltaH === 0 && state.totalDeltaV === 0) {
    this.cursor.exitTableObjectSelection();
    this.tableObjectRenderer?.clear();
    this.eventBus.emit('table-object-selection-changed', false);
    this.cursor.clearSelection();
    this.cursor.moveTo(state.pendingEnterCellHit);
    this.cursor.resetPreferredX();
    this.cursor.setAnchor();
    this.active = true;
    this.updateCaret();
    this.textarea.focus();
    // [캔버스 한컴 포크] 캔버스 모드: 재클릭 셀 진입 = 이 표의 편집 컨텍스트 시작
    if (this.canvasMode) {
      this.canvasEditingRef = { kind: 'table', sec: state.tableRef.sec, ppi: state.tableRef.ppi, ci: state.tableRef.ci };
    }
  }
}

// [캔버스 한컴 포크] 키보드 리사이즈 흡착 — 스텝 이동 후 경계가 "같은 경계 인덱스의 다른(어긋난)
// 세그먼트" 위치에 1스텝(≈1mm) 이내로 가까우면 그 위치로 딱 붙여 재정렬한다. ⚠ 핵심: '현재 위치와
// 같은(정렬된) 경계'는 흡착 대상에서 제외(ALIGN_TOL)한다 — 안 그러면 정렬 상태에서 떼어내려 해도
// 제자리로 도로 붙어 이동이 막힌다. 결과: 정렬돼 있으면 자유 이동, 어긋난 걸 되돌릴 때만 흡착.
// [캔버스 한컴 포크] 셀 선택 상태 Alt+방향키 = 경계선 "위치(정렬)"가 같은 셀들만 통째 이동.
// findAlignedLogicalResizeAffectedCells로 열/행 인덱스가 아니라 실제 경계 좌표가 같은 그룹만 고른다
// → Shift로 어긋난 세그먼트는 빠지고, 정렬된 것들만 함께 이동(반대편 보상, 표 크기 유지). 이동 후
// 어긋난 세그먼트에 가까우면 흡착해 재정렬.
export function resizeCellBoundaryWhole(this: any, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const ctx = this.cursor.getCellTableContext();
  const range = this.cursor.getSelectedCellRange();
  if (!ctx || !range) return;
  const isHoriz = (key === 'ArrowLeft' || key === 'ArrowRight');
  const step = (key === 'ArrowRight' || key === 'ArrowDown') ? KBD_RESIZE_STEP_HWP : -KBD_RESIZE_STEP_HWP;
  let bboxes: CellBbox[];
  try { bboxes = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci); } catch { return; }
  const updates = buildKbdWholeUpdates(ctx, range, isHoriz, step, bboxes, this.wasm);
  if (updates.length === 0) return;
  try {
    this.executeOperation({ kind: 'snapshot', operationType: 'resizeTableCells',
      operation: (wasm: any) => { wasm.resizeTableCells(ctx.sec, ctx.ppi, ctx.ci, updates); return this.cursor.getPosition(); } });
    this.updateCellSelection();
  } catch (err) { console.warn('[InputHandler] Alt 경계선 리사이즈 실패:', err); }
}

// [캔버스 한컴 포크] 셀 선택 상태 Shift+방향키 = 선택 셀의 "단일 경계"만 이동(localResize).
// 마우스 Shift+드래그와 동일 — 선택 셀(과 같은 행/열 이웃)만 변하고 다른 행/열의 같은 경계는
// 그대로(정렬이 깨진 로컬 리사이즈). 대상 = 선택 블록 안에서 far edge에 닿는 셀들.
export function resizeCellBoundarySingle(this: any, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const ctx = this.cursor.getCellTableContext();
  const range = this.cursor.getSelectedCellRange();
  if (!ctx || !range) return;
  const isHoriz = (key === 'ArrowLeft' || key === 'ArrowRight');
  const requestedDelta = (key === 'ArrowRight' || key === 'ArrowDown') ? KBD_RESIZE_STEP_HWP : -KBD_RESIZE_STEP_HWP;
  let bboxes: CellBbox[];
  try { bboxes = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci); } catch { return; }
  const updates = buildKbdSingleUpdates(ctx, range, isHoriz, requestedDelta, bboxes, this.wasm);
  if (updates.length === 0) return;
  try {
    this.executeOperation({ kind: 'snapshot', operationType: 'resizeTableCells',
      operation: (wasm: any) => { wasm.resizeTableCells(ctx.sec, ctx.ppi, ctx.ci, updates); return this.cursor.getPosition(); } });
    this.updateCellSelection();
  } catch (err) { console.warn('[InputHandler] Shift 단일 셀 리사이즈 실패:', err); }
}

/** 전체 표 비율 리사이즈 (phase 3, Ctrl+방향키) */
export function resizeTableProportional(this: any, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const ctx = this.cursor.getCellTableContext();
  if (!ctx) return;

  const DELTA = 200; // 1 키스트로크 당 200 HWPUNIT
  const isHoriz = (key === 'ArrowLeft' || key === 'ArrowRight');
  const delta = (key === 'ArrowRight' || key === 'ArrowDown') ? DELTA : -DELTA;

  try {
    const bboxes = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);
    const updates: Array<{ cellIdx: number; widthDelta?: number; heightDelta?: number }> = [];
    const processed = new Set<number>();

    for (const bbox of bboxes) {
      if (processed.has(bbox.cellIdx)) continue;
      processed.add(bbox.cellIdx);
      if (isHoriz) {
        updates.push({ cellIdx: bbox.cellIdx, widthDelta: delta });
      } else {
        updates.push({ cellIdx: bbox.cellIdx, heightDelta: delta });
      }
    }

    this.executeOperation({
      kind: 'snapshot',
      operationType: 'resizeTableProportional',
      operation: (wasm: any) => {
        wasm.resizeTableCells(ctx.sec, ctx.ppi, ctx.ci, updates);
        return this.cursor.getPosition();
      },
    });
    this.updateCellSelection();
  } catch (err) {
    console.warn('[InputHandler] resizeTableProportional 실패:', err);
  }
}

// ─── [캔버스 한컴 포크] 표 개체 핸들 리사이즈 = 전체 비례 스케일 (합체 4단계-②, 2026-07-11) ──
// 표 객체 선택 시 e(오른쪽=너비)·s(아래=높이)·se(대각=전체) 핸들 드래그로 표 "전체"를 비례
// 확대/축소한다. ⚠ 초판은 마지막 행/열에만 델타를 몰아 아래 행 하나가 거대해졌다(사용자 보고).
// 지금은 모든 셀을 같은 비율 sx/sy로 스케일 → 열/행 비율이 유지된 채 통째로 커지고 줄어든다.
// wasm 계약: 너비는 cell-width-equal과 동일(widthDelta=목표모델폭−현재모델폭 + renderWidth),
// 높이는 cell-height-equal과 동일(heightDelta:0 + renderHeight=현재표시높이×sy). 최소 셀 클램프.
// 프리뷰는 canvas-snap 가이드 레이어(우변·하변 위치). (_snapLayerFor는 파일 상단 import.)

type HandleCell = { cellIdx: number; modelW: number; dispHhwp: number };

export function startTableHandleResize(
  this: any,
  dir: string,
  pageX: number,
  pageY: number,
  ref: { sec: number; ppi: number; ci: number },
  pageIndex: number,
): boolean {
  if (dir !== 'e' && dir !== 's' && dir !== 'se') return false; // 아래/오른쪽/대각만
  // [캔버스 한컴 포크] 리사이즈 드래그 시작 시 hover 강조(accent)를 즉시 지운다 —
  // updateTableHandleResize는 renderTableObjectSelection을 안 불러 드래그 중 옛 크기에 얼어붙는다.
  _tableHoverFor(this.container).clear();
  try {
    const bboxes: CellBbox[] = this.wasm.getTableCellBboxes(ref.sec, ref.ppi, ref.ci);
    if (!bboxes?.length) return false;
    const bbox = this.wasm.getTableBBox(ref.sec, ref.ppi, ref.ci);
    if (!(bbox.width > 0) || !(bbox.height > 0)) return false;
    // 전 셀 수집(cellIdx 중복 제거) — 모델 폭(getCellProperties)·표시 높이(bbox.h×75)
    const seen = new Set<number>();
    const cells: HandleCell[] = [];
    for (const b of bboxes) {
      if (seen.has(b.cellIdx)) continue;
      seen.add(b.cellIdx);
      let modelW = Math.round(b.w * 75);
      try {
        const p = this.wasm.getCellProperties(ref.sec, ref.ppi, ref.ci, b.cellIdx);
        if (p?.width > 0) modelW = p.width;
      } catch { /* 모델 폭 조회 실패 시 표시 폭으로 근사 */ }
      cells.push({ cellIdx: b.cellIdx, modelW, dispHhwp: Math.max(1, Math.round(b.h * 75)) });
    }
    // [캔버스 한컴 포크] 최소 크기 유지: 열=MIN_COL_WIDTH, 행=MIN_ROW_HEIGHT. 가장 작은 셀이
    // 최소에 닿는 스케일이 하한 → 표를 비례 축소해도 어느 열/행도 기준 밑으로 안 내려간다.
    const minSx = Math.min(1, Math.max(...cells.map((c) => MIN_COL_WIDTH_HWP / c.modelW)));
    const minSy = Math.min(1, Math.max(...cells.map((c) => MIN_ROW_HEIGHT_HWP / c.dispHhwp)));
    this.tableHandleResizeState = {
      dir, ref, pageIndex, cells,
      startPageX: pageX, startPageY: pageY,
      tableW: bbox.width, tableH: bbox.height,
      left: bbox.x, top: bbox.y,
      minSx, minSy, lastSx: 1, lastSy: 1,
    };
    this.isTableHandleResizing = true;
    document.addEventListener('mouseup', this.onMouseUpBound, { once: true });
    return true;
  } catch {
    return false;
  }
}

function tableHandleScales(self: any, e: MouseEvent): { sx: number; sy: number } | null {
  const state = self.tableHandleResizeState;
  if (!state) return null;
  const sc = self.container.querySelector('#scroll-content');
  if (!sc) return null;
  const zoom = self.viewportManager.getZoom();
  const cr = sc.getBoundingClientRect();
  const pl = self.virtualScroll.getPageLeftResolved(state.pageIndex, sc.clientWidth);
  const po = self.virtualScroll.getPageOffset(state.pageIndex);
  const px = (e.clientX - cr.left - pl) / zoom;
  const py = (e.clientY - cr.top - po) / zoom;
  const wantX = state.dir === 'e' || state.dir === 'se';
  const wantY = state.dir === 's' || state.dir === 'se';
  const sx = wantX ? Math.max(state.minSx, (state.tableW + (px - state.startPageX)) / state.tableW) : 1;
  const sy = wantY ? Math.max(state.minSy, (state.tableH + (py - state.startPageY)) / state.tableH) : 1;
  return { sx, sy };
}

export function updateTableHandleResize(this: any, e: MouseEvent): void {
  const state = this.tableHandleResizeState;
  const s = tableHandleScales(this, e);
  if (!state || !s) return;
  state.lastSx = s.sx;
  state.lastSy = s.sy;
  // 프리뷰 = 새 우변/하변 위치에 파란 가이드 (비례 스케일된 표 크기)
  const sc = this.container.querySelector('#scroll-content');
  if (!sc) return;
  const zoom = this.viewportManager.getZoom();
  const guides: { axis: 'x' | 'y'; pos: number }[] = [];
  if (state.dir !== 's') guides.push({ axis: 'x', pos: state.left + state.tableW * s.sx });
  if (state.dir !== 'e') guides.push({ axis: 'y', pos: state.top + state.tableH * s.sy });
  _snapLayerFor(this.container).show(guides, {
    zoom,
    pageLeft: this.virtualScroll.getPageLeftResolved(state.pageIndex, sc.clientWidth),
    pageTop: this.virtualScroll.getPageOffset(state.pageIndex),
    pageWpx: this.virtualScroll.getPageWidth(state.pageIndex) / zoom,
    pageHpx: this.virtualScroll.getPageHeight(state.pageIndex) / zoom,
  });
}

export function finishTableHandleResize(this: any, e: MouseEvent): void {
  const state = this.tableHandleResizeState;
  const s = tableHandleScales(this, e) ?? (state ? { sx: state.lastSx, sy: state.lastSy } : null);
  _snapLayerFor(this.container).clear();
  this.isTableHandleResizing = false;
  this.tableHandleResizeState = null;
  this.container.style.cursor = '';
  if (!state || !s) return;
  const wantX = state.dir === 'e' || state.dir === 'se';
  const wantY = state.dir === 's' || state.dir === 'se';
  if ((!wantX || Math.abs(s.sx - 1) < 0.002) && (!wantY || Math.abs(s.sy - 1) < 0.002)) return; // 무변화
  // ⚠ resizeTableCells는 표 크기를 유지한 채 재분배(localResize)하거나 마지막 행/열만 흡수해
  // 균일 비례가 안 된다(실측). setCellProperties({width,height})로 각 셀 크기를 직접 목표값으로
  // 설정하면 모든 열/행이 비율대로 스케일된다(실측: width×1.4 → 전 열 정확히 ×1.40,
  // height=4500HWP → 전 행 60px). width=모델폭×sx, height=현재표시높이(dispHhwp)×sy.
  try {
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'resizeTableProportional',
      operation: (wasm: any) => {
        for (const c of state.cells as HandleCell[]) {
          const props: { width?: number; height?: number } = {};
          if (wantX) props.width = Math.max(MIN_COL_WIDTH_HWP, Math.round(c.modelW * s.sx));
          if (wantY) props.height = Math.max(MIN_ROW_HEIGHT_HWP, Math.round(c.dispHhwp * s.sy));
          wasm.setCellProperties(state.ref.sec, state.ref.ppi, state.ref.ci, c.cellIdx, props);
        }
        wasm.reflowLinesegs?.();
        return this.cursor.getPosition();
      },
    });
    this.cachedTableRef = null;
    this.cachedCellBboxes = null;
    this.renderTableObjectSelection?.();
  } catch (err) {
    console.warn('[InputHandler] 표 핸들 리사이즈 실패:', err);
  }
}

// ─── [캔버스 한컴 포크] 셀 선택 중 DEL/Backspace 처리 (한글 동작) ──────────────────
// F5 phase 1~3 · 마우스 드래그 등 셀 선택 상태에서 DEL:
//  · 열 전체 선택(모든 행 포함) → "칸 지우기?" 모달 → 확인 시 해당 열들 삭제
//  · 행 전체 선택(모든 열 포함) → "줄 지우기?" 모달 → 확인 시 해당 행들 삭제
//  · 그 외(부분/표 전체) → "내용만 지우기?" 3지선다 → 예=내용, 아니오=내용+셀모양, 취소=무시
export function handleCellSelectionDelete(this: any): void {
  const range = this.cursor.getSelectedCellRange();
  const ctx = this.cursor.getCellTableContext();
  if (!range || !ctx) return;
  let dims: { rowCount: number; colCount: number };
  try {
    dims = this.wasm.getTableDimensions(ctx.sec, ctx.ppi, ctx.ci);
  } catch {
    return;
  }
  const wholeRows = range.startCol === 0 && range.endCol === dims.colCount - 1; // 열 전부 포함 = 행 선택
  const wholeCols = range.startRow === 0 && range.endRow === dims.rowCount - 1; // 행 전부 포함 = 열 선택
  const wholeTable = wholeRows && wholeCols;

  const exitSelection = () => {
    this.cursor.exitCellSelectionMode?.();
    this.cellSelectionRenderer?.clear();
    this.cachedTableRef = null;
    this.cachedCellBboxes = null;
    this.updateCaret?.();
  };

  void (async () => {
    // 행 전체 선택(표 전체 제외) → 줄 삭제
    if (wholeRows && !wholeTable) {
      const n = range.endRow - range.startRow + 1;
      if (await showConfirm('한글', `선택한 ${n}줄을 지울까요?`)) {
        this.executeOperation({
          kind: 'snapshot',
          operationType: 'deleteTableRow',
          operation: (wasm: any) => {
            for (let r = range.endRow; r >= range.startRow; r--) wasm.deleteTableRow(ctx.sec, ctx.ppi, ctx.ci, r);
            return this.cursor.getPosition();
          },
        });
        exitSelection();
      }
      return;
    }
    // 열 전체 선택(표 전체 제외) → 칸 삭제
    if (wholeCols && !wholeTable) {
      const n = range.endCol - range.startCol + 1;
      if (await showConfirm('한글', `선택한 ${n}칸을 지울까요?`)) {
        this.executeOperation({
          kind: 'snapshot',
          operationType: 'deleteTableColumn',
          operation: (wasm: any) => {
            for (let c = range.endCol; c >= range.startCol; c--) wasm.deleteTableColumn(ctx.sec, ctx.ppi, ctx.ci, c);
            return this.cursor.getPosition();
          },
        });
        exitSelection();
      }
      return;
    }
    // 그 외 → 내용 지우기 3지선다
    const choice = await showCellClearChoice();
    if (choice === 'cancel') return;
    let cells: CellBbox[];
    try {
      cells = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);
    } catch {
      return;
    }
    const seen = new Set<number>();
    const targets = cells.filter((c) => {
      if (seen.has(c.cellIdx)) return false;
      seen.add(c.cellIdx);
      return c.row >= range.startRow && c.row <= range.endRow && c.col >= range.startCol && c.col <= range.endCol;
    });
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'clearCells',
      operation: (wasm: any) => {
        for (const c of targets) {
          const len = wasm.getCellParagraphLength(ctx.sec, ctx.ppi, ctx.ci, c.cellIdx, 0);
          if (len > 0) wasm.deleteTextInCell(ctx.sec, ctx.ppi, ctx.ci, c.cellIdx, 0, 0, len);
          if (choice === 'shape') {
            // 아니오 = 셀 모양(배경 채우기)도 지우기
            try { wasm.setCellProperties(ctx.sec, ctx.ppi, ctx.ci, c.cellIdx, { fillType: 'none' }); } catch { /* ignore */ }
          }
        }
        return this.cursor.getPosition();
      },
    });
    this.updateCellSelection?.();
  })();
}
