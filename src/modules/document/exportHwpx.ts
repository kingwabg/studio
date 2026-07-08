// exportHwpx.ts — CanvasDoc(자유배치, mm) → exportCore 캔버스 어댑터.
//
// 기존 흐름 에디터는 브라우저 배치를 "실측"해서 mm를 얻지만, 새 캔버스는 모델이
// 이미 mm 좌표(진실)라 DOM 없이 순수 변환으로 끝난다 — Node/워커에서도 돌 수 있다.
// 병합(다중 레코드)을 위해 문서 배열을 페이지별로 싣는 변형도 제공한다.
import { buildHwpx } from "../../hwpx/exportCore.js";
import { type Block, type CanvasDoc, TEXT_DEFAULTS } from "./model";

function elementOf(b: Block, page: number) {
  if (b.type === "text")
    return {
      type: "text",
      page,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      text: b.text ?? "",
      // 화면 스타일을 그대로 내보내기 코어로 (pt·굵기·기울임·정렬·색)
      style: {
        pt: b.fontSize ?? TEXT_DEFAULTS.fontSize,
        bold: b.bold ?? TEXT_DEFAULTS.bold,
        italic: b.italic ?? TEXT_DEFAULTS.italic,
        align: b.align ?? TEXT_DEFAULTS.align,
        color: b.color ?? TEXT_DEFAULTS.color,
        lineSpacing: 140,
      },
    };
  if (b.type === "table")
    return { type: "table", page, x: b.x, y: b.y, w: b.w, h: b.h, rows: b.rows ?? [[""]] };
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
  return buildHwpx({ page: { ...docs[0].page }, elements });
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
