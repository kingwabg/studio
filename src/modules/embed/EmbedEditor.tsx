// EmbedEditor.tsx — 판매용 임베드 리치텍스트 에디터 (블록 스택형).
//
// classic 웹 에디터처럼 본문 흐름에 텍스트·이미지·표를 세로로 쌓는다(블록 스택).
//  · 텍스트 블록 = 검증된 리치텍스트 코어(runs/문단정렬/목록) — CanvasBlock 헬퍼 공유
//  · 이미지 블록 = IndexedDB 자산(assets.ts) 재사용
//  · 표 블록    = table-king(TableKingBlock) 통째 재사용 — 한컴식 경계 편집까지
//  · 상단 고정 툴바 하나가 "포커스된 텍스트 블록"에 서식을 적용
//  · 내보내기: 렌더된 DOM을 실측(px→mm)해 CanvasDoc로 → exportHwpx가 3종 블록 모두 처리
//
// A4 캔버스·Zustand 없음 — 어떤 박스에든 들어가는 독립 컴포넌트. 진실은 blocks 배열.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Block,
  type ParaListType,
  type TableKingData,
  type TextAlign,
  type TextRun,
  applyRunStyle,
  normalizeRuns,
  rangeRuns,
  runsToText,
  spliceRuns,
} from "../document/model";
import {
  domToRuns,
  insertTextAtCaret,
  normalizeUrl,
  paraAlignsFromDom,
  paraIdxAt,
  paraListsFromDom,
  placeCaretEnd,
  runsFromClipboardHtml,
  runsToClipboardHtml,
  seedEditable,
  selectionOffsets,
  setSelectionRange,
  spliceAligns,
  splitParagraphAtCaret,
} from "../canvas/CanvasBlock";
import { DEFAULT_FONT, ensureFont } from "../document/fonts";
import { getAssetUrl, putAsset } from "../document/assets";
import { SCALE } from "../canvas/geometry";
import { IcImage, IcTable } from "../../ui/icons";
import { TableKingBlock, makeTableKingData, tableDataToRows } from "../../table-king/TableKingBlock.jsx";

const TK_THEME: React.CSSProperties = {
  "--tk-ink": "#1A2233", "--tk-ink-soft": "#5B6577", "--tk-ink-faint": "#98A2B3",
  "--tk-paper": "#F6F7FA", "--tk-surface": "#FFFFFF", "--tk-line": "#E4E8EF",
  "--tk-line-strong": "#CBD2DE", "--tk-accent": "#2B5CE6", "--tk-accent-soft": "#EDF2FE",
} as React.CSSProperties;

let _seq = 0;
const uid = (p: string) => `${p}_${(_seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export type EmbedBlock =
  | { id: string; kind: "text"; runs: TextRun[]; paraAligns: (TextAlign | null)[]; paraLists: (ParaListType | null)[] }
  | { id: string; kind: "image"; src: string }
  | { id: string; kind: "table"; data: TableKingData };

export interface EmbedEditorHandle {
  toDoc: (title?: string) => import("../document/model").CanvasDoc;
  isEmpty: () => boolean;
}

export interface EmbedEditorProps {
  placeholder?: string;
  minHeight?: number;
  className?: string;
  onChange?: (blocks: EmbedBlock[]) => void;
}

type ActiveFmt = {
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  align?: TextAlign; list?: ParaListType | null; href?: string;
};
const EMPTY_FMT: ActiveFmt = { bold: false, italic: false, underline: false, strike: false, align: "left", list: null };

interface TextHandle {
  applyStyle: (patch: Partial<Omit<TextRun, "text">>) => void;
  applyAlign: (a: TextAlign) => void;
  applyList: (t: ParaListType) => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
}

// ── 텍스트 블록 (리치텍스트 코어) ──
const EmbedTextBlock = forwardRef<
  TextHandle,
  {
    block: Extract<EmbedBlock, { kind: "text" }>;
    onChange: (b: Extract<EmbedBlock, { kind: "text" }>) => void;
    onActive: (id: string, fmt: ActiveFmt) => void;
    onEnterEmptyAtEnd?: () => void;
  }
>(function EmbedTextBlock({ block, onChange, onActive }, ref) {
  const ceRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<Block>({ id: block.id, type: "text", x: 0, y: 0, w: 0, h: 0, text: "" } as Block);
  const composingRef = useRef(false);
  const selRef = useRef<[number, number]>([0, 0]);
  type Snap = { runs: TextRun[]; caret: number; aligns: (TextAlign | null)[]; lists: (ParaListType | null)[] };
  const hist = useRef<{ stack: Snap[]; idx: number; lastAt: number }>({ stack: [], idx: -1, lastAt: 0 });

  const caretNow = () => {
    const el = ceRef.current;
    return el ? selectionOffsets(el)?.[1] ?? (el.textContent ?? "").length : 0;
  };
  const emit = (runs: TextRun[], aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) =>
    onChange({ id: block.id, kind: "text", runs: normalizeRuns(runs), paraAligns: aligns, paraLists: lists });
  const push = (runs: TextRun[], caret: number, coalesce: boolean, aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) => {
    const h = hist.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.idx + 1);
    if (coalesce && h.idx >= 0 && now - h.lastAt < 700) h.stack[h.idx] = { runs, caret, aligns, lists };
    else { h.stack.push({ runs, caret, aligns, lists }); h.idx = h.stack.length - 1; }
    h.lastAt = now;
  };
  const applySnap = (st: Snap) => {
    const el = ceRef.current;
    if (!el) return;
    seedEditable(el, baseRef.current, st.runs, st.aligns, st.lists);
    emit(st.runs, st.aligns, st.lists);
    el.focus();
    setSelectionRange(el, st.caret, st.caret);
  };
  const undo = () => { const h = hist.current; if (h.idx <= 0) return; h.idx--; h.lastAt = 0; applySnap(h.stack[h.idx]); };
  const redo = () => { const h = hist.current; if (h.idx >= h.stack.length - 1) return; h.idx++; h.lastAt = 0; applySnap(h.stack[h.idx]); };

  const flush = () => {
    const el = ceRef.current;
    if (!el || composingRef.current) return;
    const runs = domToRuns(el);
    const aligns = paraAlignsFromDom(el);
    const lists = paraListsFromDom(el);
    emit(runs, aligns, lists);
    push(runs, caretNow(), true, aligns, lists);
  };

  useEffect(() => {
    void ensureFont(DEFAULT_FONT);
    const el = ceRef.current;
    if (!el) return;
    const runs = block.runs.length ? block.runs : [{ text: "" }];
    seedEditable(el, baseRef.current, runs, block.paraAligns, block.paraLists);
    hist.current = { stack: [{ runs, caret: 0, aligns: block.paraAligns, lists: block.paraLists }], idx: 0, lastAt: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSel = () => {
      const el = ceRef.current;
      if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
      const offs = selectionOffsets(el);
      if (!offs) return;
      selRef.current = offs;
      const runs = domToRuns(el);
      const rr = offs[0] === offs[1] ? [] : rangeRuns(runs, offs[0], offs[1]);
      const all = (p: (r: TextRun) => boolean) => rr.length > 0 && rr.every(p);
      const text = runsToText(runs);
      const pF = paraIdxAt(text, offs[0]);
      const pT = paraIdxAt(text, offs[1]);
      const aligns = paraAlignsFromDom(el);
      const lists = paraListsFromDom(el);
      const aSel = Array.from({ length: pT - pF + 1 }, (_, i) => aligns[pF + i] ?? "left");
      const lSel = Array.from({ length: pT - pF + 1 }, (_, i) => lists[pF + i] ?? null);
      const same = <T,>(a: T[]) => (a.every((v) => v === a[0]) ? a[0] : undefined);
      const hrefs = rr.map((r) => r.href);
      onActive(block.id, {
        bold: all((r) => r.bold === true), italic: all((r) => r.italic === true),
        underline: all((r) => r.underline === true), strike: all((r) => r.strike === true),
        align: same(aSel), list: same(lSel),
        href: hrefs.length && hrefs.every((h) => h === hrefs[0]) ? hrefs[0] : undefined,
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyStyle = (patch: Partial<Omit<TextRun, "text">>) => {
    const el = ceRef.current;
    const [a, b] = selRef.current;
    if (!el || a === b) return;
    const next = applyRunStyle(domToRuns(el), a, b, patch);
    const aligns = paraAlignsFromDom(el);
    const lists = paraListsFromDom(el);
    seedEditable(el, baseRef.current, next, aligns, lists);
    emit(next, aligns, lists);
    push(next, b, false, aligns, lists);
    el.focus();
    setSelectionRange(el, a, b);
  };
  const applyPara = (mut: (a: (TextAlign | null)[], l: (ParaListType | null)[], f: number, t: number) => void) => {
    const el = ceRef.current;
    if (!el) return;
    const [a, b] = selRef.current;
    const runs = domToRuns(el);
    const text = runsToText(runs);
    const total = text.split("\n").length;
    const aligns = Array.from({ length: total }, (_, i) => paraAlignsFromDom(el)[i] ?? null);
    const lists = Array.from({ length: total }, (_, i) => paraListsFromDom(el)[i] ?? null);
    mut(aligns, lists, paraIdxAt(text, a), Math.min(paraIdxAt(text, b), total - 1));
    seedEditable(el, baseRef.current, runs, aligns, lists);
    emit(runs, aligns, lists);
    push(runs, b, false, aligns, lists);
    el.focus();
    setSelectionRange(el, a, b);
  };

  useImperativeHandle(ref, () => ({
    applyStyle,
    applyAlign: (v) => applyPara((a, _l, f, t) => { for (let i = f; i <= t; i++) a[i] = v; }),
    applyList: (v) => applyPara((_a, l, f, t) => {
      const same = Array.from({ length: t - f + 1 }, (_, k) => l[f + k]).every((x) => x === v);
      for (let i = f; i <= t; i++) l[i] = same ? null : v;
    }),
    undo, redo,
    focus: () => ceRef.current?.focus(),
  }));

  return (
    <div
      ref={ceRef}
      data-eb={block.id}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      onInput={flush}
      onFocus={() => {
        const el = ceRef.current;
        if (el && !(el.textContent ?? "").length && !el.querySelector("[data-para]")) placeCaretEnd(el);
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; flush(); }}
      onCopy={(e) => {
        const el = ceRef.current;
        const offs = el ? selectionOffsets(el) : null;
        if (!el || !offs || offs[0] === offs[1]) return;
        e.preventDefault();
        const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
        e.clipboardData.setData("text/html", runsToClipboardHtml(rr, baseRef.current));
        e.clipboardData.setData("text/plain", runsToText(rr));
      }}
      onPaste={(e) => {
        e.preventDefault();
        const el = ceRef.current;
        if (!el) return;
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
            seedEditable(el, baseRef.current, next, aligns, lists);
            emit(next, aligns, lists);
            const caret = offs[0] + insText.length;
            push(next, caret, false, aligns, lists);
            el.focus();
            setSelectionRange(el, caret, caret);
            return;
          }
        }
        insertTextAtCaret(e.clipboardData.getData("text/plain"));
        flush();
      }}
      onBeforeInput={(e) => {
        const it = (e.nativeEvent as InputEvent).inputType;
        if (it === "historyUndo") { e.preventDefault(); undo(); }
        else if (it === "historyRedo") { e.preventDefault(); redo(); }
      }}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !composingRef.current && !e.nativeEvent.isComposing) {
          const k = e.key.toLowerCase();
          if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
          if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
          if (k === "b") { e.preventDefault(); applyStyle({ bold: true }); return; }
          if (k === "i") { e.preventDefault(); applyStyle({ italic: true }); return; }
          if (k === "u") { e.preventDefault(); applyStyle({ underline: true }); return; }
        }
        if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
          e.preventDefault();
          const el = ceRef.current;
          if (!el) return;
          const caretBefore = caretNow();
          if (!splitParagraphAtCaret(el)) insertTextAtCaret("\n");
          flush();
          const lists = paraListsFromDom(el);
          if (lists.some((l) => l != null)) {
            seedEditable(el, baseRef.current, domToRuns(el), paraAlignsFromDom(el), lists);
            el.focus();
            setSelectionRange(el, caretBefore + 1, caretBefore + 1);
          }
        }
      }}
      onClick={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const href = (e.target as HTMLElement).closest?.("span[data-href]")?.getAttribute("data-href");
        if (href) { e.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
      }}
      className="px-3 py-2 outline-none text-[13.5px] leading-snug text-ink"
      style={{ whiteSpace: "pre-wrap", minHeight: "1.6em" }}
    />
  );
});

// ── 이미지 블록 ──
function EmbedImageBlock({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAssetUrl(src).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [src]);
  return (
    <div data-eb-inner className="px-3 py-2">
      {url ? (
        <img src={url} alt="" draggable={false} className="max-w-full rounded-md" style={{ maxHeight: 320 }} />
      ) : (
        <div className="h-16 rounded-md bg-paper animate-pulse" />
      )}
    </div>
  );
}

// ── 표 블록 (table-king 래퍼) ──
function EmbedTableBlock({
  block, active, onChange, onActivate,
}: {
  block: Extract<EmbedBlock, { kind: "table" }>;
  active: boolean;
  onChange: (b: EmbedBlock) => void;
  onActivate: () => void;
}) {
  const [showHandles, setShowHandles] = useState(false);
  return (
    <div data-eb={block.id} className="px-3 py-2 overflow-x-auto" style={TK_THEME} onPointerDown={onActivate}>
      <TableKingBlock
        value={block.data}
        onChange={(next: TableKingData) => onChange({ id: block.id, kind: "table", data: next })}
        active={active}
        onActivate={onActivate}
        showHandles={showHandles}
        setShowHandles={setShowHandles}
        themeVars={TK_THEME}
      />
    </div>
  );
}

// ── 블록 스택 컨테이너 ──
export const EmbedEditor = forwardRef<EmbedEditorHandle, EmbedEditorProps>(function EmbedEditor(
  { placeholder = "내용을 입력하세요…", minHeight = 220, className, onChange },
  ref
) {
  const [blocks, setBlocks] = useState<EmbedBlock[]>(() => [
    { id: uid("t"), kind: "text", runs: [{ text: "" }], paraAligns: [null], paraLists: [null] },
  ]);
  const [focusedId, setFocusedId] = useState<string | null>(blocks[0]?.id ?? null);
  const [fmt, setFmt] = useState<ActiveFmt>(EMPTY_FMT);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const handles = useRef<Map<string, TextHandle>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  useEffect(() => { onChange?.(blocks); }, [blocks, onChange]);

  const isEmpty = useMemo(() =>
    blocks.length === 1 && blocks[0].kind === "text" && !runsToText((blocks[0] as { runs: TextRun[] }).runs).trim(),
  [blocks]);

  const focusedIsText = blocks.find((b) => b.id === focusedId)?.kind === "text";
  const h = () => (focusedId ? handles.current.get(focusedId) : undefined);

  const updateBlock = (b: EmbedBlock) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? b : x)));
  const insertAfter = (nb: EmbedBlock) =>
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === focusedId);
      const at = i < 0 ? bs.length : i + 1;
      const next = [...bs.slice(0, at), nb, ...bs.slice(at)];
      // 이미지/표 뒤엔 이어 쓸 빈 텍스트 블록을 보장(마지막이 비텍스트면 커서 갈 곳 필요)
      if (nb.kind !== "text" && (at + 1 >= next.length || next[at + 1].kind !== "text"))
        next.splice(at + 1, 0, { id: uid("t"), kind: "text", runs: [{ text: "" }], paraAligns: [null], paraLists: [null] });
      return next;
    });
  const removeBlock = (id: string) =>
    setBlocks((bs) => {
      const next = bs.filter((x) => x.id !== id);
      return next.length ? next : [{ id: uid("t"), kind: "text", runs: [{ text: "" }], paraAligns: [null], paraLists: [null] }];
    });

  const insertImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/bmp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const id = await putAsset(f);
      insertAfter({ id: uid("i"), kind: "image", src: id });
    };
    input.click();
  };
  const insertTable = () =>
    insertAfter({ id: uid("tb"), kind: "table", data: makeTableKingData([["", "", ""], ["", "", ""]], 360) as TableKingData });

  // ── 내보내기: DOM 실측 → CanvasDoc (exportHwpx가 3종 블록 처리) ──
  useImperativeHandle(ref, () => ({
    isEmpty: () => isEmpty,
    toDoc: (title = "임베드 문서") => {
      const cont = contentRef.current!;
      const c = cont.getBoundingClientRect();
      const LEFT = 20; // mm 좌측 여백
      const CONTENT_W = 170;
      const out: Block[] = [];
      let maxBottom = 20;
      for (const b of blocksRef.current) {
        const el = cont.querySelector<HTMLElement>(`[data-eb="${b.id}"], [data-eb-wrap="${b.id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const y = 20 + (r.top - c.top) / SCALE;
        const hMm = Math.max(4, r.height / SCALE);
        maxBottom = Math.max(maxBottom, y + hMm);
        if (b.kind === "text") {
          const text = runsToText(b.runs);
          if (!text.trim()) continue; // 빈 텍스트 블록은 내보내기 제외
          out.push({
            id: b.id, type: "text", x: LEFT, y, w: CONTENT_W, h: hMm, text,
            runs: b.runs,
            paraAligns: b.paraAligns.some((a) => a != null) ? b.paraAligns : undefined,
            paraLists: b.paraLists.some((l) => l != null) ? b.paraLists : undefined,
          } as Block);
        } else if (b.kind === "image") {
          out.push({ id: b.id, type: "image", x: LEFT, y, w: Math.min(CONTENT_W, r.width / SCALE), h: hMm, src: b.src } as Block);
        } else {
          out.push({ id: b.id, type: "table", x: LEFT, y, w: Math.min(CONTENT_W, r.width / SCALE), h: hMm, data: b.data } as Block);
        }
      }
      return { id: "embed_export", title, page: { w: 210, h: Math.max(297, maxBottom + 20) }, blocks: out } as import("../document/model").CanvasDoc;
    },
  }), [isEmpty]);

  const tb = (on: boolean) =>
    `w-7 h-7 rounded-md flex items-center justify-center text-[13px] transition-colors ${
      on ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
    } ${!focusedIsText ? "opacity-40 pointer-events-none" : ""}`;
  const COLORS = ["#1A2233", "#D64550", "#2B5CE6", "#3B9B6B"];
  const HIGHLIGHTS = ["#FDF3B4", "#DBEAFE", ""];

  return (
    <div className={`border border-line rounded-xl bg-surface overflow-hidden ${className ?? ""}`}>
      {/* ── 고정 툴바 ── */}
      <div className="flex items-center gap-px flex-wrap px-2 py-1.5 border-b border-line bg-paper/60">
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-inksoft hover:bg-paper font-bold" title="실행취소" onClick={() => h()?.undo()} disabled={!focusedIsText}>↶</button>
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-inksoft hover:bg-paper font-bold" title="재실행" onClick={() => h()?.redo()} disabled={!focusedIsText}>↷</button>
        <span className="w-px h-4 bg-line mx-1" />
        <button className={`${tb(fmt.bold)} font-extrabold`} title="굵게" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ bold: fmt.bold ? undefined : true })}>가</button>
        <button className={`${tb(fmt.italic)} italic`} title="기울임" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ italic: fmt.italic ? undefined : true })}>가</button>
        <button className={`${tb(fmt.underline)} underline underline-offset-2`} title="밑줄" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ underline: fmt.underline ? undefined : true })}>가</button>
        <button className={`${tb(fmt.strike)} line-through`} title="취소선" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ strike: fmt.strike ? undefined : true })}>가</button>
        <span className="w-px h-4 bg-line mx-1" />
        {COLORS.map((c) => (
          <button key={c} title={`글자색 ${c}`} onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ color: c })}
            className={`w-[16px] h-[16px] rounded-full mx-[2px] hover:scale-110 transition-transform ${!focusedIsText ? "opacity-40 pointer-events-none" : ""}`}
            style={{ backgroundColor: c, boxShadow: "0 0 0 1px rgba(16,24,40,.15)" }} />
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {HIGHLIGHTS.map((c) => (
          <button key={c || "none"} title={c ? `형광펜 ${c}` : "형광펜 지우기"} onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyStyle({ bg: c || undefined })}
            className={`w-[16px] h-[16px] rounded-[4px] mx-[2px] hover:scale-110 flex items-center justify-center text-[8px] text-inkfaint ${!focusedIsText ? "opacity-40 pointer-events-none" : ""}`}
            style={{ backgroundColor: c || "var(--surface)", border: "1px solid var(--line)" }}>{!c && "✕"}</button>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {(["left", "center", "right"] as TextAlign[]).map((v, i) => (
          <button key={v} className={`${tb(fmt.align === v)} text-[11px] font-bold`} title={`${["왼쪽", "가운데", "오른쪽"][i]} 정렬`} onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyAlign(v)}>{["좌", "중", "우"][i]}</button>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        <button className={tb(fmt.list === "bullet")} title="글머리 목록" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyList("bullet")}>•</button>
        <button className={`${tb(fmt.list === "num")} text-[10px] font-bold`} title="번호 목록" onPointerDown={(e) => e.preventDefault()} onClick={() => h()?.applyList("num")}>1.</button>
        <span className="w-px h-4 bg-line mx-1" />
        <div className="relative">
          <button className={tb(!!fmt.href)} title="링크" onPointerDown={(e) => e.preventDefault()} onClick={() => { setLinkUrl(fmt.href ?? ""); setLinkOpen((v) => !v); }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5l3-3M7 4.2l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M9 11.8l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          {linkOpen && focusedIsText && (
            <div className="absolute left-0 top-[32px] w-[220px] rounded-lg bg-surface border border-line p-1.5 z-30 flex items-center gap-1.5" style={{ boxShadow: "var(--sh-pop)" }}>
              <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { h()?.applyStyle({ href: normalizeUrl(linkUrl) }); setLinkOpen(false); } else if (e.key === "Escape") setLinkOpen(false); }}
                placeholder="https://…" className="flex-1 h-[24px] px-2 rounded-md border border-line bg-paper text-[12px] text-ink outline-none" />
              <button className="h-[24px] px-2 rounded-md text-[11px] font-bold text-accent bg-accentsoft" onClick={() => { h()?.applyStyle({ href: normalizeUrl(linkUrl) }); setLinkOpen(false); }}>적용</button>
            </div>
          )}
        </div>
        {/* 삽입 그룹 — 오른쪽 */}
        <span className="flex-1" />
        <button className="h-7 px-2 rounded-md text-[12px] font-semibold text-inksoft hover:bg-paper hover:text-ink flex items-center gap-1.5" title="이미지 삽입" onClick={insertImage}><IcImage size={14} /> 이미지</button>
        <button className="h-7 px-2 rounded-md text-[12px] font-semibold text-inksoft hover:bg-paper hover:text-ink flex items-center gap-1.5" title="표 삽입" onClick={insertTable}><IcTable size={14} /> 표</button>
      </div>

      {/* ── 블록 스택 ── */}
      <div ref={contentRef} className="relative" style={{ minHeight }} onPointerDownCapture={(e) => {
        // 빈 곳 클릭 → 마지막 텍스트 블록에 포커스
        if (e.target === contentRef.current) {
          const last = [...blocks].reverse().find((b) => b.kind === "text");
          if (last) { setFocusedId(last.id); handles.current.get(last.id)?.focus(); }
        }
      }}>
        {isEmpty && (
          <div className="absolute left-3 top-2 text-[13px] text-inkfaint pointer-events-none select-none">{placeholder}</div>
        )}
        {blocks.map((b) => (
          <div
            key={b.id}
            data-eb-wrap={b.id}
            className={`group relative ${focusedId === b.id && b.kind !== "text" ? "ring-1 ring-accentline rounded-md" : ""}`}
            onPointerDown={() => setFocusedId(b.id)}
          >
            {b.kind === "text" ? (
              <EmbedTextBlock
                block={b}
                ref={(inst) => { if (inst) handles.current.set(b.id, inst); else handles.current.delete(b.id); }}
                onChange={updateBlock}
                onActive={(id, f) => { setFocusedId(id); setFmt(f); }}
              />
            ) : b.kind === "image" ? (
              <EmbedImageBlock src={b.src} />
            ) : (
              <EmbedTableBlock
                block={b}
                active={focusedId === b.id}
                onChange={updateBlock}
                onActivate={() => setFocusedId(b.id)}
              />
            )}
            {/* 블록 삭제 (텍스트가 하나뿐이면 숨김) */}
            {!(b.kind === "text" && blocks.length === 1) && (
              <button
                title="블록 삭제"
                onClick={() => removeBlock(b.id)}
                className="absolute -right-1 -top-1 w-5 h-5 rounded-full bg-surface border border-line text-inksoft opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[11px] hover:text-[color:var(--cat-red)] z-10"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

// table-king cells → 내보내기가 읽는 형태는 이미 exportHwpx가 처리하므로 별도 변환 불필요.
export { tableDataToRows };
