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
  type TextRun,
  createBlock,
  createDoc,
  descendantIds,
  groupMemberIds,
  isSelfOrDescendant,
  moveSetIds,
  normalizeRuns,
  runsToText,
} from "../document/model";
// 표는 기존 앱에서 검증된 table-king 엔진을 그대로 이관해 쓴다 (Strangler Fig 기능 이관)
import { makeTableKingData } from "../../table-king/TableKingBlock.jsx";
import { SCALE } from "./geometry";
import { reorderBlocks, type ZDir } from "./zorder";
import { clampDeltaToSafeArea } from "./gesture";
import { scaleHeights, scaleWidths } from "./tableScale";
import { MIN_COL_W as TK_MIN_COL_W, MIN_ROW_H as TK_MIN_ROW_H } from "../../table-king/table/constants.js";

const DEFAULT_TABLE_ROWS = [
  ["구분", "내용", "비고"],
  ["", "", ""],
  ["", "", ""],
];

const HISTORY_MAX = 50;
const COALESCE_MS = 800;
const SAFE_MARGIN_MM = 20;

// table-king 스냅샷의 실제 px 크기 (최대 행 너비 합 × 최대 열 높이 합)
export function tableSizePx(data: TableKingData): { wPx: number; hPx: number } {
  // 빈 widths에 Math.max(...[]) = -Infinity → NaN w/h 전파 방지 (손상 데이터 방어)
  const wPx = data.widths.length
    ? Math.max(...data.widths.map((row) => row.reduce((s, v) => s + v, 0)))
    : 0;
  const nCols = data.cells[0]?.length ?? 0;
  let hPx = 0;
  for (let c = 0; c < nCols; c++)
    hPx = Math.max(hPx, data.cellHeights.reduce((s, row) => s + (row[c] ?? 0), 0));
  return { wPx, hPx };
}

function fitTableDataToSafeArea(data: TableKingData, page: CanvasDoc["page"]): TableKingData {
  const maxWPx = Math.max(1, (page.w - SAFE_MARGIN_MM * 2) * SCALE);
  const maxHPx = Math.max(1, (page.h - SAFE_MARGIN_MM * 2) * SCALE);
  const { wPx, hPx } = tableSizePx(data);
  const widthRatio = wPx > maxWPx ? maxWPx / wPx : 1;
  const heightRatio = hPx > maxHPx ? maxHPx / hPx : 1;
  if (widthRatio === 1 && heightRatio === 1) return data;
  // 경계(누적) 공간 반올림 — 셀 단위 독립 round는 공유 경계를 1px씩 찢는다(tableScale.ts 참조)
  // 하한 = 표 엔진 최소(30/24) — 이전의 4px는 모든 콘텐츠 하한 밑이라 사용 불능 트랙을 만들었다(감사 E3)
  return {
    ...data,
    widths: scaleWidths(data.widths, widthRatio, TK_MIN_COL_W),
    cellHeights: scaleHeights(data.cellHeights, heightRatio, TK_MIN_ROW_H),
  };
}
interface CanvasState {
  doc: CanvasDoc;
  // 오른쪽 속성 패널이 무엇을 보고 있는지: 블록 / 페이지(눈금자) / 없음.
  inspectorTarget: "none" | "block" | "page";
  // 다중 선택 — selectedIds가 진실, selectedId는 앵커(마지막 클릭, 우측 패널·서식바용).
  selectedIds: string[];
  selectedId: string | null;
  // 텍스트 도구로 방금 만든 블록 — CanvasBlock이 마운트하며 바로 편집 모드로 들어간다.
  autoEditId: string | null;
  past: CanvasDoc[]; // 실행취소 스택 (오래된 것 → 최신)
  future: CanvasDoc[]; // 다시실행 스택

  addBlock: (type: BlockType, x: number, y: number, extra?: Partial<Block>) => void;
  insertTextAt: (x: number, y: number) => void; // 텍스트 도구 — 좌표에 새 텍스트 + 바로 편집
  clearAutoEdit: () => void;
  duplicateBlock: (id: string) => void; // 선택 블록 복제 (+5mm 오프셋)
  moveBlock: (id: string, x: number, y: number) => void; // 절대 좌표(mm)로 이동 (자손·그룹 동반)
  nudgeMany: (ids: string[], dx: number, dy: number) => void; // 여러 블록 델타 이동
  reorder: (ids: string[], dir: ZDir) => void; // 겹침 순서(z) — 배열 재배치(zorder.ts)
  updateBlock: (id: string, patch: Partial<Block>) => void;
  setRichText: (
    id: string,
    runs: TextRun[],
    paraAligns?: (import("../document/model").TextAlign | null)[],
    paraLists?: (import("../document/model").ParaListType | null)[]
  ) => void; // 인라인 리치 텍스트 갱신 (text 미러 동기 + 문단 정렬/목록)
  // 표 스냅샷 교체 + w/h 동기화. pos를 주면 위치까지 한 히스토리 항목으로 원자 커밋
  // (외곽 리사이즈가 updateBlock+setTableData 2회로 갈라지면 Ctrl+Z 한 번에 반쪽만 풀린다)
  setTableData: (id: string, data: TableKingData, pos?: { x: number; y: number }) => void;
  setCell: (id: string, r: number, c: number, text: string) => void; // 표 셀 하나 수정 (구형 rows용)
  setParent: (id: string, parentId: string | null) => void; // 트리 연결/해제 (순환 방지)
  cascadeStyle: (id: string) => void; // 서식 유전 — 하위 텍스트 크기를 깊이당 −2pt 계단 적용
  removeBlock: (id: string) => void; // 서브트리째 삭제 (실행취소 가능)
  removeSelection: () => void; // 선택 전체 삭제
  groupSelection: () => void; // 선택 블록을 공간 그룹으로 묶기
  ungroupSelection: () => void; // 선택 그룹 해제
  setLocked: (ids: string[], locked: boolean) => void; // 잠금/해제
  alignSelection: (edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void; // 정렬
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void; // 단일 선택 — 클릭한 블록 하나만
  selectPage: () => void; // 눈금자/페이지 속성 선택
  selectGroup: (id: string) => void; // 그룹 전체 선택 (opt-in)
  toggleSelect: (id: string) => void; // Ctrl+클릭 — 선택 토글
  selectMany: (ids: string[]) => void; // 마퀴 등 다중 선택
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
  inspectorTarget: "none",
  selectedIds: [],
  selectedId: null,
  autoEditId: null,
  past: [],
  future: [],

  addBlock: (type, x, y, extra) =>
    set((s) => {
      const block = createBlock(type, x, y);
      if (extra) Object.assign(block, extra);
      if (type === "table") {
        // 표는 table-king 스냅샷이 진실 — 크기(w/h)는 스냅샷에서 파생
        block.data = fitTableDataToSafeArea(makeTableKingData(DEFAULT_TABLE_ROWS, 420) as TableKingData, s.doc.page);
        block.rows = undefined;
        const { wPx, hPx } = tableSizePx(block.data);
        block.w = wPx / SCALE;
        block.h = hPx / SCALE;
      }
      block.x = clampBlockX(block, block.x, s.doc.page.w);
      block.y = clampBlockY(block, block.y, s.doc.page.h);
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, block] },
        selectedIds: [block.id],
        selectedId: block.id,
        inspectorTarget: "block",
      };
    }),

  // 텍스트 도구 — 지면 클릭 좌표에 순수 텍스트 블록을 만들고 바로 편집으로.
  // 시드 텍스트는 빈 문자열: 커서만 깜빡이다 아무 것도 안 쓰면 blur에서 스스로 사라진다.
  insertTextAt: (x, y) =>
    set((s) => {
      const block = createBlock("text", x, y);
      // 텍스트 생성은 마우스 좌표를 최대한 보존한다. 일반 이동/정렬은 정수 mm 스냅을 유지하되,
      // 새 텍스트 시작점만 소수점 0.01mm까지 살려서 "찍은 곳에 생기는" 느낌을 맞춘다.
      block.x = clampInsertionAxis(x, block.w, s.doc.page.w);
      block.y = clampInsertionAxis(y, block.h, s.doc.page.h);
      block.text = "";
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, block] },
        selectedIds: [block.id],
        selectedId: block.id,
        inspectorTarget: "block",
        autoEditId: block.id,
      };
    }),
  clearAutoEdit: () => set((s) => (s.autoEditId === null ? {} : { autoEditId: null })),

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
        x: clampBlockX(b, b.x + 5, s.doc.page.w),
        y: clampBlockY(b, b.y + 5, s.doc.page.h),
      }));
      return {
        ...record(s),
        doc: { ...s.doc, blocks: [...s.doc.blocks, ...copies] },
        selectedIds: [idMap.get(id)!],
        selectedId: idMap.get(id)!,
        inspectorTarget: "block",
      };
    }),

  moveBlock: (id, x, y) =>
    set((s) => {
      const target = s.doc.blocks.find((b) => b.id === id);
      if (!target || target.locked) return {};
      const nx = clampBlockX(target, x, s.doc.page.w);
      const ny = clampBlockY(target, y, s.doc.page.h);
      const dx = nx - target.x;
      const dy = ny - target.y;
      // 단일 드래그: 트리 자손(자석)만 동반한다. 공간 그룹 멤버는 따라오지 않는다 —
      // 그룹 안에서 개별 요소를 독립 이동(피그마식). 그룹 통째 이동은 그룹 전체 선택
      // (opt-in) → nudgeMany 경로(moveSetIds)가 담당. 잠금 멤버는 제외.
      const together = descendantIds(s.doc.blocks, id);
      return {
        ...record(s, `move:${id}`),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            b.id === id
              ? { ...b, x: nx, y: ny }
              : together.has(b.id) && !b.locked
                ? { ...b, x: clampBlockX(b, b.x + dx, s.doc.page.w), y: clampBlockY(b, b.y + dy, s.doc.page.h) }
                : b
          ),
        },
      };
    }),

  nudgeMany: (ids, dx, dy) =>
    set((s) => {
      const move = moveSetIds(s.doc.blocks, ids);
      const moving = s.doc.blocks.filter((b) => move.has(b.id) && !b.locked);
      const rawDx = Math.round(dx);
      const rawDy = Math.round(dy);
      const { dx: dxr, dy: dyr } = constrainDeltaToSafeArea(moving, rawDx, rawDy, s.doc.page);
      if (!dxr && !dyr) return {};
      return {
        ...record(s, `nudge:${[...move].sort().join(",")}`),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            move.has(b.id) && !b.locked
              ? { ...b, x: clampBlockX(b, b.x + dxr, s.doc.page.w), y: clampBlockY(b, b.y + dyr, s.doc.page.h) }
              : b
          ),
        },
      };
    }),

  reorder: (ids, dir) =>
    set((s) => {
      const next = reorderBlocks(s.doc.blocks, ids, dir);
      return next ? { ...record(s, `z:${dir}`), doc: { ...s.doc, blocks: next } } : {};
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
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (b.id === id ? clampBlockToSafeArea({ ...b, ...patch }, s.doc.page) : b)) },
      };
    }),

  // 인라인 리치 텍스트 — 런 배열을 정규화해 저장하고 text 평문 미러를 동기화한다.
  // 서식이 하나도 없는 단일 런이면 runs를 비워(undefined) 균일 텍스트로 되돌린다
  // → 저장/내보내기가 기존 단순 경로를 타고, 옛 문서와도 동일하게 남는다.
  setRichText: (id, runs, paraAligns, paraLists) =>
    set((s) => {
      const norm = normalizeRuns(runs);
      const text = runsToText(norm);
      // 서식 키가 하나도 없는(전부 undefined) 단일 런 = 균일 텍스트로 되돌린다.
      // bold:false 등 명시값이 있으면 리치로 유지 (블록 기본을 덮는 의미가 있으므로).
      const r0 = norm[0];
      const plain =
        norm.length <= 1 &&
        !!r0 &&
        r0.bold === undefined &&
        r0.italic === undefined &&
        r0.underline === undefined &&
        r0.strike === undefined &&
        r0.color === undefined &&
        r0.bg === undefined &&
        r0.fontSize === undefined &&
        r0.font === undefined;
      const patch: Partial<Block> = plain ? { text, runs: undefined } : { text, runs: norm };
      // 문단별 정렬/목록 — 전부 null(상속/없음)이면 필드 자체를 비워 균일 경로 유지
      if (paraAligns !== undefined)
        patch.paraAligns = paraAligns.some((a) => a != null) ? paraAligns : undefined;
      if (paraLists !== undefined)
        patch.paraLists = paraLists.some((l) => l != null) ? paraLists : undefined;
      return {
        ...record(s, `rich:${id}`),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (b.id === id ? clampBlockToSafeArea({ ...b, ...patch }, s.doc.page) : b)) },
      };
    }),

  setTableData: (id, data, pos) =>
    set((s) => {
      const fitted = fitTableDataToSafeArea(data, s.doc.page);
      const { wPx, hPx } = tableSizePx(fitted);
      return {
        ...record(s, `tbl:${id}`),
        doc: {
          ...s.doc,
          blocks: s.doc.blocks.map((b) =>
            b.id === id
              ? clampBlockToSafeArea(
                  // pos 먼저, w/h 나중 — 클램프가 "새 크기" 기준으로 계산돼야 낡은 폭으로
                  // 좌표가 튀지 않는다(감사 E2: updateBlock 선행 시 old w로 클램프)
                  { ...b, ...(pos ?? {}), data: fitted, w: wPx / SCALE, h: hPx / SCALE },
                  s.doc.page
                )
              : b
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
      // 서브트리째 삭제. 실수는 실행취소가 복구
      const gone = descendantIds(s.doc.blocks, id);
      gone.add(id);
      const selectedIds = s.selectedIds.filter((x) => !gone.has(x));
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => !gone.has(b.id)) },
        selectedIds,
        selectedId: selectedIds[selectedIds.length - 1] ?? null,
        inspectorTarget: selectedIds.length ? "block" : "none",
      };
    }),

  removeSelection: () =>
    set((s) => {
      if (!s.selectedIds.length) return {};
      const gone = new Set<string>();
      for (const id of s.selectedIds) {
        gone.add(id);
        for (const d of descendantIds(s.doc.blocks, id)) gone.add(d);
      }
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => !gone.has(b.id)) },
        selectedIds: [],
        selectedId: null,
        inspectorTarget: "none",
      };
    }),

  groupSelection: () =>
    set((s) => {
      if (s.selectedIds.length < 2) return {};
      const gid = `grp_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const inSel = new Set(s.selectedIds);
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (inSel.has(b.id) ? { ...b, groupId: gid } : b)) },
      };
    }),

  ungroupSelection: () =>
    set((s) => {
      const gids = new Set(
        s.selectedIds.map((id) => s.doc.blocks.find((b) => b.id === id)?.groupId).filter(Boolean) as string[]
      );
      if (!gids.size) return {};
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (b.groupId && gids.has(b.groupId) ? { ...b, groupId: undefined } : b)) },
      };
    }),

  setLocked: (ids, locked) =>
    set((s) => {
      const target = new Set(ids);
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (target.has(b.id) ? { ...b, locked } : b)) },
      };
    }),

  alignSelection: (edge) =>
    set((s) => {
      const sel = s.doc.blocks.filter((b) => s.selectedIds.includes(b.id) && !b.locked);
      if (sel.length < 2) return {};
      const minX = Math.min(...sel.map((b) => b.x));
      const maxX = Math.max(...sel.map((b) => b.x + b.w));
      const minY = Math.min(...sel.map((b) => b.y));
      const maxY = Math.max(...sel.map((b) => b.y + b.h));
      const patch = (b: Block): Partial<Block> => {
        switch (edge) {
          case "left": return { x: clampBlockX(b, minX, s.doc.page.w) };
          case "right": return { x: clampBlockX(b, maxX - b.w, s.doc.page.w) };
          case "hcenter": return { x: clampBlockX(b, (minX + maxX) / 2 - b.w / 2, s.doc.page.w) };
          case "top": return { y: clampBlockY(b, minY, s.doc.page.h) };
          case "bottom": return { y: clampBlockY(b, maxY - b.h, s.doc.page.h) };
          case "vcenter": return { y: clampBlockY(b, (minY + maxY) / 2 - b.h / 2, s.doc.page.h) };
        }
      };
      const inSel = new Set(sel.map((b) => b.id));
      return {
        ...record(s),
        doc: { ...s.doc, blocks: s.doc.blocks.map((b) => (inSel.has(b.id) ? { ...b, ...patch(b) } : b)) },
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
        selectedIds: [],
        selectedId: null,
        inspectorTarget: "none",
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
        selectedIds: [],
        selectedId: null,
        inspectorTarget: "none",
      };
    }),

  // 단일 선택 — 클릭한 블록 하나만. 그룹에 속해도 확장하지 않는다(그룹은 드래그 시 함께 이동).
  select: (id) =>
    set(() =>
      id === null
        ? { selectedIds: [], selectedId: null, inspectorTarget: "none" }
        : { selectedIds: [id], selectedId: id, inspectorTarget: "block" }
    ),

  selectPage: () => set(() => ({ selectedIds: [], selectedId: null, inspectorTarget: "page" })),

  // 그룹 전체 선택 (opt-in) — 이걸로만 그룹 툴바(해제·정렬)가 뜬다
  selectGroup: (id) =>
    set((s) => {
      const ids = groupMemberIds(s.doc.blocks, id);
      return { selectedIds: ids, selectedId: id, inspectorTarget: "block" };
    }),

  toggleSelect: (id) =>
    set((s) => {
      const has = s.selectedIds.includes(id);
      const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
      return { selectedIds, selectedId: has ? selectedIds[selectedIds.length - 1] ?? null : id, inspectorTarget: selectedIds.length ? "block" : "none" };
    }),

  selectMany: (ids) => set(() => ({ selectedIds: [...ids], selectedId: ids[ids.length - 1] ?? null, inspectorTarget: ids.length ? "block" : "none" })),

  setTitle: (title) => set((s) => ({ ...record(s, "title"), doc: { ...s.doc, title } })),
  loadDoc: (doc) => {
    lastKey = null;
    set({ doc, inspectorTarget: "none", selectedIds: [], selectedId: null, autoEditId: null, past: [], future: [] });
  },
  reset: (title) => {
    lastKey = null;
    set({ doc: createDoc(title), inspectorTarget: "none", selectedIds: [], selectedId: null, autoEditId: null, past: [], future: [] });
  },
}));

// 블록이 A4 안전 여백 밖으로 못 나가게 한다. 여백이 사실상 편집 가능한 페이지 경계다.
const clampInsertionAxis = (v: number, size: number, pageSize: number) => {
  const min = SAFE_MARGIN_MM;
  const max = Math.max(min, pageSize - SAFE_MARGIN_MM - size);
  return Math.round(Math.max(min, Math.min(v, max)) * 100) / 100;
};
const clampSafeAxis = (v: number, size: number, pageSize: number) => {
  const min = SAFE_MARGIN_MM;
  const max = Math.max(min, pageSize - SAFE_MARGIN_MM - size);
  // 정수 커밋 — max는 floor: round(max)가 올림되면 안전한계를 최대 0.5mm 초과 허용(중복 감사에서 확인)
  return Math.max(min, Math.min(Math.round(v), Math.floor(max)));
};
const clampBlockX = (b: Block, x: number, pageW: number) => clampSafeAxis(x, b.w, pageW);
const clampBlockY = (b: Block, y: number, pageH: number) => clampSafeAxis(y, b.h, pageH);
const clampBlockToSafeArea = (b: Block, page: CanvasDoc["page"]): Block => ({
  ...b,
  x: clampBlockX(b, b.x, page.w),
  y: clampBlockY(b, b.y, page.h),
});
// 수식의 원본은 gesture.clampDeltaToSafeArea(비반올림) — 여긴 커밋 경계라 정수 반올림만 얹는다.
export const constrainDeltaToSafeArea = (blocks: Block[], dx: number, dy: number, page: CanvasDoc["page"]) => {
  const d = clampDeltaToSafeArea(blocks, dx, dy, page);
  return { dx: Math.round(d.dx), dy: Math.round(d.dy) };
};



