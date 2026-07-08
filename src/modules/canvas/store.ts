// store.ts — 캔버스 문서의 전역 상태 (Zustand). 문서 = 진실.
//
// Phase 1: 순수 로컬 상태. 액션은 전부 불변 업데이트(블록 배열을 새로 만든다) —
// React 리렌더가 정확히 걸리고, Phase 3 협업(Yjs/Realtime) 병합 시에도 diff가 쉽다.
// Phase 2에서 이 상태를 Supabase에 저장/구독하도록 persist 미들웨어를 얹으면 된다.
//
// 실행취소: 변이 전 doc 스냅샷을 past에 쌓는다(불변 구조라 스냅샷 = 참조 복사, 저렴).
// 연속 타이핑 폭주 방지: 같은 coalesce 키가 800ms 안에 반복되면 스냅샷을 추가하지 않는다.
// auto-height의 h-전용 갱신은 파생값이라 히스토리에서 제외.
import { create } from "zustand";
import {
  type Block,
  type BlockType,
  type CanvasDoc,
  type TableKingData,
  createBlock,
  createDoc,
  descendantIds,
  isSelfOrDescendant,
} from "../document/model";
// 표는 기존 앱에서 검증된 table-king 엔진을 그대로 이관해 쓴다 (Strangler Fig 기능 이관)
import { makeTableKingData } from "../../table-king/TableKingBlock.jsx";
import { SCALE } from "./geometry";

const DEFAULT_TABLE_ROWS = [
  ["구분", "내용", "비고"],
  ["", "", ""],
  ["", "", ""],
];

const HISTORY_MAX = 50;
const COALESCE_MS = 800;

// table-king 스냅샷의 실제 px 크기 (최대 행 너비 합 × 최대 열 높이 합)
export function tableSizePx(data: TableKingData): { wPx: number; hPx: number } {
  const wPx = Math.max(...data.widths.map((row) => row.reduce((s, v) => s + v, 0)));
  const nCols = data.cells[0]?.length ?? 0;
  let hPx = 0;
  for (let c = 0; c < nCols; c++)
    hPx = Math.max(hPx, data.cellHeights.reduce((s, row) => s + (row[c] ?? 0), 0));
  return { wPx, hPx };
}

interface CanvasState {
  doc: CanvasDoc;
  selectedId: string | null;
  past: CanvasDoc[]; // 실행취소 스택 (오래된 것 → 최신)
  future: CanvasDoc[]; // 다시실행 스택

  addBlock: (type: BlockType, x: number, y: number, extra?: Partial<Block>) => void;
  duplicateBlock: (id: string) => void; // 선택 블록 복제 (+5mm 오프셋)
  moveBlock: (id: string, x: number, y: number) => void; // 절대 좌표(mm)로 이동
  updateBlock: (id: string, patch: Partial<Block>) => void;
  setTableData: (id: string, data: TableKingData) => void; // 표 스냅샷 교체 + w/h 동기화
  setCell: (id: string, r: number, c: number, text: string) => void; // 표 셀 하나 수정 (구형 rows용)
  setParent: (id: string, parentId: string | null) => void; // 트리 연결/해제 (순환 방지)
  cascadeStyle: (id: string) => void; // 서식 유전 — 하위 텍스트 크기를 깊이당 −2pt 계단 적용
  removeBlock: (id: string) => void; // 서브트리째 삭제 (실행취소 가능)
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  setTitle: (title: string) => void;
  loadDoc: (doc: CanvasDoc) => void; // 저장소에서 불러온 문서로 교체
  reset: (title?: string) => void;
}

// 코얼레싱 상태 (스토어 밖 모듈 변수 — 렌더와 무관)
let lastKey: string | null = null;
let lastAt = 0;

// 변이 전 호출: 히스토리에 스냅샷을 쌓을지 결정해 patch 조각을 돌려준다
function record(s: Pick<CanvasState, "doc" | "past">, key?: string): Partial<CanvasState> {
  const now = Date.now();
  if (key && key === lastKey && now - lastAt < COALESCE_MS) {
    lastAt = now;
    return { future: [] };
  }
  lastKey = key ?? null;
  lastAt = now;
  return { past: [...s.past.slice(-(HISTORY_MAX - 1)), s.doc], future: [] };
}

export const useCanvasStore = create<CanvasState>((set) => ({
  doc: createDoc(),
  selectedId: null,
  past: [],
  future: [],

  addBlock: (type, x, y, extra) =>
    set((s) => {
      const block = createBlock(type, x, y);
      if (extra) Object.assign(block, extra);
      if (type === "table") {
        // 표는 table-king 스냅샷이 진실 — 크기(w/h)는 스냅샷에서 파생
        block.data = makeTableKingData(DEFAULT_TABLE_ROWS, 420) as TableKingData;
        block.rows = undefined;
        const { wPx, hPx } = tableSizePx(block.data);
        block.w = wPx / SCALE;
        block.h = hPx / SCALE;
      }
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, block] },
        selectedId: block.id,
      };
    }),

  duplicateBlock: (id) =>
    set((s) => {
      const src = s.doc.blocks.find((b) => b.id === id);
      if (!src) return {};
      // 서브트리째 복제 — 새 id 발급 + parentId 재배선, 전체 +5mm 오프셋
      const kidIds = descendantIds(s.doc.blocks, id);
      const subtree = s.doc.blocks.filter((b) => b.id === id || kidIds.has(b.id));
      const idMap = new Map<string, string>();
      for (const b of subtree) idMap.set(b.id, createBlock(b.type, 0, 0).id);
      const copies: Block[] = subtree.map((b) => ({
        ...structuredClone(b),
        id: idMap.get(b.id)!,
        parentId: b.id === id ? src.parentId : idMap.get(b.parentId!) ?? b.parentId,
        x: Math.min(b.x + 5, s.doc.page.w - b.w),
        y: Math.min(b.y + 5, s.doc.page.h - b.h),
      }));
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, ...copies] },
        selectedId: idMap.get(id)!,
      };
    }),

  moveBlock: (id, x, y) =>
    set((s) => {
      const target = s.doc.blocks.find((b) => b.id === id);
      if (!target) return {};
      const nx = clamp(x, s.doc.page.w - target.w);
      const ny = clamp(y, s.doc.page.h - target.h);
      // 자석 그룹: 자손들도 같은 델타로 함께 이동 (탯줄 이동)
      const dx = nx - target.x;
      const dy = ny - target.y;
      const kids = descendantIds(s.doc.blocks, id);
      return {
        ...record(s, `move:${id}`),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            b.id === id
              ? { ...b, x: nx, y: ny }
              : kids.has(b.id)
                ? { ...b, x: clamp(b.x + dx, s.doc.page.w - b.w), y: clamp(b.y + dy, s.doc.page.h - b.h) }
                : b
          ),
        },
      };
    }),

  setParent: (id, parentId) =>
    set((s) => {
      // 순환 방지: 자기 자신·자기 자손 밑으로는 못 들어간다
      if (parentId && isSelfOrDescendant(s.doc.blocks, id, parentId)) return {};
      return {
        ...record(s),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) => (b.id === id ? { ...b, parentId: parentId ?? undefined } : b)),
        },
      };
    }),

  cascadeStyle: (id) =>
    set((s) => {
      // 서식 유전 — 선택 블록의 글자 크기를 기준으로, 하위 텍스트를 깊이당 −2pt(최소 9pt)
      // 계단으로 정리한다. 자동 유전은 개별 설정을 침범하므로 "명시 버튼"으로만 발동.
      const root = s.doc.blocks.find((b) => b.id === id);
      if (!root || root.type !== "text") return {};
      const base = root.fontSize ?? 10.5;
      const byId = new Map(s.doc.blocks.map((b) => [b.id, b]));
      const kids = descendantIds(s.doc.blocks, id);
      // 루트로부터의 상대 깊이 — 부모 체인을 거슬러 센다
      const depthOf = (b: Block): number => {
        let d = 0;
        let cur: Block | undefined = b;
        while (cur && cur.id !== id) {
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          d++;
        }
        return d;
      };
      return {
        ...record(s),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            kids.has(b.id) && b.type === "text"
              ? { ...b, fontSize: Math.max(9, base - 2 * depthOf(b)) }
              : b
          ),
        },
      };
    }),

  updateBlock: (id, patch) =>
    set((s) => {
      // h만 바뀌는 갱신은 auto-height 파생, collapsed는 보기 상태 — 히스토리 제외
      const keys = Object.keys(patch);
      const derivedOnly = keys.every((k) => k === "h" || k === "collapsed");
      return {
        ...(derivedOnly ? {} : record(s, `upd:${id}:${keys.join(",")}`)),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) },
      };
    }),

  setTableData: (id, data) =>
    set((s) => {
      const { wPx, hPx } = tableSizePx(data);
      return {
        ...record(s, `tbl:${id}`),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            b.id === id ? { ...b, data, w: wPx / SCALE, h: hPx / SCALE } : b
          ),
        },
      };
    }),

  setCell: (id, r, c, text) =>
    set((s) => ({
      ...record(s, `cell:${id}:${r}:${c}`),
      doc: {
        ...s.doc,
        blocks: s.doc.blocks.map((b) =>
          b.id === id && b.rows
            ? { ...b, rows: b.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? text : cell)) : row)) }
            : b
        ),
      },
    })),

  removeBlock: (id) =>
    set((s) => {
      // 서브트리째 삭제 — 그룹 삭제 기대에 부합. 실수는 실행취소가 복구
      const gone = descendantIds(s.doc.blocks, id);
      gone.add(id);
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => !gone.has(b.id)) },
        selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
      };
    }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      lastKey = null; // 되돌린 뒤 이어지는 편집은 새 스냅샷
      return {
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future].slice(0, HISTORY_MAX),
        selectedId: null,
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      lastKey = null;
      return {
        doc: next,
        future: s.future.slice(1),
        past: [...s.past.slice(-(HISTORY_MAX - 1)), s.doc],
        selectedId: null,
      };
    }),

  select: (id) => set({ selectedId: id }),
  setTitle: (title) => set((s) => ({ ...record(s, "title"), doc: { ...s.doc, title } })),
  loadDoc: (doc) => {
    lastKey = null;
    set({ doc, selectedId: null, past: [], future: [] });
  },
  reset: (title) => {
    lastKey = null;
    set({ doc: createDoc(title), selectedId: null, past: [], future: [] });
  },
}));

// 블록이 지면 밖으로 못 나가게 (0 ~ max). "요소는 페이지 밖으로 못 나감" 불변식.
const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), Math.round(max)));
