import { HEADERS, ROWS } from "./sampleData.js";
import { DEFAULT_COL_W, DEFAULT_ROW_H } from "./constants.js";
import { makeCell } from "./cellData.js";

export const makeInitialCells = () =>
  [HEADERS, ...ROWS].map((row) => row.map((cell) => makeCell(cell)));

export const makeInitialWidths = () =>
  Array.from({ length: ROWS.length + 1 }, () =>
    Array(HEADERS.length).fill(DEFAULT_COL_W)
  );

export const makeInitialHeights = () =>
  Array.from({ length: ROWS.length + 1 }, () => Array(HEADERS.length).fill(DEFAULT_ROW_H));
