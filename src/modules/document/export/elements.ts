// elements.ts — CanvasDoc 블록 → exportCore 요소 변환 (exportHwpx에서 분할 — 계획 4단계).
import { type Block, type TableKingData, type TextRun, LINE_SPACING_DEFAULT, TEXT_DEFAULTS, blockRuns, padOf } from "../model";
import { fontByKey } from "../fonts";
import { tableDataToRows } from "../../../table-king/TableKingBlock.jsx";
import { CELL_FONT_SIZE } from "../../../table-king/table/constants.js";
import { SCALE } from "../../canvas/geometry";
import { wrappedLineCount } from "./measure";

export const HWPUNIT_PER_MM = 283.465;
const LINK_COLOR = "#1A5FD6"; // 하이퍼링크 표시색 (richtext LINK_COLOR와 일치)
const LINE_SPACING = LINE_SPACING_DEFAULT; // 정본은 model.ts — 재선언 금지(값 표류 방지)
const PT_TO_MM = 0.352778;

// 인라인 리치 텍스트 런 → 내보내기 세그먼트 줄 배열. 각 세그먼트 스타일은 블록 기본
// 스타일(base) 위에 런이 지정한 속성만 덮어쓴다(화면 runCssObj와 같은 상속 규칙).
// 줄바꿈(\n)은 새 줄로 쪼갠다 → 한 줄 = 세그먼트 배열, 각 세그먼트 = {text, style}.
export function richLinesOf(runs: TextRun[], base: ReturnType<typeof baseStyle>) {
  const lines: { text: string; style: typeof base; href?: string }[][] = [[]];
  for (const run of runs) {
    // 하이퍼링크 런은 밑줄+링크색을 강제(화면 runCssObj와 동일 규칙) — 한글에서도 링크로 보이게
    const isLink = !!run.href;
    const style = {
      ...base,
      pt: run.fontSize ?? base.pt,
      bold: run.bold ?? base.bold,
      italic: run.italic ?? base.italic,
      // 화면 runCssObj와 동일: run ?? block(3-상태) ?? isLink — 블록이 명시 false면 링크도 무밑줄
      underline: run.underline ?? base.underlineRaw ?? isLink,
      strike: run.strike ?? base.strike,
      color: run.color ?? (isLink ? LINK_COLOR : base.color),
      shade: run.bg, // 형광펜 → charPr shadeColor (런 전용)
      font: run.font ? fontByKey(run.font).hwpxName : base.font,
    };
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, style, href: run.href });
    });
  }
  return lines;
}

export function baseStyle(b: Block) {
  return {
    pt: b.fontSize ?? TEXT_DEFAULTS.fontSize,
    bold: b.bold ?? TEXT_DEFAULTS.bold,
    italic: b.italic ?? TEXT_DEFAULTS.italic,
    underline: b.underline ?? TEXT_DEFAULTS.underline,
    // 3-상태 원시값 — 링크 밑줄 규칙(run ?? block ?? isLink)을 화면 runCssObj와 동일하게 적용하기 위해
    underlineRaw: b.underline,
    strike: b.strike ?? TEXT_DEFAULTS.strike,
    align: b.align ?? TEXT_DEFAULTS.align,
    // 세로 정렬 — 미설정(undefined)이면 textXml이 "top"으로 폴백(검증된 기존 동작 보존).
    // 설정 시 상자(b.h)가 내용보다 클 때 글이 위/가운데/아래로 정렬돼 화면 minHeight와 정합.
    vAlign: b.valign,
    color: b.color ?? TEXT_DEFAULTS.color,
    // 블록 줄간격(%) — 화면 line-height(값/100)와 같은 값이라 세로 정합 유지
    lineSpacing: b.lineSpacing ?? LINE_SPACING,
    // 요소별 글꼴 — 레지스트리 hwpxName을 charPr fontRef로 선언 (없으면 문서 기본)
    font: b.font ? fontByKey(b.font).hwpxName : undefined,
    // 모양 배경색 — 채우기 있으면 셀 채우기로 (없으면 무배경)
    backgroundColor: b.fill || undefined,
  };
}

export type ExportTextStyleOf = ReturnType<typeof baseStyle>;
type ExportTextStyle = ExportTextStyleOf;

export function lineSegmentsOf(b: Block, style: ExportTextStyle): { text: string; style: ExportTextStyle }[][] {
  return b.runs?.length
    ? richLinesOf(b.runs, style)
    : String(b.text ?? "")
        .split("\n")
        .map((line) => (line ? [{ text: line, style }] : []));
}

export function textExportHeightMm(b: Block, style: ExportTextStyle, padY: number, contentWidthMm: number): number {
  const lineCount = wrappedLineCount(lineSegmentsOf(b, style), contentWidthMm);
  const lineHeightMm = (style.pt ?? TEXT_DEFAULTS.fontSize) * PT_TO_MM * ((style.lineSpacing ?? LINE_SPACING) / 100);
  // rhwp/HWP 셀 렌더는 브라우저보다 아래쪽 여유가 조금 더 필요해서 안전 여유를 둔다.
  return Math.max(8, Math.ceil(lineCount * lineHeightMm + padY * 2 + 2));
}

export function elementOf(
  b: Block,
  page: number,
  imageBins?: Map<string, { binId: string; natW: number; natH: number }>
) {
  if (b.type === "text") {
    const pad = padOf(b); // 요소별 안쪽 여백(mm) — 화면 CSS 패딩과 같은 값
    const style = baseStyle(b);
    // 런/문단별 정렬/목록이 있으면 richLines 경로 (없으면 균일 — 기존 단순 경로 그대로)
    const hasParaAligns = !!b.paraAligns?.some((a) => a != null);
    const hasParaLists = !!b.paraLists?.some((l) => l != null);
    const richLines =
      b.runs?.length || hasParaAligns || hasParaLists ? richLinesOf(blockRuns(b), style) : undefined;
    const paraAligns = hasParaAligns ? b.paraAligns : undefined;
    const paraLists = hasParaLists ? b.paraLists : undefined;
    const contentWidth = Math.max(1, b.w - pad.x * 2);
    const exportH = Math.max(b.h, textExportHeightMm(b, style, pad.y, contentWidth));
    // flow(본문)는 절대배치 개체가 아니라 진짜 문단으로 — 한글에서 이어 쓸 수 있고
    // 길면 페이지를 넘는다. 좌표는 화면의 "글 시작점"(패딩 안쪽)으로 보정해
    // 접히는 폭이 캔버스와 같아지게 한다.
    if (b.flow)
      return {
        type: "flowText",
        page,
        x: b.x + pad.x,
        y: b.y + pad.y,
        w: b.w - pad.x * 2,
        h: exportH,
        text: b.text ?? "",
        style,
        richLines,
        paraAligns,
        paraLists,
      };
    return {
      type: "text",
      page,
      x: b.x,
      y: b.y,
      w: b.w,
      h: exportH,
      text: b.text ?? "",
      style,
      richLines,
      paraAligns,
      paraLists,
      // 상자 안쪽 여백을 화면 패딩과 일치 (HWPUNIT) — 접히는 폭 정합
      cellMarginU: {
        lr: Math.round(pad.x * HWPUNIT_PER_MM),
        tb: Math.round(pad.y * HWPUNIT_PER_MM),
      },
    };
  }
  if (b.type === "table") {
    // table-king 스냅샷 → grid (기존 앱 collectCanvas와 같은 매핑: 병합·행별 너비·셀 스타일)
    if (b.data) {
      const d = b.data as TableKingData;
      const tpad = padOf(b); // 셀 안 여백(mm) — 화면 tk-cell-pad-*·인스펙터와 같은 값
      return {
        type: "table",
        page,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        // hp:cellMargin(HWPUNIT) — 화면 셀 패딩과 같은 mm에서 파생 (WYSIWYG)
        cellMarginU: { lr: Math.round(tpad.x * HWPUNIT_PER_MM), tb: Math.round(tpad.y * HWPUNIT_PER_MM) },
        grid: {
          cellsText: tableDataToRows(d),
          merges: d.merges ?? [],
          borderScope: b.borderScope ?? "all", // 테두리 범위 — exportCore가 셀 위치로 4변 해석

          colWidthsMm: d.widths.map((row) => row.map((v) => v / SCALE)),
          rowHeightsMm: d.cellHeights.map((row) => row.map((v) => v / SCALE)),
          cellStyles: d.cells.map((row, r) =>
            row.map((cell) => {
              const s = (cell?.style ?? {}) as Record<string, unknown>;
              return {
                pt: CELL_FONT_SIZE * 0.75, // 화면 셀 글자(px)와 단일 소스 — 12.5px = 9.375pt
                // 화면 셀 줄높이 1.2(CELL_LINE_HEIGHT)와 동일 — 미지정 시 exportCore가 160%로
                // 폴백해 여러 줄 셀이 한글에서 화면보다 28% 더 길어졌다(감사 D2 CONFIRMED)
                lineSpacing: 120,
                bold: (s.bold as boolean) ?? r === 0, // 머리행은 화면 CSS가 굵게
                italic: !!s.italic,
                color: (s.color as string) ?? "#1A2233",
                hAlign: (s.hAlign as string) ?? "left",
                vAlign: (s.vAlign as string) ?? "center",
                backgroundColor: s.backgroundColor as string | undefined,
              };
            })
          ),
        },
      };
    }
    return { type: "table", page, x: b.x, y: b.y, w: b.w, h: b.h, rows: b.rows ?? [[""]] };
  }
  if (b.type === "image" && b.src && imageBins?.has(b.src)) {
    const bin = imageBins.get(b.src)!;
    return { type: "image", page, x: b.x, y: b.y, w: b.w, h: b.h, binId: bin.binId, natW: bin.natW, natH: bin.natH };
  }
  return null; // 자산 없는 이미지(placeholder)는 내보내기 제외
}
