import { EPS, MIN_ROW_H } from "./constants.js";

export const resolveBoundaryEps = (rawBoundaries, options = {}) => {
  if (typeof options.eps === "number") return options.eps;
  if (!rawBoundaries.length) return EPS;

  const min = Math.min(...rawBoundaries);
  const max = Math.max(...rawBoundaries);
  const span = Math.max(0, max - min);
  const ratioEps = span * (options.ratio || 0);
  const physicalEps = options.physicalUnitEps || 0;
  const dynamicEps = Math.max(ratioEps, physicalEps);
  if (dynamicEps === 0) return EPS;

  const minEps = options.minEps ?? 0;
  const maxEps = options.maxEps ?? Math.max(EPS, dynamicEps);

  return Math.max(minEps, Math.min(maxEps, dynamicEps));
};

export const normalizeBoundaries = (rawBoundaries, options = {}) => {
  const sorted = [...rawBoundaries].sort((a, b) => a - b);
  const out = [];
  const eps = resolveBoundaryEps(sorted, options);

  sorted.forEach((value) => {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(value - last) > eps) {
      out.push(value);
    }
  });

  return out;
};

export const collectXBoundaries = (widths, options) => {
  const raw = [0];

  widths.forEach((rowWidths) => {
    let acc = 0;
    raw.push(acc);
    rowWidths.forEach((width) => {
      acc += width;
      raw.push(acc);
    });
  });

  return normalizeBoundaries(raw, options);
};

export const collectYBoundaries = (cellHeights, colCount, options) => {
  const raw = [0];

  for (let col = 0; col < colCount; col += 1) {
    let acc = 0;
    raw.push(acc);
    for (let row = 0; row < cellHeights.length; row += 1) {
      acc += cellHeights[row]?.[col] || MIN_ROW_H;
      raw.push(acc);
    }
  }

  return normalizeBoundaries(raw, options);
};

export const sizesFromBoundaries = (boundaries) =>
  boundaries
    .slice(0, -1)
    .map((value, index) => Math.max(1, boundaries[index + 1] - value));

export const findNearestBoundaryIndex = (boundaries, value) => {
  let bestIndex = 0;
  let bestDistance = Infinity;

  boundaries.forEach((boundary, index) => {
    const distance = Math.abs(boundary - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
};

export const cellStartX = (widths, row, col) =>
  widths[row].slice(0, col).reduce((sum, width) => sum + width, 0);

export const cellWidth = (widths, row, col, colSpan = 1) =>
  widths[row].slice(col, col + colSpan).reduce((sum, width) => sum + width, 0);

export const cellStartY = (cellHeights, row, col) => {
  let acc = 0;
  for (let i = 0; i < row; i += 1) {
    acc += cellHeights[i]?.[col] || MIN_ROW_H;
  }
  return acc;
};

export const cellHeight = (cellHeights, row, col, rowSpan = 1) => {
  let acc = 0;
  for (let i = row; i < row + rowSpan; i += 1) {
    acc += cellHeights[i]?.[col] || MIN_ROW_H;
  }
  return acc;
};
