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
  removeBlock: (id: string) => void;
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
      const copy: Block = {
        ...structuredClone(src),
        id: createBlock(src.type, 0, 0).id, // 새 고유 id만 발급
        x: Math.min(src.x + 5, s.doc.page.w - src.w),
        y: Math.min(src.y + 5, s.doc.page.h - src.h),
      };
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, copy] },
        selectedId: copy.id,
      };
    }),

  moveBlock: (id, x, y) =>
    set((s) => ({
      ...record(s, `move:${id}`),
      doc: {
        ...s.doc,
        blocks: s.doc.blocks.map((b) =>
          b.id === id ? { ...b, x: clamp(x, s.doc.page.w - b.w), y: clamp(y, s.doc.page.h - b.h) } : b
        ),
      },
    })),

  updateBlock: (id, patch) =>
    set((s) => {
      // h만 바뀌는 갱신은 auto-height 파생 — 히스토리 제외
      const keys = Object.keys(patch);
      const derivedOnly = keys.every((k) => k === "h");
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
    set((s) => ({
      ...record(s),
      doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => b.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

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
