import {
  cellHeight,
  cellStartX,
  cellStartY,
  cellWidth,
} from "./boundaryGrid.js";
import { EPS } from "./constants.js";
import { isCoveredByMerge, mergeAt } from "./merge.js";

const LINE_WIDTH = 1;
// 경계 일치 허용 오차 — 그룹 판정(EPS)과 같은 값이어야 세그먼트 그리기와 드래그 그룹이 어긋나지 않는다
const BOUNDARY_EPS = EPS;

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

      if (Math.abs(y) <= BOUNDARY_EPS) {
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

      if (Math.abs(x) <= BOUNDARY_EPS) {
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

  // 외곽 4변은 위 셀별 세그먼트가 이미 전부 그린다(상단 y≈0·좌측 x≈0 조건 + 하단·우변 무조건).
  // 이전의 "합-최대 기준 외곽 통선" 오버레이는 반올림 드리프트를 가리려는 밴드에이드였는데,
  // 행 합이 갈라진 표에서 오히려 1px 간격 이중선·짧은 행 옆 유령선을 만들었다(표 감사 CONFIRMED).
  // 드리프트 자체가 경계 공간 반올림(tableScale.ts)으로 제거됐으므로 오버레이는 불필요하다.
  return segments;
};
