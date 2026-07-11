export const MIN_COL_W = 30;
export const MIN_ROW_H = 24;
// 셀 텍스트 기준 치수의 단일 소스 — 화면 inline style(fitCellTextMetrics)·최소 크기 계산
// (useBoundaryDrag)·내보내기 charPr(elements.ts pt=px×0.75)가 전부 이 값에서 파생.
// ⚠ 12.5px = table-king.css의 셀 font-size와 동일. 13 등으로 갈라지면 화면 줄바꿈과
// 한글(HWP) 조판이 어긋난다(WYSIWYG 드리프트).
export const CELL_FONT_SIZE = 12.5;
export const CELL_LINE_HEIGHT = CELL_FONT_SIZE * 1.2; // 화면 줄높이(15px)
export const DEFAULT_COL_W = 100;
export const DEFAULT_ROW_H = 40;
export const HANDLE = 12;
export const STEP = 5;
export const EPS = 0.6;
export const SNAP_THRESHOLD = 8;
export const HISTORY_LIMIT = 80;
export const STORAGE_KEY = "table-king-custom-state";

export const BG_SWATCHES = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];
export const TEXT_SWATCHES = ["#0f172a", "#dc2626", "#2563eb", "#16a34a"];
