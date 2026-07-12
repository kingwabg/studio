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
  type ReactNode,
} from "react";

// [A4 룩 2026-07-13] 리본+A4 페이지 프레젠테이션 래퍼. 모듈 레벨이라 참조가 안정적 →
// contentEditable 리마운트 없음. a4=false면 그대로 통과(유연한 임베드 유지).
function EditorPage({ a4, children }: { a4: boolean; children: ReactNode }) {
  if (!a4) return <>{children}</>;
  return (
    <div className="overflow-y-auto bg-canvas px-6 py-7 flex justify-center" style={{ maxHeight: 640 }}>
      <div
        className="bg-surface shrink-0 w-full"
        style={{ maxWidth: 794, minHeight: 1123, padding: "76px 84px", boxShadow: "0 2px 22px rgba(16,24,40,.14)" }}
      >
        {children}
      </div>
    </div>
  );
}
import {
  type Block,
  type ParaListType,
  type TableKingData,
  type TextAlign,
  type TextRun,
  normalizeRuns,
  runsToText,
} from "../document/model";
import { normalizeUrl, placeCaretEnd, useRichText } from "../richtext";
import { DEFAULT_FONT, ensureFont } from "../document/fonts";
import { getAssetUrl, putAsset } from "../document/assets";
import { SCALE } from "../canvas/geometry";
import { IcImage, IcTable } from "../../ui/icons";
import { TableKingBlock, makeTableKingData, tableDataToRows } from "../../table-king/TableKingBlock.jsx";
// [레거시 제거 재배선 2026-07-13] 예전엔 DocumentStudio/CanvasBlock이 이 CSS를 전역 로드해줬으나
// 그것들을 지우면서 고아가 됨 → 임베드 표 스타일 유지를 위해 여기서 직접 로드.
import "../../table-king/table-king.css";

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
  /** true면 리본 + A4 페이지 룩(문서 에디터). 기본 false = 유연한 임베드(폼에 붙는 흐름형). */
  a4?: boolean;
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
  const baseRef = useRef<Block>({ id: block.id, type: "text", x: 0, y: 0, w: 0, h: 0, text: "" } as Block);

  // 편집 배선 공유 훅 (richtext/useRichText — 캔버스 TextContent와 동일 코어, 계획 2단계).
  // 임베드 특유: 커밋=로컬 blocks 갱신, 선택 통지=상단 고정 툴바 활성 상태(onActive).
  const rt = useRichText({
    getBase: () => baseRef.current,
    onCommit: (runs, aligns, lists) =>
      onChange({ id: block.id, kind: "text", runs: normalizeRuns(runs), paraAligns: aligns, paraLists: lists }),
    onSelection: (st) => {
      if (!st) return; // 에디터 밖 — 마지막 상태 유지 (다중 블록에서 서로 안 지움)
      onActive(block.id, {
        bold: st.bold, italic: st.italic, underline: st.underline, strike: st.strike,
        align: st.align, list: st.list, href: st.href,
      });
    },
  });

  useEffect(() => {
    void ensureFont(DEFAULT_FONT);
    rt.seed(block.runs.length ? block.runs : [{ text: "" }], block.paraAligns, block.paraLists);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSel = rt.handleSelectionChange;
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    applyStyle: rt.applyStyle,
    applyAlign: rt.applyAlign,
    applyList: rt.applyList,
    undo: rt.undo,
    redo: rt.redo,
    focus: () => rt.ref.current?.focus(),
  }));

  return (
    <div
      {...rt.editableProps}
      data-eb={block.id}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      onFocus={() => {
        const el = rt.ref.current;
        if (el && !(el.textContent ?? "").length && !el.querySelector("[data-para]")) placeCaretEnd(el);
      }}
      onClick={(e) => {
        // Ctrl+클릭 → 링크 열기 (편집 중에도)
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
  { placeholder = "내용을 입력하세요…", minHeight = 220, a4 = false, className, onChange },
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
    <div className={`border border-line rounded-xl overflow-hidden ${a4 ? "bg-canvas" : "bg-surface"} ${className ?? ""}`}>
      {/* ── 고정 툴바(리본) ── */}
      <div className={`flex items-center gap-px flex-wrap px-2 py-1.5 border-b border-line ${a4 ? "bg-surface" : "bg-paper/60"}`}>
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

      {/* ── 블록 스택 (a4면 A4 페이지 안에) ── */}
      <EditorPage a4={a4}>
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
      </EditorPage>
    </div>
  );
});

// table-king cells → 내보내기가 읽는 형태는 이미 exportHwpx가 처리하므로 별도 변환 불필요.
export { tableDataToRows };
