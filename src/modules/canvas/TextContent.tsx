// TextContent.tsx — 캔버스 텍스트 블록: 편집(useRichText 훅) + 읽기(RichRead) +
// auto-width/height (CanvasBlock에서 분할 — 계획 3단계).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import { type Block, TEXT_DEFAULTS, blockRuns, padOf, showingHint } from "../document/model";
import {
  RichRead,
  ScriptText,
  TEXT_BORDER,
  TEXT_SURFACE,
  measureNaturalWidthPx,
  textStyle,
  useRichText,
} from "../richtext";
import { ensureFont, fontByKey, useFontStore } from "../document/fonts";
import { SCALE, mmToPx } from "./geometry";
import { useCanvasStore } from "./store";
import { InlineToolbar, type InlineSel } from "./InlineToolbar";
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

  // 편집 중 높이 동기화 — contentEditable 자연 높이(패딩 포함)를 block.h로
  const syncEditH = () => {
    const el = rt.ref.current;
    if (!el) return;
    const needMm = Math.max(1, Math.ceil(el.offsetHeight / SCALE));
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
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
      const needMm = Math.max(1, Math.ceil(el.offsetHeight / SCALE));
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
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
          ...(block.paraAligns?.some((a) => a != null) ? { width: "100%" } : {}),
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
