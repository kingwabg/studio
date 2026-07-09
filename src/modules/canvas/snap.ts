// snap.ts — 스마트 정렬 가이드(자석 스냅) 엔진 + 가이드 상태.
//
// 이동 중인 블록의 세로선(좌/중/우)·가로선(상/중/하)이 다른 블록의 선이나 지면의
// 가장자리·중앙과 ±SNAP_MM 안에 오면 그 선에 "착" 붙인다 (Hard Snap).
// Alt를 누르면 스냅 해제(정밀 조정) — 캔바/피그마와 같은 하이브리드.
//
// 가이드 표시는 지면 전체를 관통하지 않고 "정렬에 참여한 요소들의 구간"만 그린다
// (피그마식 구간선). 스냅이 걸리면 이동 블록과 가장 가까운 이웃 사이의 거리(mm)를
// 배지로 함께 띄운다. computeSnap은 순수 함수라 Node 하네스로 검증 가능하다.
import { create } from "zustand";
import { type Block, type CanvasDoc } from "../document/model";

export const SNAP_MM = 2;
const EPS = 0.4; // 같은 선으로 볼 허용 오차(mm) — 스냅 후 정합 판단용

// ── Alt 스냅 해제 플래그 (윈도우 리스너는 StudioEditor가 등록) ──
let altPressed = false;
export const setAltPressed = (v: boolean) => {
  altPressed = v;
};
export const isAltPressed = () => altPressed;

// ── 드래그 중 표시할 가이드 (구간선 + 거리 배지) — 초경량 UI 스토어 ──
export interface SnapGuide {
  axis: "v" | "h"; // 세로선(v) / 가로선(h)
  at: number; // 선 위치(mm) — v면 x, h면 y
  from: number; // 구간 시작(반대축 mm)
  to: number; // 구간 끝(반대축 mm)
  page: boolean; // 지면 기준선인가(가장자리·정중앙) — 스타일 구분
}
export interface SnapBadge {
  cx: number; // 배지 중심 x(mm)
  cy: number; // 배지 중심 y(mm)
  mm: number; // 이웃까지의 거리(mm)
  axis: "v" | "h"; // 갭 방향과 함께 그릴 측정선 방향
}

interface GuideState {
  guides: SnapGuide[];
  badges: SnapBadge[];
  setGuides: (guides: SnapGuide[], badges: SnapBadge[]) => void;
  clear: () => void;
}
// 렌더 폭주 방지 — 이전 프레임과 같은 내용이면 set 생략
const sig = (guides: SnapGuide[], badges: SnapBadge[]) =>
  guides.map((g) => `${g.axis}${g.at.toFixed(1)}:${g.from.toFixed(1)}-${g.to.toFixed(1)}`).join("|") +
  "#" +
  badges.map((b) => `${b.cx.toFixed(1)},${b.cy.toFixed(1)}=${b.mm}`).join("|");

export const useGuideStore = create<GuideState>((set, get) => ({
  guides: [],
  badges: [],
  setGuides: (guides, badges) => {
    const s = get();
    if (sig(s.guides, s.badges) === sig(guides, badges)) return;
    set({ guides, badges });
  },
  clear: () => {
    const s = get();
    if (s.guides.length || s.badges.length) set({ guides: [], badges: [] });
  },
}));

// ── 드래그 팔로우 — 블록을 끄는 동안 "함께 움직일 집합"(트리 자손 + 그룹 멤버 +
//    다중 선택)이 실시간으로 따라오도록, 시각 델타(px)와 멤버 집합을 공유한다.
//    멤버 집합은 드래그당 1회 계산(StudioEditor) — 블록마다 재계산하지 않는다. ──
interface FollowState {
  activeId: string | null;
  dxPx: number;
  dyPx: number;
  members: Set<string> | null;
  setFollow: (activeId: string, dxPx: number, dyPx: number, members: Set<string>) => void;
  clear: () => void;
}
export const useFollowStore = create<FollowState>((set, get) => ({
  activeId: null,
  dxPx: 0,
  dyPx: 0,
  members: null,
  setFollow: (activeId, dxPx, dyPx, members) => {
    const s = get();
    if (s.activeId === activeId && s.dxPx === dxPx && s.dyPx === dyPx) return;
    set({ activeId, dxPx, dyPx, members });
  },
  clear: () => {
    if (get().activeId !== null) set({ activeId: null, dxPx: 0, dyPx: 0, members: null });
  },
}));

// ── 스냅 계산 ──
export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  badges: SnapBadge[];
}

// 한 축의 스냅 후보선: 위치(at) + 출처(block=요소, null=지면)
interface Line {
  at: number;
  block: Block | null;
}

// 후보선 중 이동선(offsets)에 가장 가까운 스냅을 찾는다
function bestSnap(lines: Line[], base: number, offsets: number[]): { at: number; delta: number } | null {
  let best: { at: number; delta: number } | null = null;
  for (const off of offsets)
    for (const ln of lines) {
      const d = ln.at - (base + off);
      if (Math.abs(d) <= SNAP_MM && (best === null || Math.abs(d) < Math.abs(best.delta)))
        best = { at: ln.at, delta: d };
    }
  return best;
}

// 이동 후보 (xMm, yMm)의 블록(id, w, h)을 다른 블록·지면에 스냅
export function computeSnap(
  doc: CanvasDoc,
  movingId: string,
  xMm: number,
  yMm: number,
  w: number,
  h: number
): SnapResult {
  const others = doc.blocks.filter((b) => b.id !== movingId);

  // 후보선 수집: 지면(가장자리+중앙) + 다른 블록들(가장자리+중앙)
  const linesX: Line[] = [
    { at: 0, block: null },
    { at: doc.page.w / 2, block: null },
    { at: doc.page.w, block: null },
  ];
  const linesY: Line[] = [
    { at: 0, block: null },
    { at: doc.page.h / 2, block: null },
    { at: doc.page.h, block: null },
  ];
  for (const b of others) {
    linesX.push({ at: b.x, block: b }, { at: b.x + b.w / 2, block: b }, { at: b.x + b.w, block: b });
    linesY.push({ at: b.y, block: b }, { at: b.y + b.h / 2, block: b }, { at: b.y + b.h, block: b });
  }

  // 이동 블록의 선: 좌/중/우 · 상/중/하 (후보 좌표 기준의 오프셋)
  const snapX = bestSnap(linesX, xMm, [0, w / 2, w]);
  const snapY = bestSnap(linesY, yMm, [0, h / 2, h]);

  const sx = snapX ? xMm + snapX.delta : xMm;
  const sy = snapY ? yMm + snapY.delta : yMm;
  const M = { x: sx, y: sy, w, h }; // 스냅 적용된 이동 블록 상자

  const guides: SnapGuide[] = [];
  const badges: SnapBadge[] = [];

  // 세로 가이드 — 같은 x선(at)에 걸린 블록들의 세로 구간만 그린다
  if (snapX) {
    const at = snapX.at;
    const on = others.filter((b) => near(b.x, at) || near(b.x + b.w / 2, at) || near(b.x + b.w, at));
    if (on.length) {
      const tops = [M.y, ...on.map((b) => b.y)];
      const bots = [M.y + M.h, ...on.map((b) => b.y + b.h)];
      guides.push({ axis: "v", at, from: Math.min(...tops), to: Math.max(...bots), page: false });
      const nb = nearestGap(on, M.y, M.y + M.h, (b) => [b.y, b.y + b.h]);
      if (nb) badges.push({ cx: at, cy: nb.mid, mm: Math.round(nb.gap), axis: "v" });
    } else {
      // 지면 기준선(가장자리·정중앙) — 전체 관통
      guides.push({ axis: "v", at, from: 0, to: doc.page.h, page: true });
    }
  }

  // 가로 가이드 — 같은 y선(at)에 걸린 블록들의 가로 구간만
  if (snapY) {
    const at = snapY.at;
    const on = others.filter((b) => near(b.y, at) || near(b.y + b.h / 2, at) || near(b.y + b.h, at));
    if (on.length) {
      const lefts = [M.x, ...on.map((b) => b.x)];
      const rights = [M.x + M.w, ...on.map((b) => b.x + b.w)];
      guides.push({ axis: "h", at, from: Math.min(...lefts), to: Math.max(...rights), page: false });
      const nb = nearestGap(on, M.x, M.x + M.w, (b) => [b.x, b.x + b.w]);
      if (nb) badges.push({ cx: nb.mid, cy: at, mm: Math.round(nb.gap), axis: "h" });
    } else {
      guides.push({ axis: "h", at, from: 0, to: doc.page.w, page: true });
    }
  }

  return { x: sx, y: sy, guides, badges };
}

const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

// 정렬된 이웃들 중, 이동 블록(lo~hi 구간)과 가장 가까운 이웃과의 빈 간격(gap)과
// 그 중점을 구한다. 겹치면(gap<=0) 배지 생략(null). span은 이웃의 [시작,끝].
function nearestGap(
  neighbors: Block[],
  lo: number,
  hi: number,
  span: (b: Block) => [number, number]
): { gap: number; mid: number } | null {
  let best: { gap: number; mid: number } | null = null;
  for (const b of neighbors) {
    const [s, e] = span(b);
    let gap: number, mid: number;
    if (e <= lo) {
      gap = lo - e; // 이웃이 위/왼쪽
      mid = (e + lo) / 2;
    } else if (s >= hi) {
      gap = s - hi; // 이웃이 아래/오른쪽
      mid = (hi + s) / 2;
    } else {
      continue; // 구간이 겹침 — 거리 의미 없음
    }
    if (gap > 0 && (best === null || gap < best.gap)) best = { gap, mid };
  }
  return best;
}
