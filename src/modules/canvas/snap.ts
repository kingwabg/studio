// snap.ts — 스마트 정렬선(자석 스냅) 계산. 순수 함수 + 가이드 상태.
//
// 이동 중인 블록의 세로선(좌/중/우)·가로선(상/중/하)이 다른 블록의 선이나 지면의
// 가장자리·중앙과 ±SNAP_MM 안에 오면 그 선에 "착" 붙인다 (Hard Snap).
// Alt를 누르면 스냅 해제(정밀 조정) — 캔바/피그마와 같은 하이브리드.
import { create } from "zustand";
import { type Block, type CanvasDoc } from "../document/model";

export const SNAP_MM = 2;

// ── Alt 스냅 해제 플래그 (윈도우 리스너는 StudioEditor가 등록) ──
let altPressed = false;
export const setAltPressed = (v: boolean) => {
  altPressed = v;
};
export const isAltPressed = () => altPressed;

// ── 드래그 중 표시할 가이드 선 (mm) — 초경량 UI 스토어 ──
interface GuideState {
  v: number[]; // 세로선 x(mm)
  h: number[]; // 가로선 y(mm)
  setGuides: (v: number[], h: number[]) => void;
  clear: () => void;
}
const sameArr = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const useGuideStore = create<GuideState>((set, get) => ({
  v: [],
  h: [],
  setGuides: (v, h) => {
    const s = get();
    if (sameArr(s.v, v) && sameArr(s.h, h)) return; // 렌더 폭주 방지
    set({ v, h });
  },
  clear: () => {
    const s = get();
    if (s.v.length || s.h.length) set({ v: [], h: [] });
  },
}));

// ── 스냅 계산 ──
export interface SnapResult {
  x: number;
  y: number;
  guidesV: number[];
  guidesH: number[];
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
  // 대상 선 수집: 지면(가장자리+중앙) + 다른 블록들(가장자리+중앙)
  const targetsX: number[] = [0, doc.page.w / 2, doc.page.w];
  const targetsY: number[] = [0, doc.page.h / 2, doc.page.h];
  for (const b of doc.blocks) {
    if (b.id === movingId) continue;
    targetsX.push(b.x, b.x + b.w / 2, b.x + b.w);
    targetsY.push(b.y, b.y + b.h / 2, b.y + b.h);
  }

  // 이동 블록의 선: 좌/중/우 · 상/중/하 (후보 좌표 기준의 오프셋)
  const linesX = [0, w / 2, w];
  const linesY = [0, h / 2, h];

  let bestDX = Infinity;
  let snapVLine: number | null = null;
  for (const off of linesX)
    for (const t of targetsX) {
      const d = t - (xMm + off);
      if (Math.abs(d) < Math.abs(bestDX) && Math.abs(d) <= SNAP_MM) {
        bestDX = d;
        snapVLine = t;
      }
    }
  let bestDY = Infinity;
  let snapHLine: number | null = null;
  for (const off of linesY)
    for (const t of targetsY) {
      const d = t - (yMm + off);
      if (Math.abs(d) < Math.abs(bestDY) && Math.abs(d) <= SNAP_MM) {
        bestDY = d;
        snapHLine = t;
      }
    }

  return {
    x: snapVLine !== null ? xMm + bestDX : xMm,
    y: snapHLine !== null ? yMm + bestDY : yMm,
    guidesV: snapVLine !== null ? [snapVLine] : [],
    guidesH: snapHLine !== null ? [snapHLine] : [],
  };
}
