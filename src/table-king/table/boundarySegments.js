import {
  cellHeight,
  cellStartX,
  cellStartY,
  cellWidth,
} from "./boundaryGrid.js";

const LINE_WIDTH = 1;

const isCoveredByMerge = (merges, row, col) =>
  merges.some(
    (merge) =>
      row >= merge.r &&
      row < merge.r + merge.rs &&
      col >= merge.c &&
      col < merge.c + merge.cs &&
      !(row === merge.r && col === merge.c)
  );

const mergeAt = (merges, row, col) =>
  merges.find((merge) => merge.r === row && merge.c === col);

const horizontalSegment = (x, y, width, meta = {}) => ({
  type: "h",
  x,
  y: y - LINE_WIDTH / 2,
  width,
  height: LINE_WIDTH,
  ...meta,
});

const verticalSegment = (x, y, height, meta = {}) => ({
  type: "v",
  x: x - LINE_WIDTH / 2,
  y,
  width: LINE_WIDTH,
  height,
  ...meta,
});

export const buildBoundarySegments = ({ cells, widths, cellHeights, merges }) => {
  const segments = [];

  cells.forEach((rowCells, row) => {
    rowCells.forEach((_, col) => {
      if (isCoveredByMerge(merges, row, col)) return;

      const merge = mergeAt(merges, row, col);
      const rowSpan = merge?.rs || 1;
      const colSpan = merge?.cs || 1;
      const bottomBoundaryIndex = row + rowSpan - 1;
      const rightBoundaryIndex = col + colSpan - 1;
      const x = cellStartX(widths, row, col);
      const y = cellStartY(cellHeights, row, col);
      const width = cellWidth(widths, row, col, colSpan);
      const height = cellHeight(cellHeights, row, col, rowSpan);

      if (y === 0) {
        segments.push(
          horizontalSegment(x, y, width, {
            boundaryIndex: row - 1,
            col: rightBoundaryIndex,
          })
        );
      }
      segments.push(
        horizontalSegment(x, y + height, width, {
          boundaryIndex: bottomBoundaryIndex,
          col: rightBoundaryIndex,
        })
      );

      if (x === 0) {
        segments.push(
          verticalSegment(x, y, height, {
            row,
            boundaryIndex: col - 1,
          })
        );
      }
      segments.push(
        verticalSegment(x + width, y, height, {
          row,
          boundaryIndex: rightBoundaryIndex,
        })
      );
    });
  });

  return segments;
};
