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
  colGroupWidths,
  getCellsForYRow,
  hoverBoundary,
  renderCell,
  rowGroupHeights,
  showHandles,
  startDrag,
  totalHeight,
  totalWidth,
}) {
  return (
    <section className="workspace">
      <div className="table-frame" style={{ width: totalWidth, minHeight: totalHeight }}>
        <div
          className="corner-handle"
          onMouseDown={(event) => startDrag(event, "diag", 0)}
          style={{ opacity: showHandles ? 1 : 0 }}
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
        <table style={{ width: totalWidth }}>
          <colgroup>
            {colGroupWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <tbody>
            {rowGroupHeights.map((height, yIndex) => {
              const yCells = getCellsForYRow(yIndex);
              if (yCells.length === 0) return null;

              return (
                <tr key={yIndex} style={{ height }}>
                  {yCells.map(({ cell, rowIndex, colIndex }) =>
                    renderCell(cell, rowIndex, colIndex)
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
