import { makeKey } from "./selection.js";

export const makeCell = (text = "", style = {}) => ({
  text: String(text ?? ""),
  style: { ...style },
});

export const isCellObject = (cell) =>
  cell !== null && typeof cell === "object" && !Array.isArray(cell);

export const normalizeCell = (cell, style = {}) => {
  if (isCellObject(cell)) {
    return makeCell(cell.text ?? "", { ...(cell.style || {}), ...style });
  }

  return makeCell(cell, style);
};

export const normalizeCells = (cells, legacyStyles = {}) =>
  cells.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      normalizeCell(cell, legacyStyles[makeKey(rowIndex, colIndex)])
    )
  );

export const getCellText = (cell) =>
  isCellObject(cell) ? String(cell.text ?? "") : String(cell ?? "");

export const getCellStyle = (cell) =>
  isCellObject(cell) ? { ...(cell.style || {}) } : {};

export const setCellText = (cell, text) =>
  makeCell(text, getCellStyle(cell));

export const patchCellStyle = (cell, stylePatch) => {
  const nextStyle = { ...getCellStyle(cell), ...stylePatch };

  Object.keys(nextStyle).forEach((key) => {
    if (nextStyle[key] === undefined) delete nextStyle[key];
  });

  return makeCell(getCellText(cell), nextStyle);
};

export const cloneCell = (cell) => normalizeCell(cell);

export const cloneCellGrid = (cells) =>
  cells.map((row) => row.map((cell) => cloneCell(cell)));
