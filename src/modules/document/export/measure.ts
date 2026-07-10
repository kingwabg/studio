// measure.ts — 내보내기용 글자폭/줄수/높이 실측 (exportHwpx에서 분할 — 계획 4단계).
import { type TextRun, TEXT_DEFAULTS, type Block } from "../model";
import { DEFAULT_FONT, FONTS, countHangul, fontByKey, useFontStore } from "../fonts";
import { SCALE } from "../../canvas/geometry";
import { type ExportTextStyleOf } from "./elements"; // 타입만 — 런타임 무순환

export type ExportTextStyle = ExportTextStyleOf;
const PT_TO_MM = 0.352778;
const LINE_SPACING = 138;

export function fontKeyForStyle(style: ExportTextStyle): string {
  if (!style.font) return DEFAULT_FONT;
  return FONTS.find((f) => f.hwpxName === style.font)?.key ?? DEFAULT_FONT;
}

export function charWidthMm(ch: string, style: ExportTextStyle): number {
  const pt = style.pt ?? TEXT_DEFAULTS.fontSize;
  const fontKey = fontKeyForStyle(style);
  const def = fontByKey(fontKey);
  if (typeof document !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      const sizePx = (pt * 96) / 72;
      const italic = style.italic ? "italic " : "";
      const weight = style.bold ? 700 : 400;
      ctx.font = `${italic}${weight} ${sizePx}px "${def.webFamily}", "Malgun Gothic", sans-serif`;
      const em = useFontStore.getState().spacing[def.key] ?? 0.06;
      return (ctx.measureText(ch).width + em * sizePx * countHangul(ch)) / SCALE;
    }
  }
  const isHangul = countHangul(ch) > 0;
  return pt * PT_TO_MM * (isHangul ? 1 : ch === " " ? 0.33 : 0.55);
}

export function wrappedLineCount(lines: { text: string; style: ExportTextStyle }[][], widthMm: number): number {
  const maxW = Math.max(1, widthMm);
  let count = 0;
  for (const segs of lines) {
    count += 1;
    let current = 0;
    for (const seg of segs) {
      for (const ch of seg.text) {
        const w = charWidthMm(ch, seg.style);
        if (current > 0 && current + w > maxW) {
          count += 1;
          current = w;
        } else {
          current += w;
        }
      }
    }
  }
  return Math.max(1, count);
}
