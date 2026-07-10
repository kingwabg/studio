// measure.ts — auto-width 실측 (canvas.measureText, 런별 서식 + 전각 보정 반영).
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)
import { type Block, type TextRun, TEXT_DEFAULTS, blockRuns, showingHint } from "../document/model";
import { countHangul, fontByKey } from "../document/fonts";

// ── auto-width 측정 (canvas) ──
// 예전엔 visibility:hidden 사이저를 하나 더 그려 폭을 쟀지만, DOM에 텍스트가 두 번
// 생겨 검사기에서 헷갈렸다 → 제거. 이제 텍스트는 화면 사이저 "하나"뿐이고, 폭은
// canvas.measureText로 잰다(런별 폰트·크기·굵기·기울임 + 전각 보정 letter-spacing 반영).
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  return _measureCtx;
}

// 런들을 \n 기준으로 줄 배열로 쪼갠다 (각 줄 = 런 배열, 서식 유지)
function splitRunsIntoLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines;
}

// 줄바꿈 없는 "가장 긴 줄"의 자연 폭(px) — auto-width가 이 값 + 좌우 패딩으로 박스를 맞춘다.
// letter-spacing은 브라우저가 글자마다 뒤에 붙이므로 em×px×글자수로 근사(±1mm 허용).
export function measureNaturalWidthPx(block: Block, spacing: Record<string, number>): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  const lines = showingHint(block)
    ? (block.hint ?? "").split("\n").map((l) => [{ text: l } as TextRun])
    : splitRunsIntoLines(blockRuns(block));
  let max = 0;
  for (const line of lines) {
    let w = 0;
    for (const run of line) {
      const def = fontByKey(run.font ?? block.font);
      const sizePx = (run.fontSize ?? block.fontSize ?? TEXT_DEFAULTS.fontSize) * (96 / 72);
      const weight = (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400;
      const italic = (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic " : "";
      ctx.font = `${italic}${weight} ${sizePx}px "${def.webFamily}", "Malgun Gothic", sans-serif`;
      const em = spacing[def.key] ?? 0.06;
      // 전각 보정 letter-spacing은 한글 글자에만 (화면 ScriptText 규칙과 동일)
      w += ctx.measureText(run.text).width + em * sizePx * countHangul(run.text);
    }
    if (w > max) max = w;
  }
  return max;
}
