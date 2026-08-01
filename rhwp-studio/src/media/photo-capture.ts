/**
 * 문서에 삽입된 이미지를 로컬 사진첩("내 사진")에 자동 축적한다.
 *
 * `WasmBridge.insertPicture` 성공 직후 fire-and-forget 으로 호출된다 —
 * 리본 '그림'·드롭·붙여넣기 세 경로가 모두 이 한 지점을 통과하므로 여기 한 곳만
 * 후킹하면 된다. 저장이 실패해도 삽입 흐름에는 절대 영향을 주지 않는다.
 */
import { savePhoto } from '@/media/photo-store';

const THUMB_MAX = 96;

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  return `image/${e === 'jpg' ? 'jpeg' : e}`;
}

async function makeThumbnail(data: Uint8Array, ext: string): Promise<string> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return '';
    const blob = new Blob([data as BlobPart], { type: mimeForExt(ext) });
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}

/** 삽입된 이미지를 사진첩에 저장(비동기, 실패 무시). */
export function capturePhoto(
  data: Uint8Array,
  ext: string,
  width: number,
  height: number,
  name: string,
): void {
  const bytes = new Uint8Array(data); // 호출측 재사용/변경과 분리
  void (async () => {
    try {
      const thumb = await makeThumbnail(bytes, ext);
      await savePhoto({ name: name || `그림.${ext}`, ext, width, height, data: bytes, thumb });
    } catch (err) {
      console.warn('[photo-capture] 사진첩 저장 실패(무시):', err);
    }
  })();
}
