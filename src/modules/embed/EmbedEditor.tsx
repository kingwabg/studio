// EmbedEditor.tsx — 판매용 임베드 리치텍스트 에디터 (작은 박스 에디터).
//
// 문서 에디터(캔버스)와 다른 점:
//  · A4 지면·mm 좌표·Zustand 캔버스 스토어 없음 — 어떤 박스에든 들어가는 독립 컴포넌트
//  · 항상 편집 상태 (읽기/편집 토글 없음) — 클래식 에디터 UX
//  · 고정 툴바(상단, 기본 기능만): 굵게·기울임·밑줄·취소선·크기·색·형광펜·정렬·목록·링크·실행취소
//  · 진실은 runs(TextRun[]) + paraAligns + paraLists — 캔버스와 같은 모델이라
//    HWPX 내보내기(exportHwpx)를 그대로 태울 수 있다 (셀링포인트).
//
// 편집 코어(seedEditable/domToRuns/오프셋 워커/문단 파생)는 CanvasBlock에서 검증된
// 구현을 import — 캔버스와 임베드가 한 코어를 공유한다(수정도 한 곳).
// TODO(패키징 단계): 코어를 src/modules/richtext/로 이동하고 양쪽이 참조하게 정리.
import { useEffect, useRef, useState } from "react";
import {
  type Block,
  type ParaListType,
  type TextAlign,
  type TextRun,
  TEXT_DEFAULTS,
  applyRunStyle,
  blockRuns,
  normalizeRuns,
  rangeRuns,
  runsToText,
  spliceRuns,
} from "../document/model";
import {
  LINK_COLOR,
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

export interface EmbedValue {
  runs: TextRun[];
  paraAligns: (TextAlign | null)[];
  paraLists: (ParaListType | null)[];
  text: string;
}

export interface EmbedEditorProps {
  initialRuns?: TextRun[];
  placeholder?: string;
  fontSize?: number; // pt (기본 10.5)
  minHeight?: number; // px (기본 160)
  onChange?: (v: EmbedValue) => void;
  className?: string;
}

const COLORS = ["#1A2233", "#D64550", "#2B5CE6", "#3B9B6B"];
const HIGHLIGHTS = ["#FDF3B4", "#DBEAFE", ""];

// 임베드의 서식 기본값 컨테이너 — 캔버스 Block과 같은 형태(코어 함수들이 이걸 읽는다)
function makeBaseBlock(fontSize: number): Block {
  return { id: "embed", type: "text", x: 0, y: 0, w: 0, h: 0, text: "", fontSize } as Block;
}

export function EmbedEditor({
  initialRuns,
  placeholder = "내용을 입력하세요…",
  fontSize = 10.5,
  minHeight = 160,
  onChange,
  className,
}: EmbedEditorProps) {
  const ceRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<Block>(makeBaseBlock(fontSize));
  const composingRef = useRef(false);
  const selRef = useRef<[number, number]>([0, 0]); // 마지막 선택(캐럿 포함) — 툴바 적용 대상
  const [active, setActive] = useState<{
    bold: boolean; italic: boolean; underline: boolean; strike: boolean;
    align: TextAlign | undefined; list: ParaListType | null | undefined; href?: string; empty: boolean;
  }>({ bold: false, italic: false, underline: false, strike: false, align: "left", list: null, empty: true });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  // ── 미니 히스토리 (캔버스 TextContent와 같은 규칙: 700ms 버스트 코얼레싱) ──
  type Snap = { runs: TextRun[]; caret: number; aligns: (TextAlign | null)[]; lists: (ParaListType | null)[] };
  const histRef = useRef<{ stack: Snap[]; idx: number; lastAt: number }>({ stack: [], idx: -1, lastAt: 0 });
  const caretNow = () => {
    const el = ceRef.current;
    return el ? (selectionOffsets(el)?.[1] ?? (el.textContent ?? "").length) : 0;
  };
  const pushHistory = (runs: TextRun[], caret: number, coalesce: boolean, aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) => {
    const h = histRef.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.idx + 1);
    if (coalesce && h.idx >= 0 && now - h.lastAt < 700) h.stack[h.idx] = { runs, caret, aligns, lists };
    else {
      h.stack.push({ runs, caret, aligns, lists });
      h.idx = h.stack.length - 1;
    }
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
  const undo = () => {
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    h.lastAt = 0;
    applySnap(h.stack[h.idx]);
  };
  const redo = () => {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    h.lastAt = 0;
    applySnap(h.stack[h.idx]);
  };

  const emit = (runs: TextRun[], aligns: (TextAlign | null)[], lists: (ParaListType | null)[]) => {
    onChange?.({ runs: normalizeRuns(runs), paraAligns: aligns, paraLists: lists, text: runsToText(runs) });
  };

  const flush = () => {
    const el = ceRef.current;
    if (!el || composingRef.current) return;
    const runs = domToRuns(el);
    const aligns = paraAlignsFromDom(el);
    const lists = paraListsFromDom(el);
    emit(runs, aligns, lists);
    pushHistory(runs, caretNow(), true, aligns, lists);
    setActive((a) => ({ ...a, empty: !runsToText(runs).trim() }));
  };

  // 초기 시드 + 폰트 로드 + 히스토리 바닥
  useEffect(() => {
    void ensureFont(DEFAULT_FONT);
    const el = ceRef.current;
    if (!el) return;
    const runs = initialRuns?.length ? initialRuns : [{ text: "" }];
    seedEditable(el, baseRef.current, runs);
    histRef.current = { stack: [{ runs, caret: 0, aligns: [null], lists: [null] }], idx: 0, lastAt: 0 };
    setActive((a) => ({ ...a, empty: !runsToText(runs).trim() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택 추적 → 툴바 활성 상태 (캔버스 InlineSel 간소판 — 캐럿만 있어도 문단 버튼용으로 저장)
  useEffect(() => {
    const onSel = () => {
      const el = ceRef.current;
      if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
      const offs = selectionOffsets(el);
      if (!offs) return;
      selRef.current = offs;
      const runs = domToRuns(el);
      const rr = offs[0] === offs[1] ? [] : rangeRuns(runs, offs[0], offs[1]);
      const all = (pred: (r: TextRun) => boolean) => rr.length > 0 && rr.every(pred);
      const text = runsToText(runs);
      const pFrom = paraIdxAt(text, offs[0]);
      const pTo = paraIdxAt(text, offs[1]);
      const aligns = paraAlignsFromDom(el);
      const lists = paraListsFromDom(el);
      const aInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => aligns[pFrom + i] ?? "left");
      const lInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => lists[pFrom + i] ?? null);
      const same = <T,>(arr: T[]) => (arr.every((v) => v === arr[0]) ? arr[0] : undefined);
      const hrefs = rr.map((r) => r.href);
      setActive((a) => ({
        ...a,
        bold: all((r) => r.bold === true),
        italic: all((r) => r.italic === true),
        underline: all((r) => r.underline === true),
        strike: all((r) => r.strike === true),
        align: same(aInSel),
        list: same(lInSel),
        href: hrefs.length && hrefs.every((h) => h === hrefs[0]) ? hrefs[0] : undefined,
      }));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // ── 서식 적용 (선택 구간) ──
  const applyStyle = (patch: Partial<Omit<TextRun, "text">>) => {
    const el = ceRef.current;
    const [a, b] = selRef.current;
    if (!el || a === b) return;
    const next = applyRunStyle(domToRuns(el), a, b, patch);
    const aligns = paraAlignsFromDom(el);
    const lists = paraListsFromDom(el);
    seedEditable(el, baseRef.current, next, aligns, lists);
    emit(next, aligns, lists);
    pushHistory(next, b, false, aligns, lists);
    el.focus();
    setSelectionRange(el, a, b);
  };

  // ── 문단 속성 적용 (캐럿만 있어도 동작) ──
  const applyPara = (mut: (aligns: (TextAlign | null)[], lists: (ParaListType | null)[], pFrom: number, pTo: number) => void) => {
    const el = ceRef.current;
    if (!el) return;
    const [a, b] = selRef.current;
    const runs = domToRuns(el);
    const text = runsToText(runs);
    const pFrom = paraIdxAt(text, a);
    const pTo = paraIdxAt(text, b);
    const total = text.split("\n").length;
    const aligns: (TextAlign | null)[] = Array.from({ length: total }, (_, i) => paraAlignsFromDom(el)[i] ?? null);
    const lists: (ParaListType | null)[] = Array.from({ length: total }, (_, i) => paraListsFromDom(el)[i] ?? null);
    mut(aligns, lists, pFrom, Math.min(pTo, total - 1));
    seedEditable(el, baseRef.current, runs, aligns, lists);
    emit(runs, aligns, lists);
    pushHistory(runs, b, false, aligns, lists);
    el.focus();
    setSelectionRange(el, a, b);
  };
  const applyAlign = (v: TextAlign) => applyPara((aligns, _l, f, t) => { for (let i = f; i <= t; i++) aligns[i] = v; });
  const applyList = (v: ParaListType) =>
    applyPara((_a, lists, f, t) => {
      const allSame = Array.from({ length: t - f + 1 }, (_, k) => lists[f + k]).every((x) => x === v);
      for (let i = f; i <= t; i++) lists[i] = allSame ? null : v;
    });

  const btn = (on: boolean) =>
    `w-7 h-7 rounded-md flex items-center justify-center text-[13px] transition-colors ${
      on ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
    }`;

  return (
    <div className={`border border-line rounded-xl bg-surface overflow-hidden ${className ?? ""}`}>
      {/* ── 고정 툴바 (기본 기능만) ── */}
      <div className="flex items-center gap-px flex-wrap px-2 py-1.5 border-b border-line bg-paper/60">
        <button className={`${btn(false)} font-bold`} title="실행취소 (Ctrl+Z)" onClick={undo}>↶</button>
        <button className={`${btn(false)} font-bold`} title="재실행 (Ctrl+Y)" onClick={redo}>↷</button>
        <span className="w-px h-4 bg-line mx-1" />
        <button className={`${btn(active.bold)} font-extrabold`} title="굵게" onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ bold: active.bold ? undefined : true })}>가</button>
        <button className={`${btn(active.italic)} italic`} title="기울임" onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ italic: active.italic ? undefined : true })}>가</button>
        <button className={`${btn(active.underline)} underline underline-offset-2`} title="밑줄" onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ underline: active.underline ? undefined : true })}>가</button>
        <button className={`${btn(active.strike)} line-through`} title="취소선" onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ strike: active.strike ? undefined : true })}>가</button>
        <span className="w-px h-4 bg-line mx-1" />
        {COLORS.map((c) => (
          <button key={c} title={`글자색 ${c}`} onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ color: c })}
            className="w-[16px] h-[16px] rounded-full mx-[2px] hover:scale-110 transition-transform"
            style={{ backgroundColor: c, boxShadow: "0 0 0 1px rgba(16,24,40,.15)" }} />
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {HIGHLIGHTS.map((c) => (
          <button key={c || "none"} title={c ? `형광펜 ${c}` : "형광펜 지우기"} onPointerDown={(e) => e.preventDefault()} onClick={() => applyStyle({ bg: c || undefined })}
            className="w-[16px] h-[16px] rounded-[4px] mx-[2px] hover:scale-110 transition-transform flex items-center justify-center text-[8px] text-inkfaint"
            style={{ backgroundColor: c || "var(--surface)", border: "1px solid var(--line)" }}>{!c && "✕"}</button>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {(["left", "center", "right"] as TextAlign[]).map((v, i) => (
          <button key={v} className={`${btn(active.align === v)} text-[11px] font-bold`} title={`${["왼쪽", "가운데", "오른쪽"][i]} 정렬`} onPointerDown={(e) => e.preventDefault()} onClick={() => applyAlign(v)}>
            {["좌", "중", "우"][i]}
          </button>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        <button className={btn(active.list === "bullet")} title="글머리 기호" onPointerDown={(e) => e.preventDefault()} onClick={() => applyList("bullet")}>•</button>
        <button className={`${btn(active.list === "num")} text-[10px] font-bold`} title="번호 목록" onPointerDown={(e) => e.preventDefault()} onClick={() => applyList("num")}>1.</button>
        <span className="w-px h-4 bg-line mx-1" />
        <div className="relative">
          <button className={btn(!!active.href)} title="링크" onPointerDown={(e) => e.preventDefault()} onClick={() => { setLinkUrl(active.href ?? ""); setLinkOpen((v) => !v); }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5l3-3M7 4.2l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M9 11.8l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          {linkOpen && (
            <div className="absolute left-0 top-[32px] w-[220px] rounded-lg bg-surface border border-line p-1.5 z-20 flex items-center gap-1.5" style={{ boxShadow: "var(--sh-pop)" }}>
              <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { applyStyle({ href: normalizeUrl(linkUrl) }); setLinkOpen(false); } else if (e.key === "Escape") setLinkOpen(false); }}
                placeholder="https://…" className="flex-1 h-[24px] px-2 rounded-md border border-line bg-paper text-[12px] text-ink outline-none" />
              <button className="h-[24px] px-2 rounded-md text-[11px] font-bold text-accent bg-accentsoft" onClick={() => { applyStyle({ href: normalizeUrl(linkUrl) }); setLinkOpen(false); }}>적용</button>
            </div>
          )}
        </div>
      </div>

      {/* ── 편집 영역 (항상 편집 상태) ── */}
      <div className="relative">
        {active.empty && (
          <div className="absolute left-3 top-2.5 text-[13px] text-inkfaint pointer-events-none select-none">{placeholder}</div>
        )}
        <div
          ref={ceRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={flush}
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
          onCut={(e) => {
            const el = ceRef.current;
            const offs = el ? selectionOffsets(el) : null;
            if (!el || !offs || offs[0] === offs[1]) return;
            e.preventDefault();
            const cur = domToRuns(el);
            const rr = rangeRuns(cur, offs[0], offs[1]);
            e.clipboardData.setData("text/html", runsToClipboardHtml(rr, baseRef.current));
            e.clipboardData.setData("text/plain", runsToText(rr));
            const next = spliceRuns(cur, offs[0], offs[1], []);
            const curText = runsToText(cur);
            const aligns = spliceAligns(paraAlignsFromDom(el), curText, offs[0], offs[1], "");
            const lists = spliceAligns(paraListsFromDom(el), curText, offs[0], offs[1], "");
            seedEditable(el, baseRef.current, next, aligns, lists);
            emit(next, aligns, lists);
            pushHistory(next, offs[0], false, aligns, lists);
            el.focus();
            setSelectionRange(el, offs[0], offs[0]);
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
                pushHistory(next, caret, false, aligns, lists);
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
              if (k === "b") { e.preventDefault(); applyStyle({ bold: active.bold ? undefined : true }); return; }
              if (k === "i") { e.preventDefault(); applyStyle({ italic: active.italic ? undefined : true }); return; }
              if (k === "u") { e.preventDefault(); applyStyle({ underline: active.underline ? undefined : true }); return; }
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
            // Ctrl+클릭 → 링크 열기 (편집 중에도)
            if (!(e.ctrlKey || e.metaKey)) return;
            const t = e.target as HTMLElement;
            const href = t.closest?.("span[data-href]")?.getAttribute("data-href");
            if (href) { e.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
          }}
          className="px-3 py-2.5 outline-none text-[13.5px] leading-snug text-ink"
          style={{ minHeight, whiteSpace: "pre-wrap", caretColor: LINK_COLOR }}
          onFocus={() => {
            const el = ceRef.current;
            if (el && !(el.textContent ?? "").length && !el.querySelector("[data-para]")) placeCaretEnd(el);
          }}
        />
      </div>
    </div>
  );
}

// 임베드 값 → 캔버스 문서 (HWPX 내보내기용 어댑터) — A4 본문(flow)로 변환
export function embedValueToDoc(v: EmbedValue, title = "임베드 문서") {
  return {
    id: "embed_export",
    title,
    page: { w: 210, h: 297 },
    blocks: [
      {
        id: "embed_flow",
        type: "text" as const,
        flow: true,
        x: 20,
        y: 20,
        w: 170,
        h: 40,
        text: v.text,
        runs: v.runs,
        paraAligns: v.paraAligns.some((a) => a != null) ? v.paraAligns : undefined,
        paraLists: v.paraLists.some((l) => l != null) ? v.paraLists : undefined,
        fontSize: TEXT_DEFAULTS.fontSize,
      },
    ],
  };
}
