// useRichText.ts — 리치텍스트 편집 배선 공유 훅 (계획 2단계).
//
// 캔버스 TextContent와 임베드 EmbedTextBlock에 중복돼 있던 편집 배선(미니 히스토리·
// IME 가드·flush·서식/문단 적용·클립보드·키보드)을 한 곳으로. 진실 반영은 onCommit
// 콜백으로 주입 — 훅은 스토어(zustand)·캔버스 지오메트리를 모른다.
//
// 소비자가 하는 일: contentEditable div에 editableProps 스프레드(+자기 속성/Escape 등
// 래핑), 필요한 시점에 seed() 호출(히스토리 초기화 포함), 툴바에 apply* 연결.
import { useRef } from "react";
import type React from "react";
import {
  type Block,
  type ParaListType,
  type TextAlign,
  type TextRun,
  TEXT_DEFAULTS,
  applyRunStyle,
  rangeRuns,
  runsToText,
  spliceRuns,
} from "../document/model";
import { seedEditable, domToRuns, paraAlignsFromDom, paraListsFromDom, paraIdxAt, spliceAligns, splitParagraphAtCaret } from "./dom";
import { selectionOffsets, setSelectionRange, placeCaretEnd, placeCaretFromPoint, insertTextAtCaret } from "./caret";
import { runsToClipboardHtml, runsFromClipboardHtml } from "./clipboard";

// 선택 상태 — 서식바(플로팅/고정)가 활성 표시에 쓰는 값. 상속(블록 기본) 포함 판정.
export interface RichSelState {
  offs: [number, number];
  isRange: boolean;
  rect: DOMRect;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  href?: string;
  bg?: string;
  fontSize?: number;
  font?: string;
  align?: TextAlign;
  list?: ParaListType | null;
}

export interface UseRichTextOpts {
  // 서식 기본값 컨테이너(상속 판정·시드 스타일) — 최신 블록을 반환해야 한다
  getBase: () => Block;
  // 진실 반영 — 캔버스: setRichText+syncEditH / 임베드: 로컬 state 갱신
  onCommit: (runs: TextRun[], aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) => void;
  // 선택 변화 통지 (null = 에디터 밖/선택 소실) — 서식바 표시용
  onSelection?: (state: RichSelState | null) => void;
  // true를 반환하면 이번 selectionchange를 무시(서식바 포커스 등 — 선택 유지)
  shouldSkipSelection?: () => boolean;
  // Ctrl+B/I/U 단축키 (기본 켬)
  hotkeys?: boolean;
}

type Snap = { runs: TextRun[]; caret: number; aligns: (TextAlign | null)[]; lists: (ParaListType | null)[] };

export function useRichText({ getBase, onCommit, onSelection, shouldSkipSelection, hotkeys = true }: UseRichTextOpts) {
  const ref = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  // 마지막 유효 선택(캐럿 포함) — 서식바로 포커스가 옮겨가 선택이 사라져도 이 값으로 적용
  const selRef = useRef<[number, number]>([0, 0]);
  // 미니 히스토리 — 네이티브 CE undo는 프로그램적 재시드를 몰라 어긋난다 → runs 스냅샷.
  // 연속 타이핑은 700ms 버스트로 한 단계, 서식 적용은 항상 독립 단계.
  const histRef = useRef<{ stack: Snap[]; idx: number; lastAt: number }>({ stack: [], idx: -1, lastAt: 0 });

  const caretNow = () => {
    const el = ref.current;
    return el ? (selectionOffsets(el)?.[1] ?? (el.textContent ?? "").length) : 0;
  };

  const pushHistory = (runs: TextRun[], caret: number, coalesce: boolean, aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) => {
    const h = histRef.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.idx + 1); // 새 편집은 redo 꼬리를 버린다
    if (coalesce && h.idx >= 0 && now - h.lastAt < 700) h.stack[h.idx] = { runs, caret, aligns, lists };
    else {
      h.stack.push({ runs, caret, aligns, lists });
      h.idx = h.stack.length - 1;
    }
    h.lastAt = now;
  };

  const applySnap = (st: Snap) => {
    const el = ref.current;
    if (!el) return;
    seedEditable(el, getBase(), st.runs, st.aligns, st.lists);
    onCommit(st.runs, st.aligns, st.lists);
    el.focus();
    setSelectionRange(el, st.caret, st.caret);
  };
  const undo = () => {
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    h.lastAt = 0; // 되돌린 뒤 이어지는 입력은 새 스냅샷
    applySnap(h.stack[h.idx]);
  };
  const redo = () => {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    h.lastAt = 0;
    applySnap(h.stack[h.idx]);
  };

  // 시드 + 히스토리 초기화. caret: 숫자 오프셋 | "end" | 클릭 좌표 | 생략(배치 안 함)
  const seed = (
    runs: TextRun[],
    aligns?: (TextAlign | null)[],
    lists?: (ParaListType | null)[],
    caret?: number | "end" | { x: number; y: number }
  ) => {
    const el = ref.current;
    if (!el) return;
    seedEditable(el, getBase(), runs, aligns, lists);
    if (caret !== undefined) {
      el.focus();
      if (caret === "end") placeCaretEnd(el);
      else if (typeof caret === "number") setSelectionRange(el, caret, caret);
      else placeCaretFromPoint(el, caret);
    }
    histRef.current = {
      stack: [
        {
          runs,
          caret: caret === undefined ? 0 : caretNow(),
          aligns: paraAlignsFromDom(el),
          lists: paraListsFromDom(el),
        },
      ],
      idx: 0,
      lastAt: 0,
    };
  };

  // DOM→runs 반영 (타이핑·삭제). IME 조합 중엔 건너뛰고 compositionend에서 처리.
  const flush = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const runs = domToRuns(el);
    const aligns = paraAlignsFromDom(el); // 문단별 정렬·목록은 편집 DOM이 진실
    const lists = paraListsFromDom(el);
    onCommit(runs, aligns, lists);
    pushHistory(runs, caretNow(), true, aligns, lists);
  };

  // 선택 구간에 런 서식 적용 — 재시드 후 선택 복원
  const applyStyle = (patch: Partial<Omit<TextRun, "text">>) => {
    const el = ref.current;
    const [a, b] = selRef.current;
    if (!el || a === b) return;
    const next = applyRunStyle(domToRuns(el), a, b, patch);
    const aligns = paraAlignsFromDom(el); // 재시드 전에 현재 문단 정렬·목록 보존
    const lists = paraListsFromDom(el);
    seedEditable(el, getBase(), next, aligns, lists);
    onCommit(next, aligns, lists);
    pushHistory(next, b, false, aligns, lists); // 서식 적용은 항상 독립 단계
    el.focus();
    setSelectionRange(el, a, b);
  };

  // 문단 속성(정렬/목록) 공통 적용기 — 캐럿만 있어도 그 문단에 동작
  const applyPara = (
    mut: (aligns: (TextAlign | null)[], lists: (ParaListType | null)[], pFrom: number, pTo: number) => void
  ) => {
    const el = ref.current;
    if (!el) return;
    const [a, b] = selRef.current;
    const runs = domToRuns(el);
    const text = runsToText(runs);
    const total = text.split("\n").length;
    const aligns: (TextAlign | null)[] = Array.from({ length: total }, (_, i) => paraAlignsFromDom(el)[i] ?? null);
    const lists: (ParaListType | null)[] = Array.from({ length: total }, (_, i) => paraListsFromDom(el)[i] ?? null);
    mut(aligns, lists, paraIdxAt(text, a), Math.min(paraIdxAt(text, b), total - 1));
    seedEditable(el, getBase(), runs, aligns, lists);
    onCommit(runs, aligns, lists);
    pushHistory(runs, b, false, aligns, lists);
    el.focus();
    setSelectionRange(el, a, b);
  };
  const applyAlign = (v: TextAlign) =>
    applyPara((aligns, _l, f, t) => {
      for (let i = f; i <= t; i++) aligns[i] = v;
    });
  const applyList = (v: ParaListType) =>
    applyPara((_a, lists, f, t) => {
      const allSame = Array.from({ length: t - f + 1 }, (_, k) => lists[f + k]).every((x) => x === v);
      for (let i = f; i <= t; i++) lists[i] = allSame ? null : v;
    });

  // selectionchange 핸들러 — 소비자 effect에서 등록한다(활성 조건이 소비자마다 달라서).
  // 선택 상태(상속 포함 판정)를 계산해 onSelection으로 통지하고 selRef를 갱신한다.
  const handleSelectionChange = () => {
    const el = ref.current;
    if (!el) return;
    if (shouldSkipSelection?.()) return; // 서식바 포커스 등 — 선택 유지
    const offs = selectionOffsets(el);
    if (!offs) {
      onSelection?.(null);
      return;
    }
    selRef.current = offs;
    const base = getBase();
    const isRange = offs[0] !== offs[1];
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const runs = domToRuns(el);
    const rr = isRange ? rangeRuns(runs, offs[0], offs[1]) : [];
    const all = (pred: (r: TextRun) => boolean) => rr.length > 0 && rr.every(pred);
    const same = <T,>(get: (r: TextRun) => T): T | undefined => {
      if (!rr.length) return undefined;
      const first = get(rr[0]);
      return rr.every((r) => get(r) === first) ? first : undefined;
    };
    // 선택이 걸친 문단들의 정렬/목록 — 전부 같으면 그 값, 섞이면 undefined
    const text = runsToText(runs);
    const pFrom = paraIdxAt(text, offs[0]);
    const pTo = paraIdxAt(text, offs[1]);
    const domAligns = paraAlignsFromDom(el);
    const aInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => domAligns[pFrom + i] ?? base.align ?? "left");
    const domLists = paraListsFromDom(el);
    const lInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => domLists[pFrom + i] ?? null);
    onSelection?.({
      offs,
      isRange,
      rect,
      bold: all((r) => (r.bold ?? base.bold ?? false) === true),
      italic: all((r) => (r.italic ?? base.italic ?? false) === true),
      underline: all((r) => (r.underline ?? base.underline ?? false) === true),
      strike: all((r) => (r.strike ?? base.strike ?? false) === true),
      color: same((r) => r.color ?? base.color ?? TEXT_DEFAULTS.color),
      href: same((r) => r.href),
      bg: same((r) => r.bg),
      fontSize: same((r) => r.fontSize ?? base.fontSize ?? TEXT_DEFAULTS.fontSize),
      font: same((r) => r.font ?? base.font),
      align: aInSel.every((v) => v === aInSel[0]) ? aInSel[0] : undefined,
      list: lInSel.every((v) => v === lInSel[0]) ? lInSel[0] : undefined,
    });
  };

  // contentEditable에 스프레드할 공통 핸들러 — 소비자는 자기 속성(className 등)과
  // 래퍼(Escape 등)를 얹는다.
  const editableProps = {
    ref,
    onInput: flush,
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
      flush();
    },
    onCopy: (e: React.ClipboardEvent<HTMLDivElement>) => {
      const el = ref.current;
      const offs = el ? selectionOffsets(el) : null;
      if (!el || !offs || offs[0] === offs[1]) return; // 빈 선택은 기본 동작
      e.preventDefault();
      const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
      e.clipboardData.setData("text/html", runsToClipboardHtml(rr, getBase()));
      e.clipboardData.setData("text/plain", runsToText(rr));
    },
    onCut: (e: React.ClipboardEvent<HTMLDivElement>) => {
      const el = ref.current;
      const offs = el ? selectionOffsets(el) : null;
      if (!el || !offs || offs[0] === offs[1]) return;
      e.preventDefault();
      const cur = domToRuns(el);
      const rr = rangeRuns(cur, offs[0], offs[1]);
      e.clipboardData.setData("text/html", runsToClipboardHtml(rr, getBase()));
      e.clipboardData.setData("text/plain", runsToText(rr));
      const next = spliceRuns(cur, offs[0], offs[1], []);
      const curText = runsToText(cur);
      const aligns = spliceAligns(paraAlignsFromDom(el), curText, offs[0], offs[1], "");
      const lists = spliceAligns(paraListsFromDom(el), curText, offs[0], offs[1], "");
      seedEditable(el, getBase(), next, aligns, lists);
      onCommit(next, aligns, lists);
      pushHistory(next, offs[0], false, aligns, lists);
      el.focus();
      setSelectionRange(el, offs[0], offs[0]);
    },
    onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      // 서식 붙여넣기 — HTML이 있으면 화이트리스트만 남겨 런으로. 없으면 평문.
      const html = e.clipboardData.getData("text/html");
      if (html) {
        const ins = runsFromClipboardHtml(html);
        const insText = runsToText(ins);
        if (insText) {
          const offs = selectionOffsets(el) ?? [caretNow(), caretNow()];
          const cur = domToRuns(el);
          const next = spliceRuns(cur, offs[0], offs[1], ins);
          const curText = runsToText(cur);
          const aligns = spliceAligns(paraAlignsFromDom(el), curText, offs[0], offs[1], insText);
          const lists = spliceAligns(paraListsFromDom(el), curText, offs[0], offs[1], insText);
          seedEditable(el, getBase(), next, aligns, lists);
          onCommit(next, aligns, lists);
          const caret = offs[0] + insText.length;
          pushHistory(next, caret, false, aligns, lists);
          el.focus();
          setSelectionRange(el, caret, caret);
          return;
        }
      }
      insertTextAtCaret(e.clipboardData.getData("text/plain"));
      flush();
    },
    onBeforeInput: (e: React.FormEvent<HTMLDivElement>) => {
      // 컨텍스트 메뉴 "실행 취소" 등 키보드 밖 경로의 네이티브 undo도 차단 → 미니 히스토리
      const it = (e.nativeEvent as InputEvent).inputType;
      if (it === "historyUndo") {
        e.preventDefault();
        undo();
      } else if (it === "historyRedo") {
        e.preventDefault();
        redo();
      }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !composingRef.current && !e.nativeEvent.isComposing) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
        if (hotkeys && (k === "b" || k === "i" || k === "u")) {
          e.preventDefault();
          applyStyle(k === "b" ? { bold: true } : k === "i" ? { italic: true } : { underline: true });
          return;
        }
      }
      // 엔터 = 문단 분할(정렬·목록 상속). IME 조합 확정 엔터는 통과(isComposing).
      if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const el = ref.current;
        if (!el) return;
        const caretBefore = caretNow();
        if (!splitParagraphAtCaret(el)) insertTextAtCaret("\n"); // 방어적 폴백
        flush();
        // 목록 문단이 있으면 재시드 — 새 문단 마커·이후 번호를 다시 그린다
        const lists = paraListsFromDom(el);
        if (lists.some((l) => l != null)) {
          seedEditable(el, getBase(), domToRuns(el), paraAlignsFromDom(el), lists);
          el.focus();
          setSelectionRange(el, caretBefore + 1, caretBefore + 1);
        }
      }
    },
  };

  return {
    ref,
    editableProps,
    seed,
    flush,
    undo,
    redo,
    applyStyle,
    applyAlign,
    applyList,
    handleSelectionChange,
    caretNow,
    getSel: () => selRef.current,
    clearSel: () => {
      selRef.current = [0, 0];
    },
  };
}
