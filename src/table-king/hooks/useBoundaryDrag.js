import { useCallback, useEffect, useRef } from "react";
import { CELL_FONT_SIZE, CELL_LINE_HEIGHT, MIN_COL_W, MIN_ROW_H } from "../table/constants";
import { getCellText } from "../table/cellData";
import {
  findColumnBoundaryGroup,
  findRowBoundaryGroup,
  moveColumnBoundaryGroup,
  moveRowBoundaryGroup,
  moveTableRowBoundary,
} from "../table/boundaryResize";
import { isColumnBoundaryAnchorLocked, isRowBoundaryShiftLocked } from "../table/boundaryLocks";
import {
  snapColumnBoundaryDelta,
  snapColumnBoundaryGroupDelta,
  snapRowBoundaryDelta,
  snapRowBoundaryGroupDelta,
} from "../table/boundarySnap";

// 한글은 완전히 빈 셀이 없다(항상 문단 부호 1개). 그래서 빈 셀도 "폰트 크기 × 줄간격(160%)
// + 상하 안 여백"을 한 줄 최소 높이로 보장한다 — 이보다 작게 줄면 글자가 잘린다.
const HANGUL_MIN_LINE = CELL_FONT_SIZE * 1.6;
const CELL_TEXT_PAD_X = 16;
const CELL_TEXT_PAD_Y = 8; // 상+하 안 여백 합 (인스펙터 기본 1mm×2 ≈ 7.6px과 정합)
// 한 줄(한글) 최소 셀 높이 — 새 표 기본 높이·로드 수리 바닥의 단일 소스.
export const HANGUL_MIN_ROW_H = Math.max(MIN_ROW_H, Math.ceil(HANGUL_MIN_LINE + CELL_TEXT_PAD_Y));

const measureTextUnits = (value) =>
  [...String(value || "")].reduce((sum, char) => {
    if (char === " ") return sum + 0.35;
    return sum + (char.charCodeAt(0) > 127 ? 1 : 0.62);
  }, 0);

const minWidthForCell = (cell) => {
  const text = getCellText(cell);
  if (!text) return MIN_COL_W;
  return Math.max(MIN_COL_W, Math.ceil(measureTextUnits(text) * CELL_FONT_SIZE + CELL_TEXT_PAD_X));
};

// 셀 콘텐츠 최소 높이: max(한글 한 줄 160%, 줄 수 × 화면 줄높이) + 상하 여백.
// 줄 수는 명시적 \n만 센다(자동 줄바꿈 미추정 — 폭 정보 없이 과대 하한을 만들지 않는 보수 선택).
// 병합 앵커 셀의 여러 줄 텍스트는 앵커 행 하나의 하한으로 잡혀 과보수일 수 있다(잘림 방지 우선).
const minHeightForCell = (cell, cellPadY = CELL_TEXT_PAD_Y) => {
  const lines = String(getCellText(cell) || "").split("\n").length;
  const content = Math.max(HANGUL_MIN_LINE, lines * CELL_LINE_HEIGHT);
  return Math.max(MIN_ROW_H, Math.ceil(content + cellPadY));
};

// export — 캔버스 외곽 8핸들 리사이즈(CanvasBlock)도 같은 콘텐츠 하한으로 스케일을 클램프한다
// (사용자 요청: 표가 텍스트 크기보다 작아지면 안 됨). 하한 규칙의 단일 소스.
export const buildContentMinWidths = (cells) =>
  cells.map((row) => row.map((cell) => minWidthForCell(cell)));

export const buildContentMinRows = (cells, cellPadY = CELL_TEXT_PAD_Y) =>
  cells.map((row) =>
    row.length ? Math.max(...row.map((cell) => minHeightForCell(cell, cellPadY))) : HANGUL_MIN_ROW_H
  );

// 셀별 최소 높이 행렬 — Shift 국소 드래그는 그 열의 셀 내용만 하한이므로 행 최대(minRows)가 아니라
// 셀 단위 하한을 쓴다 (다른 열의 긴 텍스트가 이 열의 축소를 막지 않게).
const buildContentMinCells = (cells, cellPadY = CELL_TEXT_PAD_Y) =>
  cells.map((row) => row.map((cell) => minHeightForCell(cell, cellPadY)));

// Shift 국소 행 드래그의 그룹: 병합 셀(cs>1)의 아래 경계는 핸들 앵커가 우단 열(col+cs-1)이지만
// 렌더는 앵커 열(m.c) 높이를 읽는다 — 스팬의 모든 열을 한 그룹으로 묶어 함께 써야 화면·데이터가
// 일치한다. 단일 열만 쓰면 병합 셀 테두리는 안 움직이고 옆 셀만 밀린다(감사 CONFIRMED E2).
const localRowBoundaryGroup = (merges, boundaryIndex, col) => {
  const merge = (merges || []).find(
    (m) => m.r + m.rs - 1 === boundaryIndex && col >= m.c && col <= m.c + m.cs - 1
  );
  if (!merge) return [{ boundaryIndex, col }];
  return Array.from({ length: merge.cs }, (_, i) => ({ boundaryIndex, col: merge.c + i }));
};

export const useBoundaryDrag = ({
  cellHeights,
  cells,
  merges,
  rowHeights,
  setCellHeights,
  setActiveBoundary,
  setHoverBoundary,
  setRowHeights,
  setSaveMessage,
  setWidths,
  widths,
  cellPadY = CELL_TEXT_PAD_Y, // 실제 셀 상하 여백(px 합) — 인스펙터 padY에서 파생, 최소 높이 공식에 반영
}) => {
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  const pendingRef = useRef(null);

  const scheduleResizePaint = useCallback((task) => {
    pendingRef.current = task;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.();
    });
  }, []);

  const flushResizePaint = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.();
  }, []);

  // 드래그 도중 언마운트(AI 문서 교체 리마운트·블록 삭제·병합 미리보기 전환) 시 window 리스너와
  // body 커서 오버라이드가 남는 누수 방지 — 활성 드래그의 해제 함수를 ref로 들고 있다가 정리.
  const dragCleanupRef = useRef(null);
  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    dragCleanupRef.current?.();
  }, []);

  const startDrag = useCallback(
    (event, type, index, rowIndex = null, colIndex = null) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        type === "row" &&
        event.shiftKey &&
        colIndex !== null &&
        isRowBoundaryShiftLocked({
          widths,
          boundaryIndex: index,
          col: colIndex,
        })
      ) {
        flushResizePaint();
        dragRef.current = null;
        setActiveBoundary?.(null);
        setSaveMessage("앵커 가로선 고정");
        return;
      }

      if (
        type === "col" &&
        event.shiftKey &&
        rowIndex !== null &&
        isColumnBoundaryAnchorLocked({
          widths,
          row: rowIndex,
          boundaryIndex: index,
        })
      ) {
        flushResizePaint();
        dragRef.current = null;
        setActiveBoundary?.(null);
        setHoverBoundary?.(null);
        setSaveMessage("앵커 세로선 고정");
        return;
      }
      const dragState = {
        type,
        index,
        rowIndex,
        colIndex,
        localColBoundary: type === "col" && event.shiftKey && rowIndex !== null,
        localRowBoundary: type === "row" && event.shiftKey && colIndex !== null,
        startX: event.clientX,
        startY: event.clientY,
        startWidths: widths.map((row) => [...row]),
        startRows: [...rowHeights],
        startHeights: cellHeights.map((row) => [...row]),
        minWidths: buildContentMinWidths(cells),
        minRows: buildContentMinRows(cells, cellPadY),
        minCells: buildContentMinCells(cells, cellPadY),
      };

      dragState.columnBoundaryGroup =
        type === "col"
          ? dragState.localColBoundary
            ? [{ row: rowIndex, boundaryIndex: index }]
            : findColumnBoundaryGroup({
                cells,
                widths,
                cellHeights,
                merges,
                rowIndex,
                boundaryIndex: index,
              })
          : [];

      dragState.rowBoundaryGroup =
        type === "row"
          ? dragState.localRowBoundary
            ? localRowBoundaryGroup(merges, index, colIndex)
            : findRowBoundaryGroup({
                cells,
                widths,
                cellHeights,
                merges,
                boundaryIndex: index,
                colIndex,
              })
          : [];

      dragRef.current = dragState;
      setHoverBoundary?.(null);
      setActiveBoundary?.(
        type === "col"
          ? { type, items: dragState.columnBoundaryGroup }
          : type === "row"
            ? { type, items: dragState.rowBoundaryGroup }
            : { type, items: [] }
      );

      const onMove = (moveEvent) => {
        const drag = dragRef.current;
        if (!drag) return;

        const dx = moveEvent.clientX - drag.startX;
        const dy = moveEvent.clientY - drag.startY;

        if (drag.type === "col") {
          const snappedDx = drag.localColBoundary
            ? snapRowBoundaryDelta({
                widths: drag.startWidths,
                rowIndex: drag.rowIndex,
                boundaryIndex: drag.index,
                delta: dx,
              })
            : snapRowBoundaryGroupDelta({
                widths: drag.startWidths,
                group: drag.columnBoundaryGroup,
                delta: dx,
              });

          // 콘텐츠 최소 폭 클램프 — 외곽 8핸들·diag와 같은 하한 규칙(감사 I4: 내부 드래그만
          // 30px 바닥이라 긴 텍스트 열이 잘렸다). 이미 하한 미만이면 악화만 금지(0으로 눌러
          // 제스처 방향 보존 — 강제 수리로 반대 방향 점프 금지).
          const lo = Math.min(
            0,
            Math.max(
              ...drag.columnBoundaryGroup.map(({ row, boundaryIndex }) => {
                const w0 = drag.startWidths[row]?.[boundaryIndex];
                if (w0 === undefined) return -Infinity;
                return (drag.minWidths[row]?.[boundaryIndex] ?? MIN_COL_W) - w0;
              })
            )
          );
          const hi = Math.max(
            0,
            Math.min(
              ...drag.columnBoundaryGroup.map(({ row, boundaryIndex }) => {
                const right = drag.startWidths[row]?.[boundaryIndex + 1];
                if (right === undefined) return Infinity; // 우측 외곽 — 표가 커지는 방향은 무제한
                return right - (drag.minWidths[row]?.[boundaryIndex + 1] ?? MIN_COL_W);
              })
            )
          );
          const boundedDx = Math.max(lo, Math.min(snappedDx, hi));
          const nextWidths = moveRowBoundaryGroup(
            drag.startWidths,
            drag.columnBoundaryGroup,
            boundedDx
          );
          scheduleResizePaint(() => setWidths(nextWidths));
        }

        if (drag.type === "row") {
          if (drag.localRowBoundary) {
            // Shift-드래그: 한 열(병합이면 스팬 열들)의 경계만 국소 이동 (한컴식 어긋남 편집)
            const snappedDy = snapColumnBoundaryDelta({
              cellHeights: drag.startHeights,
              colIndex: drag.colIndex,
              boundaryIndex: drag.index,
              delta: dy,
            });
            // 셀 단위 콘텐츠 하한 — 국소 드래그는 이 열의 셀 내용만 하한(행 최대가 아님).
            // 이미 하한 미만이면 악화만 금지(0으로 눌러 반대 방향 점프 방지 — 감사 E1과 동일 규칙).
            const bi = drag.index;
            const groupCols = drag.rowBoundaryGroup.map((g) => g.col);
            const lo = Math.min(
              0,
              Math.max(
                ...groupCols.map((c) => {
                  const h0 = drag.startHeights[bi]?.[c];
                  if (h0 === undefined) return -Infinity;
                  return (drag.minCells[bi]?.[c] ?? HANGUL_MIN_ROW_H) - h0;
                })
              )
            );
            const hi = drag.startHeights[bi + 1]
              ? Math.max(
                  0,
                  Math.min(
                    ...groupCols.map((c) => {
                      const below = drag.startHeights[bi + 1]?.[c];
                      if (below === undefined) return Infinity;
                      return below - (drag.minCells[bi + 1]?.[c] ?? HANGUL_MIN_ROW_H);
                    })
                  )
                )
              : Infinity;
            const boundedDy = Math.max(lo, Math.min(snappedDy, hi));
            const nextHeights = moveColumnBoundaryGroup(
              drag.startHeights,
              drag.rowBoundaryGroup,
              boundedDy
            );
            scheduleResizePaint(() => setCellHeights(nextHeights));
          } else {
            // 일반 행 높이 조절: 한 행 = 한 높이라는 불변식을 지킨다. 열별 그룹 이동
            // (moveColumnBoundaryGroup)은 셀을 position:absolute·열별 높이로 그리는 지금의
            // 렌더에서 병합셀 앵커열(col0) vs 그룹 타깃열(col+cs-1) 불일치로 행이 갈라진다.
            // 원본 <table>은 <tr>이 행 높이를 통일해 무해했지만, 이제는 드래그가 직접 통일해야 한다.
            const snappedDy = snapColumnBoundaryGroupDelta({
              cellHeights: drag.startHeights,
              group: drag.rowBoundaryGroup,
              delta: dy,
            });
            // 행 단위 콘텐츠 하한: 위 행은 자기 최소(빈 셀=한글 한 줄, 텍스트=줄 수×줄높이)
            // 까지만 줄고, 아래 행도 마찬가지. 어긋난 행(열별 상이)은 최솟값 열 기준으로 보수 클램프.
            // ⚠ 이미 하한 미만인 행(텍스트 줄 수 증가 등)은 "악화만 금지" — lo/hi를 0으로 눌러
            // 제스처와 반대 방향으로 강제 수리(점프)하지 않는다 (감사 E1 CONFIRMED).
            const bi = drag.index;
            const topRow = drag.startHeights[bi] ?? [];
            const belowRow = drag.startHeights[bi + 1];
            const topMin = drag.minRows[bi] ?? HANGUL_MIN_ROW_H;
            const lo = Math.min(0, topRow.length ? topMin - Math.min(...topRow) : 0);
            const hi = Math.max(
              0,
              belowRow?.length
                ? Math.min(...belowRow) - (drag.minRows[bi + 1] ?? HANGUL_MIN_ROW_H)
                : Infinity
            );
            const boundedDy = Math.max(lo, Math.min(snappedDy, hi));
            const nextHeights = moveTableRowBoundary(drag.startHeights, bi, boundedDy, MIN_ROW_H);
            scheduleResizePaint(() => setCellHeights(nextHeights));
          }
        }

        if (drag.type === "diag") {
          const colDelta = dx / Math.max(1, drag.startWidths[0]?.length || 1);
          const rowDelta = dy / Math.max(1, drag.startRows.length);
          // 열 단위 유효 델타 — 어느 행이든 그 열의 콘텐츠 하한에 닿으면 열 전체가 함께 멈춘다.
          // 셀별 독립 클램프는 행 합을 갈라 우측 외곽을 지그재그로 만든다(표 감사 CONFIRMED).
          const colCount = Math.max(0, ...drag.startWidths.map((row) => row.length));
          const effColDelta = Array.from({ length: colCount }, (_, colIndex) =>
            Math.max(
              colDelta,
              ...drag.startWidths.map(
                (row, rowIndex) => (drag.minWidths[rowIndex]?.[colIndex] ?? MIN_COL_W) - (row[colIndex] ?? MIN_COL_W)
              )
            )
          );
          const nextWidths = drag.startWidths.map((row) =>
            row.map((width, colIndex) => width + (effColDelta[colIndex] ?? colDelta))
          );
          const nextRows = drag.startRows.map((height, rowIndex) =>
            Math.max(drag.minRows[rowIndex] ?? MIN_ROW_H, height + rowDelta)
          );
          scheduleResizePaint(() => {
            setWidths(nextWidths);
            setRowHeights(nextRows);
          });
        }
      };

      const detach = () => {
        dragRef.current = null;
        dragCleanupRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      const onUp = () => {
        flushResizePaint();
        setActiveBoundary?.(null);
        detach();
      };

      // 언마운트 정리는 setState 없이 리스너·커서만 해제 (언마운트된 컴포넌트에 setState 금지)
      dragCleanupRef.current = detach;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor =
        type === "col" ? "col-resize" : type === "row" ? "row-resize" : "nwse-resize";
      document.body.style.userSelect = "none";
    },
    [
      cellHeights,
      cellPadY,
      cells,
      merges,
      rowHeights,
      setActiveBoundary,
      setCellHeights,
      setHoverBoundary,
      setRowHeights,
      setSaveMessage,
      setWidths,
      scheduleResizePaint,
      flushResizePaint,
      widths,
    ]
  );

  return { startDrag };
};


