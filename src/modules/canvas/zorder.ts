// zorder.ts — 겹침 순서(z)의 진실은 blocks 배열 순서다 (에세이 원칙 3: z-order = 데이터).
// 렌더(CanvasStage가 배열 순서로 map)와 내보내기(exportCore zOrder 연속 부여)가 이미 배열
// 순서에서 파생되므로, 별도 z 필드 없이 배열 재배치만으로 화면·HWPX 겹침이 함께 바뀐다.
// 순수 함수 — store.reorder가 record(undo)와 함께 호출한다.
import { type Block } from "../document/model";

export type ZDir = "front" | "back" | "forward" | "backward";

// ids 집합을 방향대로 재배치한 새 배열 (이동 집합의 상대 순서는 보존).
// forward/backward = 인접 비이동 블록 하나를 건너뛰는 "한 단계". 변화 없으면 null(커밋 생략).
export function reorderBlocks(blocks: Block[], ids: string[], dir: ZDir): Block[] | null {
  const idSet = new Set(ids);
  const moving = blocks.filter((b) => idSet.has(b.id));
  if (!moving.length || moving.length === blocks.length) return null;
  const rest = blocks.filter((b) => !idSet.has(b.id));
  const indexOf = new Map(blocks.map((b, i) => [b.id, i]));

  let pos: number;
  if (dir === "front") pos = rest.length;
  else if (dir === "back") pos = 0;
  else if (dir === "forward") {
    // 이동 집합의 최상단보다 아래(앞 인덱스)에 있는 비이동 블록 수 + 1 = 한 단계 위
    const top = Math.max(...moving.map((b) => indexOf.get(b.id) ?? 0));
    const below = rest.filter((b) => (indexOf.get(b.id) ?? 0) < top).length;
    pos = Math.min(rest.length, below + 1);
  } else {
    const bottom = Math.min(...moving.map((b) => indexOf.get(b.id) ?? 0));
    const below = rest.filter((b) => (indexOf.get(b.id) ?? 0) < bottom).length;
    pos = Math.max(0, below - 1);
  }

  const next = [...rest.slice(0, pos), ...moving, ...rest.slice(pos)];
  return next.every((b, i) => b === blocks[i]) ? null : next;
}
