/**
 * [자 드래그 2026-07-30] 가로 자(ruler)의 마커를 끌어 문단 여백·들여쓰기를 바꾼다.
 * 한컴 패리티 조사에서 확정한 갭: ruler.ts 에 pointer 리스너가 **0개**여서 마커는 표시만 되고
 * 끌 수 없었다(구조적 부재, high).
 *
 * 좌표 규약(실측 2026-07-30): ParaProperties 의 marginLeft/marginRight/indent 는 **이미
 * px(96dpi, zoom=1)** 이다 — marginLeft 를 0→2000 으로 주면 커서 x 가 165→2139 로 1:1 이동한다.
 * 따라서 화면 dx 를 zoom 으로만 나누면 그대로 적용값이 된다(HWPUNIT 환산 금지).
 *
 * 마커 ↔ 값 관계(ruler.ts 의 그리기 공식을 그대로 역산):
 *   indent >= 0 → first = ml + indent,  remain = ml
 *   indent <  0 → first = ml,           remain = ml + |indent|
 *   ⇒ ml = min(first, remain),  indent = first - remain
 * 오른쪽 마커: marginRight = (본문 우측 기준 - 마커 x)
 */
import type { Ruler } from './ruler';

/** 히트 반경(px). 삼각형 마커가 6px 급이라 여유를 둔다. */
const HIT = 8;

type MarkerKind = 'first' | 'remain' | 'right';

interface DragHost {
  /** 문단 서식 적용 — px 단위 값을 그대로 넘긴다(공개 진입점) */
  applyParaPropsAtCursor(props: Record<string, unknown>): void;
  /** 현재 커서 문단 속성(px) */
  getParaProperties(): { marginLeft?: number; marginRight?: number; indent?: number } | null;
  focus?: () => void;
}

/** 마커 히트테스트 — 가장 가까운 마커, 없으면 null */
export function hitTestMarker(
  x: number, m: { firstX: number; remainX: number; rightX: number },
): MarkerKind | null {
  const cands: Array<[MarkerKind, number]> = [
    ['first', Math.abs(x - m.firstX)],
    ['remain', Math.abs(x - m.remainX)],
    ['right', Math.abs(x - m.rightX)],
  ];
  cands.sort((a, b) => a[1] - b[1]);
  return cands[0][1] <= HIT ? cands[0][0] : null;
}

/** 드래그 결과 → 문단 서식 값(px). 순수 함수라 단위 테스트로 고정한다. */
export function computeParaFromDrag(
  kind: MarkerKind,
  newXScreen: number,
  m: { refLeft: number; refRight: number; zoom: number },
  cur: { marginLeft: number; marginRight: number; indent: number },
): { marginLeft?: number; marginRight?: number; indent?: number } {
  const z = m.zoom || 1;
  // 화면 x → 본문 기준 상대 px(zoom=1)
  const fromLeft = Math.max(0, (newXScreen - m.refLeft) / z);
  const fromRight = Math.max(0, (m.refRight - newXScreen) / z);

  const first = cur.marginLeft + Math.max(0, cur.indent);
  const remain = cur.marginLeft + Math.max(0, -cur.indent);

  if (kind === 'right') {
    return { marginRight: Math.round(fromRight) };
  }
  const nextFirst = kind === 'first' ? fromLeft : first;
  const nextRemain = kind === 'remain' ? fromLeft : remain;
  return {
    marginLeft: Math.round(Math.min(nextFirst, nextRemain)),
    indent: Math.round(nextFirst - nextRemain),
  };
}

/**
 * 가로 자 캔버스에 드래그를 붙인다. 반환값은 해제 함수.
 * hover 시 커서 모양을 바꿔 "끌 수 있음"을 알린다(어포던스 — 조사에서 지적된 항목).
 */
export function attachRulerDrag(
  hCanvas: HTMLCanvasElement,
  ruler: Ruler,
  getHost: () => DragHost | null,
): () => void {
  let dragging: MarkerKind | null = null;

  const localX = (e: PointerEvent | MouseEvent): number =>
    e.clientX - hCanvas.getBoundingClientRect().left;

  const apply = (kind: MarkerKind, x: number): void => {
    const m = ruler.getMarkers();
    const host = getHost();
    if (!m || !host) return;
    const p = host.getParaProperties() ?? {};
    const next = computeParaFromDrag(kind, x, m, {
      marginLeft: p.marginLeft ?? 0,
      marginRight: p.marginRight ?? 0,
      indent: p.indent ?? 0,
    });
    host.applyParaPropsAtCursor(next);
  };

  const onMove = (e: PointerEvent): void => {
    const m = ruler.getMarkers();
    if (!m) return;
    if (dragging) {
      e.preventDefault();
      apply(dragging, localX(e));
      return;
    }
    hCanvas.style.cursor = hitTestMarker(localX(e), m) ? 'ew-resize' : '';
  };

  const onDown = (e: PointerEvent): void => {
    const m = ruler.getMarkers();
    if (!m) return;
    const hit = hitTestMarker(localX(e), m);
    if (!hit) return;
    dragging = hit;
    e.preventDefault();
    hCanvas.setPointerCapture?.(e.pointerId);
  };

  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    apply(dragging, localX(e));
    dragging = null;
    hCanvas.releasePointerCapture?.(e.pointerId);
    getHost()?.focus?.();
  };

  hCanvas.addEventListener('pointerdown', onDown);
  hCanvas.addEventListener('pointermove', onMove);
  hCanvas.addEventListener('pointerup', onUp);
  hCanvas.addEventListener('pointercancel', onUp);

  return () => {
    hCanvas.removeEventListener('pointerdown', onDown);
    hCanvas.removeEventListener('pointermove', onMove);
    hCanvas.removeEventListener('pointerup', onUp);
    hCanvas.removeEventListener('pointercancel', onUp);
  };
}
