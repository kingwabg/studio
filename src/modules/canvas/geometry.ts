// geometry.ts — 화면 px ↔ 문서 mm 변환. 모델은 mm(진실), 화면은 px(파생).
// SCALE은 CSS 표준 mm(96dpi ÷ 25.4)로 고정 — table-king(px 실측 엔진)의 px가
// 곧 화면 px이자 mm×SCALE이 되어, 화면 크기 = 내보내기 크기가 정확히 일치한다.
// (기존 흐름 에디터의 지면(794×1123px)과도 같은 크기)
export const SCALE = 96 / 25.4; // ≈3.7795 px per mm

export const mmToPx = (mm: number) => mm * SCALE;
export const pxToMm = (px: number) => px / SCALE;
