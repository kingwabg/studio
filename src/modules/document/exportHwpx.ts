// exportHwpx.ts — CanvasDoc(자유배치, mm) → exportCore 캔버스 어댑터.
//
// 기존 흐름 에디터는 브라우저 배치를 "실측"해서 mm를 얻지만, 새 캔버스는 모델이
// 이미 mm 좌표(진실)라 DOM 없이 순수 변환으로 끝난다 — Node/워커에서도 돌 수 있다.
// 병합(다중 레코드)을 위해 문서 배열을 페이지별로 싣는 변형도 제공한다.
import { buildHwpx } from "../../hwpx/exportCore.js";
import { tableDataToRows } from "../../table-king/TableKingBlock.jsx";
import { type Block, type CanvasDoc, type TableKingData, type TextRun, TEXT_DEFAULTS, blockRuns, padOf } from "./model";
import { DEFAULT_FONT, FONTS, countHangul, fontByKey, useFontStore } from "./fonts";
import { extOfMime, getAsset } from "./assets";
import { SCALE } from "../canvas/geometry";

const HWPUNIT_PER_MM = 283.465;
// 캔버스 leading-snug = 1.375 → 문단 줄간격 %
const LINE_SPACING = 138;
const PT_TO_MM = 0.352778;

// 문서 폰트 — 캔버스 지면(.canvas-dots)과 같은 스택의 첫 가용 폰트를 hwpx에 선언한다.
// 한글/HWP 조판은 한글을 전각(1em)으로 계산하므로, 지면도 전각 폰트를 쓰고 같은 폰트를
// 선언해야 화면 줄바꿈 = 한글 줄바꿈이 된다.
// 기본은 나눔고딕(OFL 웹폰트 self-host) — 저작권 안전 + 전 OS 동일. 요소별 글꼴은
// elementOf가 style.font로 선언하고, 이 값은 "글꼴 미지정 요소"의 문서 기본이 된다.
function effectiveFont(): string {
  return fontByKey(DEFAULT_FONT).hwpxName;
}

// 인라인 리치 텍스트 런 → 내보내기 세그먼트 줄 배열. 각 세그먼트 스타일은 블록 기본
// 스타일(base) 위에 런이 지정한 속성만 덮어쓴다(화면 runCssObj와 같은 상속 규칙).
// 줄바꿈(\n)은 새 줄로 쪼갠다 → 한 줄 = 세그먼트 배열, 각 세그먼트 = {text, style}.
function richLinesOf(runs: TextRun[], base: ReturnType<typeof baseStyle>) {
  const lines: { text: string; style: typeof base }[][] = [[]];
  for (const run of runs) {
    const style = {
      ...base,
      pt: run.fontSize ?? base.pt,
      bold: run.bold ?? base.bold,
      italic: run.italic ?? base.italic,
      underline: run.underline ?? base.underline,
      strike: run.strike ?? base.strike,
      color: run.color ?? base.color,
      shade: run.bg, // 형광펜 → charPr shadeColor (런 전용)
      font: run.font ? fontByKey(run.font).hwpxName : base.font,
    };
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, style });
    });
  }
  return lines;
}

function baseStyle(b: Block) {
  return {
    pt: b.fontSize ?? TEXT_DEFAULTS.fontSize,
    bold: b.bold ?? TEXT_DEFAULTS.bold,
    italic: b.italic ?? TEXT_DEFAULTS.italic,
    underline: b.underline ?? TEXT_DEFAULTS.underline,
    strike: b.strike ?? TEXT_DEFAULTS.strike,
    align: b.align ?? TEXT_DEFAULTS.align,
    color: b.color ?? TEXT_DEFAULTS.color,
    // 블록 줄간격(%) — 화면 line-height(값/100)와 같은 값이라 세로 정합 유지
    lineSpacing: b.lineSpacing ?? LINE_SPACING,
    // 요소별 글꼴 — 레지스트리 hwpxName을 charPr fontRef로 선언 (없으면 문서 기본)
    font: b.font ? fontByKey(b.font).hwpxName : undefined,
    // 모양 배경색 — 채우기 있으면 셀 채우기로 (없으면 무배경)
    backgroundColor: b.fill || undefined,
  };
}

type ExportTextStyle = ReturnType<typeof baseStyle>;

function lineSegmentsOf(b: Block, style: ExportTextStyle): { text: string; style: ExportTextStyle }[][] {
  return b.runs?.length
    ? richLinesOf(b.runs, style)
    : String(b.text ?? "")
        .split("\n")
        .map((line) => (line ? [{ text: line, style }] : []));
}

function fontKeyForStyle(style: ExportTextStyle): string {
  if (!style.font) return DEFAULT_FONT;
  return FONTS.find((f) => f.hwpxName === style.font)?.key ?? DEFAULT_FONT;
}

function charWidthMm(ch: string, style: ExportTextStyle): number {
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

function wrappedLineCount(lines: { text: string; style: ExportTextStyle }[][], widthMm: number): number {
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

function textExportHeightMm(b: Block, style: ExportTextStyle, padY: number, contentWidthMm: number): number {
  const lineCount = wrappedLineCount(lineSegmentsOf(b, style), contentWidthMm);
  const lineHeightMm = (style.pt ?? TEXT_DEFAULTS.fontSize) * PT_TO_MM * ((style.lineSpacing ?? LINE_SPACING) / 100);
  // rhwp/HWP 셀 렌더는 브라우저보다 아래쪽 여유가 조금 더 필요해서 안전 여유를 둔다.
  return Math.max(8, Math.ceil(lineCount * lineHeightMm + padY * 2 + 2));
}
function elementOf(
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
      return {
        type: "table",
        page,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        grid: {
          cellsText: tableDataToRows(d),
          merges: d.merges ?? [],
          colWidthsMm: d.widths.map((row) => row.map((v) => v / SCALE)),
          rowHeightsMm: d.cellHeights.map((row) => row.map((v) => v / SCALE)),
          cellStyles: d.cells.map((row, r) =>
            row.map((cell) => {
              const s = (cell?.style ?? {}) as Record<string, unknown>;
              return {
                pt: 9.4, // table-king 셀 글자 12.5px 고정(CSS)
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

// 문서 1개 → hwpx 바이트 (동기 — 이미지는 제외. Node 하네스·레거시 호환)
export function buildHwpxBytes(doc: CanvasDoc): Uint8Array {
  return buildHwpxBytesMultiPage([doc]);
}

// 문서 N개 → 한 파일 N페이지 hwpx (병합 "한 파일 N쪽" 모드, 동기 — 이미지 제외)
export function buildHwpxBytesMultiPage(docs: CanvasDoc[]): Uint8Array {
  const elements = docs.flatMap((d, i) =>
    d.blocks.map((b) => elementOf(b, i)).filter((e): e is NonNullable<typeof e> => e !== null)
  );
  // 화면의 실효 글꼴을 선언 — 줄바꿈 위치가 캔버스와 일치하도록
  return buildHwpx({ page: { ...docs[0].page }, font: effectiveFont(), elements });
}

// ── 이미지 포함 내보내기 (비동기 — 자산 저장소에서 바이트·원본 크기 로드) ──
// 자산 id → binId(image1..N, 중복 자산은 1회만) 매핑을 만들고 elements와 함께 싣는다.
async function collectImages(docs: CanvasDoc[]) {
  const srcs: string[] = [];
  for (const d of docs)
    for (const b of d.blocks) if (b.type === "image" && b.src && !srcs.includes(b.src)) srcs.push(b.src);
  const images: { binId: string; ext: string; mime: string; data: Uint8Array }[] = [];
  const map = new Map<string, { binId: string; natW: number; natH: number }>();
  for (const src of srcs) {
    const rec = await getAsset(src).catch(() => null);
    if (!rec) continue; // 자산 유실 — 그 이미지는 placeholder 취급(내보내기 제외)
    const binId = `image${images.length + 1}`;
    let natW = 0;
    let natH = 0;
    try {
      const bmp = await createImageBitmap(new Blob([rec.bytes], { type: rec.mime }));
      natW = bmp.width;
      natH = bmp.height;
      bmp.close();
    } catch {
      // 크기 실측 실패 시 0 — picXml이 표시 크기 기반으로 폴백
    }
    images.push({ binId, ext: extOfMime(rec.mime), mime: rec.mime, data: new Uint8Array(rec.bytes) });
    map.set(src, { binId, natW, natH });
  }
  return { images, map };
}

export async function buildHwpxBytesAsync(doc: CanvasDoc): Promise<Uint8Array> {
  return buildHwpxBytesMultiPageAsync([doc]);
}

export async function buildHwpxBytesMultiPageAsync(docs: CanvasDoc[]): Promise<Uint8Array> {
  const { images, map } = await collectImages(docs);
  const elements = docs.flatMap((d, i) =>
    d.blocks.map((b) => elementOf(b, i, map)).filter((e): e is NonNullable<typeof e> => e !== null)
  );
  return buildHwpx({ page: { ...docs[0].page }, font: effectiveFont(), elements, images });
}

// 브라우저 다운로드 헬퍼 (파일명 금지 문자는 _)
export function downloadBytes(bytes: Uint8Array | Blob, filename: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  URL.revokeObjectURL(url);
}
