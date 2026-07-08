// geometry.ts — 화면 px ↔ 문서 mm 변환. 모델은 mm(진실), 화면은 px(파생).
// Phase 1은 고정 배율. 줌은 Phase 2에서 이 SCALE을 상태로 빼면 된다.
export const SCALE = 3.2; // px per mm (A4 210×297mm → 672×950px)

export const mmToPx = (mm: number) => mm * SCALE;
export const pxToMm = (px: number) => px / SCALE;
