import { EPS } from "./constants.js";
import { cumulativePositions } from "./boundarySnap.js";

const hasBoundaryAt = (positions, target, eps) =>
  positions.some((position) => Math.abs(position - target) <= eps);

const pointTouchesSegment = (point, from, to, eps) =>
  point >= Math.min(from, to) - eps && point <= Math.max(from, to) + eps;

const hasUnalignedVerticalEndpoint = ({
  widths,
  row,
  compareRow,
  segmentLeft,
  segmentRight,
  eps,
}) => {
  const rowPositions = cumulativePositions(widths[row]);
  const comparePositions =
    widths[compareRow] === undefined ? null : cumulativePositions(widths[compareRow]);

  return rowPositions.slice(1, -1).some((x) => {
    if (!pointTouchesSegment(x, segmentLeft, segmentRight, eps)) return false;
    if (!comparePositions) return true;
    return !hasBoundaryAt(comparePositions, x, eps);
  });
};

export const isRowBoundaryShiftLocked = ({
  widths,
  boundaryIndex,
  col,
  eps = EPS,
}) => {
  const segmentRow = widths[boundaryIndex];
  if (!segmentRow) return false;

  const segmentPositions = cumulativePositions(segmentRow);
  const segmentLeft = segmentPositions[col];
  const segmentRight = segmentPositions[col + 1];
  if (segmentLeft === undefined || segmentRight === undefined) return false;

  return [boundaryIndex, boundaryIndex + 1].some((row) => {
    if (!widths[row]) return false;

    const compareRow = row === boundaryIndex ? boundaryIndex + 1 : boundaryIndex;
    return hasUnalignedVerticalEndpoint({
      widths,
      row,
      compareRow,
      segmentLeft,
      segmentRight,
      eps,
    });
  });
};
export const isColumnBoundaryAnchorLocked = ({
  widths,
  row,
  boundaryIndex,
}) => widths[row]?.[boundaryIndex + 1] === undefined;

