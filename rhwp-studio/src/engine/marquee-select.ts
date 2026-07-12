// [캔버스 한컴 포크] 마퀴(러버밴드) 선택 — 빈 지면 드래그로 그린 사각형과 겹치는 개체를 고른다.
// 순수 함수(DOM/wasm 무의존)라 단위 테스트로 히트테스트 정합을 검증한다(object-align.ts 패턴).
// 좌표계: 페이지 px(getPageControlLayout의 controls와 동일 공간). 드래그 방향 무관.

export interface MarqueeRect { x: number; y: number; w: number; h: number; }

/** 드래그로 개체가 "잡혔다"고 볼 최소 이동량(px) — 이 미만은 단순 클릭(=선택 해제). */
export const MARQUEE_MIN_PX = 3;

/** 두 점(드래그 시작·끝)을 좌상단+양수 크기 사각형으로 정규화한다(어느 방향이든). */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): MarqueeRect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** 두 사각형이 겹치는가(경계만 접하는 경우는 제외 — 실제 면적 교차). */
export function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 마퀴 사각형에 걸린 개체들의 인덱스를 돌려준다(교차=intersect 모드, 피그마식 "닿으면 선택").
 * boxes는 개체 bbox 배열. 비정상(NaN 등) 박스는 건너뛴다.
 */
export function objectsInMarquee(marquee: MarqueeRect, boxes: MarqueeRect[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
    if (rectsIntersect(marquee, b)) hits.push(i);
  }
  return hits;
}
