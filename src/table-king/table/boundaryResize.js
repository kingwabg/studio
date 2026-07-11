import { EPS, MIN_COL_W, MIN_ROW_H } from "./constants.js";
import {
  cellHeight,
  cellStartX,
  cellStartY,
  cellWidth,
} from "./boundaryGrid.js";
import { isCoveredByMerge, mergeAt } from "./merge.js";

export const moveRowBoundary = (
  rowWidths,
  boundaryIndex,
  delta,
  minWidth = MIN_COL_W
) => {
  const nextRow = [...rowWidths];
  const leftWidth = rowWidths[boundaryIndex];
  const rightWidth = rowWidths[boundaryIndex + 1];

  if (rightWidth === undefined) {
    nextRow[boundaryIndex] = Math.max(minWidth, leftWidth + delta);
    return nextRow;
  }

  const boundedDelta = Math.max(
    minWidth - leftWidth,
    Math.min(delta, rightWidth - minWidth)
  );

  nextRow[boundaryIndex] = leftWidth + boundedDelta;
  nextRow[boundaryIndex + 1] = rightWidth - boundedDelta;
  return nextRow;
};

export const moveColumnBoundary = (
  heights,
  boundaryIndex,
  colIndex,
  delta,
  minHeight = MIN_ROW_H
) => {
  const nextHeights = heights.map((row) => [...row]);
  const topHeight = heights[boundaryIndex]?.[colIndex];
  const bottomHeight = heights[boundaryIndex + 1]?.[colIndex];

  if (topHeight === undefined) return nextHeights;

  if (bottomHeight === undefined) {
    nextHeights[boundaryIndex][colIndex] = Math.max(minHeight, topHeight + delta);
    return nextHeights;
  }

  const boundedDelta = Math.max(
    minHeight - topHeight,
    Math.min(delta, bottomHeight - minHeight)
  );

  nextHeights[boundaryIndex][colIndex] = topHeight + boundedDelta;
  nextHeights[boundaryIndex + 1][colIndex] = bottomHeight - boundedDelta;
  return nextHeights;
};

export const moveTableRowBoundary = (
  heights,
  boundaryIndex,
  delta,
  minHeight = MIN_ROW_H
) => {
  const nextHeights = heights.map((row) => [...row]);
  const colCount = nextHeights[boundaryIndex]?.length || 0;

  for (let col = 0; col < colCount; col += 1) {
    const topHeight = heights[boundaryIndex]?.[col];
    const bottomHeight = heights[boundaryIndex + 1]?.[col];
    if (topHeight === undefined) continue;

    if (bottomHeight === undefined) {
      nextHeights[boundaryIndex][col] = Math.max(minHeight, topHeight + delta);
      continue;
    }

    const boundedDelta = Math.max(
      minHeight - topHeight,
      Math.min(delta, bottomHeight - minHeight)
    );

    nextHeights[boundaryIndex][col] = topHeight + boundedDelta;
    nextHeights[boundaryIndex + 1][col] = bottomHeight - boundedDelta;
  }

  return nextHeights;
};

const sumUntil = (values, endIndex) =>
  values.slice(0, endIndex).reduce((sum, value) => sum + value, 0);

const intervalsTouch = (a, b, eps = EPS) =>
  a.to >= b.from - eps && b.to >= a.from - eps;

const collectConnectedIntervals = (candidates, seedIndexes) => {
  const connectedIndexes = new Set(seedIndexes);
  const queue = [...seedIndexes];

  while (queue.length > 0) {
    const currentIndex = queue.shift();
    const current = candidates[currentIndex];

    candidates.forEach((candidate, candidateIndex) => {
      if (connectedIndexes.has(candidateIndex)) return;
      if (!intervalsTouch(current, candidate)) return;

      connectedIndexes.add(candidateIndex);
      queue.push(candidateIndex);
    });
  }

  return [...connectedIndexes].map((index) => candidates[index]);
};

const uniqueBoundaries = (items, makeKey) => [
  ...new Map(items.map((item) => [makeKey(item), item])).values(),
];

const clampDelta = (delta, ranges) => {
  if (ranges.length === 0) return delta;

  const minDelta = Math.max(...ranges.map((range) => range.min));
  const maxDelta = Math.min(...ranges.map((range) => range.max));
  return Math.max(minDelta, Math.min(delta, maxDelta));
};

const rowBoundaryDeltaRange = (
  rowWidths,
  boundaryIndex,
  minWidth = MIN_COL_W
) => {
  const leftWidth = rowWidths?.[boundaryIndex];
  const rightWidth = rowWidths?.[boundaryIndex + 1];

  if (leftWidth === undefined) return null;

  if (rightWidth === undefined) {
    return { min: minWidth - leftWidth, max: Infinity };
  }

  return {
    min: minWidth - leftWidth,
    max: rightWidth - minWidth,
  };
};

const columnBoundaryDeltaRange = (
  cellHeights,
  boundaryIndex,
  col,
  minHeight = MIN_ROW_H
) => {
  const topHeight = cellHeights[boundaryIndex]?.[col];
  const bottomHeight = cellHeights[boundaryIndex + 1]?.[col];

  if (topHeight === undefined) return null;

  if (bottomHeight === undefined) {
    return { min: minHeight - topHeight, max: Infinity };
  }

  return {
    min: minHeight - topHeight,
    max: bottomHeight - minHeight,
  };
};

const applyRowBoundaryDelta = (rowWidths, boundaryIndex, delta) => {
  const nextRow = [...rowWidths];
  const rightWidth = rowWidths[boundaryIndex + 1];

  nextRow[boundaryIndex] = rowWidths[boundaryIndex] + delta;
  if (rightWidth !== undefined) {
    nextRow[boundaryIndex + 1] = rightWidth - delta;
  }

  return nextRow;
};

export const findColumnBoundaryGroup = ({
  cells,
  widths,
  cellHeights,
  merges,
  rowIndex,
  boundaryIndex,
  eps = EPS,
}) => {
  const targetX = sumUntil(widths[rowIndex] || [], boundaryIndex + 1);
  const candidates = [];

  cells.forEach((rowCells, row) => {
    rowCells.forEach((_, col) => {
      if (isCoveredByMerge(merges, row, col)) return;

      const merge = mergeAt(merges, row, col);
      const rowSpan = merge?.rs || 1;
      const colSpan = merge?.cs || 1;
      const rightBoundaryIndex = col + colSpan - 1;
      const x = cellStartX(widths, row, col) + cellWidth(widths, row, col, colSpan);

      if (Math.abs(x - targetX) > eps) return;

      const y = cellStartY(cellHeights, row, col);
      candidates.push({
        row,
        boundaryIndex: rightBoundaryIndex,
        from: y,
        to: y + cellHeight(cellHeights, row, col, rowSpan),
      });
    });
  });

  const seedIndexes = candidates
    .map((candidate, index) =>
      candidate.row === rowIndex && candidate.boundaryIndex === boundaryIndex
        ? index
        : -1
    )
    .filter((index) => index !== -1);

  const connected =
    seedIndexes.length > 0
      ? collectConnectedIntervals(candidates, seedIndexes)
      : [{ row: rowIndex, boundaryIndex }];

  return uniqueBoundaries(connected, (item) => `${item.row}-${item.boundaryIndex}`);
};

export const findRowBoundaryGroup = ({
  cells,
  widths,
  cellHeights,
  merges,
  boundaryIndex,
  colIndex,
  eps = EPS,
}) => {
  let targetY = 0;
  for (let row = 0; row <= boundaryIndex; row += 1) {
    targetY += cellHeights[row]?.[colIndex] || MIN_ROW_H;
  }

  const candidates = [];

  cells.forEach((rowCells, row) => {
    rowCells.forEach((_, col) => {
      if (isCoveredByMerge(merges, row, col)) return;

      const merge = mergeAt(merges, row, col);
      const rowSpan = merge?.rs || 1;
      const colSpan = merge?.cs || 1;
      const bottomBoundaryIndex = row + rowSpan - 1;
      const y = cellStartY(cellHeights, row, col) + cellHeight(cellHeights, row, col, rowSpan);

      if (Math.abs(y - targetY) > eps) return;

      const x = cellStartX(widths, row, col);
      candidates.push({
        boundaryIndex: bottomBoundaryIndex,
        col: col + colSpan - 1,
        from: x,
        to: x + cellWidth(widths, row, col, colSpan),
      });
    });
  });

  const seedIndexes = candidates
    .map((candidate, index) =>
      candidate.boundaryIndex === boundaryIndex && candidate.col === colIndex
        ? index
        : -1
    )
    .filter((index) => index !== -1);

  const connected =
    seedIndexes.length > 0
      ? collectConnectedIntervals(candidates, seedIndexes)
      : [{ boundaryIndex, col: colIndex }];

  return uniqueBoundaries(connected, (item) => `${item.boundaryIndex}-${item.col}`);
};

export const moveRowBoundaryGroup = (widths, group, delta) => {
  const next = widths.map((row) => [...row]);
  const boundedDelta = clampDelta(
    delta,
    group
      .map(({ row, boundaryIndex }) =>
        rowBoundaryDeltaRange(widths[row], boundaryIndex)
      )
      .filter(Boolean)
  );

  group.forEach(({ row, boundaryIndex }) => {
    if (!next[row]) return;
    if (!rowBoundaryDeltaRange(widths[row], boundaryIndex)) return;
    next[row] = applyRowBoundaryDelta(widths[row], boundaryIndex, boundedDelta);
  });

  return next;
};

export const moveColumnBoundaryGroup = (cellHeights, group, delta) => {
  const next = cellHeights.map((row) => [...row]);
  const boundedDelta = clampDelta(
    delta,
    group
      .map(({ boundaryIndex, col }) =>
        columnBoundaryDeltaRange(cellHeights, boundaryIndex, col)
      )
      .filter(Boolean)
  );

  group.forEach(({ boundaryIndex, col }) => {
    const topHeight = cellHeights[boundaryIndex]?.[col];
    const bottomHeight = cellHeights[boundaryIndex + 1]?.[col];

    if (topHeight === undefined) return;

    if (bottomHeight === undefined) {
      next[boundaryIndex][col] = topHeight + boundedDelta;
      return;
    }

    next[boundaryIndex][col] = topHeight + boundedDelta;
    next[boundaryIndex + 1][col] = bottomHeight - boundedDelta;
  });

  return next;
};
