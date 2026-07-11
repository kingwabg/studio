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
  center?: boolean; // 선택 요소의 "중심선" 정렬인가 — 렌더에서 강조(실선·진하게)
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

// ── 정렬 점선 항상 표시 토글 (수정 단계용) ──
// 표/블록을 이동할 때 잠깐 뜨는 정렬 가이드(보라 점선)를, 드래그하지 않아도 선택한
// 요소 기준으로 계속 보이게 하는 뷰 토글. 진실(문서)엔 영향 없는 순수 뷰 상태.
interface InspectState {
  showGuides: boolean;
  toggle: () => void;
}
export const useInspectStore = create<InspectState>((set) => ({
  showGuides: false,
  toggle: () => set((s) => ({ showGuides: !s.showGuides })),
}));

// 선택한 요소가 "지금" 다른 요소·지면과 맞춰져 있는 정렬 점선(정지 상태).
// 드래그 때 computeSnap이 스냅으로 그리는 것과 같은 구간선을, 이동 없이 현재 위치에서
// 겹치는(정렬된) 모든 축에 대해 그린다. computeSnap은 축당 "가장 가까운 스냅" 하나만
// 돌려주지만, 여기선 좌·중·우 / 상·중·하 각각 정렬된 곳을 전부 보여준다.
const ALIGN_EPS = 0.6; // 정렬로 볼 허용 오차(mm) — 정지 상태라 스냅(0.4)보다 살짝 넉넉히
export function selectionGuides(doc: CanvasDoc, id: string): SnapGuide[] {
  const M = doc.blocks.find((b) => b.id === id);
  if (!M) return [];
  const others = doc.blocks.filter((b) => b.id !== id);
  const near2 = (a: number, b: number) => Math.abs(a - b) <= ALIGN_EPS;
  const guides: SnapGuide[] = [];
  const seen = new Set<string>();
  const push = (g: SnapGuide) => {
    const key = `${g.axis}:${g.at.toFixed(1)}`;
    if (!seen.has(key)) {
      seen.add(key);
      guides.push(g);
    }
  };

  // 세로 정렬(x): 이동 블록의 좌·중·우 선이 다른 블록의 좌/중/우 또는 지면 선과 겹치나.
  // 가운데(center=true)는 렌더에서 강조 — "핵심은 중심선"을 눈에 보이게.
  for (const { at, center } of [
    { at: M.x, center: false },
    { at: M.x + M.w / 2, center: true },
    { at: M.x + M.w, center: false },
  ]) {
    const on = others.filter((b) => near2(b.x, at) || near2(b.x + b.w / 2, at) || near2(b.x + b.w, at));
    if (on.length) {
      const tops = [M.y, ...on.map((b) => b.y)];
      const bots = [M.y + M.h, ...on.map((b) => b.y + b.h)];
      push({ axis: "v", at, from: Math.min(...tops), to: Math.max(...bots), page: false, center });
    } else if (near2(at, 0) || near2(at, doc.page.w / 2) || near2(at, doc.page.w)) {
      push({ axis: "v", at, from: 0, to: doc.page.h, page: true, center });
    }
  }
  // 가로 정렬(y): 상·중·하
  for (const { at, center } of [
    { at: M.y, center: false },
    { at: M.y + M.h / 2, center: true },
    { at: M.y + M.h, center: false },
  ]) {
    const on = others.filter((b) => near2(b.y, at) || near2(b.y + b.h / 2, at) || near2(b.y + b.h, at));
    if (on.length) {
      const lefts = [M.x, ...on.map((b) => b.x)];
      const rights = [M.x + M.w, ...on.map((b) => b.x + b.w)];
      push({ axis: "h", at, from: Math.min(...lefts), to: Math.max(...rights), page: false, center });
    } else if (near2(at, 0) || near2(at, doc.page.h / 2) || near2(at, doc.page.h)) {
      push({ axis: "h", at, from: 0, to: doc.page.w, page: true, center });
    }
  }
  return guides;
}

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

// 이동 후보 (xMm, yMm)의 블록(id, w, h)을 다른 블록·지면에 스냅.
// exclude: 함께 움직이는 팔로워(자손·그룹·다중선택) — 드래그 중 doc 좌표가 원위치라
// 후보선에 넣으면 유령 스냅(상·중·"중하"·하처럼 한 번 더 걸림)이 생긴다. 반드시 제외.
export function computeSnap(
  doc: CanvasDoc,
  movingId: string,
  xMm: number,
  yMm: number,
  w: number,
  h: number,
  exclude?: ReadonlySet<string>
): SnapResult {
  const others = doc.blocks.filter((b) => b.id !== movingId && !exclude?.has(b.id));

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

  let sx = snapX ? xMm + snapX.delta : xMm;
  let sy = snapY ? yMm + snapY.delta : yMm;
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

  // ── 분포(등간격) 스냅 — 엣지/중앙 스냅이 없는 축에서만. 두 이웃 사이 가운데(좌=우)
  //    또는 인접 gap과 같게(시리즈 연장) 놓이면 하드 스냅 + 등간격 배지 2개. ──
  if (!snapX) {
    const band = others
      .filter((b) => b.y < M.y + h && b.y + b.h > M.y) // 교차축(세로)이 겹치는 것만 = 한 줄
      .map((b) => [b.x, b.x + b.w] as [number, number]);
    const d = distribute(band, xMm, xMm + w);
    if (d) {
      sx = d.lo;
      for (const mid of d.mids) badges.push({ cx: mid, cy: M.y + h / 2, mm: Math.round(d.gap), axis: "h" });
    }
  }
  if (!snapY) {
    const band = others
      .filter((b) => b.x < sx + w && b.x + b.w > sx) // 교차축(가로)이 겹치는 것만 = 한 열
      .map((b) => [b.y, b.y + b.h] as [number, number]);
    const d = distribute(band, yMm, yMm + h);
    if (d) {
      sy = d.lo;
      for (const mid of d.mids) badges.push({ cx: sx + w / 2, cy: mid, mm: Math.round(d.gap), axis: "v" });
    }
  }

  return { x: sx, y: sy, guides, badges };
}

const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

// 한 축 등간격 후보 — items: 같은 줄(교차축 겹침) 이웃들의 [시작,끝](primary축).
// mLo~mHi: 이동 블록 구간. 가운데(좌1·우1) / 오른쪽 연장(좌2) / 왼쪽 연장(우2) 중
// 이동 위치(mLo)에 ±SNAP_MM 이내로 가장 가까운 후보를 고른다. mids = 배지 중점 2개.
function distribute(items: [number, number][], mLo: number, mHi: number): { lo: number; gap: number; mids: number[] } | null {
  const size = mHi - mLo;
  const cands: { lo: number; gap: number; mids: number[] }[] = [];
  const left = items.filter((it) => it[1] <= mLo + SNAP_MM).sort((a, b) => b[1] - a[1]); // M 왼쪽, 가까운 순
  const right = items.filter((it) => it[0] >= mHi - SNAP_MM).sort((a, b) => a[0] - b[0]); // M 오른쪽
  // 가운데: 좌1·우1 사이 정중앙 (gap 좌=우)
  if (left[0] && right[0]) {
    const Le = left[0][1];
    const Rs = right[0][0];
    const gap = (Rs - Le - size) / 2;
    if (gap > 0.5) cands.push({ lo: Le + gap, gap, mids: [Le + gap / 2, Rs - gap / 2] });
  }
  // 오른쪽 연장: 왼쪽 두 블록 사이 gap과 같게 M을 L1 오른쪽에
  if (left[0] && left[1]) {
    const g = left[0][0] - left[1][1];
    if (g > 0.5) {
      const lo = left[0][1] + g;
      cands.push({ lo, gap: g, mids: [(left[1][1] + left[0][0]) / 2, (left[0][1] + lo) / 2] });
    }
  }
  // 왼쪽 연장: 오른쪽 두 블록 사이 gap과 같게 M을 R1 왼쪽에
  if (right[0] && right[1]) {
    const g = right[1][0] - right[0][1];
    if (g > 0.5) {
      const lo = right[0][0] - g - size;
      cands.push({ lo, gap: g, mids: [(lo + size + right[0][0]) / 2, (right[0][1] + right[1][0]) / 2] });
    }
  }
  let best: { lo: number; gap: number; mids: number[] } | null = null;
  for (const c of cands)
    if (Math.abs(c.lo - mLo) <= SNAP_MM && (best === null || Math.abs(c.lo - mLo) < Math.abs(best.lo - mLo))) best = c;
  return best;
}

// 선택 블록의 상하좌우 가장 가까운 이웃까지의 거리 배지 (키보드 넛지 실시간 표시용).
// 교차축이 겹치는 이웃만 대상 — 실제로 그 방향에 마주 보는 블록과의 간격을 잰다.
export function neighborBadges(doc: CanvasDoc, id: string): { guides: SnapGuide[]; badges: SnapBadge[] } {
  const M = doc.blocks.find((b) => b.id === id);
  if (!M) return { guides: [], badges: [] };
  const others = doc.blocks.filter((b) => b.id !== id);
  const badges: SnapBadge[] = [];
  const oX = (b: Block) => b.x < M.x + M.w && b.x + b.w > M.x; // 세로 이웃(위/아래)
  const oY = (b: Block) => b.y < M.y + M.h && b.y + b.h > M.y; // 가로 이웃(좌/우)
  const cx = M.x + M.w / 2;
  const cy = M.y + M.h / 2;
  const up = others.filter((b) => oX(b) && b.y + b.h <= M.y).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
  if (up) badges.push({ cx, cy: (up.y + up.h + M.y) / 2, mm: Math.round(M.y - (up.y + up.h)), axis: "v" });
  const dn = others.filter((b) => oX(b) && b.y >= M.y + M.h).sort((a, b) => a.y - b.y)[0];
  if (dn) badges.push({ cx, cy: (M.y + M.h + dn.y) / 2, mm: Math.round(dn.y - (M.y + M.h)), axis: "v" });
  const lf = others.filter((b) => oY(b) && b.x + b.w <= M.x).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  if (lf) badges.push({ cx: (lf.x + lf.w + M.x) / 2, cy, mm: Math.round(M.x - (lf.x + lf.w)), axis: "h" });
  const rt = others.filter((b) => oY(b) && b.x >= M.x + M.w).sort((a, b) => a.x - b.x)[0];
  if (rt) badges.push({ cx: (M.x + M.w + rt.x) / 2, cy, mm: Math.round(rt.x - (M.x + M.w)), axis: "h" });
  return { guides: [], badges };
}

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
