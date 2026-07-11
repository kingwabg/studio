// canvas-snap.ts — [캔버스 한컴 포크] 캔바식 스냅 가이드 (합체 4단계, 2026-07-11)
// 개체(그림·도형·글상자) 이동 드래그에 자석 정렬을 얹는다: 지면 가장자리·여백선·중앙 +
// 같은 페이지 다른 개체들의 좌/중/우·상/중/하 에 ±SNAP_EPS_PX 접근 시 스냅 + 정렬선 표시.
// 좌표계: 페이지 로컬 px (getPageControlLayout·HWPUNIT/75 과 동일). Alt = 스냅 해제.
// document-studio 캔버스(snap.ts)의 검증된 규약을 rhwp 구조로 재구현 — 로직 원본과 독립.

export const SNAP_EPS_PX = 5;

export type SnapGuide = { axis: 'x' | 'y'; pos: number };
export type SnapTargets = { xs: number[]; ys: number[] };
export type SnapContext = {
  targets: SnapTargets;
  bbox: { x: number; y: number; w: number; h: number }; // 드래그 시작 시 이동 개체(들) 합집합
};

type MovingRef = { ppi: number; ci: number };
type LayoutControl = { x: number; y: number; w: number; h: number; paraIdx?: number; controlIdx?: number };
type WasmLike = {
  getPageControlLayout(page: number): { controls: LayoutControl[] };
  getPageDef(sectionIdx: number): {
    marginLeft: number; marginRight: number; marginTop: number; marginBottom: number;
    marginHeader: number; marginFooter: number;
  };
};

const HWP_PER_PX = 75;

/** 드래그 시작 시 1회: 스냅 타겟(지면·여백·타 개체)과 이동 개체 합집합 bbox 수집 */
export function buildSnapContext(
  wasm: WasmLike,
  pageIndex: number,
  moving: MovingRef[],
  pageWpx: number,
  pageHpx: number,
): SnapContext | null {
  const xs: number[] = [0, pageWpx / 2, pageWpx];
  const ys: number[] = [0, pageHpx / 2, pageHpx];
  try {
    const pd = wasm.getPageDef(0);
    xs.push(pd.marginLeft / HWP_PER_PX, pageWpx - pd.marginRight / HWP_PER_PX);
    ys.push((pd.marginTop + pd.marginHeader) / HWP_PER_PX, pageHpx - (pd.marginBottom + pd.marginFooter) / HWP_PER_PX);
  } catch { /* 여백선 없이 진행 */ }

  let bbox: SnapContext['bbox'] | null = null;
  try {
    const controls = wasm.getPageControlLayout(pageIndex)?.controls ?? [];
    for (const c of controls) {
      const isMoving = moving.some((m) => m.ppi === c.paraIdx && m.ci === c.controlIdx);
      if (isMoving) {
        bbox = bbox
          ? {
              x: Math.min(bbox.x, c.x),
              y: Math.min(bbox.y, c.y),
              w: Math.max(bbox.x + bbox.w, c.x + c.w) - Math.min(bbox.x, c.x),
              h: Math.max(bbox.y + bbox.h, c.y + c.h) - Math.min(bbox.y, c.y),
            }
          : { x: c.x, y: c.y, w: c.w, h: c.h };
        continue;
      }
      xs.push(c.x, c.x + c.w / 2, c.x + c.w);
      ys.push(c.y, c.y + c.h / 2, c.y + c.h);
    }
  } catch { /* 개체 열거 실패 — 지면 라인만으로 진행 */ }

  if (!bbox) return null; // 이동 개체를 레이아웃에서 못 찾으면 스냅 비활성(오탐 방지)
  return { targets: { xs, ys }, bbox };
}

/** 이동 후보 bbox → 가장 가까운 타겟으로의 보정(dx,dy)과 정렬선 */
export function computeSnap(
  bbox: { x: number; y: number; w: number; h: number },
  t: SnapTargets,
  eps: number = SNAP_EPS_PX,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const pick = (cands: number[], targets: number[]) => {
    let best: { d: number; pos: number } | null = null;
    for (const c of cands)
      for (const tg of targets) {
        const d = tg - c;
        if (Math.abs(d) <= eps && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, pos: tg };
      }
    return best;
  };
  const bx = pick([bbox.x, bbox.x + bbox.w / 2, bbox.x + bbox.w], t.xs);
  const by = pick([bbox.y, bbox.y + bbox.h / 2, bbox.y + bbox.h], t.ys);
  const guides: SnapGuide[] = [];
  if (bx) guides.push({ axis: 'x', pos: bx.pos });
  if (by) guides.push({ axis: 'y', pos: by.pos });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}

/** 정렬선 오버레이 — TableObjectRenderer 패턴(#scroll-content 절대배치 레이어, z8) */
export class SnapGuideLayer {
  private layer: HTMLDivElement | null = null;
  constructor(private container: HTMLElement) {}

  private ensure(): HTMLDivElement | null {
    if (this.layer?.isConnected) return this.layer;
    const sc = this.container.querySelector('#scroll-content');
    if (!sc) return null;
    const layer = document.createElement('div');
    layer.className = 'canvas-snap-layer';
    layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:8;';
    sc.appendChild(layer);
    this.layer = layer;
    return layer;
  }

  show(
    guides: SnapGuide[],
    ctx: { zoom: number; pageLeft: number; pageTop: number; pageWpx: number; pageHpx: number },
  ): void {
    const layer = this.ensure();
    if (!layer) return;
    layer.replaceChildren();
    for (const g of guides) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.background = 'var(--ui-menu-open, #256ef4)';
      el.style.opacity = '0.9';
      if (g.axis === 'x') {
        el.style.left = `${ctx.pageLeft + g.pos * ctx.zoom}px`;
        el.style.top = `${ctx.pageTop}px`;
        el.style.width = '1.5px';
        el.style.height = `${ctx.pageHpx * ctx.zoom}px`;
      } else {
        el.style.left = `${ctx.pageLeft}px`;
        el.style.top = `${ctx.pageTop + g.pos * ctx.zoom}px`;
        el.style.height = '1.5px';
        el.style.width = `${ctx.pageWpx * ctx.zoom}px`;
      }
      layer.appendChild(el);
    }
  }

  clear(): void {
    this.layer?.replaceChildren();
  }
}

// 컨테이너별 레이어 싱글턴 — input-handler에 필드를 추가하지 않기 위한 최소 침습 장치
const layers = new WeakMap<HTMLElement, SnapGuideLayer>();
export function snapLayerFor(container: HTMLElement): SnapGuideLayer {
  let layer = layers.get(container);
  if (!layer) {
    layer = new SnapGuideLayer(container);
    layers.set(container, layer);
  }
  return layer;
}

// [캔버스 한컴 포크] "전체 표 잡기" 호버 강조 — 8핸들 위에 마우스가 오면 표 전체 외곽을
// accent 사각으로 감싼다(한컴독스식: 핸들=전체, 그 외=경계선). snap 가이드와 별도 레이어라
// 경계선 마커·스냅선과 충돌하지 않는다.
export class TableHoverLayer {
  private layer: HTMLDivElement | null = null;
  constructor(private container: HTMLElement) {}
  private ensure(): HTMLDivElement | null {
    if (this.layer?.isConnected) return this.layer;
    const sc = this.container.querySelector('#scroll-content');
    if (!sc) return null;
    const layer = document.createElement('div');
    layer.className = 'table-whole-hover-layer';
    layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:8;';
    sc.appendChild(layer);
    this.layer = layer;
    return layer;
  }
  show(
    bbox: { x: number; y: number; width: number; height: number },
    ctx: { zoom: number; pageLeft: number; pageTop: number },
  ): void {
    const layer = this.ensure();
    if (!layer) return;
    const el = (layer.firstElementChild as HTMLDivElement) ?? document.createElement('div');
    el.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;' +
      'border:2px solid var(--ui-menu-open,#256ef4);background:color-mix(in srgb, var(--ui-menu-open,#256ef4) 8%, transparent);';
    el.style.left = `${ctx.pageLeft + (bbox.x - 1.5) * ctx.zoom}px`;
    el.style.top = `${ctx.pageTop + (bbox.y - 1.5) * ctx.zoom}px`;
    el.style.width = `${(bbox.width + 3) * ctx.zoom}px`;
    el.style.height = `${(bbox.height + 3) * ctx.zoom}px`;
    if (!el.parentElement) layer.appendChild(el);
  }
  clear(): void {
    this.layer?.replaceChildren();
  }
}
const hoverLayers = new WeakMap<HTMLElement, TableHoverLayer>();
export function tableHoverFor(container: HTMLElement): TableHoverLayer {
  let layer = hoverLayers.get(container);
  if (!layer) {
    layer = new TableHoverLayer(container);
    hoverLayers.set(container, layer);
  }
  return layer;
}
