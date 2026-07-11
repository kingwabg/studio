// gesture.ts — 이동 제스처의 공용 데이터 계산 (에세이 원칙 4: 인터랙션 = 데이터 함수).
// dnd-kit 드래그(StudioEditor)·테두리 이동(CanvasBlock)·다중선택 오버레이가 전부 이 모듈을
// 공유한다 — 이전엔 세 경로가 클램프/스냅을 제각각 구현해 "잡는 표면에 따라 자석이 다르게
// 걸리는" 격차가 있었다(감사 CONFIRMED: 표 테두리 이동엔 스냅 0). 진실 변경은 여기 없다 —
// 순수 계산만. 커밋은 각 경로가 store 액션(moveBlock/nudgeMany) 1회 호출로.
import { type Block, type CanvasDoc, descendantIds, moveSetIds } from "../document/model";
import { computeSnap, isAltPressed, type SnapBadge, type SnapGuide } from "./snap";

export const SAFE_MARGIN_MM = 20;

// 한 축 안전여백 클램프 — 요소가 여백 안쪽에서만 움직인다 (H5 불변식의 제스처판)
export const clampSafeAxis = (value: number, size: number, pageSize: number) => {
  const min = SAFE_MARGIN_MM;
  const max = Math.max(min, pageSize - SAFE_MARGIN_MM - size);
  return Math.max(min, Math.min(value, max));
};

// 드래그에 함께 움직이는 집합 — 다중 선택이면 moveSet(선택∪자손∪그룹), 아니면 자기+자손
export const dragMemberIds = (blocks: Block[], selectedIds: string[], block: Block) =>
  selectedIds.length > 1 && selectedIds.includes(block.id)
    ? moveSetIds(blocks, selectedIds)
    : new Set<string>([block.id, ...descendantIds(blocks, block.id)]);

// 이동 후보를 안전여백 안으로 — 집합이면 집합 bbox 기준 델타 클램프
export const constrainDragPosition = (
  blocks: Block[],
  active: Block,
  x: number,
  y: number,
  page: { w: number; h: number },
  members: Set<string>
) => {
  const moving = blocks.filter((b) => members.has(b.id) && !b.locked);
  if (moving.length <= 1) {
    return { x: clampSafeAxis(x, active.w, page.w), y: clampSafeAxis(y, active.h, page.h) };
  }
  const dx = x - active.x;
  const dy = y - active.y;
  const minX = Math.min(...moving.map((b) => b.x));
  const maxX = Math.max(...moving.map((b) => b.x + b.w));
  const minY = Math.min(...moving.map((b) => b.y));
  const maxY = Math.max(...moving.map((b) => b.y + b.h));
  const clampedDx = Math.max(SAFE_MARGIN_MM - minX, Math.min(dx, page.w - SAFE_MARGIN_MM - maxX));
  const clampedDy = Math.max(SAFE_MARGIN_MM - minY, Math.min(dy, page.h - SAFE_MARGIN_MM - maxY));
  return { x: active.x + clampedDx, y: active.y + clampedDy };
};

// 집합(bbox) 델타 클램프 — 비반올림(제스처 중 부드러움). 정수 커밋 반올림은 store 경계에서.
// ⚠ 이 수식의 유일 원본 — store.constrainDeltaToSafeArea가 이걸 감싸 반올림한다(중복 금지).
export function clampDeltaToSafeArea(
  blocks: Block[],
  dx: number,
  dy: number,
  page: { w: number; h: number }
): { dx: number; dy: number } {
  if (!blocks.length) return { dx: 0, dy: 0 };
  const minX = Math.min(...blocks.map((b) => b.x));
  const maxX = Math.max(...blocks.map((b) => b.x + b.w));
  const minY = Math.min(...blocks.map((b) => b.y));
  const maxY = Math.max(...blocks.map((b) => b.y + b.h));
  return {
    dx: Math.max(SAFE_MARGIN_MM - minX, Math.min(dx, page.w - SAFE_MARGIN_MM - maxX)),
    dy: Math.max(SAFE_MARGIN_MM - minY, Math.min(dy, page.h - SAFE_MARGIN_MM - maxY)),
  };
}

export interface MovePlan {
  x: number;
  y: number;
  guides: SnapGuide[];
  badges: SnapBadge[];
}

// 이동 계획 = 클램프 → (Alt 아니면) 자석 스냅 → 재클램프. 세 이동 경로의 유일한 수식.
// 이동 중 시각과 커밋 좌표가 같은 함수에서 나오므로 "보이는 곳에 놓인다"가 보장된다.
export function planMove(
  doc: CanvasDoc,
  active: Block,
  candX: number,
  candY: number,
  members: Set<string>
): MovePlan {
  const constrained = constrainDragPosition(doc.blocks, active, candX, candY, doc.page, members);
  if (isAltPressed()) return { ...constrained, guides: [], badges: [] };
  const snap = computeSnap(doc, active.id, constrained.x, constrained.y, active.w, active.h, members);
  const finalPos = constrainDragPosition(doc.blocks, active, snap.x, snap.y, doc.page, members);
  return { ...finalPos, guides: snap.guides, badges: snap.badges };
}

// 점 히트 — mm 좌표가 들어있는 블록들. 배열 순서 = z 순서이므로 마지막 원소가 최상단.
// (마퀴의 모델 좌표 교차 판정과 같은 계보 — DOM이 아니라 데이터로 판별하는 중앙 점 히트)
export function blocksAtPoint(blocks: Block[], xMm: number, yMm: number): Block[] {
  return blocks.filter((b) => xMm >= b.x && xMm <= b.x + b.w && yMm >= b.y && yMm <= b.y + b.h);
}
