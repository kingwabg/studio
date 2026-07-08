// exportHwpx.ts — CanvasDoc(자유배치, mm) → exportCore 캔버스 어댑터.
//
// 기존 흐름 에디터는 브라우저 배치를 "실측"해서 mm를 얻지만, 새 캔버스는 모델이
// 이미 mm 좌표(진실)라 DOM 없이 순수 변환으로 끝난다 — Node/워커에서도 돌 수 있다.
// 병합(다중 레코드)을 위해 문서 배열을 페이지별로 싣는 변형도 제공한다.
import { buildHwpx } from "../../hwpx/exportCore.js";
import { tableDataToRows } from "../../table-king/TableKingBlock.jsx";
import { type Block, type CanvasDoc, type TableKingData, TEXT_DEFAULTS } from "./model";
import { SCALE } from "../canvas/geometry";

// 캔버스 텍스트 블록의 안쪽 여백 (CanvasBlock의 px-2 py-1) — 화면과 한글의
// "글이 접히는 폭"을 같게 하려면 내보내기에서도 이만큼 보정해야 한다.
const PAD_X_MM = 8 / SCALE; // ≈2.12mm
const PAD_Y_MM = 4 / SCALE; // ≈1.06mm
// 캔버스 leading-snug = 1.375 → 문단 줄간격 %
const LINE_SPACING = 138;

// 문서 폰트 — 캔버스 지면(.canvas-dots)과 같은 스택의 첫 가용 폰트를 hwpx에 선언한다.
// 한글/HWP 조판은 한글을 전각(1em)으로 계산하므로, 지면도 전각 폰트(맑은 고딕)를 쓰고
// 같은 폰트를 선언해야 화면 줄바꿈 = 한글 줄바꿈이 된다.
function effectiveFont(): string | undefined {
  if (typeof document === "undefined" || !document.fonts?.check) return undefined;
  if (document.fonts.check(`12px "Malgun Gothic"`)) return "맑은 고딕";
  if (document.fonts.check(`12px "Noto Sans KR"`)) return "Noto Sans KR";
  return "함초롬돋움"; // 한글 기본 고딕 폴백
}

function elementOf(b: Block, page: number) {
  if (b.type === "text") {
    const style = {
      pt: b.fontSize ?? TEXT_DEFAULTS.fontSize,
      bold: b.bold ?? TEXT_DEFAULTS.bold,
      italic: b.italic ?? TEXT_DEFAULTS.italic,
      align: b.align ?? TEXT_DEFAULTS.align,
      color: b.color ?? TEXT_DEFAULTS.color,
      lineSpacing: LINE_SPACING,
    };
    // flow(본문)는 절대배치 개체가 아니라 진짜 문단으로 — 한글에서 이어 쓸 수 있고
    // 길면 페이지를 넘는다. 좌표는 화면의 "글 시작점"(패딩 안쪽)으로 보정해
    // 접히는 폭이 캔버스와 같아지게 한다.
    if (b.flow)
      return {
        type: "flowText",
        page,
        x: b.x + PAD_X_MM,
        y: b.y + PAD_Y_MM,
        w: b.w - PAD_X_MM * 2,
        h: b.h,
        text: b.text ?? "",
        style,
      };
    return {
      type: "text",
      page,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      text: b.text ?? "",
      style,
      // 상자 안쪽 여백을 화면 패딩과 일치 (HWPUNIT) — 접히는 폭 정합
      cellMarginU: {
        lr: Math.round(PAD_X_MM * 283.465),
        tb: Math.round(PAD_Y_MM * 283.465),
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
  return null; // image: hp:pic 매핑은 별도 과제 — 내보내기에서 제외
}

// 문서 1개 → hwpx 바이트
export function buildHwpxBytes(doc: CanvasDoc): Uint8Array {
  return buildHwpxBytesMultiPage([doc]);
}

// 문서 N개 → 한 파일 N페이지 hwpx (병합 "한 파일 N쪽" 모드)
export function buildHwpxBytesMultiPage(docs: CanvasDoc[]): Uint8Array {
  const elements = docs.flatMap((d, i) =>
    d.blocks.map((b) => elementOf(b, i)).filter((e): e is NonNullable<typeof e> => e !== null)
  );
  // 화면의 실효 글꼴을 선언 — 줄바꿈 위치가 캔버스와 일치하도록
  return buildHwpx({ page: { ...docs[0].page }, font: effectiveFont(), elements });
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
