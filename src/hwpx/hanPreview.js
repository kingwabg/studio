// hanPreview.js — rhwp(@rhwp/core, WASM)로 hwpx 바이트를 "한글이 그리는 그대로" 페이지 SVG로 조판.
//
// 아키텍처상 위치: [파생] 전용. 내보내기 코어(exportCore.js, 의존성 0)는 건드리지 않고,
// 그 결과물(hwpx 바이트)을 입력으로 받아 미리보기만 만든다.
// WASM 로딩/초기화는 rhwpLoader가 담당 (가져오기 importCore와 공유).
import { openDocument } from "./rhwpLoader.js";

// hwpx 바이트 → 페이지별 SVG 문자열 배열
export async function renderHwpxPages(bytes) {
  const doc = await openDocument(bytes);
  try {
    const n = doc.pageCount();
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(doc.renderPageSvg(i));
    return pages;
  } finally {
    doc.free(); // wasm 힙의 문서 객체는 GC가 못 거두므로 명시 해제
  }
}
