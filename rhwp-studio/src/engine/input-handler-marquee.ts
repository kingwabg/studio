// [캔버스 한컴 포크] 마퀴(러버밴드) 선택 — input-handler에서 추출한 드래그 수명주기.
// 캔버스 모드에서 빈 지면을 드래그하면 사각형을 그리고, 놓는 순간 그 안에 걸친 개체를
// 다중 선택한다. 히트테스트 수학은 순수 모듈(marquee-select.ts), 여기는 DOM/wasm 배선만.
// 대원칙 준수: 엔진·문서 모델 무변경 — 기존 다중 선택 상태(selectedPictureRefs)만 채운다.
import { normalizeRect, objectsInMarquee, MARQUEE_MIN_PX, type MarqueeRect } from './marquee-select';

type ShapeType = 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole';
const SHAPE_TYPES: ShapeType[] = ['image', 'shape', 'equation', 'group', 'line', 'ole'];

/** client 좌표 → 지정 페이지의 페이지 px(개체 layout과 동일 공간). */
function clientToPage(that: any, clientX: number, clientY: number, pageIdx: number): { pageX: number; pageY: number } | null {
  const sc = that.container.querySelector('#scroll-content');
  if (!sc) return null;
  const zoom = that.viewportManager.getZoom();
  const cr = sc.getBoundingClientRect();
  const cx = clientX - cr.left;
  const cy = clientY - cr.top;
  const po = that.virtualScroll.getPageOffset(pageIdx);
  const pl = that.virtualScroll.getPageLeftResolved(pageIdx, sc.clientWidth);
  return { pageX: (cx - pl) / zoom, pageY: (cy - po) / zoom };
}

function showMarqueeOverlay(that: any, x1: number, y1: number, x2: number, y2: number): void {
  if (!that.marqueeOverlay) {
    that.marqueeOverlay = document.createElement('div');
    that.marqueeOverlay.style.cssText =
      'position:fixed;border:1px solid #256ef4;background:rgba(37,110,244,0.10);pointer-events:none;z-index:9999;';
    document.body.appendChild(that.marqueeOverlay);
  }
  that.marqueeOverlay.style.left = `${Math.min(x1, x2)}px`;
  that.marqueeOverlay.style.top = `${Math.min(y1, y2)}px`;
  that.marqueeOverlay.style.width = `${Math.abs(x2 - x1)}px`;
  that.marqueeOverlay.style.height = `${Math.abs(y2 - y1)}px`;
}

function hideMarqueeOverlay(that: any): void {
  if (that.marqueeOverlay) {
    that.marqueeOverlay.remove();
    that.marqueeOverlay = null;
  }
}

/** 빈 지면 mousedown에서 마퀴 후보를 시작한다(아직 사각형은 안 그림 — 드래그해야 나타남). */
export function startMarquee(this: any, e: MouseEvent, pageIdx: number, startPageX: number, startPageY: number): void {
  this.marqueeState = {
    pageIdx,
    startPageX,
    startPageY,
    startClientX: e.clientX,
    startClientY: e.clientY,
    moved: false,
  };
  document.addEventListener('mousemove', this.onMouseMoveBound); // 멱등(동일 참조)
  document.addEventListener('mouseup', this.onMouseUpBound, { once: true });
}

/** 드래그 중 사각형 갱신. 임계값을 넘겨야 마퀴로 승격(그전엔 클릭 후보). */
export function updateMarqueeDrag(this: any, e: MouseEvent): void {
  const st = this.marqueeState;
  if (!st) return;
  if (Math.abs(e.clientX - st.startClientX) > MARQUEE_MIN_PX ||
      Math.abs(e.clientY - st.startClientY) > MARQUEE_MIN_PX) {
    st.moved = true;
  }
  if (st.moved) showMarqueeOverlay(this, st.startClientX, st.startClientY, e.clientX, e.clientY);
}

/** 놓는 순간 — 사각형과 겹친 개체를 다중 선택한다. 이동 없으면 단순 클릭(이미 해제됨)이라 무동작. */
export function finishMarquee(this: any, e: MouseEvent): void {
  const st = this.marqueeState;
  this.marqueeState = null;
  hideMarqueeOverlay(this);
  if (!st || !st.moved) return;

  const end = clientToPage(this, e.clientX, e.clientY, st.pageIdx);
  if (!end) return;
  const marquee: MarqueeRect = normalizeRect(st.startPageX, st.startPageY, end.pageX, end.pageY);

  // 이 페이지의 최상위 floating 개체만(셀 안 개체 cellPath는 제외 — 표 통합은 별도 로드맵)
  let controls: any[] = [];
  try {
    controls = (this.wasm.getPageControlLayout(st.pageIdx)?.controls || [])
      .filter((c: any) => SHAPE_TYPES.includes(c.type) && (!c.cellPath || c.cellPath.length === 0));
  } catch (err) {
    console.warn('[InputHandler] 마퀴 개체 조회 실패:', err);
    return;
  }
  const boxes: MarqueeRect[] = controls.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
  const hitIdx = objectsInMarquee(marquee, boxes);
  if (hitIdx.length === 0) return; // 빈 드래그 = 아무것도 안 잡힘 → 해제 상태 유지

  this.exitPictureObjectSelectionIfNeeded?.();
  const refs = hitIdx.map((i) => {
    const c = controls[i];
    return { sec: c.secIdx ?? 0, ppi: c.paraIdx, ci: c.controlIdx, type: (SHAPE_TYPES.includes(c.type) ? c.type : 'shape') as ShapeType };
  });
  this.cursor.enterPictureObjectSelectionDirect(refs[0].sec, refs[0].ppi, refs[0].ci, refs[0].type);
  for (let k = 1; k < refs.length; k++) this.cursor.togglePictureObjectSelection(refs[k]);
  this.renderPictureObjectSelection();
  this.eventBus.emit('picture-object-selection-changed', true);
  this.textarea?.focus?.();
}
