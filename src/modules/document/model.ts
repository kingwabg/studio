// model.ts — 새 자유배치 캔버스의 문서 모델 (진실).
//
// 기존 흐름 에디터(sections→blocks, 브라우저가 배치)와 달리, 이 모델은 Canva식
// 절대 배치다: 모든 블록이 mm 좌표(x/y/w/h)를 직접 가진다. A4(210×297mm) 지면 위에
// 자유롭게 놓인다. 좌표 단위를 mm로 두면 기존 exportCore(mm→HWPUNIT)와 그대로 만난다.
//
// Phase 1은 순수 프론트엔드 — DB/직렬화는 Phase 2에서 이 타입을 그대로 저장한다.

export type BlockType = "text" | "table" | "image";

// table-king 스냅샷 (src/table-king의 표 모델 — 병합·행별 너비·셀별 높이·셀 스타일)
export interface TableKingData {
  cells: { text: string; style: Record<string, unknown> }[][];
  widths: number[][]; // px, 행별
  cellHeights: number[][]; // px, 셀별
  merges: { r: number; c: number; rs: number; cs: number }[];
}

export type TextAlign = "left" | "center" | "right";

export interface Block {
  id: string;
  type: BlockType;
  // 트리(부모-자식) — 문서의 논리 구조. 부모를 끌면 자손이 함께 움직이고(자석 그룹),
  // 내보내기 때 트리 상하관계가 개요 번호(Ⅰ/1/가)로 펴진다. 없으면 루트 블록.
  parentId?: string;
  // 아코디언 접기 — true면 이 블록의 자손을 캔버스·레이어에서 숨긴다.
  // 보기 전용 상태: 내보내기(hwpx)·펴기(flatten)는 무시하고 전부 포함한다.
  collapsed?: boolean;
  x: number; // mm, 지면 좌상단 기준
  y: number; // mm
  w: number; // mm
  h: number; // mm
  text?: string; // text 블록
  // 본문(흐름) 플래그 — true면 hwpx로 나갈 때 절대배치 개체가 아니라 "진짜 문단"으로
  // 내보낸다: 한글에서 커서가 흐르고, 이어 쓰면 밀리고, 길면 페이지를 넘는다.
  flow?: boolean;
  rows?: string[][]; // table 블록 구형 포맷 (data 없을 때 폴백 — 저장된 옛 문서 호환)
  data?: TableKingData; // table 블록 — table-king 엔진 스냅샷 (진실)
  src?: string; // image 블록 (Phase 2 Storage)
  // 텍스트 스타일 (text 블록) — 없으면 기본값. 내보내기(exportHwpx)도 이 값을 쓴다.
  font?: string; // 폰트 레지스트리 key (fonts.ts) — 없으면 문서 기본(나눔고딕)
  fontSize?: number; // pt
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
  color?: string; // hex
}

export const TEXT_DEFAULTS = {
  fontSize: 10.5,
  bold: false,
  italic: false,
  align: "left" as TextAlign,
  color: "#1A2233",
};

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

// id 생성 — 전역 고유(UUID). 영속화에 필수: 세션 카운터는 새로고침 후 재사용돼
// 문서/블록 id가 충돌한다(기존 것을 덮어씀). crypto.randomUUID는 브라우저·Node18+ 지원.
const uid = (prefix: string): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  // 폴백(구형 환경): 시간+난수 조합
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

export function createBlock(type: BlockType, x: number, y: number): Block {
  const d = BLOCK_DEFAULTS[type];
  return {
    id: uid("blk"),
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
  return { id: uid("doc"), title, page: { ...A4 }, blocks: [] };
}

// ── 트리 헬퍼 (parentId 기반) ──

// id의 모든 자손 id 집합 (자석 그룹 이동·서브트리 삭제/복제용)
export function descendantIds(blocks: Block[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const b of blocks) {
      if (b.parentId === pid && !out.has(b.id)) {
        out.add(b.id);
        walk(b.id);
      }
    }
  };
  walk(id);
  return out;
}

// candidate가 id 자신이거나 자손인가 — setParent 순환 방지용
export function isSelfOrDescendant(blocks: Block[], id: string, candidate: string): boolean {
  return id === candidate || descendantIds(blocks, id).has(candidate);
}

// 접힌(collapsed) 조상을 가진 블록 id 집합 — 캔버스·레이어 패널이 숨길 대상.
// 내보내기·flatten은 이 집합을 쓰지 않는다 (접기는 조망용, 문서 내용은 그대로).
export function collapsedHiddenIds(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks)
    if (b.collapsed) for (const id of descendantIds(blocks, b.id)) out.add(id);
  return out;
}
