// rhwpLoader.js — @rhwp/core WASM 공용 로더 (미리보기·가져오기가 공유)
//
// 이 모듈은 dynamic import로만 불러온다 — WASM(약 5.7MB)을 실제로 쓰는 순간에만
// 내려받아 편집 화면의 첫 로딩을 지키기 위함. 초기화는 앱 수명 동안 1회.
import wasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import init, { HwpDocument } from "@rhwp/core";

let initPromise = null;

// measureTextWidth는 init "전"에 등록해야 한다 — rhwp가 줄바꿈/정렬 계산 시
// 브라우저 Canvas의 실제 글자 폭을 콜백으로 묻기 때문.
export function ensureInit() {
  if (!initPromise) {
    let ctx = null;
    let lastFont = "";
    globalThis.measureTextWidth = (font, text) => {
      if (!ctx) ctx = document.createElement("canvas").getContext("2d");
      if (font !== lastFont) {
        ctx.font = font;
        lastFont = font;
      }
      return ctx.measureText(text).width;
    };
    initPromise = init({ module_or_path: wasmUrl });
  }
  return initPromise;
}

// hwp/hwpx 바이트 → HwpDocument. 호출자가 반드시 doc.free()로 해제할 것 (wasm 힙).
export async function openDocument(bytes) {
  await ensureInit();
  return new HwpDocument(bytes);
}
