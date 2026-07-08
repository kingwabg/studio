import { useCallback, useRef } from "react";
import { MIN_COL_W, MIN_ROW_H } from "../table/constants";
import {
  findColumnBoundaryGroup,
  findRowBoundaryGroup,
  moveColumnBoundaryGroup,
  moveRowBoundaryGroup,
} from "../table/boundaryResize";
import { isRowBoundaryShiftLocked } from "../table/boundaryLocks";
import {
  snapColumnBoundaryDelta,
  snapColumnBoundaryGroupDelta,
  snapRowBoundaryDelta,
  snapRowBoundaryGroupDelta,
} from "../table/boundarySnap";

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
}) => {
  const dragRef = useRef(null);

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
        dragRef.current = null;
        setActiveBoundary?.(null);
        setSaveMessage("앵커 가로선 고정");
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
            ? [{ boundaryIndex: index, col: colIndex }]
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

          setWidths(
            moveRowBoundaryGroup(
              drag.startWidths,
              drag.columnBoundaryGroup,
              snappedDx
            )
          );
        }

        if (drag.type === "row") {
          const snappedDy = drag.localRowBoundary
            ? snapColumnBoundaryDelta({
                cellHeights: drag.startHeights,
                colIndex: drag.colIndex,
                boundaryIndex: drag.index,
                delta: dy,
              })
            : snapColumnBoundaryGroupDelta({
                cellHeights: drag.startHeights,
                group: drag.rowBoundaryGroup,
                delta: dy,
              });

          setCellHeights(
            moveColumnBoundaryGroup(
              drag.startHeights,
              drag.rowBoundaryGroup,
              snappedDy
            )
          );
        }

        if (drag.type === "diag") {
          const colDelta = dx / drag.startWidths[0].length;
          const rowDelta = dy / drag.startRows.length;
          setWidths(
            drag.startWidths.map((row) =>
              row.map((width) => Math.max(MIN_COL_W, width + colDelta))
            )
          );
          setRowHeights(
            drag.startRows.map((height) => Math.max(MIN_ROW_H, height + rowDelta))
          );
        }
      };

      const onUp = () => {
        dragRef.current = null;
        setActiveBoundary?.(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor =
        type === "col" ? "col-resize" : type === "row" ? "row-resize" : "nwse-resize";
      document.body.style.userSelect = "none";
    },
    [
      cellHeights,
      cells,
      merges,
      rowHeights,
      setActiveBoundary,
      setCellHeights,
      setHoverBoundary,
      setRowHeights,
      setSaveMessage,
      setWidths,
      widths,
    ]
  );

  return { startDrag };
};
