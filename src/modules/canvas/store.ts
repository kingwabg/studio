// store.ts — 캔버스 문서의 전역 상태 (Zustand). 문서 = 진실.
//
// Phase 1: 순수 로컬 상태. 액션은 전부 불변 업데이트(블록 배열을 새로 만든다) —
// React 리렌더가 정확히 걸리고, Phase 3 협업(Yjs/Realtime) 병합 시에도 diff가 쉽다.
// Phase 2에서 이 상태를 Supabase에 저장/구독하도록 persist 미들웨어를 얹으면 된다.
import { create } from "zustand";
import { type Block, type BlockType, type CanvasDoc, createBlock, createDoc } from "../document/model";

interface CanvasState {
  doc: CanvasDoc;
  selectedId: string | null;

  addBlock: (type: BlockType, x: number, y: number) => void;
  moveBlock: (id: string, x: number, y: number) => void; // 절대 좌표(mm)로 이동
  updateBlock: (id: string, patch: Partial<Block>) => void;
  removeBlock: (id: string) => void;
  select: (id: string | null) => void;
  setTitle: (title: string) => void;
  loadDoc: (doc: CanvasDoc) => void; // 저장소에서 불러온 문서로 교체
  reset: (title?: string) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  doc: createDoc(),
  selectedId: null,

  addBlock: (type, x, y) =>
    set((s) => {
      const block = createBlock(type, x, y);
      return { doc: { ...s.doc, blocks: [...s.doc.blocks, block] }, selectedId: block.id };
    }),

  moveBlock: (id, x, y) =>
    set((s) => ({
      doc: {
        ...s.doc,
        blocks: s.doc.blocks.map((b) =>
          b.id === id ? { ...b, x: clamp(x, s.doc.page.w - b.w), y: clamp(y, s.doc.page.h - b.h) } : b
        ),
      },
    })),

  updateBlock: (id, patch) =>
    set((s) => ({
      doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) },
    })),

  removeBlock: (id) =>
    set((s) => ({
      doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => b.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  select: (id) => set({ selectedId: id }),
  setTitle: (title) => set((s) => ({ doc: { ...s.doc, title } })),
  loadDoc: (doc) => set({ doc, selectedId: null }),
  reset: (title) => set({ doc: createDoc(title), selectedId: null }),
}));

// 블록이 지면 밖으로 못 나가게 (0 ~ max). "요소는 페이지 밖으로 못 나감" 불변식.
const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), Math.round(max)));
