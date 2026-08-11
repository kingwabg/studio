/**
 * [캔버스 한컴 포크] 표 hover 핸들 — Alt 없이 표 전체 선택 + 리사이즈.
 * 캔버스 모드에서 표에 마우스를 올리면 외곽선 + 흰 네모 핸들이 뜬다:
 *  - 핸들 클릭 = 표 전체 개체 선택
 *  - e/s/se(오른쪽·아래·대각) 핸들 드래그 = 너비/높이/양방향 리사이즈(기존 startTableHandleResize 재사용)
 *  - 핸들 아닌 안쪽 = 평소대로 셀 텍스트 편집 (핸들만 pointer-events:auto라 안쪽 클릭은 통과)
 * 엔진·문서 모델 무변경 — #scroll-content 위 오버레이 + container 자체 mousemove(거대 onClick 무수정).
 * ⚠ #scroll-content는 문서 로드 때 재생성 → 리스너는 container, 레이어는 ensureAttached 재부착.
 *
 * [2026-08-11 사용자 지시] 그림(테두리·핸들)은 **개체 선택 상태와 완전히 동일**하다 —
 * table-object-renderer 의 공용 부품을 그대로 쓴다. 다른 점은 동작뿐: 여기 핸들은
 * 잡으면 '선택'(pointer-events:auto + move 커서), 선택 상태 핸들은 리사이즈다.
 */

import {
  applyTableGrabBorderStyle,
  createTableGrabHandle,
  TABLE_GRAB_HANDLE_POS,
} from './table-object-renderer';

export interface TableHoverHost {
  getZoom(): number;
  /** 지금 hover 핸들을 보여도 되는가 (캔버스 모드·개체 미선택·드래그 아님) */
  canShowTableHoverHandles(): boolean;
  /** 핸들 잡음 → 표 선택(+ e/s/se면 리사이즈 시작) */
  onTableHoverHandleGrab(
    ref: { sec: number; ppi: number; ci: number },
    dir: Dir, pageX: number, pageY: number, pageIndex: number,
  ): void;
}

interface VScroll {
  getPageAtPoint(x: number, y: number): number;
  getPageOffset(pageIdx: number): number;
  getPageLeftResolved(pageIdx: number, contentWidth: number): number;
}

type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
// [캔버스 한컴 포크] 선택 전 핸들은 "표 전체 잡기(=선택)" 신호 — 리사이즈 커서가 아니라 move(잡기).
// 리사이즈 커서/동작은 선택 후에만(선택 상태 hover가 방향별 resize 커서를 준다).
const GRAB_CURSOR = 'move';

export class TableHoverHandles {
  private layer: HTMLDivElement;
  private border: HTMLDivElement;
  private handles: HTMLDivElement[] = [];
  private current: { key: string; ref: { sec: number; ppi: number; ci: number }; pi: number } | null = null;

  constructor(
    private container: HTMLElement,
    private wasm: any,
    private virtualScroll: VScroll,
    private host: TableHoverHost,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'table-hover-handle-layer';
    this.layer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:8;';
    this.border = document.createElement('div');
    this.border.style.display = 'none';
    this.layer.appendChild(this.border);

    this.container.addEventListener('mousemove', this.onMove);
    this.container.addEventListener('mouseleave', this.hide);
    window.addEventListener('scroll', this.hide, true);
  }

  private ensureAttached(): HTMLElement | null {
    const sc = this.container.querySelector('#scroll-content') as HTMLElement | null;
    if (sc && this.layer.parentElement !== sc) sc.appendChild(this.layer);
    return sc;
  }

  private onMove = (e: MouseEvent): void => {
    const sc = this.ensureAttached();
    if (!sc || !this.host.canShowTableHoverHandles()) { this.hide(); return; }
    const cr = sc.getBoundingClientRect();
    const cx = e.clientX - cr.left;
    const cy = e.clientY - cr.top;
    const zoom = this.host.getZoom() || 1;
    const pi = this.virtualScroll.getPageAtPoint(cx, cy);
    const po = this.virtualScroll.getPageOffset(pi);
    const pl = this.virtualScroll.getPageLeftResolved(pi, sc.clientWidth);
    const pageX = (cx - pl) / zoom;
    const pageY = (cy - po) / zoom;

    const found = this.findTableAt(pi, pageX, pageY);
    if (!found) { this.hide(); return; }
    const key = `${pi}:${found.ref.sec}:${found.ref.ppi}:${found.ref.ci}`;
    if (this.current?.key === key) return; // 같은 표 위 — 이미 렌더됨(mousemove 스팸 방지)

    this.render(found.ref, found.bbox, pi, zoom, pl, po);
    this.current = { key, ref: found.ref, pi };
  };

  private render(
    ref: { sec: number; ppi: number; ci: number },
    bbox: { x: number; y: number; width: number; height: number },
    pi: number, zoom: number, pl: number, po: number,
  ): void {
    for (const h of this.handles) h.remove();
    this.handles = [];
    const left = pl + bbox.x * zoom;
    const top = po + bbox.y * zoom;
    const w = bbox.width * zoom;
    const h = bbox.height * zoom;
    // 테두리·핸들 모두 개체 선택과 같은 부품 (사용자 지시: 두 효과 동일)
    applyTableGrabBorderStyle(this.border, left, top, w, h, zoom);
    this.border.style.display = 'block';

    for (const p of TABLE_GRAB_HANDLE_POS) {
      const el = createTableGrabHandle(p.dir, left + p.fx * w, top + p.fy * h);
      // 그림은 선택 상태와 같고, **동작만** 다르다 — 잡으면 표 개체 선택.
      el.style.pointerEvents = 'auto';
      el.style.cursor = GRAB_CURSOR;
      el.addEventListener('mousedown', (ev) => this.grab(ev, p.dir as Dir));
      this.layer.appendChild(el);
      this.handles.push(el);
    }
  }

  /** 핸들 mousedown → 좌표 계산 후 host에 위임(선택/리사이즈). */
  private grab(ev: MouseEvent, dir: Dir): void {
    if (ev.button !== 0 || !this.current) return;
    ev.preventDefault();
    ev.stopPropagation(); // 캔버스 onClick(셀 편집)으로 새지 않게
    const sc = this.container.querySelector('#scroll-content') as HTMLElement | null;
    if (!sc) return;
    const cr = sc.getBoundingClientRect();
    const zoom = this.host.getZoom() || 1;
    const pi = this.current.pi;
    const pl = this.virtualScroll.getPageLeftResolved(pi, sc.clientWidth);
    const po = this.virtualScroll.getPageOffset(pi);
    const pageX = (ev.clientX - cr.left - pl) / zoom;
    const pageY = (ev.clientY - cr.top - po) / zoom;
    this.host.onTableHoverHandleGrab(this.current.ref, dir, pageX, pageY, pi);
    this.hide();
  }

  /** 페이지 pi 위 (pageX,pageY)를 담는 표를 찾는다(뒤=위 z순서 우선). */
  private findTableAt(pi: number, pageX: number, pageY: number):
    { ref: { sec: number; ppi: number; ci: number }; bbox: { x: number; y: number; width: number; height: number } } | null {
    let layout: any;
    try { layout = this.wasm.getPageControlLayout(pi); } catch { return null; }
    let hit: any = null;
    for (const ctrl of layout?.controls ?? []) {
      if (ctrl.type !== 'table') continue;
      let bbox: any;
      try { bbox = this.wasm.getTableBBox(ctrl.secIdx ?? 0, ctrl.paraIdx, ctrl.controlIdx); } catch { continue; }
      if (pageX >= bbox.x && pageX <= bbox.x + bbox.width &&
          pageY >= bbox.y && pageY <= bbox.y + bbox.height) {
        hit = { ref: { sec: ctrl.secIdx ?? 0, ppi: ctrl.paraIdx, ci: ctrl.controlIdx }, bbox };
      }
    }
    return hit;
  }

  hide = (): void => {
    if (!this.current && this.border.style.display === 'none') return;
    this.border.style.display = 'none';
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.current = null;
  };

  dispose(): void {
    this.container.removeEventListener('mousemove', this.onMove);
    this.container.removeEventListener('mouseleave', this.hide);
    window.removeEventListener('scroll', this.hide, true);
    this.layer.remove();
  }
}
