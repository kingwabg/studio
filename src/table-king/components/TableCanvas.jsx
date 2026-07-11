import React from "react";

const boundaryMatchesMarker = (segment, marker) => {
  if (!marker?.items?.length) return false;

  if (marker.type === "col") {
    return (
      segment.type === "v" &&
      marker.items.some(
        (item) =>
          item.row === segment.row &&
          item.boundaryIndex === segment.boundaryIndex
      )
    );
  }

  if (marker.type === "row") {
    return (
      segment.type === "h" &&
      marker.items.some(
        (item) =>
          item.boundaryIndex === segment.boundaryIndex &&
          item.col === segment.col
      )
    );
  }

  return false;
};

const boundarySegmentClassName = (segment, activeBoundary, hoverBoundary) =>
  [
    "boundary-segment",
    `boundary-segment-${segment.type}`,
    boundaryMatchesMarker(segment, hoverBoundary) && "boundary-segment-hover",
    boundaryMatchesMarker(segment, activeBoundary) && "boundary-segment-active",
  ]
    .filter(Boolean)
    .join(" ");

export function TableCanvas({
  activeBoundary,
  boundarySegments,
  getCellsForYRow,
  hoverBoundary,
  outerResizeHandles,
  renderCell,
  rowGroupHeights,
  showHandles,
  startDrag,
  totalHeight,
  totalWidth,
}) {
  return (
    <section className="workspace">
      <div className="table-frame" style={{ width: totalWidth, height: totalHeight }}>
        <div
          className="corner-handle"
          onMouseDown={(event) => startDrag(event, "diag", 0)}
          // 숨김일 땐 히트도 꺼야 함 — opacity만 0이면 객체 모드에서 우하단 14px가
          // "보이지 않는 diag 리사이즈 트랩"이 된다 (셀 핸들의 handleHitboxStyle과 동일 패턴)
          style={{ opacity: showHandles ? 1 : 0, pointerEvents: showHandles ? "auto" : "none" }}
        />
        <div className="boundary-layer" aria-hidden="true">
          {boundarySegments.map((segment, index) => (
            <div
              className={boundarySegmentClassName(
                segment,
                activeBoundary,
                hoverBoundary
              )}
              key={index}
              style={{
                left: segment.x,
                top: segment.y,
                width: segment.width,
                height: segment.height,
              }}
            />
          ))}
        </div>
        <div className="table-grid" style={{ width: totalWidth, height: totalHeight }}>
          {rowGroupHeights.map((height, yIndex) => {
            const yCells = getCellsForYRow(yIndex);
            if (yCells.length === 0) return null;

            return (
              <div className="table-row" key={yIndex} style={{ height }}>
                {yCells.map(({ cell, rowIndex, colIndex }) =>
                  renderCell(cell, rowIndex, colIndex)
                )}
              </div>
            );
          })}
        </div>
        {outerResizeHandles}
      </div>
    </section>
  );
}


