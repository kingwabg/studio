// model.ts — 새 자유배치 캔버스의 문서 모델 (진실).
//
// 기존 흐름 에디터(sections→blocks, 브라우저가 배치)와 달리, 이 모델은 Canva식
// 절대 배치다: 모든 블록이 mm 좌표(x/y/w/h)를 직접 가진다. A4(210×297mm) 지면 위에
// 자유롭게 놓인다. 좌표 단위를 mm로 두면 기존 exportCore(mm→HWPUNIT)와 그대로 만난다.
//
// Phase 1은 순수 프론트엔드 — DB/직렬화는 Phase 2에서 이 타입을 그대로 저장한다.

export type BlockType = "text" | "table" | "image";

export interface Block {
  id: string;
  type: BlockType;
  x: number; // mm, 지면 좌상단 기준
  y: number; // mm
  w: number; // mm
  h: number; // mm
  text?: string; // text 블록
  rows?: string[][]; // table 블록 (Phase 1은 정적 표본)
  src?: string; // image 블록 (Phase 2 Storage)
}

export interface CanvasDoc {
  id: string;
  title: string;
  page: { w: number; h: number }; // mm — 기본 A4
  blocks: Block[];
}

export const A4: CanvasDoc["page"] = { w: 210, h: 297 };

// 블록 타입별 기본 크기(mm)와 시드 콘텐츠
const BLOCK_DEFAULTS: Record<BlockType, Partial<Block>> = {
  text: { w: 80, h: 12, text: "텍스트를 입력하세요" },
  table: {
    w: 120,
    h: 24,
    rows: [
      ["항목", "내용", "비고"],
      ["", "", ""],
    ],
  },
  image: { w: 60, h: 45 },
};

let seq = 0;
// id 생성 — 결정적 카운터(세션 내 유일). Math.random을 피해 SSR/테스트에서도 안정적.
const nextId = () => `blk_${++seq}`;

export function createBlock(type: BlockType, x: number, y: number): Block {
  const d = BLOCK_DEFAULTS[type];
  return {
    id: nextId(),
    type,
    x: Math.round(x),
    y: Math.round(y),
    w: d.w ?? 60,
    h: d.h ?? 20,
    text: d.text,
    rows: d.rows,
  };
}

export function createDoc(title = "제목 없는 문서"): CanvasDoc {
  return { id: `doc_${++seq}`, title, page: { ...A4 }, blocks: [] };
}
