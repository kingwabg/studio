// TextContent.tsx — 캔버스 텍스트 블록: 편집(useRichText 훅) + 읽기(RichRead) +
// auto-width/height (CanvasBlock에서 분할 — 계획 3단계).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import { type Block, TEXT_DEFAULTS, blockRuns, padOf, showingHint } from "../document/model";
import {
  RichRead,
  ScriptText,
  TEXT_BORDER,
  TEXT_SURFACE,
  measureNaturalWidthPx,
  offsetFromPoint,
  selectionEndpointRects,
  setSelectionRange,
  textStyle,
  useRichText,
} from "../richtext";
import { ensureFont, fontByKey, useFontStore } from "../document/fonts";
import { SCALE, mmToPx } from "./geometry";
import { useCanvasStore } from "./store";
import { InlineToolbar, type InlineSel } from "./InlineToolbar";
type SelectionEdge = "start" | "end";

type TextSelectionHandlesProps = {
  sel: InlineSel;
  editorRef: { current: HTMLDivElement | null };
};

function TextSelectionHandles({ sel, editorRef }: TextSelectionHandlesProps) {
  const [points, setPoints] = useState<{ start: DOMRect; end: DOMRect } | null>(null);
  const dragRef = useRef<{ edge: SelectionEdge; fixed: number } | null>(null);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root || !sel.isRange) {
      setPoints(null);
      return;
    }
    const update = () => setPoints(selectionEndpointRects(root, sel.offs[0], sel.offs[1]));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editorRef, sel.isRange, sel.offs[0], sel.offs[1]]);

  const startDrag = (edge: SelectionEdge, event: RPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const root = editorRef.current;
    if (!root) return;
    const [start, end] = sel.offs;
    dragRef.current = { edge, fixed: edge === "start" ? end : start };
    root.focus({ preventScroll: true });
    const previousUserSelect = document.body.style.userSelect;

    const stop = () => {
      dragRef.current = null;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const currentRoot = editorRef.current;
      const drag = dragRef.current;
      if (!currentRoot || !drag) return;
      const next = offsetFromPoint(currentRoot, moveEvent.clientX, moveEvent.clientY);
      if (next == null) return;
      const range = drag.edge === "start"
        ? (next <= drag.fixed ? [next, drag.fixed] : [drag.fixed, next])
        : (next >= drag.fixed ? [drag.fixed, next] : [next, drag.fixed]);
      setSelectionRange(currentRoot, range[0], range[1]);
    };

    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  if (!points) return null;
  const handle = (edge: SelectionEdge, rect: DOMRect) => (
    <button
      type="button"
      aria-label={edge === "start" ? "선택 시작점 조절" : "선택 끝점 조절"}
      title={edge === "start" ? "선택 시작점" : "선택 끝점"}
      onPointerDown={(event) => startDrag(edge, event)}
      style={{
        position: "fixed",
        left: rect.left - 6,
        top: rect.bottom - 6,
        width: 12,
        height: 12,
        padding: 0,
        borderRadius: "999px",
        border: "2px solid #FFFFFF",
        background: "#256EF4",
        boxShadow: "0 0 0 1px #256EF4, 0 2px 8px rgba(37,110,244,0.35)",
        cursor: "ew-resize",
        zIndex: 1000,
      }}
    />
  );

  return createPortal(
    <>
      {handle("start", points.start)}
      {handle("end", points.end)}
    </>,
    document.body,
  );
}
export function TextContent({
  block,
  editing,
  initialCaretPoint,
  onDoneEditing,
}: {
  block: Block;
  editing: boolean;
  initialCaretPoint: { x: number; y: number } | null;
  onDoneEditing: () => void;
}) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const setRichText = useCanvasStore((s) => s.setRichText);
  const pageW = useCanvasStore((s) => s.doc.page.w);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<InlineSel | null>(null);
  // 안쪽 여백(mm→px) — auto-width/height 계산에 쓴다(블록폭 = 글자폭 + 2·여백).
  const pad = padOf(block);
  const padXpx = mmToPx(pad.x);
  const padYpx = mmToPx(pad.y);

  const fontKey = fontByKey(block.font).key;
  useFontStore((s) => s.spacing[fontKey]); // 캘리브레이션 완료 리렌더 트리거
  useEffect(() => {
    void ensureFont(fontKey);
  }, [fontKey]);

  // 편집 중 높이 동기화 — contentEditable 자연 높이(패딩 포함)를 block.h로.
  // 0.1mm 반올림 + dead-band 0.25mm: 이전의 "정수 mm 올림 + 1mm dead-band"는 h를 최대
  // ~2mm 부풀려 중심선(y+h/2)이 시각 중앙보다 ~1mm 아래로 처졌다(정렬선 어긋남의 원인).
  const syncEditH = () => {
    const el = rt.ref.current;
    if (!el) return;
    const needMm = Math.max(1, Math.round((el.offsetHeight / SCALE) * 10) / 10);
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.h ?? 0) - needMm) >= 0.25) updateBlock(block.id, { h: needMm });
  };

  // 편집 배선 공유 훅 (richtext/useRichText — 임베드 에디터와 동일 코어, 계획 2단계).
  // 캔버스 특유: 커밋=스토어 반영+auto-height, 서식바 포커스 시 선택 유지, 범위 선택만 서식바.
  const rt = useRichText({
    getBase: () => block,
    onCommit: (runs, aligns, lists) => {
      setRichText(block.id, runs, aligns, lists);
      syncEditH();
    },
    onSelection: (st) => {
      if (!st || !st.isRange) {
        setSel(null);
        return;
      }
      setSel(st);
    },
    shouldSkipSelection: () => !!toolbarRef.current?.contains(document.activeElement),
  });

  // 편집 진입 — 시드 + 캐럿(클릭 지점, 없으면 끝) + 미니 히스토리 초기화 (editing 토글에만)
  useEffect(() => {
    if (!editing) {
      setSel(null);
      rt.clearSel();
      return;
    }
    rt.seed(blockRuns(block), block.paraAligns, block.paraLists, initialCaretPoint ?? "end");
    syncEditH();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 편집 중 선택 변화 → 서식바 위치·활성 상태 갱신 (구간 선택일 때만 표시)
  useEffect(() => {
    if (!editing) return;
    const onSelChange = rt.handleSelectionChange;
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, block]);

  // auto-height (읽기 모드) — 내용 자연 높이를 관찰해 block.h로. 편집 중엔 syncEditH가 담당.
  const sizerRef = useRef<HTMLDivElement>(null);
  // 전각 보정 spacing 맵 — 폰트 캘리브레이션 완료 시 갱신돼 폭 재측정 트리거
  const spacing = useFontStore((s) => s.spacing);
  useEffect(() => {
    if (editing) return;
    const el = sizerRef.current;
    if (!el) return;
    const sync = () => {
      // syncEditH와 같은 규칙(0.1mm 반올림 + 0.25mm dead-band) — 두 경로의 h가 달라지면 안 됨
      const needMm = Math.max(1, Math.round((el.offsetHeight / SCALE) * 10) / 10);
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (cur && Math.abs((cur.h ?? 0) - needMm) >= 0.25) updateBlock(block.id, { h: needMm });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, editing, `${block.text}|${block.w}|${block.fontSize}|${block.bold}|${block.italic}|${block.font}|${block.padY}|${(block.runs ?? []).length}|${block.hint}|${block.hintOn}`]);

  // auto-width — canvas로 잰 자연 폭 + 좌우 패딩으로 박스 폭을 글자에 맞춘다(캔바식).
  // 숨은 DOM 사이저가 없어졌으므로 ResizeObserver 대신 canvas 측정. 지면 밖으로는 못 나감.
  useEffect(() => {
    if (editing || block.manualW) return;
    const naturalPx = measureNaturalWidthPx(block, spacing);
    const needMm = Math.min(pageW - block.x, Math.max(20, Math.ceil((naturalPx + padXpx * 2) / SCALE) + 1));
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.w ?? 0) - needMm) >= 1) updateBlock(block.id, { w: needMm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.manualW, block.x, pageW, editing, spacing, padXpx, `${block.text}|${block.fontSize}|${block.bold}|${block.italic}|${block.font}|${(block.runs ?? []).length}|${block.hint}|${block.hintOn}`]);

  const { setNodeRef, isOver } = useDroppable({
    id: `textdrop:${block.id}`,
    data: { kind: "textblock", blockId: block.id },
  });

  if (editing)
    return (
      <>
        <div
          key="editor"
          {...rt.editableProps}
          data-text-click-zone={block.id}
          data-text-hitbox={block.id}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onBlur={(e) => {
            // 서식바로 포커스가 옮겨간 blur는 편집 종료가 아님 (폰트 드롭다운 등)
            if (toolbarRef.current?.contains(e.relatedTarget as Node | null)) return;
            onDoneEditing();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onDoneEditing();
              return;
            }
            rt.editableProps.onKeyDown(e); // Ctrl+Z/Y/B/I/U·Enter 분할은 훅 공통
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...textStyle(block), whiteSpace: "pre-wrap", minHeight: "1em", backgroundColor: TEXT_SURFACE, borderColor: TEXT_BORDER }}
          className="w-full leading-snug bg-white outline-none border-0 cursor-text"
        />
        {sel && <TextSelectionHandles sel={sel} editorRef={rt.ref} />}
        {sel &&
          createPortal(
            <InlineToolbar
              sel={sel}
              toolbarRef={toolbarRef}
              onApply={rt.applyStyle}
              onApplyAlign={rt.applyAlign}
              onApplyList={rt.applyList}
              defaults={{
                bold: block.bold ?? TEXT_DEFAULTS.bold,
                italic: block.italic ?? TEXT_DEFAULTS.italic,
                underline: block.underline ?? TEXT_DEFAULTS.underline,
                strike: block.strike ?? TEXT_DEFAULTS.strike,
              }}
            />,
            document.body
          )}
      </>
    );


  // 안내문(placeholder) 표시 여부 — 비었고 토글 켜졌을 때 회색 안내문을 내용 대신 렌더.
  // 사이저도 안내문 기준으로 재므로 빈 블록이 안내문 크기만큼 자리를 차지한다.
  const hinting = showingHint(block);
  return (
    <div
      key="reader"
      ref={setNodeRef}
      data-text-click-zone={block.id}
      style={{ ...textStyle(block) }}
      className={`w-full leading-snug ${
        isOver ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2" : ""
      }`}
    >
      {/* 텍스트는 이 사이저 하나뿐 — 폭은 canvas로 재므로 숨은 복사본이 없다(DOM에 텍스트 1개) */}
      <div
        ref={sizerRef}
        data-text-hitbox={block.id}
        style={{
          display: "inline-block",
          maxWidth: "100%",
          // ⚠ 문단별 정렬이 있으면 전체 폭 — 밀착(수축) 폭에서는 text-align의 기준이
          // "가장 긴 줄"뿐이라 화면(블록 폭) 기준 정렬이 안 보인다. 편집 모드(w-full)와
          // 같은 기준 폭을 줘야 편집=읽기 정렬이 일치한다. 정렬 없으면 밀착 유지.
          ...(block.paraAligns?.some((a) => a != null) || (block.align && block.align !== "left")
            ? { width: "100%" }
            : {}),
          whiteSpace: "pre-wrap",
          backgroundColor: TEXT_SURFACE,
          borderColor: TEXT_BORDER,
        }}
      >
        {hinting ? (
          <span style={{ color: "var(--inkfaint)" }}>
            <ScriptText text={block.hint ?? ""} />
          </span>
        ) : (
          <RichRead block={block} />
        )}
      </div>
    </div>
  );
}
