// style.ts — 리치텍스트 표시 스타일 (블록/런 CSS · 색 정규화 · 링크색).
// 캔버스 CanvasBlock과 임베드 EmbedEditor가 공유하는 편집 코어의 일부.
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)
import type React from "react";
import { type Block, type TextRun, TEXT_DEFAULTS } from "../document/model";
import { fontCss } from "../document/fonts";

export const LEGACY_TEXT_INK = "#1A2233";
export const TEXT_INK = "#000000";
export const TEXT_SURFACE = "#ffffff";
export const TEXT_BORDER = "#98A4BD";
export const normalizeTextColor = (color?: string) => (!color || color.toUpperCase() === LEGACY_TEXT_INK ? TEXT_INK : color);

export function textStyle(block: Block): React.CSSProperties {
  return {
    // 줄간격 — 지정 시 line-height = %/100 (미지정이면 leading-snug 1.375 클래스가 담당).
    // 내보내기 paraPr lineSpacing과 같은 값이라 화면 세로 배치 = 한글 세로 배치.
    ...(block.lineSpacing ? { lineHeight: block.lineSpacing / 100 } : {}),
    fontSize: ptToPx(block.fontSize ?? TEXT_DEFAULTS.fontSize),
    fontWeight: (block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textAlign: block.align ?? TEXT_DEFAULTS.align,
    color: normalizeTextColor(block.color),
    // 글꼴 + 전각(1em) 보정 — 폰트 레지스트리가 폰트별 letter-spacing을 실측 캘리브레이션
    // (한글/HWP 조판은 한글을 1em으로 계산 — em 단위라 fontSize별로 정확히 스케일)
    ...fontCss(block.font),
  };
}
const ptToPx = (pt: number) => `${pt * (96 / 72)}px`;

// 런(run) 하나의 화면 스타일 — 블록 기본값 위에 런이 지정한 속성만 덮어쓴다.
// 굵기·기울임·색은 항상 명시(런 없으면 블록값), 크기·글꼴은 런이 지정할 때만 덮어써
// 나머지는 컨테이너(textStyle) 상속을 그대로 받게 한다 → 전각 보정·크기 정합 유지.
export function runCssObj(block: Block, run: TextRun): React.CSSProperties {
  // ⚠ 밑줄/취소선은 컨테이너가 아니라 "런 span"에만 건다 — CSS text-decoration은 부모에
  // 걸면 자식이 못 지우므로(전파 규칙), 블록 기본이 밑줄이어도 일부 런만 보통(false)이
  // 되려면 span 단위 적용이 유일한 경로다.
  // 하이퍼링크는 밑줄 + 링크색(파랑)을 얹는다 — 사용자가 색을 명시했으면 그 색 존중.
  const isLink = !!run.href;
  const underline = run.underline ?? block.underline ?? isLink ?? TEXT_DEFAULTS.underline;
  const strike = run.strike ?? block.strike ?? TEXT_DEFAULTS.strike;
  const deco = [underline ? "underline" : "", strike ? "line-through" : ""].filter(Boolean).join(" ");
  return {
    fontWeight: (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textDecoration: deco || "none",
    color: normalizeTextColor(run.color ?? (isLink ? LINK_COLOR : block.color)),
    ...(run.bg ? { backgroundColor: run.bg } : {}), // 형광펜 — 런 전용(블록 상속 없음)
    ...(run.fontSize != null ? { fontSize: ptToPx(run.fontSize) } : {}),
    ...(run.font ? fontCss(run.font) : {}),
  };
}

// 하이퍼링크 표시색 — 화면·내보내기 charPr 공통(한글에서도 링크로 보이게)
export const LINK_COLOR = "#1A5FD6";
