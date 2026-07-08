import React from "react";
import { BG_SWATCHES, TEXT_SWATCHES } from "../table/constants";

const H_ALIGN_OPTIONS = [
  { label: "좌", title: "왼쪽 정렬", value: "left" },
  { label: "중", title: "가운데 정렬", value: "center" },
  { label: "우", title: "오른쪽 정렬", value: "right" },
];

const V_ALIGN_OPTIONS = [
  { label: "상", title: "위쪽 정렬", value: "top" },
  { label: "중", title: "세로 가운데 정렬", value: "center" },
  { label: "하", title: "아래쪽 정렬", value: "bottom" },
];

export function PrimaryToolbar({
  canRedo,
  canUndo,
  clearRange,
  copyRange,
  deleteSelectedCols,
  deleteSelectedRows,
  equalizeHeights,
  equalizeWidths,
  insertColRight,
  insertRowBelow,
  loadTable,
  mergeSelection,
  pasteAt,
  redo,
  saveTable,
  setShowHandles,
  showHandles,
  undo,
  unmergeSelection,
}) {
  return (
    <section className="toolbar" aria-label="table tools">
      <button type="button" onClick={undo} disabled={!canUndo}>
        실행 취소
      </button>
      <button type="button" onClick={redo} disabled={!canRedo}>
        다시 실행
      </button>
      {/* 문서 편집기 통합: 표 단독 저장은 문서 저장이 대체하므로, 핸들러가 주어질 때만 노출 */}
      {saveTable && (
        <button type="button" onClick={saveTable}>
          저장
        </button>
      )}
      {loadTable && (
        <button type="button" onClick={loadTable}>
          불러오기
        </button>
      )}
      <button type="button" onClick={() => setShowHandles((value) => !value)}>
        핸들 {showHandles ? "숨기기" : "보이기"}
      </button>
      <button type="button" onClick={insertRowBelow}>
        행 추가
      </button>
      <button type="button" onClick={insertColRight}>
        열 추가
      </button>
      <button type="button" onClick={deleteSelectedRows}>
        행 삭제
      </button>
      <button type="button" onClick={deleteSelectedCols}>
        열 삭제
      </button>
      <button type="button" onClick={mergeSelection}>
        병합
      </button>
      <button type="button" onClick={unmergeSelection}>
        병합 해제
      </button>
      <button type="button" onClick={equalizeWidths}>
        W 같게
      </button>
      <button type="button" onClick={equalizeHeights}>
        H 같게
      </button>
      <button type="button" onClick={clearRange}>
        지우기
      </button>
      <button type="button" onClick={() => copyRange(false)}>
        복사
      </button>
      <button type="button" onClick={() => copyRange(true)}>
        잘라내기
      </button>
      <button type="button" onClick={pasteAt}>
        붙여넣기
      </button>
    </section>
  );
}

export function StyleToolbar({
  applyStyle,
  setSplitCols,
  setSplitRows,
  splitCols,
  splitRows,
  splitSelection,
}) {
  return (
    <section className="toolbar secondary" aria-label="style tools">
      <button className="icon-button" type="button" onClick={() => applyStyle({ bold: true })}>
        B
      </button>
      <button className="icon-button" type="button" onClick={() => applyStyle({ italic: true })}>
        I
      </button>
      <span className="segmented-control" aria-label="가로 정렬">
        {H_ALIGN_OPTIONS.map((option) => (
          <button
            key={option.value}
            className="align-button"
            type="button"
            title={option.title}
            onClick={() => applyStyle({ hAlign: option.value })}
          >
            {option.label}
          </button>
        ))}
      </span>
      <span className="segmented-control" aria-label="세로 정렬">
        {V_ALIGN_OPTIONS.map((option) => (
          <button
            key={option.value}
            className="align-button"
            type="button"
            title={option.title}
            onClick={() => applyStyle({ vAlign: option.value })}
          >
            {option.label}
          </button>
        ))}
      </span>
      <span className="swatch-group">
        {BG_SWATCHES.map((color) => (
          <button
            key={color || "transparent"}
            className="swatch"
            type="button"
            title="배경색"
            onClick={() => applyStyle({ backgroundColor: color || undefined })}
            style={{ backgroundColor: color || "#fff" }}
          />
        ))}
      </span>
      <span className="swatch-group">
        {TEXT_SWATCHES.map((color) => (
          <button
            key={color}
            className="swatch"
            type="button"
            title="글자색"
            onClick={() => applyStyle({ color })}
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
      <label>
        행
        <input
          min="1"
          type="number"
          value={splitRows}
          onChange={(event) => setSplitRows(event.target.valueAsNumber || 1)}
        />
      </label>
      <label>
        열
        <input
          min="1"
          type="number"
          value={splitCols}
          onChange={(event) => setSplitCols(event.target.valueAsNumber || 1)}
        />
      </label>
      <button type="button" onClick={splitSelection}>
        나누기
      </button>
    </section>
  );
}
