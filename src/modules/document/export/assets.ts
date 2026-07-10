// assets.ts — 이미지 자산 수집(binId 매핑·원본 크기) (exportHwpx에서 분할 — 계획 4단계).
import { type CanvasDoc } from "../model";
import { extOfMime, getAsset } from "../assets";

// ── 이미지 포함 내보내기 (비동기 — 자산 저장소에서 바이트·원본 크기 로드) ──
// 자산 id → binId(image1..N, 중복 자산은 1회만) 매핑을 만들고 elements와 함께 싣는다.
export async function collectImages(docs: CanvasDoc[]) {
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
