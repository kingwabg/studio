// exportHwpx.ts — CanvasDoc(자유배치, mm) → exportCore 캔버스 어댑터 (공개 API 파사드).
//
// 내부는 export/{elements,measure,assets}로 분할(계획 4단계) — 이 파일은 진입점만.
// 콜사이트(StudioEditor·HanPreviewModal·LeftPanel·StudioEmbed)는 이 경로 그대로.
import { buildHwpx } from "../../hwpx/exportCore.js";
import { type CanvasDoc } from "./model";
import { DEFAULT_FONT, fontByKey } from "./fonts";
import { elementOf } from "./export/elements";
import { collectImages } from "./export/assets";

// 문서 폰트 — 기본 나눔고딕(hwpxName)을 문서 기본으로 선언 (요소별 글꼴은 elementOf가)
function effectiveFont(): string {
  return fontByKey(DEFAULT_FONT).hwpxName;
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
