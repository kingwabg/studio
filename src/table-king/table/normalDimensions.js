import {
  DEFAULT_COL_W,
  DEFAULT_ROW_H,
  EPS,
  MIN_COL_W,
  MIN_ROW_H,
} from "./constants.js";

const dimensionKey = (value) => Math.round(value / EPS);

const cleanDimension = (value, fallback, min) =>
  Number.isFinite(value) ? Math.max(min, value) : fallback;

const mostCommonDimension = (values, fallback, min) => {
  const groups = new Map();

  values.forEach((value, index) => {
    const cleanValue = cleanDimension(value, fallback, min);
    const key = dimensionKey(cleanValue);
    const group = groups.get(key) || { count: 0, sum: 0, firstIndex: index };
    group.count += 1;
    group.sum += cleanValue;
    groups.set(key, group);
  });

  if (groups.size === 0) return fallback;

  const best = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.firstIndex - b.firstIndex
  )[0];

  if (best.count === 1 && groups.size > 1) return fallback;
  return best.sum / best.count;
};

const mostCommonVector = (vectors, length, fallback, min) => {
  if (length <= 0) return [];

  const groups = new Map();
  vectors.forEach((vector, index) => {
    if (!Array.isArray(vector) || vector.length !== length) return;

    const cleanVector = vector.map((value) => cleanDimension(value, fallback, min));
    const key = cleanVector.map(dimensionKey).join("|");
    const group =
      groups.get(key) || {
        count: 0,
        sums: Array(length).fill(0),
        firstIndex: index,
      };

    group.count += 1;
    cleanVector.forEach((value, valueIndex) => {
      group.sums[valueIndex] += value;
    });
    groups.set(key, group);
  });

  if (groups.size === 0) return Array(length).fill(fallback);

  const best = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.firstIndex - b.firstIndex
  )[0];

  if (best.count === 1 && groups.size > 1) return Array(length).fill(fallback);
  return best.sums.map((sum) => sum / best.count);
};

export const makeNormalRowWidths = (widths, colCount = widths[0]?.length || 0) =>
  mostCommonVector(widths, colCount, DEFAULT_COL_W, MIN_COL_W);

export const makeNormalInsertedRowHeights = (
  sourceHeights,
  colCount = sourceHeights?.length || 0
) => {
  const height = mostCommonDimension(sourceHeights || [], DEFAULT_ROW_H, MIN_ROW_H);
  return Array(colCount).fill(height);
};

export const makeNormalInsertedColumnWidth = (widths, sourceColIndex) =>
  mostCommonDimension(
    widths.map((row) => row?.[sourceColIndex]),
    DEFAULT_COL_W,
    MIN_COL_W
  );

export const makeNormalColumnHeights = (cellHeights) =>
  cellHeights.map((row) =>
    mostCommonDimension(row || [], DEFAULT_ROW_H, MIN_ROW_H)
  );
