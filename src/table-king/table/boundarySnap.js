import { MIN_ROW_H, SNAP_THRESHOLD } from "./constants.js";

export const cumulativePositions = (sizes) => {
  let acc = 0;
  return [0, ...sizes.map((size) => (acc += size))];
};

const findSnapTarget = (position, targets, threshold = SNAP_THRESHOLD) => {
  let best = null;
  let bestDistance = threshold;

  targets.forEach((target) => {
    const distance = Math.abs(target - position);
    if (distance > 0.001 && distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  });

  return best;
};

const snapDeltaToTargets = (startPosition, delta, targets, threshold) => {
  const target = findSnapTarget(startPosition + delta, targets, threshold);
  return target === null ? delta : target - startPosition;
};

const snapDeltaForMovingPositions = (
  startPositions,
  delta,
  targets,
  threshold = SNAP_THRESHOLD
) => {
  let best = null;
  let bestDistance = threshold;

  startPositions.forEach((startPosition) => {
    targets.forEach((target) => {
      if (startPositions.some((position) => Math.abs(position - target) <= 0.001)) {
        return;
      }

      const distance = Math.abs(target - (startPosition + delta));
      if (distance > 0.001 && distance <= bestDistance) {
        best = target - startPosition;
        bestDistance = distance;
      }
    });
  });

  return best === null ? delta : best;
};

const rowBoundaryKey = (row, boundaryIndex) => `${row}-${boundaryIndex}`;

const columnBoundaryKey = (boundaryIndex, col) => `${boundaryIndex}-${col}`;

export const rowBoundaryTargets = (widths, excludeRowIndex = null) =>
  widths.flatMap((rowWidths, rowIndex) => {
    if (rowIndex === excludeRowIndex) return [];
    return cumulativePositions(rowWidths).slice(1);
  });

export const rowBoundaryGroupTargets = (widths, group = []) => {
  const excluded = new Set(
    group.map(({ row, boundaryIndex }) => rowBoundaryKey(row, boundaryIndex))
  );

  return widths.flatMap((rowWidths, rowIndex) =>
    cumulativePositions(rowWidths)
      .slice(1)
      .filter((_, boundaryIndex) => !excluded.has(rowBoundaryKey(rowIndex, boundaryIndex)))
  );
};

export const columnBoundaryTargets = (cellHeights, excludeColIndex = null) => {
  const colCount = cellHeights[0]?.length || 0;
  const targets = [];

  for (let col = 0; col < colCount; col += 1) {
    if (col === excludeColIndex) continue;
    targets.push(
      ...cumulativePositions(cellHeights.map((row) => row[col] || MIN_ROW_H)).slice(1)
    );
  }

  return targets;
};

export const columnBoundaryGroupTargets = (cellHeights, group = []) => {
  const colCount = cellHeights[0]?.length || 0;
  const excluded = new Set(
    group.map(({ boundaryIndex, col }) => columnBoundaryKey(boundaryIndex, col))
  );
  const targets = [];

  for (let col = 0; col < colCount; col += 1) {
    cumulativePositions(cellHeights.map((row) => row[col] || MIN_ROW_H))
      .slice(1)
      .forEach((position, boundaryIndex) => {
        if (!excluded.has(columnBoundaryKey(boundaryIndex, col))) {
          targets.push(position);
        }
      });
  }

  return targets;
};

export const snapRowBoundaryDelta = ({
  widths,
  rowIndex,
  boundaryIndex,
  delta,
  threshold = SNAP_THRESHOLD,
}) => {
  const startPosition = cumulativePositions(widths[rowIndex]).at(boundaryIndex + 1);
  if (startPosition === undefined) return delta;

  return snapDeltaToTargets(
    startPosition,
    delta,
    rowBoundaryTargets(widths, rowIndex),
    threshold
  );
};

export const snapRowBoundaryGroupDelta = ({
  widths,
  group,
  delta,
  threshold = SNAP_THRESHOLD,
}) => {
  const startPositions = group
    .map(({ row, boundaryIndex }) =>
      cumulativePositions(widths[row] || []).at(boundaryIndex + 1)
    )
    .filter((position) => position !== undefined);

  if (startPositions.length === 0) return delta;

  return snapDeltaForMovingPositions(
    startPositions,
    delta,
    rowBoundaryGroupTargets(widths, group),
    threshold
  );
};

export const snapColumnBoundaryDelta = ({
  cellHeights,
  colIndex,
  boundaryIndex,
  delta,
  threshold = SNAP_THRESHOLD,
}) => {
  const columnHeights = cellHeights.map((row) => row[colIndex] || MIN_ROW_H);
  const startPosition = cumulativePositions(columnHeights).at(boundaryIndex + 1);
  if (startPosition === undefined) return delta;

  return snapDeltaToTargets(
    startPosition,
    delta,
    columnBoundaryTargets(cellHeights, colIndex),
    threshold
  );
};

export const snapColumnBoundaryGroupDelta = ({
  cellHeights,
  group,
  delta,
  threshold = SNAP_THRESHOLD,
}) => {
  const startPositions = group
    .map(({ boundaryIndex, col }) =>
      cumulativePositions(cellHeights.map((row) => row[col] || MIN_ROW_H)).at(
        boundaryIndex + 1
      )
    )
    .filter((position) => position !== undefined);

  if (startPositions.length === 0) return delta;

  return snapDeltaForMovingPositions(
    startPositions,
    delta,
    columnBoundaryGroupTargets(cellHeights, group),
    threshold
  );
};
