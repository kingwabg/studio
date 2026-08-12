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

// 같은 논리 경계선에 접한 셀 전부 — 열/행 인덱스 기준. 예전엔 실제 경계 좌표(±1px)로
// 한 번 더 걸렀는데, 그 필터가 이미 어긋난 표에서 집합을 한 셀로 무너뜨려 드래그마다
// 격자가 더 찢어졌다(사용자 신고 2026-08-04). 한컴 정본: 경계선은 줄 전체가 움직인다.
export function findAlignedLogicalResizeAffectedCells(
  edge: BorderEdge,
  target: { cellIdx: number; side: 'start' | 'end' },
  bboxes: CellBbox[],
): number[] {
  const targetBox = bboxes.find(b => b.cellIdx === target.cellIdx);
  if (!targetBox) return [];

  if (edge.type === 'col') {
    const boundaryCol = target.side === 'end'
      ? targetBox.col + targetBox.colSpan
      : targetBox.col;
    return [...new Set(
      bboxes.filter(b => b.col + b.colSpan === boundaryCol).map(b => b.cellIdx),
    )];
  }

  const boundaryRow = target.side === 'end'
    ? targetBox.row + targetBox.rowSpan
    : targetBox.row;
  return [...new Set(
    bboxes.filter(b => b.row + b.rowSpan === boundaryRow).map(b => b.cellIdx),
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

// [유령 공간 수리 2026-08-12] targetMin/neighborMin: 셀별 축소 한계(기본 = 절대 최소).
// 행은 콘텐츠 글줄 바닥(getCellContentFloors)을 넘겨야 한다 — 절대 최소(1276)가 글줄
// 바닥(12pt=1484)보다 작아, 격자(기록값)는 줄고 표 상자(측정 바닥)는 안 줄어 2.7px
// 유령 공간이 생겼다. 한컴: 행은 글줄 밑으로 줄어들지 않는다.
export function clampSingleCellDisplayDelta(
  edge: BorderEdge,
  targetDisplaySize: number,
  neighborDisplaySize: number | null,
  requestedDelta: number,
  targetMin: number = minCellSizeHwp(edge.type),
  neighborMin: number = minCellSizeHwp(edge.type),
): number {
  if (neighborDisplaySize === null || requestedDelta === 0) return requestedDelta;
  if (requestedDelta > 0) {
    const maxDelta = Math.max(0, Math.round(neighborDisplaySize - neighborMin));
    return Math.min(requestedDelta, maxDelta);
  }
  const maxDelta = Math.max(0, Math.round(targetDisplaySize - targetMin));
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
// [2026-08-12 수리 2건] ① 보상 = 이웃 페어가 아니라 **경계 반대편(시작변이 경계) 셀 전체**
// — 어긋난 표에서 걸침 이웃이 페어 탐색에 안 잡혀 보상이 빠지면 표 크기가 변한다(마우스
// 모델 경로와 동일 수리). ② 세로(행)는 모델 높이(빈 셀=패딩만 284)를 클램프 기준으로 쓰면
// 항상 delta=0 → F5 후 Alt+↑↓ 가 늘 무동작이었다("잘 안 된다" 신고). 마우스 드래그
// (2026-07-14)와 동일하게 display 크기 + renderHeight 강제로 통일하고, 축소 한계는
// max(절대 최소, 콘텐츠 글줄 바닥) — 한컴: 행은 글줄 밑으로 줄어들지 않는다.
export function buildKbdWholeUpdates(
  ctx: TableRef,
  range: CellRange,
  isHoriz: boolean,
  step: number,
  bboxes: CellBbox[],
  wasm: CellPropsProvider,
  contentFloors?: number[],
): KbdResizeUpdate[] {
  const edge: BorderEdge = { type: isHoriz ? 'col' : 'row', index: 0, pageIndex: 0 };
  const line = isHoriz ? range.endCol : range.endRow;
  const targetBox = bboxes.find(b =>
    b.row >= range.startRow && b.row <= range.endRow && b.col >= range.startCol && b.col <= range.endCol &&
    (isHoriz ? b.col + b.colSpan - 1 === line : b.row + b.rowSpan - 1 === line));
  if (!targetBox) return [];
  const alignedIdxs = findAlignedLogicalResizeAffectedCells(edge, { cellIdx: targetBox.cellIdx, side: 'end' }, bboxes);
  if (alignedIdxs.length === 0) return [];
  const boundaryLine = isHoriz ? targetBox.col + targetBox.colSpan : targetBox.row + targetBox.rowSpan;
  // [바깥 테두리 금지 2026-08-12] 마지막 행/열의 끝 경계 = 바깥 테두리 — 마우스는
  // startResizeDrag 에서 개체 선택으로 전환(이동 금지)하는데 키보드는 뚫렸다(신고).
  // 보상 상대(반대편 셀)가 없어 무보상 +d 로 표가 자랐다. 표 크기는 Ctrl(비율)·개체
  // 핸들로만 — 규칙 "바깥 테두리 이동 금지·크기 조절은 핸들만"의 키보드 이행.
  const totalLines = isHoriz
    ? Math.max(...bboxes.map(b => b.col + b.colSpan))
    : Math.max(...bboxes.map(b => b.row + b.rowSpan));
  if (boundaryLine >= totalLines) return [];
  const compIdxs: number[] = [...new Set<number>(
    bboxes
      .filter(b => (isHoriz ? b.col === boundaryLine : b.row === boundaryLine))
      .map(b => b.cellIdx),
  )];
  let delta = snapKbdBoundaryDelta(edge, targetBox, bboxes, step); // 흡착(어긋난 세그먼트 재정렬)
  const updates: KbdResizeUpdate[] = [];
  const aligned = new Set<number>(alignedIdxs);

  if (isHoriz) {
    const pairs = alignedIdxs.map(idx => {
      const b = bboxes.find(x => x.cellIdx === idx) as CellBbox;
      return { targetCellIdx: idx, neighborCellIdx: findResizeCompensationNeighbor(edge, b, bboxes) };
    });
    delta = clampCompensatedResizeDelta(wasm, ctx, edge, pairs, delta);
    if (delta > 0 && compIdxs.length > 0) {
      const limits: number[] = [];
      for (const idx of compIdxs) {
        try {
          const size = wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, idx).width;
          if (Number.isFinite(size)) limits.push(Math.max(0, Math.round(size - minCellSizeHwp('col'))));
        } catch { /* 조회 실패 셀은 clamp 대상에서 제외 */ }
      }
      if (limits.length > 0) delta = Math.min(delta, Math.min(...limits));
    }
    if (delta === 0) return [];
    for (const idx of alignedIdxs) updates.push({ cellIdx: idx, widthDelta: delta });
    for (const idx of compIdxs) {
      if (!aligned.has(idx)) updates.push({ cellIdx: idx, widthDelta: -delta });
    }
    return updates;
  }

  // 세로(행): display 기반 — 마우스 드래그 display 경로와 같은 재료(renderHeight+heightDelta)
  const dispOf = new Map<number, number>();
  for (const b of bboxes) {
    if (!dispOf.has(b.cellIdx)) dispOf.set(b.cellIdx, getCellDisplaySize(b, edge));
  }
  const effMin = (idx: number) => Math.max(minCellSizeHwp('row'), contentFloors?.[idx] ?? 0);
  const shrinkSide = delta < 0 ? alignedIdxs : compIdxs;
  const limits: number[] = [];
  for (const idx of shrinkSide) {
    const d = dispOf.get(idx);
    if (d !== undefined) limits.push(Math.max(0, d - effMin(idx)));
  }
  if (limits.length > 0) {
    const lim = Math.min(...limits);
    delta = delta > 0 ? Math.min(delta, lim) : Math.max(delta, -lim);
  }
  if (delta === 0) return [];
  const comp = new Set<number>(compIdxs);
  const modelH = (idx: number): number => {
    try { return wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, idx).height; } catch { return 0; }
  };
  for (const idx of alignedIdxs) {
    const size = (dispOf.get(idx) ?? 0) + delta;
    pushLocalResizeHeightHint(updates, idx, size, size - modelH(idx));
  }
  for (const idx of compIdxs) {
    if (aligned.has(idx)) continue;
    const size = (dispOf.get(idx) ?? 0) - delta;
    pushLocalResizeHeightHint(updates, idx, size, size - modelH(idx));
  }
  // 나머지 셀은 현재 표시 높이 보존(freeze) — 드래그 display 경로와 동일
  for (const b of bboxes) {
    if (aligned.has(b.cellIdx) || comp.has(b.cellIdx)) continue;
    pushLocalResizeHeightHint(updates, b.cellIdx, dispOf.get(b.cellIdx) ?? 0);
  }
  return updates;
}
