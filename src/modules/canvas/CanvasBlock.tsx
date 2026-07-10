// CanvasBlock.tsx — 지면 위 블록 하나.
//  - dnd-kit useDraggable로 이동, 클릭으로 선택, 더블클릭으로 인라인 텍스트 편집
//  - 텍스트: 선택 시 가로 폭 조절 핸들
//  - 표: 기존 앱에서 이관한 table-king 엔진(경계 드래그·병합·셀 스타일·실행취소).
//    크기는 스냅샷에서 파생(setTableData가 w/h 동기화), 이동은 그립 핸들로만
//    (표 내부 클릭은 셀 선택이어야 하므로). SCALE=3.7795라 표 px = 화면 px = mm×SCALE.
//  - 데이터 병합: 텍스트/표는 알약 드롭 대상. 저장의 진실은 {{열이름}} 토큰,
//    화면은 칩 또는 미리보기 값으로 렌더 (하이브리드 전략)
import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  type Block,
  type ParaListType,
  type TableKingData,
  type TextAlign,
  type TextRun,
  TEXT_DEFAULTS,
  padOf,
  blockRuns,
  applyRunStyle,
  rangeRuns,
  spliceRuns,
  normalizeRuns,
  runsToText,
  showingHint,
} from "../document/model";
import { CATEGORY_LABEL, FONTS, countHangul, ensureFont, fontByKey, fontCss, splitByHangul, useFontStore } from "../document/fonts";
import { getAssetUrl, putAsset } from "../document/assets";
import { SCALE, mmToPx, pxToMm } from "./geometry";
import { useCanvasStore } from "./store";
import { useFollowStore } from "./snap";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { IcGrip, IcCopy, IcImage, IcTrash } from "../../ui/icons";
import { TableKingBlock, makeTableKingData, tableDataToRows } from "../../table-king/TableKingBlock.jsx";
import "../../table-king/table-king.css";

const MIN_W = 12; // mm
const MIN_H = 8; // mm
const PAGE_MARGIN_MM = 20; // A4 안전 여백 기준
const LEGACY_TEXT_INK = "#1A2233";
const TEXT_INK = "#000000";
const TEXT_SURFACE = "#ffffff";
const TEXT_BORDER = "#98A4BD";
const normalizeTextColor = (color?: string) => (!color || color.toUpperCase() === LEGACY_TEXT_INK ? TEXT_INK : color);
const normalizeTextBorderColor = (color?: string) => (!color || color.toUpperCase() === LEGACY_TEXT_INK ? TEXT_BORDER : color);
const normalizeTextFill = (fill?: string) => (!fill || fill === "transparent" || fill === "rgba(0, 0, 0, 0)" ? TEXT_SURFACE : fill);

// 기존 앱과 같은 table-king 테마 주입 (디자인 토큰 T와 동일 값)
const TK_THEME_VARS = {
  "--tk-ink": "#1A2233",
  "--tk-ink-soft": "#5B6577",
  "--tk-ink-faint": "#98A2B3",
  "--tk-paper": "#F6F7FA",
  "--tk-surface": "#FFFFFF",
  "--tk-line": "#E4E8EF",
  "--tk-line-strong": "#CBD2DE",
  "--tk-accent": "#2B5CE6",
  "--tk-accent-soft": "#EDF2FE",
} as React.CSSProperties;

// ⚠ memo — 마퀴/오버레이 등 CanvasStage의 로컬 상태 변경이 모든 블록(무거운 table-king
// 포함)을 재렌더하지 않게 한다. 스토어는 블록을 불변 갱신(변경 블록만 새 참조)하므로
// block 참조 비교로 충분하고, 선택·팔로우 등 반응 상태는 내부 zustand 구독이 처리한다.
export const CanvasBlock = memo(function CanvasBlock({ block }: { block: Block }) {
  const select = useCanvasStore((s) => s.select);
  const selectGroup = useCanvasStore((s) => s.selectGroup);
  const toggleSelect = useCanvasStore((s) => s.toggleSelect);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const page = useCanvasStore((s) => s.doc.page);
  const duplicateBlock = useCanvasStore((s) => s.duplicateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);
  const setLocked = useCanvasStore((s) => s.setLocked);
  const clearAutoEdit = useCanvasStore((s) => s.clearAutoEdit);
  const autoEdit = useCanvasStore((s) => s.autoEditId === block.id);
  // 다중 선택 — 원시값 셀렉터(무한 리렌더 방지): 이 블록이 선택됐나 / 유일 선택인가
  const selected = useCanvasStore((s) => s.selectedIds.includes(block.id));
  const soleSelected = useCanvasStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === block.id);
  const [editing, setEditing] = useState(false);
  const [textCaretPoint, setTextCaretPoint] = useState<{ x: number; y: number } | null>(null);
  const isTable = block.type === "table";
  const isText = block.type === "text";
  const locked = !!block.locked;
  // 안쪽 여백(px) — 텍스트 박스 크기(block.w/h)는 유지하고, 글자 영역만 안쪽으로 들인다.
  const pad = padOf(block);
  const padPx = { x: mmToPx(pad.x), y: mmToPx(pad.y) };
  const fontSpacing = useFontStore((s) => s.spacing);
  const textFill = isText ? normalizeTextFill(block.fill) : block.fill;
  const textBorderColor = isText ? normalizeTextBorderColor(block.borderColor) : block.borderColor;
  const selectBlockOrGroup = () => (block.groupId ? selectGroup(block.id) : select(block.id));
  const isTextHitTarget = (target: EventTarget | null) => {
    if (!isText || !(target instanceof HTMLElement)) return true;
    const hitbox = target.closest<HTMLElement>("[data-text-hitbox]");
    if (hitbox?.dataset.textHitbox === block.id) return true;
    const zone = target.closest<HTMLElement>("[data-text-click-zone]");
    return zone?.dataset.textClickZone === block.id;
  };

  const textClickPoint = (e: RMouseEvent<HTMLDivElement>) => {
    if (!isText || !(e.target instanceof HTMLElement)) return { x: e.clientX, y: e.clientY };
    const directHitbox = e.target.closest<HTMLElement>("[data-text-hitbox]");
    if (directHitbox?.dataset.textHitbox === block.id) return { x: e.clientX, y: e.clientY };
    const zone = e.target.closest<HTMLElement>("[data-text-click-zone]");
    if (zone?.dataset.textClickZone !== block.id) return { x: e.clientX, y: e.clientY };
    const hitbox = zone.querySelector<HTMLElement>("[data-text-hitbox]");
    if (hitbox?.dataset.textHitbox !== block.id) return { x: e.clientX, y: e.clientY };
    const rect = hitbox.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX, rect.left + 1), Math.max(rect.left + 1, rect.right - 1)),
      y: Math.min(Math.max(e.clientY, rect.top + 1), Math.max(rect.top + 1, rect.bottom - 1)),
    };
  };

  // 텍스트 도구로 방금 생성 → 바로 편집 모드 진입 (커서 깜빡)
  useEffect(() => {
    if (autoEdit) {
      setTextCaretPoint(null);
      setEditing(true);
      clearAutoEdit();
    }
  }, [autoEdit, clearAutoEdit]);

  // 텍스트 편집기는 문서 전체에서 하나만 살아야 한다.
  // 다른 블록이 선택되거나 다중 선택으로 바뀌면 이전 contentEditable을 즉시 닫아
  // document.selectionchange가 마지막 텍스트 블록으로 튀는 현상을 막는다.
  useEffect(() => {
    if (!editing) return;
    if (selected) return;
    setEditing(false);
    setTextCaretPoint(null);
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && cur.type === "text" && !(cur.text ?? "").trim() && !(cur.hintOn && cur.hint))
      removeBlock(block.id);
  }, [block.id, editing, removeBlock, selected]);

  // 다중 선택/그룹 오버레이가 텍스트 위에 있어도 더블클릭은 실제 텍스트 편집으로 넘긴다.
  useEffect(() => {
    const onEditText = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId: string; x: number; y: number }>).detail;
      if (detail?.blockId !== block.id || block.type !== "text" || locked) return;
      setTextCaretPoint({ x: detail.x, y: detail.y });
      setEditing(true);
    };
    window.addEventListener("studio:edit-text-block", onEditText);
    return () => window.removeEventListener("studio:edit-text-block", onEditText);
  }, [block.id, block.type, locked]);

  // 텍스트 편집 중에는 다중 선택/그룹 박스가 입력을 가로채지 않도록 알린다.
  useEffect(() => {
    if (!editing || block.type !== "text") return undefined;
    window.dispatchEvent(new CustomEvent("studio:text-editing-start", { detail: { blockId: block.id } }));
    return () => {
      // dispatchEvent는 boolean을 반환 — 그대로 반환하면 effect cleanup 타입 위반
      window.dispatchEvent(new CustomEvent("studio:text-editing-end", { detail: { blockId: block.id } }));
    };
  }, [block.id, block.type, editing]);
  // 편집 종료 — 내용이 비면(공백뿐이면) 블록을 지운다. 더블클릭 오발/빈 텍스트 정리.
  // 단, 안내문(placeholder)이 켜진 블록은 "비어있는 게 정상"이므로 지우지 않는다.
  const finishEditing = () => {
    setEditing(false);
    setTextCaretPoint(null);
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && cur.type === "text" && !(cur.text ?? "").trim() && !(cur.hintOn && cur.hint))
      removeBlock(block.id);
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
    disabled: editing || locked,
  });

  // 드래그 팔로우: 다른 블록이 드래그 중이고 내가 그 이동 집합(트리 자손·그룹 멤버·
  // 다중 선택)에 속하면 같은 델타로 실시간 따라간다. 집합은 StudioEditor가 1회 계산.
  // ⚠ zustand 셀렉터는 원시값 반환 (무한 리렌더 방지).
  const following = useFollowStore(
    (s) => s.activeId !== null && s.activeId !== block.id && (s.members?.has(block.id) ?? false)
  );
  const followX = useFollowStore((s) => (following ? s.dxPx : 0));
  const followY = useFollowStore((s) => (following ? s.dyPx : 0));

  const textSafeLeft = PAGE_MARGIN_MM;
  const textSafeRight = page.w - PAGE_MARGIN_MM;
  const textMaxWidth = Math.max(MIN_W, textSafeRight - textSafeLeft);
  const textIsMaxWidth = isText && Math.abs(block.x - textSafeLeft) <= 1 && Math.abs(block.w - textMaxWidth) <= 1;

  const compactTextWidth = () => {
    const naturalMm = measureNaturalWidthPx(block, fontSpacing) / SCALE + pad.x * 2;
    const fallbackMm = 36;
    return Math.max(MIN_W, Math.min(textMaxWidth, Math.ceil(naturalMm || fallbackMm)));
  };

  const toggleTextWidth = () => {
    if (block.type !== "text") return;
    if (textIsMaxWidth) {
      const nextW = compactTextWidth();
      updateBlock(block.id, {
        x: Math.max(textSafeLeft, Math.min(Math.round(block.x), Math.round(textSafeRight - nextW))),
        w: nextW,
        manualW: true,
      });
      return;
    }
    updateBlock(block.id, { x: textSafeLeft, w: textMaxWidth, manualW: true });
  };

  const boxPositionTargetX = (mode: "left" | "center" | "right") => {
    const safeLeft = PAGE_MARGIN_MM;
    const safeRight = page.w - PAGE_MARGIN_MM;
    const safeWidth = safeRight - safeLeft;
    const width = Math.min(block.w, safeWidth);
    if (mode === "left") return safeLeft;
    if (mode === "right") return safeRight - width;
    return safeLeft + (safeWidth - width) / 2;
  };

  const setBoxPosition = (mode: "left" | "center" | "right") => {
    const safeLeft = PAGE_MARGIN_MM;
    const safeRight = page.w - PAGE_MARGIN_MM;
    const safeWidth = safeRight - safeLeft;
    const nextW = Math.min(block.w, safeWidth);
    updateBlock(block.id, {
      x: Math.round(boxPositionTargetX(mode)),
      ...(nextW !== block.w ? { w: Math.round(nextW) } : {}),
    });
  };

  const miniBoxPositionClass = (mode: "left" | "center" | "right") => {
    const active = Math.abs(block.x - boxPositionTargetX(mode)) <= 1;
    return `w-[30px] h-[30px] rounded-lg flex items-center justify-center transition-colors ${
      active ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
    }`;
  };

  // 더블클릭 진입. 표: 셀 편집 모드(그전엔 객체 선택=이동). 텍스트: 글자 편집.
  const handleBlockDoubleClick = (e: RMouseEvent<HTMLDivElement>) => {
    if (locked) return;
    if (isTable) {
      setEditing(true); // 표 = 객체 선택 → 더블클릭으로 셀 편집(table-king active)
      return;
    }
    if (block.type !== "text") return;
    if (!isTextHitTarget(e.target)) return;
    setTextCaretPoint(textClickPoint(e));
    setEditing(true);
  };
  const startResize = (e: RPointerEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault();
    const s = { px: e.clientX, py: e.clientY, x: block.x, y: block.y, w: block.w, h: block.h };
    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = pxToMm(ev.clientX - s.px);
      const dy = pxToMm(ev.clientY - s.py);
      let { x, y, w, h } = s;
      if (dir.includes("e")) w = s.w + dx;
      if (dir.includes("s")) h = s.h + dy;
      if (dir.includes("w")) {
        x = s.x + dx;
        w = s.w - dx;
      }
      if (dir.includes("n")) {
        y = s.y + dy;
        h = s.h - dy;
      }
      if (w < MIN_W) {
        if (dir.includes("w")) x = s.x + (s.w - MIN_W);
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes("n")) y = s.y + (s.h - MIN_H);
        h = MIN_H;
      }
      const innerLeft = PAGE_MARGIN_MM;
      const innerTop = PAGE_MARGIN_MM;
      const innerRight = page.w - PAGE_MARGIN_MM;
      const innerBottom = page.h - PAGE_MARGIN_MM;
      if (block.type === "text") {
        // 텍스트: 폭만 조절(높이는 auto). 여백 안쪽에서만 폭이 늘어난다.
        const right = dir.includes("w") ? Math.min(s.x + s.w, innerRight) : innerRight;
        if (dir.includes("w")) {
          x = Math.max(innerLeft, Math.min(x, right - MIN_W));
          w = right - x;
        } else {
          x = Math.max(innerLeft, Math.min(x, innerRight - MIN_W));
          w = Math.min(w, innerRight - x);
        }
        updateBlock(block.id, { x: Math.round(x), w: Math.round(w), manualW: true });
      } else {
        const right = dir.includes("w") ? Math.min(s.x + s.w, innerRight) : innerRight;
        const bottom = dir.includes("n") ? Math.min(s.y + s.h, innerBottom) : innerBottom;
        if (dir.includes("w")) {
          x = Math.max(innerLeft, Math.min(x, right - MIN_W));
          w = right - x;
        } else {
          x = Math.max(innerLeft, Math.min(x, innerRight - MIN_W));
          w = Math.min(w, innerRight - x);
        }
        if (dir.includes("n")) {
          y = Math.max(innerTop, Math.min(y, bottom - MIN_H));
          h = bottom - y;
        } else {
          y = Math.max(innerTop, Math.min(y, innerBottom - MIN_H));
          h = Math.min(h, innerBottom - y);
        }
        updateBlock(block.id, {
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(w),
          h: Math.round(h),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={setNodeRef}
      data-block-id={block.id}
      {...attributes}
      onPointerDown={(e) => {
        if (editing) return;
        if (isText && !isTextHitTarget(e.target)) {
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) select(null);
          return;
        }
        // Ctrl/⌘/Shift+클릭 = 다중 선택 토글, 아니면 그룹/단일 선택
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.stopPropagation();
          toggleSelect(block.id);
          return;
        }
        selectBlockOrGroup();
        // 표 내부 포인터는 셀 선택/경계 드래그 몫 — 블록 이동은 그립 핸들로만. 잠금이면 이동 안 함
        if (!isTable && !locked) listeners?.onPointerDown?.(e);
      }}
      onDoubleClick={handleBlockDoubleClick}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        // 표/텍스트는 내용 DOM의 자연 크기가 선택 박스다. 이미지만 block.h로 고정한다.
        height: isTable || block.type === "text" ? undefined : mmToPx(block.h),
        minHeight: undefined,
        transform: following
          ? `translate3d(${followX}px, ${followY}px, 0)`
          : CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : following ? 19 : selected ? 10 : 1,
        cursor: editing ? "text" : locked ? "default" : isText || isTable ? "default" : "grab",
        touchAction: "none",
      }}
      className={`group/blk rounded-[3px] overflow-visible select-none transition-[outline-color,box-shadow] ${
        isText ? "" : "bg-white"
      } ${
        isText
          ? "" // 텍스트: 테두리·그림자는 아래 실제 박스(inner)에 그린다
          : selected
            ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(43,92,230,0.18)]"
            : "outline outline-1 outline-line hover:outline-2 hover:outline-accent"
      } ${isDragging ? "opacity-95 shadow-[0_8px_24px_rgba(26,34,51,0.18)]" : ""}`}
    >
      <div
        className={
          isText
            ? `rounded-[3px] overflow-hidden transition-[outline-color,box-shadow] ${
                selected
                  ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(43,92,230,0.18)]"
                  : "hover:outline hover:outline-2 hover:outline-accent"
              }`
            : `w-full h-full ${isTable ? "overflow-visible" : "overflow-hidden"}`
        }
        style={{
          borderRadius: block.radius ?? 2,
          background: textFill,
          border: block.borderWidth ? `${block.borderWidth}px solid ${textBorderColor || "#1A2233"}` : undefined,
          borderColor: isText ? textBorderColor : undefined,
          // 텍스트: 글자 편집 DOM의 자연 높이가 곧 선택 박스 높이다.
          ...(isText ? { width: "100%", boxSizing: "border-box" } : {}),
        }}
      >
        {block.type === "text" ? (
          <TextContent block={block} editing={editing} initialCaretPoint={textCaretPoint} onDoneEditing={finishEditing} />
        ) : isTable ? (
          <TableKingContent block={block} active={editing} />
        ) : (
          <ImageContent block={block} locked={locked} />
        )}
      </div>

      {/* 고정 배지 — 클릭하면 해제(그룹이면 그룹 전체). 잠긴 요소는 플로팅바가 없어
          이 배지가 유일한 해제 통로다. */}
      {locked && selected && (
        <button
          title={block.groupId ? "그룹 고정 해제" : "고정 해제"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const all = useCanvasStore.getState().doc.blocks;
            const ids = block.groupId ? all.filter((b) => b.groupId === block.groupId).map((b) => b.id) : [block.id];
            setLocked(ids, false);
          }}
          className="absolute -top-2 -left-2 z-40 w-5 h-5 rounded-md bg-inksoft text-white flex items-center justify-center hover:bg-ink transition-colors"
          style={{ boxShadow: "var(--sh-card)" }}
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {/* 단일 선택 + 미잠금일 때만 편집 어포던스(그립·플로팅 바·핸들). 다중은 outline만 */}
      {soleSelected && !editing && !locked && (
        <>
          {/* 표: 이동 오버레이 — 객체 선택 상태에선 표 위를 덮어 "어디를 끌어도 이동"(move 커서).
              더블클릭으로 셀 편집 진입(오버레이 사라짐). 모서리 리사이즈 핸들은 z-30로 위에 둠. */}
          {isTable && (
            <div
              {...listeners}
              onPointerDown={(e) => {
                selectBlockOrGroup();
                listeners?.onPointerDown?.(e);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              title="드래그하여 이동 · 더블클릭하여 표 편집"
              className="absolute inset-0 z-20"
              style={{ cursor: "move", touchAction: "none" }}
            />
          )}

          {/* 플로팅 액션 바 — 그룹 선택·잠금·복제·삭제 (표는 객체 모드에서 여기로 삭제·복제) */}
          {(
            <div
              className="absolute -top-[58px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
              style={{ boxShadow: "var(--sh-pop)" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* 그룹에 속하면: 그룹 전체 선택(opt-in) — 단일 클릭은 이 블록만 잡는다 */}
              {block.groupId && (
                <button onClick={() => selectGroup(block.id)} title="그룹 전체 선택" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 4h3.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
              )}
              {isText && (
                <>
                  <button type="button" onClick={() => setBoxPosition("left")} title="박스 왼쪽 정렬" className={miniBoxPositionClass("left")}>
                    <MiniBoxPositionIcon mode="left" />
                  </button>
                  <button type="button" onClick={() => setBoxPosition("center")} title="박스 가운데 정렬" className={miniBoxPositionClass("center")}>
                    <MiniBoxPositionIcon mode="center" />
                  </button>
                  <button type="button" onClick={() => setBoxPosition("right")} title="박스 오른쪽 정렬" className={miniBoxPositionClass("right")}>
                    <MiniBoxPositionIcon mode="right" />
                  </button>
                  <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
                </>
              )}
              <button onClick={() => setLocked([block.id], true)} title="잠금" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button onClick={() => duplicateBlock(block.id)} title="복제" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                <IcCopy size={14} />
              </button>
              <button onClick={() => removeBlock(block.id)} title="삭제" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-[color:var(--cat-red-soft)] hover:text-[color:var(--cat-red)] transition-colors">
                <IcTrash size={14} />
              </button>
            </div>
          )}

          {/* 리사이즈 핸들 — 텍스트는 폭만 조절하므로 모서리 4점만 노출한다.
              좌/우 중앙 네모는 폭 자동 확장/접기 전용이다. */}
          {isText && (
            <button
              type="button"
              title={textIsMaxWidth ? "좁히기" : "늘리기"}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleTextWidth();
              }}
              className="absolute z-50 w-[14px] h-[14px] rounded-full border-2 transition-colors"
              style={{
                top: "50%",
                right: -7,
                transform: "translateY(-50%)",
                backgroundColor: "#2B5CE6",
                borderColor: "#FFFFFF",
                boxShadow: "0 0 0 2px #2B5CE6, 0 2px 10px rgba(43,92,230,0.38)",
                cursor: "default",
              }}
            />
          )}
          {/* 모서리 핸들 — 텍스트·표는 4모서리만, 이미지는 8방향. 표는 시각 표식 전용
              (pointer-events:none)이라 모서리에서도 이동 오버레이가 그대로 잡힌다. */}
          {RESIZE_HANDLES.filter((h) => (isText || isTable ? h.dir.length === 2 : true)).map((hdl) => (
            <div
              key={hdl.dir}
              title={isTable ? undefined : isText ? "폭 조절" : "크기 조절"}
              onPointerDown={isTable ? undefined : (e) => startResize(e, hdl.dir)}
              className="absolute z-30 bg-white border-[1.5px] border-accent rounded-[2px]"
              style={{
                ...(isText ? textWidthHandleStyle(hdl.style) : hdl.style),
                ...(isTable ? { pointerEvents: "none" as const, cursor: "default" } : {}),
              }}
            />
          ))}
        </>
      )}
    </div>
  );
});

const HANDLE = 8;
const off = -HANDLE / 2;


function MiniBoxPositionIcon({ mode }: { mode: "left" | "center" | "right" }) {
  const boxX = mode === "left" ? 2.2 : mode === "center" ? 5 : 7.8;
  const guideX = mode === "left" ? 2 : mode === "center" ? 7 : 12;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d={`M${guideX} 2.5v9`} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <rect x={boxX} y="4.2" width="4" height="5.6" rx="1" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function textWidthHandleStyle(s: React.CSSProperties): React.CSSProperties {
  return { ...s, cursor: "default" };
}
const RESIZE_HANDLES: { dir: string; style: React.CSSProperties }[] = [
  { dir: "nw", style: { top: off, left: off, width: HANDLE, height: HANDLE, cursor: "nwse-resize" } },
  { dir: "ne", style: { top: off, right: off, width: HANDLE, height: HANDLE, cursor: "nesw-resize" } },
  { dir: "sw", style: { bottom: off, left: off, width: HANDLE, height: HANDLE, cursor: "nesw-resize" } },
  { dir: "se", style: { bottom: off, right: off, width: HANDLE, height: HANDLE, cursor: "nwse-resize" } },
  { dir: "n", style: { top: off, left: "50%", marginLeft: off, width: HANDLE, height: HANDLE, cursor: "ns-resize" } },
  { dir: "s", style: { bottom: off, left: "50%", marginLeft: off, width: HANDLE, height: HANDLE, cursor: "ns-resize" } },
  { dir: "w", style: { left: off, top: "50%", marginTop: off, width: HANDLE, height: HANDLE, cursor: "ew-resize" } },
  { dir: "e", style: { right: off, top: "50%", marginTop: off, width: HANDLE, height: HANDLE, cursor: "ew-resize" } },
];

export function textStyle(block: Block): React.CSSProperties {
  return {
    // 줄간격 — 지정 시 line-height = %/100 (미지정이면 leading-snug 1.375 클래스가 담당).
    // 내보내기 paraPr lineSpacing과 같은 값이라 화면 세로 배치 = 한글 세로 배치.
    ...(block.lineSpacing ? { lineHeight: block.lineSpacing / 100 } : {}),
    fontSize: ptToPx(block.fontSize ?? TEXT_DEFAULTS.fontSize),
    fontWeight: (block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textAlign: block.align ?? TEXT_DEFAULTS.align,
    color: normalizeTextColor(block.color),
    // 글꼴 + 전각(1em) 보정 — 폰트 레지스트리가 폰트별 letter-spacing을 실측 캘리브레이션
    // (한글/HWP 조판은 한글을 1em으로 계산 — em 단위라 fontSize별로 정확히 스케일)
    ...fontCss(block.font),
  };
}
const ptToPx = (pt: number) => `${pt * (96 / 72)}px`;

// 런(run) 하나의 화면 스타일 — 블록 기본값 위에 런이 지정한 속성만 덮어쓴다.
// 굵기·기울임·색은 항상 명시(런 없으면 블록값), 크기·글꼴은 런이 지정할 때만 덮어써
// 나머지는 컨테이너(textStyle) 상속을 그대로 받게 한다 → 전각 보정·크기 정합 유지.
function runCssObj(block: Block, run: TextRun): React.CSSProperties {
  // ⚠ 밑줄/취소선은 컨테이너가 아니라 "런 span"에만 건다 — CSS text-decoration은 부모에
  // 걸면 자식이 못 지우므로(전파 규칙), 블록 기본이 밑줄이어도 일부 런만 보통(false)이
  // 되려면 span 단위 적용이 유일한 경로다.
  // 하이퍼링크는 밑줄 + 링크색(파랑)을 얹는다 — 사용자가 색을 명시했으면 그 색 존중.
  const isLink = !!run.href;
  const underline = run.underline ?? block.underline ?? isLink ?? TEXT_DEFAULTS.underline;
  const strike = run.strike ?? block.strike ?? TEXT_DEFAULTS.strike;
  const deco = [underline ? "underline" : "", strike ? "line-through" : ""].filter(Boolean).join(" ");
  return {
    fontWeight: (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textDecoration: deco || "none",
    color: normalizeTextColor(run.color ?? (isLink ? LINK_COLOR : block.color)),
    ...(run.bg ? { backgroundColor: run.bg } : {}), // 형광펜 — 런 전용(블록 상속 없음)
    ...(run.fontSize != null ? { fontSize: ptToPx(run.fontSize) } : {}),
    ...(run.font ? fontCss(run.font) : {}),
  };
}

// 하이퍼링크 표시색 — 화면·내보내기 charPr 공통(한글에서도 링크로 보이게)
export const LINK_COLOR = "#1A5FD6";

// URL 정규화 — 스킴 없으면 https:// 붙임. 빈 값은 undefined(링크 제거).
export function normalizeUrl(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^(https?:|mailto:|tel:|ftp:)/i.test(s)) return s;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return `mailto:${s}`;
  return `https://${s}`;
}

// 읽기 모드: 런을 스타일 span으로, 각 span 안에서 {{토큰}}은 칩으로 렌더.
// 문단별 정렬이 있으면 문단마다 div(text-align)로 감싼다 — 없으면 기존 flat 렌더
// 그대로(옛 문서·검증된 경로 무손상). div 스택은 pre-wrap \n과 같은 세로 배치.
export function RichRead({ block }: { block: Block }) {
  const runs = blockRuns(block);
  const aligns = block.paraAligns;
  const lists = block.paraLists;
  if (aligns?.some((a) => a != null) || lists?.some((l) => l != null)) {
    const paras = splitRunsToParasView(runs);
    return (
      <>
        {paras.map((paraRuns, pi) => {
          // 목록 마커 — 편집 모드 markerTextAt과 같은 규칙(연속 num 이어 세기)
          const lt = lists?.[pi];
          let marker: string | null = null;
          if (lt === "bullet") marker = "• ";
          else if (lt === "num") {
            let n = 1;
            for (let k = pi - 1; k >= 0 && lists![k] === "num"; k--) n++;
            marker = `${n}. `;
          }
          return (
            <div key={pi} style={aligns?.[pi] ? { textAlign: aligns[pi] as TextAlign } : undefined}>
              {marker && (
                <span style={{ display: "inline-block", minWidth: "1.3em", userSelect: "none" }}>{marker}</span>
              )}
              {paraRuns.length ? paraRuns.map((run, i) => <RunSpan key={i} block={block} run={run} />) : <br />}
            </div>
          );
        })}
      </>
    );
  }
  return (
    <>
      {runs.map((run, i) => (
        <RunSpan key={i} block={block} run={run} />
      ))}
    </>
  );
}

// 읽기 모드 런 span — 하이퍼링크면 Ctrl/⌘+클릭으로 새 탭 열기(일반 클릭은 블록 선택 유지).
function RunSpan({ block, run }: { block: Block; run: TextRun }) {
  const href = run.href;
  return (
    <span
      style={{ ...runCssObj(block, run), ...(href ? { cursor: "pointer" } : {}) }}
      title={href ? `${href} (Ctrl+클릭으로 열기)` : undefined}
      onClick={
        href
          ? (e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                window.open(href, "_blank", "noopener,noreferrer");
              }
            }
          : undefined
      }
    >
      <TokenText text={run.text} />
    </span>
  );
}

// RichRead용 문단 분할 — seedEditable의 splitRunsToParas와 같은 규칙 (모듈 순서상 별도 정의)
function splitRunsToParasView(runs: TextRun[]): TextRun[][] {
  const paras: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) paras.push([]);
      if (part) paras[paras.length - 1].push({ ...run, text: part });
    });
  }
  return paras;
}

// ── auto-width 측정 (canvas) ──
// 예전엔 visibility:hidden 사이저를 하나 더 그려 폭을 쟀지만, DOM에 텍스트가 두 번
// 생겨 검사기에서 헷갈렸다 → 제거. 이제 텍스트는 화면 사이저 "하나"뿐이고, 폭은
// canvas.measureText로 잰다(런별 폰트·크기·굵기·기울임 + 전각 보정 letter-spacing 반영).
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  return _measureCtx;
}

// 런들을 \n 기준으로 줄 배열로 쪼갠다 (각 줄 = 런 배열, 서식 유지)
function splitRunsIntoLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines;
}

// 줄바꿈 없는 "가장 긴 줄"의 자연 폭(px) — auto-width가 이 값 + 좌우 패딩으로 박스를 맞춘다.
// letter-spacing은 브라우저가 글자마다 뒤에 붙이므로 em×px×글자수로 근사(±1mm 허용).
function measureNaturalWidthPx(block: Block, spacing: Record<string, number>): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  const lines = showingHint(block)
    ? (block.hint ?? "").split("\n").map((l) => [{ text: l } as TextRun])
    : splitRunsIntoLines(blockRuns(block));
  let max = 0;
  for (const line of lines) {
    let w = 0;
    for (const run of line) {
      const def = fontByKey(run.font ?? block.font);
      const sizePx = (run.fontSize ?? block.fontSize ?? TEXT_DEFAULTS.fontSize) * (96 / 72);
      const weight = (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400;
      const italic = (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic " : "";
      ctx.font = `${italic}${weight} ${sizePx}px "${def.webFamily}", "Malgun Gothic", sans-serif`;
      const em = spacing[def.key] ?? 0.06;
      // 전각 보정 letter-spacing은 한글 글자에만 (화면 ScriptText 규칙과 동일)
      w += ctx.measureText(run.text).width + em * sizePx * countHangul(run.text);
    }
    if (w > max) max = w;
  }
  return max;
}

// 전각 보정 선택 적용 — 한글 구간은 컨테이너의 letter-spacing(전각 보정)을 상속하고,
// 숫자·라틴 구간은 spacing 0으로 자연폭. HWP 조판(한글만 전각, 나머지 반각)과 동일한
// 규칙이라 혼합 텍스트도 화면 줄바꿈 = 한글 줄바꿈이 유지된다.
function ScriptText({ text }: { text: string }) {
  const segs = splitByHangul(text);
  return (
    <>
      {segs.map((s, i) =>
        s.hangul ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : (
          <span key={i} style={{ letterSpacing: 0 }}>
            {s.text}
          </span>
        )
      )}
    </>
  );
}

// ── 이미지 블록 ──
// src = 자산 저장소(IndexedDB) id. 없으면 placeholder(더블클릭→파일 선택),
// 있으면 objectURL <img>. 원본 비율은 선택 시 h를 폭에 맞춰 보정한다.
function imageDims(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function ImageContent({ block, locked }: { block: Block; locked: boolean }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (block.src) {
      void getAssetUrl(block.src).then((u) => {
        if (alive) setUrl(u);
      });
    } else {
      setUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [block.src]);

  const pick = () => {
    if (locked) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/bmp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const [id, dim] = await Promise.all([putAsset(f), imageDims(f)]);
      // 폭 유지 + 원본 비율로 높이 보정 — 지면 아래로 넘치지 않게 상한
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (!cur) return;
      const h = dim ? Math.max(8, Math.min(200, Math.round(cur.w * (dim.h / dim.w)))) : cur.h;
      updateBlock(block.id, { src: id, h });
    };
    input.click();
  };

  if (!block.src || !url)
    return (
      <button
        onDoubleClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        onPointerDown={(e) => {
          // 선택은 상위(블록)가 처리 — 더블클릭만 여기서
          void e;
        }}
        className="w-full h-full flex flex-col items-center justify-center gap-1 bg-paper text-inkfaint text-[11px] cursor-pointer"
        title="더블클릭으로 이미지 선택"
      >
        <IcImage size={18} />
        더블클릭으로 이미지 선택
      </button>
    );

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onDoubleClick={(e) => {
        e.stopPropagation();
        pick(); // 재선택(교체)
      }}
      className="w-full h-full select-none"
      style={{ objectFit: "fill", borderRadius: block.radius ?? 0 }}
      title="더블클릭으로 이미지 교체"
    />
  );
}

// {{토큰}}을 칩으로, 미리보기 중이면 실제 값(강조)으로 렌더
function TokenText({ text }: { text: string }) {
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  if (dataset && previewIndex !== null) {
    const resolved = resolveTokens(text, dataset.columns, dataset.rows[previewIndex] ?? []);
    if (resolved !== text)
      return (
        <span className="bg-emerald-50 text-emerald-700 rounded-[2px] px-0.5">
          <ScriptText text={resolved} />
        </span>
      );
    return <ScriptText text={resolved} />;
  }

  const parts = text.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = new RegExp(`^${TOKEN_RE.source}$`).exec(p);
        return m ? (
          <span
            key={i}
            className="inline-block align-baseline rounded-full bg-accentsoft text-accent px-1.5 text-[0.85em] leading-normal mx-0.5"
          >
            {m[1].trim()}
          </span>
        ) : (
          <ScriptText key={i} text={p} />
        );
      })}
    </>
  );
}

// ═════════════════ 인라인 리치 텍스트: contentEditable 직렬화 ═════════════════
// 편집 표면은 contentEditable(런=span). 진실은 스토어의 runs다. 타이핑 중에는 DOM을
// 다시 그리지 않고(한글 IME·커서 보존), input에서 DOM→runs로 읽어 스토어에 반영한다.
// 서식 적용(선택 구간)만 DOM을 다시 그리고 오프셋으로 커서를 복원한다.

// 런 → span 엘리먼트. dataset이 직렬화의 진실(readRunStyle이 이것만 읽는다).
// inline style은 보이기용 — 브라우저가 span을 쪼개도 dataset이 함께 복제돼 서식이 산다.
function runToSpanEl(block: Block, run: TextRun): HTMLSpanElement {
  const span = document.createElement("span");
  // bold/italic은 3-상태 — 명시값(true/false)만 dataset에 기록(undefined=상속은 미기록).
  if (run.bold !== undefined) span.dataset.b = run.bold ? "1" : "0";
  if (run.italic !== undefined) span.dataset.i = run.italic ? "1" : "0";
  if (run.underline !== undefined) span.dataset.u = run.underline ? "1" : "0";
  if (run.strike !== undefined) span.dataset.s = run.strike ? "1" : "0";
  if (run.color) span.dataset.color = run.color;
  if (run.href) span.dataset.href = run.href;
  if (run.bg) span.dataset.bg = run.bg;
  if (run.fontSize != null) span.dataset.size = String(run.fontSize);
  if (run.font) span.dataset.font = run.font;
  Object.assign(span.style, runCssObj(block, run) as Record<string, string>);
  // 편집 표면도 읽기 모드(ScriptText)와 똑같이 — 비한글 구간은 letterSpacing 0(전각 보정
  // 제외)로. 이렇게 안 하면 편집 중(균일 spacing)과 편집 종료 후(한글만 spacing) 박스
  // 너비/높이가 달라진다. domToRuns는 dataset만 읽으므로 이 하위 span(무-dataset)의
  // 텍스트는 부모 런 스타일로 되합쳐진다(직렬화 안전).
  const segs = splitByHangul(run.text);
  if (segs.length <= 1) {
    span.textContent = run.text;
  } else {
    for (const seg of segs) {
      if (seg.hangul) span.appendChild(document.createTextNode(seg.text));
      else {
        const sub = document.createElement("span");
        sub.style.letterSpacing = "0";
        sub.textContent = seg.text;
        span.appendChild(sub);
      }
    }
  }
  return span;
}

// 런을 \n 기준 문단(run 그룹) 배열로 — 편집 시드·읽기 렌더·정렬 배열이 공유하는 분할 규칙
function splitRunsToParas(runs: TextRun[]): TextRun[][] {
  const paras: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) paras.push([]);
      if (part) paras[paras.length - 1].push({ ...run, text: part });
    });
  }
  return paras;
}

// 문단 i의 목록 마커 텍스트 — 번호는 연속 num 구간에서 이어 센다(끊기면 1부터)
function markerTextAt(lists: (ParaListType | null)[] | undefined, i: number): string | null {
  const t = lists?.[i];
  if (!t) return null;
  if (t === "bullet") return "• ";
  let n = 1;
  for (let k = i - 1; k >= 0 && lists![k] === "num"; k--) n++;
  return `${n}. `;
}

// 목록 마커 span — 편집 불가·선택 불가·직렬화 제외(data-marker를 domToRuns/emission이 스킵)
function markerSpanEl(text: string): HTMLSpanElement {
  const m = document.createElement("span");
  m.setAttribute("data-marker", "");
  m.contentEditable = "false";
  m.style.userSelect = "none";
  m.style.display = "inline-block";
  m.style.minWidth = "1.3em";
  m.textContent = text;
  return m;
}

// contentEditable을 현재 런으로 채운다 (편집 진입·서식 적용 시).
// 구조 = 문단마다 <div data-para style="text-align:…" data-list="bullet|num"> —
// 문단별 정렬·목록이 편집 중에도 보이고, Enter는 div 분할, domToRuns는 div 경계를
// \n으로 되읽는다. 빈 문단은 <br> 하나(높이 확보 + 커서 진입 가능).
export function seedEditable(
  el: HTMLElement,
  block: Block,
  runs: TextRun[],
  paraAligns?: (TextAlign | null)[],
  paraLists?: (ParaListType | null)[]
) {
  const paras = splitRunsToParas(runs);
  const divs = paras.map((paraRuns, i) => {
    const div = document.createElement("div");
    div.setAttribute("data-para", "");
    const a = paraAligns?.[i];
    if (a) div.style.textAlign = a;
    const list = paraLists?.[i];
    if (list) div.setAttribute("data-list", list);
    const marker = markerTextAt(paraLists, i);
    if (marker) div.appendChild(markerSpanEl(marker));
    if (paraRuns.length) div.append(...paraRuns.map((r) => runToSpanEl(block, r)));
    else div.appendChild(document.createElement("br"));
    return div;
  });
  el.replaceChildren(...divs);
}

function readRunStyle(el: HTMLElement): Partial<TextRun> {
  const d = el.dataset;
  const st: Partial<TextRun> = {};
  if (d.b !== undefined) st.bold = d.b === "1"; // "0"=강제 보통도 보존
  if (d.i !== undefined) st.italic = d.i === "1";
  if (d.u !== undefined) st.underline = d.u === "1";
  if (d.s !== undefined) st.strike = d.s === "1";
  if (d.color) st.color = d.color;
  if (d.href) st.href = d.href;
  if (d.bg) st.bg = d.bg;
  if (d.size) st.fontSize = Number(d.size);
  if (d.font) st.font = d.font;
  return st;
}

// DOM(편집 중 자유 변형된 상태) → 정규화된 런 배열. 줄바꿈은 \n 텍스트·BR·블록경계 모두 흡수.
export function domToRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, style: Partial<TextRun>) => {
    if (text) runs.push({ text, ...style });
  };
  const walk = (node: Node, style: Partial<TextRun>) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child as Text).data, style);
      } else if (child.nodeName === "BR") {
        push("\n", style);
      } else if (child instanceof HTMLElement) {
        if (child.dataset.marker !== undefined) return; // 목록 마커는 장식 — 직렬화 제외
        const isBlock = /^(DIV|P)$/.test(child.nodeName);
        // 엔터로 생긴 블록 요소 앞에는 줄바꿈 (이미 \n로 끝났으면 생략 — 중복 방지)
        if (isBlock && runs.length && !runsToText(runs).endsWith("\n")) push("\n", style);
        walk(child, { ...style, ...readRunStyle(child) });
      }
    });
  };
  walk(root, {});
  return normalizeRuns(runs);
}

// ── 선형화(emission) — domToRuns의 텍스트 방출 규칙과 1:1 동일 ──
// 문단 div 경계·BR을 \n 1글자로 세는 규칙을 오프셋 계산/복원과 domToRuns가 공유해야
// 서식 적용·undo 후 커서가 튀지 않는다. 이벤트: text(길이 n) / br(1) / boundary(1).
type EmitEvent =
  | { kind: "text"; node: Text }
  | { kind: "br"; node: HTMLElement }
  | { kind: "boundary"; before: HTMLElement };
function collectEmissions(root: HTMLElement): EmitEvent[] {
  const out: EmitEvent[] = [];
  let emitted = false; // 지금까지 글자를 내보냈나 (첫 블록 앞엔 경계 없음)
  let endsNL = false; // 마지막 방출이 \n로 끝났나 (경계 중복 방지 — domToRuns와 동일)
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text;
        if (t.data.length) {
          out.push({ kind: "text", node: t });
          endsNL = t.data.endsWith("\n");
          emitted = true;
        }
      } else if (child.nodeName === "BR") {
        out.push({ kind: "br", node: child as HTMLElement });
        endsNL = true;
        emitted = true;
      } else if (child instanceof HTMLElement) {
        if (child.dataset.marker !== undefined) return; // 목록 마커 — domToRuns와 동일하게 제외
        if (/^(DIV|P)$/.test(child.nodeName) && emitted && !endsNL) {
          out.push({ kind: "boundary", before: child });
          endsNL = true;
        }
        walk(child);
      }
    });
  };
  walk(root);
  return out;
}
const emitLen = (ev: EmitEvent) => (ev.kind === "text" ? ev.node.data.length : 1);
const emitAnchor = (ev: EmitEvent): Node => (ev.kind === "text" ? ev.node : ev.kind === "br" ? ev.node : ev.before);

// 선택 지점(node,offset)의 root 기준 평문 오프셋 — emission 시뮬레이션 기반
function textOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  // 요소 앵커(node=요소, offset=자식 인덱스) → "이 노드 앞" 지점으로 정규화
  let beforeNode: Node | null = null;
  let afterNode: Node | null = null;
  if (node.nodeType === Node.TEXT_NODE) {
    // 텍스트 앵커는 아래 루프에서 직접 처리
  } else if (offset < node.childNodes.length) {
    beforeNode = node.childNodes[offset];
  } else {
    afterNode = node; // 요소 끝 = 요소의 마지막 방출 뒤
  }
  let count = 0;
  for (const ev of collectEmissions(root)) {
    const anchor = emitAnchor(ev);
    if (node.nodeType === Node.TEXT_NODE && ev.kind === "text" && ev.node === node)
      return count + Math.min(offset, ev.node.data.length);
    if (beforeNode && (anchor === beforeNode || beforeNode.contains(anchor))) return count;
    if (afterNode && !afterNode.contains(anchor) && afterNode.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)
      return count;
    count += emitLen(ev);
  }
  return count;
}

// 현재 선택의 [start,end] 오프셋 (root 안이고 접혀있지 않을 때만)
export function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = textOffsetOf(root, range.startContainer, range.startOffset);
  const b = textOffsetOf(root, range.endContainer, range.endOffset);
  return a <= b ? [a, b] : [b, a];
}

// 평문 오프셋 → DOM 위치 (커서 복원용) — emission 시뮬레이션 기반.
// br/boundary 위치에 떨어지면 "그 뒤 요소의 시작"(= 다음 문단 첫 지점)에 캐럿을 둔다.
function locateOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
  let count = 0;
  const events = collectEmissions(root);
  for (const ev of events) {
    if (ev.kind === "text") {
      const len = ev.node.data.length;
      if (target <= count + len) return { node: ev.node, offset: target - count };
      count += len;
    } else if (ev.kind === "br") {
      if (target <= count) {
        const p = ev.node.parentNode as Node;
        return { node: p, offset: Array.prototype.indexOf.call(p.childNodes, ev.node) };
      }
      count += 1;
    } else {
      if (target <= count) {
        const p = ev.before.parentNode as Node;
        return { node: p, offset: Array.prototype.indexOf.call(p.childNodes, ev.before) };
      }
      count += 1;
      // 경계 직후(= 다음 문단 시작)에 떨어지면 그 div의 첫 지점 —
      // 목록 마커(data-marker, 직렬화 제외)가 있으면 그 뒤에 캐럿을 둔다
      if (target <= count) {
        const first = ev.before.firstChild;
        const off = first instanceof HTMLElement && first.dataset.marker !== undefined ? 1 : 0;
        return { node: ev.before, offset: off };
      }
    }
  }
  // 끝 — 마지막 문단 div의 끝 (없으면 root 끝)
  const lastPara = [...root.children].reverse().find((c) => c.hasAttribute?.("data-para"));
  if (lastPara) return { node: lastPara, offset: lastPara.childNodes.length };
  return { node: root, offset: root.childNodes.length };
}

export function setSelectionRange(root: HTMLElement, start: number, end: number) {
  const s = locateOffset(root, start);
  const e = locateOffset(root, end);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

// 편집 DOM에서 문단별 정렬 배열을 파생 — 모델 문단(text.split("\n"))과 index가 일치하도록
// emission을 재생하며 각 문단의 "첫 내용이 속한 div"의 textAlign을 기록한다.
export function paraAlignsFromDom(root: HTMLElement): (TextAlign | null)[] {
  const alignOf = (n: Node | null): TextAlign | null => {
    const div = (n instanceof HTMLElement ? n : n?.parentElement)?.closest?.("[data-para]") as HTMLElement | null;
    const a = div?.style.textAlign;
    return a === "left" || a === "center" || a === "right" ? a : null;
  };
  const aligns: (TextAlign | null)[] = [null];
  let cur = 0;
  const setA = (n: Node) => {
    if (aligns[cur] == null) aligns[cur] = alignOf(n);
  };
  for (const ev of collectEmissions(root)) {
    if (ev.kind === "text") {
      const parts = ev.node.data.split("\n");
      if (parts[0]) setA(ev.node);
      for (let i = 1; i < parts.length; i++) {
        cur++;
        aligns[cur] = null;
        if (parts[i]) setA(ev.node);
      }
    } else if (ev.kind === "br") {
      setA(ev.node); // 빈 문단의 정렬 = br이 든 div
      cur++;
      aligns[cur] = null;
    } else {
      cur++;
      aligns[cur] = alignOf(ev.before); // 새 문단 = 경계 뒤 div
    }
  }
  return aligns;
}

// 편집 DOM에서 문단별 목록 배열 파생 — paraAlignsFromDom과 같은 재생 규칙(div data-list)
export function paraListsFromDom(root: HTMLElement): (ParaListType | null)[] {
  const listOf = (n: Node | null): ParaListType | null => {
    const div = (n instanceof HTMLElement ? n : n?.parentElement)?.closest?.("[data-para]") as HTMLElement | null;
    const v = div?.getAttribute("data-list");
    return v === "bullet" || v === "num" ? v : null;
  };
  const lists: (ParaListType | null)[] = [null];
  let cur = 0;
  const setL = (n: Node) => {
    if (lists[cur] == null) lists[cur] = listOf(n);
  };
  for (const ev of collectEmissions(root)) {
    if (ev.kind === "text") {
      const parts = ev.node.data.split("\n");
      if (parts[0]) setL(ev.node);
      for (let i = 1; i < parts.length; i++) {
        cur++;
        lists[cur] = null;
        if (parts[i]) setL(ev.node);
      }
    } else if (ev.kind === "br") {
      setL(ev.node);
      cur++;
      lists[cur] = null;
    } else {
      cur++;
      lists[cur] = listOf(ev.before);
    }
  }
  return lists;
}

// 오프셋이 속한 문단 인덱스 — 평문 기준(\n 개수)
export const paraIdxAt = (text: string, offset: number) =>
  (text.slice(0, Math.max(0, Math.min(offset, text.length))).match(/\n/g) ?? []).length;

// [start,end) 교체 시 문단 속성 배열(정렬·목록)도 함께 스플라이스 —
// 삽입된 새 문단은 시작 문단의 값을 상속
export function spliceAligns<T>(
  aligns: (T | null)[],
  text: string,
  start: number,
  end: number,
  insertedText: string
): (T | null)[] {
  const pFrom = paraIdxAt(text, start);
  const pTo = paraIdxAt(text, end);
  const added = (insertedText.match(/\n/g) ?? []).length;
  const inherit = aligns[pFrom] ?? null;
  return [
    ...aligns.slice(0, pFrom + 1),
    ...Array.from({ length: added }, () => inherit),
    ...aligns.slice(pTo + 1),
  ];
}

// Enter — 캐럿 위치에서 현재 문단 div를 둘로 쪼갠다 (뒤쪽이 정렬 상속, 캐럿은 새 문단 시작)
export function splitParagraphAtCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  range.deleteContents(); // 선택 상태면 지우고 분할
  const anchor = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
  const para = anchor?.closest?.("[data-para]") as HTMLElement | null;
  if (!para || !root.contains(para)) return false;
  const tail = document.createRange();
  tail.selectNodeContents(para);
  tail.setStart(range.startContainer, range.startOffset);
  const frag = tail.extractContents();
  const next = document.createElement("div");
  next.setAttribute("data-para", "");
  if (para.style.textAlign) next.style.textAlign = para.style.textAlign;
  const listType = para.getAttribute("data-list");
  if (listType) next.setAttribute("data-list", listType); // 목록 상속 (마커는 Enter 후 재시드가 그림)
  next.appendChild(frag);
  // 빈 쪽엔 br로 높이·커서 자리 확보
  if (!(next.textContent ?? "").length && !next.querySelector("br")) next.appendChild(document.createElement("br"));
  if (!(para.textContent ?? "").length && !para.querySelector("br")) para.appendChild(document.createElement("br"));
  para.after(next);
  const r = document.createRange();
  r.setStart(next, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

export function placeCaretEnd(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretFromPoint(root: HTMLElement, point: { x: number; y: number } | null) {
  if (!point) {
    placeCaretEnd(root);
    return;
  }
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  // ⚠ caretPositionFromPoint는 클릭 지점 "최상단" 요소 기준으로 캐럿을 찾는다. 다중선택/그룹
  // 오버레이(z-11)가 텍스트를 덮고 있으면 에디터가 아니라 오버레이를 집어 실패 → 끝으로
  // 폴백된다(그룹 상태에서만 커서가 끝으로 잡히던 원인). 지점 위에서 에디터보다 위에 있는
  // 요소들을 잠시 pointer-events:none로 눌러 텍스트를 뚫고 캐럿을 집는다(즉시 복원).
  const muted: { el: HTMLElement; prev: string }[] = [];
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    if (el === root || root.contains(el)) break; // 에디터 텍스트에 도달 — 위 요소만 눌렀으면 됨
    if (el instanceof HTMLElement && getComputedStyle(el).pointerEvents !== "none") {
      muted.push({ el, prev: el.style.pointerEvents });
      el.style.pointerEvents = "none";
    }
  }
  try {
    const range = document.createRange();
    const pos = doc.caretPositionFromPoint?.(point.x, point.y);
    if (pos && root.contains(pos.offsetNode)) {
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    } else {
      const legacyRange = doc.caretRangeFromPoint?.(point.x, point.y);
      if (!legacyRange || !root.contains(legacyRange.startContainer)) {
        placeCaretEnd(root);
        return;
      }
      range.setStart(legacyRange.startContainer, legacyRange.startOffset);
      range.collapse(true);
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } finally {
    for (const m of muted) m.el.style.pointerEvents = m.prev;
  }
}

// 캐럿 자리에 평문 삽입 (엔터=\n·붙여넣기 정규화용) — pre-wrap이라 \n이 줄바꿈으로 보인다
export function insertTextAtCaret(text: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tn = document.createTextNode(text);
  range.insertNode(tn);
  range.setStartAfter(tn);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── 서식 복사/붙여넣기: 런 ↔ HTML ──
// 복사: 선택 런을 인라인 스타일 span으로 직렬화(블록 상속값을 구워 넣음 — 다른 블록에
// 붙여도 서식 유지). 붙여넣기: 외부 HTML을 화이트리스트(굵기·기울임·밑줄·취소선·색·
// 형광펜·크기)만 남기고 런으로 변환 — 글꼴은 레지스트리 밖 폰트가 섞이므로 제외.
const escHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function runsToClipboardHtml(runs: TextRun[], block: Block): string {
  const body = runs
    .map((r) => {
      const st: string[] = [];
      if (r.bold ?? block.bold) st.push("font-weight:700");
      if (r.italic ?? block.italic) st.push("font-style:italic");
      const deco = [
        (r.underline ?? block.underline) ? "underline" : "",
        (r.strike ?? block.strike) ? "line-through" : "",
      ].filter(Boolean).join(" ");
      if (deco) st.push(`text-decoration:${deco}`);
      const color = r.color ?? block.color;
      if (color) st.push(`color:${color}`);
      if (r.bg) st.push(`background-color:${r.bg}`);
      const pt = r.fontSize ?? block.fontSize;
      if (pt) st.push(`font-size:${pt}pt`);
      return `<span style="${st.join(";")}">${escHtml(r.text).replace(/\n/g, "<br>")}</span>`;
    })
    .join("");
  return `<div>${body}</div>`;
}

// CSS 색 → hex (rgb()/#hex만 허용 — 이름 색상 등은 화이트리스트 밖이라 버림)
function cssColorToHex(v: string): string | null {
  if (!v) return null;
  const m = v.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // 완전 투명
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  return null;
}

export function runsFromClipboardHtml(html: string): TextRun[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const runs: TextRun[] = [];
  type St = Partial<Omit<TextRun, "text">>;
  const push = (text: string, st: St) => {
    if (text) runs.push({ text, ...st });
  };
  const parseSize = (v: string): number | null => {
    const m = v.match(/^([\d.]+)(pt|px)$/);
    if (!m) return null;
    const pt = Math.round((m[2] === "pt" ? parseFloat(m[1]) : (parseFloat(m[1]) * 72) / 96) * 2) / 2;
    return pt >= 6 && pt <= 96 ? pt : null;
  };
  const BLOCKY = /^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|UL|OL|TABLE|TBODY)$/;
  const walk = (node: Node, st: St) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child as Text).data.replace(/ /g, " "), st); // nbsp → 일반 공백
        return;
      }
      if (child.nodeName === "BR") {
        push("\n", st);
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (/^(SCRIPT|STYLE|META|TITLE|HEAD)$/.test(child.nodeName)) return;
      const next: St = { ...st };
      const tag = child.nodeName;
      if (tag === "B" || tag === "STRONG") next.bold = true;
      if (tag === "I" || tag === "EM") next.italic = true;
      if (tag === "U") next.underline = true;
      if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;
      const cs = child.style;
      const fw = cs.fontWeight;
      if (fw) {
        if (fw === "bold" || fw === "bolder" || parseInt(fw) >= 600) next.bold = true;
        else if (fw === "normal" || parseInt(fw) <= 400) next.bold = false;
      }
      if (cs.fontStyle === "italic") next.italic = true;
      else if (cs.fontStyle === "normal") next.italic = false;
      const deco = cs.textDecorationLine || cs.textDecoration;
      if (deco) {
        if (deco.includes("underline")) next.underline = true;
        if (deco.includes("line-through")) next.strike = true;
        if (deco.includes("none")) {
          next.underline = false;
          next.strike = false;
        }
      }
      const color = cssColorToHex(cs.color);
      if (color) next.color = color;
      const bg = cssColorToHex(cs.backgroundColor);
      if (bg && bg !== "#FFFFFF") next.bg = bg;
      const size = cs.fontSize ? parseSize(cs.fontSize) : null;
      if (size) next.fontSize = size;
      // 블록 요소 경계 = 줄바꿈 (이미 \n로 끝났으면 중복 방지)
      if (BLOCKY.test(tag) && runs.length && !runsToText(runs).endsWith("\n")) push("\n", st);
      walk(child, next);
    });
  };
  walk(doc.body, {});
  return normalizeRuns(runs);
}

type InlineSel = { rect: DOMRect; bold: boolean; italic: boolean; underline: boolean; strike: boolean; color?: string; href?: string; bg?: string; fontSize?: number; font?: string; align?: TextAlign; list?: ParaListType | null };

function TextContent({
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
  const editRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  // 마지막 유효 선택 오프셋 — 서식바(폰트 드롭다운 등)로 포커스가 옮겨가 선택이 사라져도
  // 이 값으로 구간을 되찾아 서식을 적용한다.
  const selRef = useRef<[number, number] | null>(null);
  // ── 편집 세션 미니 히스토리 (편집 중 Ctrl+Z/Y) ──
  // 브라우저 네이티브 CE undo는 우리 프로그램적 DOM 재시드(seedEditable·insertTextAtCaret)를
  // 모르기 때문에 되돌리기가 스토어와 어긋난다 → 네이티브를 차단하고 runs 스냅샷으로 직접
  // 되돌린다. 연속 타이핑은 700ms 버스트로 묶고(한 단계), 서식 적용은 항상 새 단계.
  type EditSnap = { runs: TextRun[]; caret: number; aligns: (TextAlign | null)[]; lists: (ParaListType | null)[] };
  const histRef = useRef<{ stack: EditSnap[]; idx: number; lastAt: number }>({
    stack: [],
    idx: -1,
    lastAt: 0,
  });
  const caretNow = (el: HTMLElement) => selectionOffsets(el)?.[1] ?? (el.textContent ?? "").length;
  const pushHistory = (
    runs: TextRun[],
    caret: number,
    coalesce: boolean,
    aligns: (TextAlign | null)[],
    lists: (ParaListType | null)[]
  ) => {
    const h = histRef.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.idx + 1); // 새 편집은 redo 꼬리를 버린다
    if (coalesce && h.idx >= 0 && now - h.lastAt < 700) {
      h.stack[h.idx] = { runs, caret, aligns, lists }; // 같은 버스트 — 최신 상태로 교체
    } else {
      h.stack.push({ runs, caret, aligns, lists });
      h.idx = h.stack.length - 1;
    }
    h.lastAt = now;
  };
  const applyHistoryState = (st: EditSnap) => {
    const el = editRef.current;
    if (!el) return;
    seedEditable(el, block, st.runs, st.aligns, st.lists);
    setRichText(block.id, st.runs, st.aligns, st.lists);
    el.focus();
    setSelectionRange(el, st.caret, st.caret);
    syncEditH();
  };
  const undoEdit = () => {
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    h.lastAt = 0; // 되돌린 뒤 이어지는 입력은 새 스냅샷
    applyHistoryState(h.stack[h.idx]);
  };
  const redoEdit = () => {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    h.lastAt = 0;
    applyHistoryState(h.stack[h.idx]);
  };
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
    const el = editRef.current;
    if (!el) return;
    const needMm = Math.max(1, Math.ceil(el.offsetHeight / SCALE));
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
  };

  // 편집 진입 — 현재 런으로 contentEditable을 채우고 커서를 끝에 둔다 (1회, editing 토글에만)
  useEffect(() => {
    if (!editing) {
      setSel(null);
      selRef.current = null;
      return;
    }
    const el = editRef.current;
    if (!el) return;
    seedEditable(el, block, blockRuns(block), block.paraAligns, block.paraLists);
    el.focus();
    placeCaretFromPoint(el, initialCaretPoint);
    // 미니 히스토리 초기화 — 스택 바닥 = 편집 진입 시점 상태 (Ctrl+Z의 최종 종착지)
    histRef.current = {
      stack: [
        { runs: blockRuns(block), caret: caretNow(el), aligns: paraAlignsFromDom(el), lists: paraListsFromDom(el) },
      ],
      idx: 0,
      lastAt: 0,
    };
    syncEditH();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 편집 중 선택 변화 → 서식바 위치·활성 상태 갱신 (구간 선택일 때만 표시)
  useEffect(() => {
    if (!editing) return;
    const onSelChange = () => {
      const el = editRef.current;
      if (!el) return;
      // 서식바 컨트롤에 포커스가 있으면(폰트 드롭다운 등) 유지 — 선택이 사라져도 숨기지 않음
      if (toolbarRef.current?.contains(document.activeElement)) return;
      const offs = selectionOffsets(el);
      if (!offs || offs[0] === offs[1]) {
        setSel(null);
        return;
      }
      selRef.current = offs;
      const range = window.getSelection()!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
      const all = (pred: (r: TextRun) => boolean) => rr.length > 0 && rr.every(pred);
      const same = <T,>(get: (r: TextRun) => T): T | undefined => {
        if (!rr.length) return undefined;
        const first = get(rr[0]);
        return rr.every((r) => get(r) === first) ? first : undefined;
      };
      // 선택이 걸친 문단들의 정렬 — 전부 같으면 그 값, 섞이면 undefined
      const fullText = runsToText(domToRuns(el));
      const pFrom = paraIdxAt(fullText, offs[0]);
      const pTo = paraIdxAt(fullText, offs[1]);
      const domAligns = paraAlignsFromDom(el);
      const paraAlignsInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => domAligns[pFrom + i] ?? block.align ?? "left");
      const alignUniform = paraAlignsInSel.every((v) => v === paraAlignsInSel[0]) ? paraAlignsInSel[0] : undefined;
      const domLists = paraListsFromDom(el);
      const listsInSel = Array.from({ length: pTo - pFrom + 1 }, (_, i) => domLists[pFrom + i] ?? null);
      const listUniform = listsInSel.every((v) => v === listsInSel[0]) ? listsInSel[0] : undefined;
      setSel({
        rect,
        bold: all((r) => (r.bold ?? block.bold ?? false) === true),
        italic: all((r) => (r.italic ?? block.italic ?? false) === true),
        underline: all((r) => (r.underline ?? block.underline ?? false) === true),
        strike: all((r) => (r.strike ?? block.strike ?? false) === true),
        color: same((r) => r.color ?? block.color ?? TEXT_DEFAULTS.color),
        href: same((r) => r.href),
        bg: same((r) => r.bg),
        fontSize: same((r) => r.fontSize ?? block.fontSize ?? TEXT_DEFAULTS.fontSize),
        font: same((r) => r.font ?? block.font),
        align: alignUniform,
        list: listUniform,
      });
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, block]);

  // DOM→runs 반영 (타이핑·삭제·붙여넣기). IME 조합 중엔 건너뛰고 compositionend에서 처리.
  const flushRuns = () => {
    const el = editRef.current;
    if (!el || composingRef.current) return;
    const runs = domToRuns(el);
    const aligns = paraAlignsFromDom(el); // 문단별 정렬·목록은 편집 DOM이 진실
    const lists = paraListsFromDom(el);
    setRichText(block.id, runs, aligns, lists);
    pushHistory(runs, caretNow(el), true, aligns, lists); // 타이핑 버스트는 한 단계로 코얼레싱
    syncEditH();
  };

  // 선택 구간에 서식 패치 적용 — DOM을 다시 그리고 커서를 복원한다
  const applyStyle = (patch: Partial<Omit<TextRun, "text">>) => {
    const el = editRef.current;
    const offs = selRef.current;
    if (!el || !offs || offs[0] === offs[1]) return;
    const next = applyRunStyle(domToRuns(el), offs[0], offs[1], patch);
    const aligns = paraAlignsFromDom(el); // 재시드 전에 현재 문단 정렬·목록 보존
    const lists = paraListsFromDom(el);
    seedEditable(el, block, next, aligns, lists);
    setRichText(block.id, next, aligns, lists);
    pushHistory(next, offs[1], false, aligns, lists); // 서식 적용은 항상 독립 단계
    el.focus();
    setSelectionRange(el, offs[0], offs[1]);
    syncEditH();
  };

  // 문단 정렬 적용 — 선택(또는 커서)이 걸친 문단들의 textAlign을 바꾼다
  const applyParaAlign = (a: TextAlign) => {
    const el = editRef.current;
    if (!el) return;
    const offs = selRef.current ?? ([caretNow(el), caretNow(el)] as [number, number]);
    const runs = domToRuns(el);
    const text = runsToText(runs);
    const pFrom = paraIdxAt(text, offs[0]);
    const pTo = paraIdxAt(text, offs[1]);
    const old = paraAlignsFromDom(el);
    const lists = paraListsFromDom(el);
    const total = text.split("\n").length;
    const next: (TextAlign | null)[] = Array.from({ length: total }, (_, i) => old[i] ?? null);
    for (let i = pFrom; i <= pTo && i < total; i++) next[i] = a;
    seedEditable(el, block, runs, next, lists);
    setRichText(block.id, runs, next, lists);
    pushHistory(runs, offs[1], false, next, lists);
    el.focus();
    setSelectionRange(el, offs[0], offs[1]);
    syncEditH();
  };

  // 문단 목록 토글 — 선택이 걸친 문단들이 전부 그 타입이면 해제, 아니면 적용
  const applyParaList = (t: ParaListType) => {
    const el = editRef.current;
    if (!el) return;
    const offs = selRef.current ?? ([caretNow(el), caretNow(el)] as [number, number]);
    const runs = domToRuns(el);
    const text = runsToText(runs);
    const pFrom = paraIdxAt(text, offs[0]);
    const pTo = paraIdxAt(text, offs[1]);
    const aligns = paraAlignsFromDom(el);
    const old = paraListsFromDom(el);
    const total = text.split("\n").length;
    const next: (ParaListType | null)[] = Array.from({ length: total }, (_, i) => old[i] ?? null);
    const allSame = Array.from({ length: pTo - pFrom + 1 }, (_, k) => next[pFrom + k]).every((v) => v === t);
    for (let i = pFrom; i <= pTo && i < total; i++) next[i] = allSame ? null : t;
    seedEditable(el, block, runs, aligns, next);
    setRichText(block.id, runs, aligns, next);
    pushHistory(runs, offs[1], false, aligns, next);
    el.focus();
    setSelectionRange(el, offs[0], offs[1]);
    syncEditH();
  };

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
          ref={editRef}
          data-text-click-zone={block.id}
          data-text-hitbox={block.id}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={flushRuns}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            flushRuns();
          }}
          onCopy={(e) => {
            // 서식 복사 — 선택 런을 HTML(화이트리스트 인라인 스타일)로 클립보드에.
            // 블록 상속값을 구워 넣어 다른 블록/외부 앱에 붙여도 서식이 산다.
            const el = editRef.current;
            const offs = el ? selectionOffsets(el) : null;
            if (!el || !offs || offs[0] === offs[1]) return; // 빈 선택은 기본 동작
            e.preventDefault();
            const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
            e.clipboardData.setData("text/html", runsToClipboardHtml(rr, block));
            e.clipboardData.setData("text/plain", runsToText(rr));
          }}
          onCut={(e) => {
            const el = editRef.current;
            const offs = el ? selectionOffsets(el) : null;
            if (!el || !offs || offs[0] === offs[1]) return;
            e.preventDefault();
            const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
            e.clipboardData.setData("text/html", runsToClipboardHtml(rr, block));
            e.clipboardData.setData("text/plain", runsToText(rr));
            const cur = domToRuns(el);
            const next = spliceRuns(cur, offs[0], offs[1], []);
            const curText = runsToText(cur);
            const aligns = spliceAligns(paraAlignsFromDom(el), curText, offs[0], offs[1], "");
            const lists = spliceAligns(paraListsFromDom(el), curText, offs[0], offs[1], "");
            seedEditable(el, block, next, aligns, lists);
            setRichText(block.id, next, aligns, lists);
            pushHistory(next, offs[0], false, aligns, lists);
            el.focus();
            setSelectionRange(el, offs[0], offs[0]);
            syncEditH();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const el = editRef.current;
            if (!el) return;
            // 서식 붙여넣기 — HTML이 있으면 화이트리스트만 남겨 런으로. 없으면 평문.
            const html = e.clipboardData.getData("text/html");
            if (html) {
              const ins = runsFromClipboardHtml(html);
              const insText = runsToText(ins);
              if (insText) {
                const offs = selectionOffsets(el) ?? [
                  (el.textContent ?? "").length,
                  (el.textContent ?? "").length,
                ];
                const cur = domToRuns(el);
                const next = spliceRuns(cur, offs[0], offs[1], ins);
                const curText = runsToText(cur);
                const aligns = spliceAligns(paraAlignsFromDom(el), curText, offs[0], offs[1], insText);
                const lists = spliceAligns(paraListsFromDom(el), curText, offs[0], offs[1], insText);
                seedEditable(el, block, next, aligns, lists);
                setRichText(block.id, next, aligns, lists);
                const caret = offs[0] + insText.length;
                pushHistory(next, caret, false, aligns, lists);
                el.focus();
                setSelectionRange(el, caret, caret);
                syncEditH();
                return;
              }
            }
            insertTextAtCaret(e.clipboardData.getData("text/plain"));
            flushRuns();
          }}
          onBlur={(e) => {
            // 서식바로 포커스가 옮겨간 blur는 편집 종료가 아님 (폰트 드롭다운 등)
            if (toolbarRef.current?.contains(e.relatedTarget as Node | null)) return;
            onDoneEditing();
          }}
          onBeforeInput={(e) => {
            // 컨텍스트 메뉴 "실행 취소" 등 키보드 밖 경로의 네이티브 undo도 차단 →
            // 미니 히스토리로 우회 (네이티브는 우리 DOM 재시드를 몰라 어긋난다)
            const it = (e.nativeEvent as InputEvent).inputType;
            if (it === "historyUndo") {
              e.preventDefault();
              undoEdit();
            } else if (it === "historyRedo") {
              e.preventDefault();
              redoEdit();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onDoneEditing();
              return;
            }
            // 편집 중 Ctrl+Z/Y — 네이티브 CE undo를 차단하고 runs 미니 히스토리로.
            // IME 조합 중엔 건드리지 않는다(조합 취소는 IME 몫).
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !composingRef.current && !e.nativeEvent.isComposing) {
              const k = e.key.toLowerCase();
              if (k === "z" && !e.shiftKey) {
                e.preventDefault();
                undoEdit();
                return;
              }
              if (k === "y" || (k === "z" && e.shiftKey)) {
                e.preventDefault();
                redoEdit();
                return;
              }
            }
            // 엔터 = 문단 분할(현재 div를 둘로, 정렬·목록 상속). 브라우저 기본을 막아 직렬화 통제.
            // IME 조합 확정 엔터는 통과(isComposing) — 줄바꿈이 아니라 글자 확정이어야 한다.
            if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const el = editRef.current;
              if (!el) return;
              const caretBefore = caretNow(el);
              if (!splitParagraphAtCaret(el)) insertTextAtCaret("\n"); // 방어적 폴백
              flushRuns();
              // 목록 문단이 있으면 재시드 — 새 문단의 마커·이후 번호를 다시 그린다
              const lists = paraListsFromDom(el);
              if (lists.some((l) => l != null)) {
                seedEditable(el, block, domToRuns(el), paraAlignsFromDom(el), lists);
                el.focus();
                setSelectionRange(el, caretBefore + 1, caretBefore + 1);
              }
            }
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
              onApply={applyStyle}
              onApplyAlign={applyParaAlign}
              onApplyList={applyParaList}
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

// ── 선택 위 플로팅 서식바 (굵게·기울임·색·크기·글꼴) ──
const INLINE_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#D64550", "#3B9B6B", "#C77A28"];
// 형광펜 스와치 — 한글 형광펜 감성의 연한 톤 4 + 지우기("")
const INLINE_HIGHLIGHTS = ["#FDF3B4", "#D7F5DD", "#DBEAFE", "#FCE1E4", ""];

function InlineToolbar({
  sel,
  toolbarRef,
  onApply,
  onApplyAlign,
  onApplyList,
  defaults,
}: {
  sel: InlineSel;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onApply: (patch: Partial<Omit<TextRun, "text">>) => void;
  onApplyAlign: (a: TextAlign) => void;
  onApplyList: (t: ParaListType) => void;
  defaults: { bold: boolean; italic: boolean; underline: boolean; strike: boolean };
}) {
  // 토글 끄기 값 — 블록 기본이 이미 보통이면 상속(undefined)으로 되돌리고, 블록이 굵으면
  // 명시적 false로 덮는다(그래야 인접 상속 런과 병합되지 않고 그 구간만 보통이 된다).
  const offBold = defaults.bold ? false : undefined;
  const offItalic = defaults.italic ? false : undefined;
  const offUnderline = defaults.underline ? false : undefined;
  const offStrike = defaults.strike ? false : undefined;
  const [fontOpen, setFontOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 서식바 위치 — 선택 사각 위쪽 중앙. 화면 밖으로 나가지 않게 좌우 클램프.
  const top = Math.max(8, sel.rect.top - 46);
  const left = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2), window.innerWidth - 8);
  const size = sel.fontSize ?? TEXT_DEFAULTS.fontSize;
  // 굵게/기울임 토글: 켜져 있으면 끄기(false로 명시 — 블록 기본이 굵을 수도 있으므로)
  const btn = "w-[28px] h-[28px] rounded-[7px] flex items-center justify-center text-inksoft hover:bg-paper transition-colors";
  const btnOn = "bg-accentsoft text-accent";

  return (
    <div
      ref={toolbarRef}
      // 포인터다운 기본 차단 → contentEditable 선택 유지(포커스·하이라이트 안 뺏김)
      onPointerDown={(e) => e.preventDefault()}
      style={{ position: "fixed", top, left, transform: "translateX(-50%)", zIndex: 70, boxShadow: "var(--sh-pop)" }}
      className="flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
    >
      <button className={`${btn} ${sel.bold ? btnOn : ""} font-extrabold text-[13px]`} title="굵게 (선택 구간)" onClick={() => onApply({ bold: sel.bold ? offBold : true })}>
        가
      </button>
      <button className={`${btn} ${sel.italic ? btnOn : ""} italic text-[13px]`} title="기울임 (선택 구간)" onClick={() => onApply({ italic: sel.italic ? offItalic : true })}>
        가
      </button>
      <button className={`${btn} ${sel.underline ? btnOn : ""} underline underline-offset-2 text-[13px]`} title="밑줄 (선택 구간)" onClick={() => onApply({ underline: sel.underline ? offUnderline : true })}>
        가
      </button>
      <button className={`${btn} ${sel.strike ? btnOn : ""} line-through text-[13px]`} title="취소선 (선택 구간)" onClick={() => onApply({ strike: sel.strike ? offStrike : true })}>
        가
      </button>
      {/* 링크 — URL 팝오버 (기존 링크면 프리필) */}
      <div className="relative">
        <button
          className={`${btn} ${sel.href ? btnOn : ""}`}
          title="링크 (선택 구간)"
          onClick={() => {
            setLinkUrl(sel.href ?? "");
            setLinkOpen((v) => !v);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M6.5 9.5l3-3M7 4.2l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M9 11.8l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {linkOpen && (
          <div
            className="absolute left-0 top-[34px] w-[228px] rounded-[9px] bg-surface border border-line p-2 z-10 flex items-center gap-1.5"
            style={{ boxShadow: "var(--sh-pop)" }}
          >
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onApply({ href: normalizeUrl(linkUrl) });
                  setLinkOpen(false);
                } else if (e.key === "Escape") setLinkOpen(false);
              }}
              placeholder="https://…"
              className="flex-1 h-[26px] px-2 rounded-[6px] border border-line bg-paper text-[12px] text-ink outline-none focus:border-accentline"
            />
            <button
              className="h-[26px] px-2 rounded-[6px] text-[11.5px] font-bold text-accent bg-accentsoft hover:bg-accent hover:text-onaccent transition-colors"
              onClick={() => {
                onApply({ href: normalizeUrl(linkUrl) });
                setLinkOpen(false);
              }}
            >
              적용
            </button>
            {sel.href && (
              <button
                className="h-[26px] px-1.5 rounded-[6px] text-[11.5px] text-inksoft hover:text-ink"
                title="링크 제거"
                onClick={() => {
                  onApply({ href: undefined });
                  setLinkOpen(false);
                }}
              >
                제거
              </button>
            )}
          </div>
        )}
      </div>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 크기 스테퍼 */}
      <button className={`${btn} text-[15px]`} title="작게" onClick={() => onApply({ fontSize: Math.max(6, Math.round((size - 0.5) * 2) / 2) })}>
        −
      </button>
      <span className="text-[11px] font-semibold text-ink tabular-nums w-8 text-center">{size}</span>
      <button className={`${btn} text-[15px]`} title="크게" onClick={() => onApply({ fontSize: Math.round((size + 0.5) * 2) / 2 })}>
        ＋
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 색 */}
      {INLINE_COLORS.map((c) => (
        <button
          key={c}
          title={`색 ${c}`}
          onClick={() => onApply({ color: c })}
          className="w-[18px] h-[18px] rounded-full mx-[1px] transition-transform hover:scale-[1.15] shrink-0"
          style={{ backgroundColor: c, border: `2px solid ${(sel.color ?? "").toUpperCase() === c.toUpperCase() ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.1)" }}
        />
      ))}
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 형광펜(글자 배경) — 런 전용. 빈 스와치 = 지우기(undefined → 상속 없음이라 무배경) */}
      {INLINE_HIGHLIGHTS.map((c) => (
        <button
          key={c || "none"}
          title={c ? `형광펜 ${c}` : "형광펜 지우기"}
          onClick={() => onApply({ bg: c || undefined })}
          className="w-[18px] h-[18px] rounded-[5px] mx-[1px] transition-transform hover:scale-[1.15] shrink-0 flex items-center justify-center"
          style={{ backgroundColor: c || "var(--surface)", border: `2px solid ${(sel.bg ?? "") === c ? "var(--accent)" : "var(--line)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.06)" }}
        >
          {!c && <span className="text-[9px] text-inkfaint leading-none">✕</span>}
        </button>
      ))}
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 문단 정렬 — 선택이 걸친 문단들에 적용 */}
      {(["left", "center", "right"] as TextAlign[]).map((a, i) => (
        <button
          key={a}
          className={`${btn} ${sel.align === a ? btnOn : ""} text-[11px] font-bold`}
          title={`${["왼쪽", "가운데", "오른쪽"][i]} 정렬 (문단)`}
          onClick={() => onApplyAlign(a)}
        >
          {["좌", "중", "우"][i]}
        </button>
      ))}
      {/* 목록 — 글머리(•)/번호(1.) 토글 (선택 걸친 문단) */}
      <button
        className={`${btn} ${sel.list === "bullet" ? btnOn : ""}`}
        title="글머리 기호 (문단)"
        onClick={() => onApplyList("bullet")}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
          <circle cx="2.2" cy="2.2" r="1.4" fill="currentColor" />
          <circle cx="2.2" cy="9.4" r="1.4" fill="currentColor" />
          <path d="M6 2.2h7M6 9.4h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`${btn} ${sel.list === "num" ? btnOn : ""} text-[10px] font-bold tracking-tight`}
        title="번호 목록 (문단)"
        onClick={() => onApplyList("num")}
      >
        1.
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 글꼴 — 커스텀 팝오버(네이티브 select는 blur로 선택 잃음) */}
      <div className="relative">
        <button
          className="h-[28px] px-2 rounded-[7px] text-[11.5px] text-ink hover:bg-paper transition-colors flex items-center gap-1 whitespace-nowrap max-w-[92px]"
          title="글꼴 (선택 구간)"
          onClick={() => setFontOpen((v) => !v)}
        >
          <span className="truncate">{fontByKey(sel.font).label}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {fontOpen && (
          <div
            className="absolute left-0 top-[32px] w-[168px] max-h-[240px] overflow-auto rounded-[9px] bg-surface border border-line py-1 z-10"
            style={{ boxShadow: "var(--sh-pop)" }}
          >
            {(["gothic", "myeongjo", "display", "hand", "safe", "compat"] as const).map((cat) => {
              const inCat = FONTS.filter((f) => f.category === cat);
              if (!inCat.length) return null;
              return (
                <div key={cat}>
                  <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold text-inkfaint tracking-[.06em]">{CATEGORY_LABEL[cat]}</div>
                  {inCat.map((f) => (
                    <button
                      key={f.key}
                      className={`w-full text-left px-2.5 py-1 text-[12px] hover:bg-paper transition-colors ${sel.font === f.key ? "text-accent font-bold" : "text-ink"}`}
                      onClick={() => {
                        void ensureFont(f.key);
                        onApply({ font: f.key });
                        setFontOpen(false);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 표: table-king 엔진 (기존 앱에서 이관) ──
type TableContextMenuState = { x: number; y: number };

type TableRibbonCommandDetail =
  | { blockId: string; kind: "primary"; label: string }
  | { blockId: string; kind: "style"; title: string }
  | { blockId: string; kind: "background"; index: number }
  | { blockId: string; kind: "textColor"; index: number }
  | { blockId: string; kind: "split"; rows: number; cols: number };

type TableMenuItem = {
  label: string;
  action?: string;
  disabled?: boolean;
};

const TABLE_CONTEXT_ITEMS: TableMenuItem[] = [
  { label: "복사", action: "복사" },
  { label: "붙여넣기", action: "붙여넣기" },
  { label: "행 추가", action: "행 추가" },
  { label: "열 추가", action: "열 추가" },
  { label: "행 삭제", action: "행 삭제" },
  { label: "열 삭제", action: "열 삭제" },
  { label: "셀 병합", action: "병합" },
  { label: "셀 나누기", action: "나누기" },
  { label: "테두리", disabled: true },
];

const TABLE_BG_SWATCHES = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 7H4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.8 10.5A7.2 7.2 0 1 1 7 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 7h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 10.5A7.2 7.2 0 1 0 17 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function AlignTopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 10h8M8 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlignMiddleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 8h8M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 10h6M8 14h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BorderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function TableKingContent({ block, active }: { block: Block; active: boolean }) {
  const setTableData = useCanvasStore((s) => s.setTableData);
  const select = useCanvasStore((s) => s.select);
  const selectGroup = useCanvasStore((s) => s.selectGroup);
  const selectBlockOrGroup = () => (block.groupId ? selectGroup(block.id) : select(block.id));
  const [showHandles, setShowHandles] = useState(true);
  const [menu, setMenu] = useState<TableContextMenuState | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  // 알약 드롭 대상 (셀 특정은 StudioEditor가 드롭 좌표의 input으로 해결)
  const { setNodeRef, isOver } = useDroppable({
    id: `tabledrop:${block.id}`,
    data: { kind: "tableblock", blockId: block.id },
  });

  // 구형(rows만 있는) 저장 문서 호환 — 첫 렌더에서 스냅샷으로 승격
  const data: TableKingData =
    block.data ?? (makeTableKingData(block.rows ?? [[""]], 420) as TableKingData);

  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event: globalThis.PointerEvent) => {
      if (shellRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // table-king 원본 액션을 직접 옮기지 않고, 숨겨둔 원본 툴바 버튼을 호출한다.
  const runTableAction = (label: string) => {
    const buttons = Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>(".toolbar button") ?? []);
    const button = buttons.find((item) => item.textContent?.replace(/\s+/g, " ").trim() === label);
    button?.click();
    setMenu(null);
  };

  const runBackground = (index: number) => {
    const swatchGroups = Array.from(shellRef.current?.querySelectorAll<HTMLElement>(".toolbar.secondary .swatch-group") ?? []);
    const swatches = Array.from(swatchGroups[0]?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    swatches[index]?.click();
    setMenu(null);
  };

  const runStyleAction = (title: string) => {
    const buttons = Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>(".toolbar.secondary button") ?? []);
    const label = title === "굵게" ? "B" : title === "기울임" ? "I" : title;
    const button = buttons.find((item) => item.title === title || item.textContent?.replace(/\s+/g, " ").trim() === label);
    button?.click();
    setMenu(null);
  };

  const runTextColor = (index: number) => {
    const swatchGroups = Array.from(shellRef.current?.querySelectorAll<HTMLElement>(".toolbar.secondary .swatch-group") ?? []);
    const swatches = Array.from(swatchGroups[1]?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    swatches[index]?.click();
    setMenu(null);
  };

  const runSplit = (rows: number, cols: number) => {
    const secondary = shellRef.current?.querySelector<HTMLElement>(".toolbar.secondary");
    const inputs = Array.from(secondary?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? []);
    const setInput = (input: HTMLInputElement | undefined, value: number) => {
      if (!input) return;
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput(inputs[0], rows);
    setInput(inputs[1], cols);
    runTableAction("나누기");
  };

  useEffect(() => {
    if (!active) return undefined;
    const onRibbonCommand = (event: Event) => {
      const detail = (event as CustomEvent<TableRibbonCommandDetail>).detail;
      if (!detail || detail.blockId !== block.id) return;
      if (detail.kind === "primary") runTableAction(detail.label);
      if (detail.kind === "style") runStyleAction(detail.title);
      if (detail.kind === "background") runBackground(detail.index);
      if (detail.kind === "textColor") runTextColor(detail.index);
      if (detail.kind === "split") runSplit(detail.rows, detail.cols);
    };
    window.addEventListener("studio:table-ribbon", onRibbonCommand);
    return () => window.removeEventListener("studio:table-ribbon", onRibbonCommand);
  }, [active, block.id]);

  const preserveContextSelection = (event: RMouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    selectBlockOrGroup();
  };

  const openContextMenu = (event: RMouseEvent<HTMLDivElement>) => {
    selectBlockOrGroup();
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const stopToolbarPointer = (event: RMouseEvent | RPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // 병합 미리보기 모드: 편집기 대신 값이 치환된 정적 표 (읽기 전용)
  if (dataset && previewIndex !== null)
    return <StaticResolvedTable data={data} columns={dataset.columns} row={dataset.rows[previewIndex] ?? []} />;

  return (
    <div
      ref={setNodeRef}
      className={isOver ? "outline outline-2 outline-accent -outline-offset-1 rounded-[2px]" : ""}
      data-tableblock={block.id}
    >
      <div
          ref={shellRef}
          className="table-action-shell"
          onMouseDownCapture={preserveContextSelection}
          onContextMenu={openContextMenu}
        >
        <TableKingBlock
          value={data}
          onChange={(next: TableKingData) => setTableData(block.id, next)}
          active={active}
          onActivate={selectBlockOrGroup}
          showHandles={showHandles}
          setShowHandles={setShowHandles}
          themeVars={TK_THEME_VARS}
        />

        {active && (
          <>
            <div className="table-mini-toolbar table-ribbon" onPointerDown={stopToolbarPointer}>
              <span className="table-ribbon-group" aria-label="실행">
                <button type="button" title="실행 취소" aria-label="실행 취소" onClick={() => runTableAction("실행 취소")}>
                  <UndoIcon />
                </button>
                <button type="button" title="다시 실행" aria-label="다시 실행" onClick={() => runTableAction("다시 실행")}>
                  <RedoIcon />
                </button>
              </span>
              <span className="table-ribbon-group" aria-label="가로 정렬">
                <span className="table-ribbon-label">정렬</span>
                <button type="button" title="왼쪽 정렬" onClick={() => runStyleAction("왼쪽 정렬")}>좌</button>
                <button type="button" title="가운데 정렬" onClick={() => runStyleAction("가운데 정렬")}>중</button>
                <button type="button" title="오른쪽 정렬" onClick={() => runStyleAction("오른쪽 정렬")}>우</button>
              </span>
              <span className="table-ribbon-group" aria-label="세로 정렬">
                <button type="button" title="위쪽 정렬" aria-label="상" onClick={() => runStyleAction("위쪽 정렬")}>
                  <AlignTopIcon />
                </button>
                <button type="button" title="세로 가운데 정렬" aria-label="중" onClick={() => runStyleAction("세로 가운데 정렬")}>
                  <AlignMiddleIcon />
                </button>
                <button type="button" title="아래쪽 정렬" aria-label="하" onClick={() => runStyleAction("아래쪽 정렬")}>
                  <AlignBottomIcon />
                </button>
              </span>
              <span className="table-ribbon-group" aria-label="테두리">
                <button type="button" title="테두리" aria-label="테두리" disabled>
                  <BorderIcon />
                  <span>테두리</span>
                </button>
              </span>
              <span className="table-mini-swatches" aria-label="배경색">
                <span className="table-ribbon-label">배경색</span>
                {TABLE_BG_SWATCHES.map((color, index) => (
                  <button
                    key={color || "transparent"}
                    type="button"
                    title={color ? "배경색" : "배경 지우기"}
                    onClick={() => runBackground(index)}
                    style={{ backgroundColor: color || "#ffffff" }}
                  />
                ))}
              </span>
            </div>

            {menu && (
              <div
                className="table-context-menu"
                style={{ left: menu.x, top: menu.y }}
                onPointerDown={stopToolbarPointer}
                role="menu"
              >
                {TABLE_CONTEXT_ITEMS.map((item, index) => (
                  <Fragment key={item.label}>
                    {index === 2 || index === 6 || index === 8 ? <div className="table-context-separator" /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => item.action && runTableAction(item.action)}
                    >
                      {item.label}
                    </button>
                  </Fragment>
                ))}
                <div className="table-context-separator" />
                <div className="table-context-palette" aria-label="배경색">
                  <span>배경색</span>
                  <div>
                    {TABLE_BG_SWATCHES.map((color, index) => (
                      <button
                        key={color || "transparent"}
                        type="button"
                        title={color ? "배경색" : "배경 지우기"}
                        onClick={() => runBackground(index)}
                        style={{ backgroundColor: color || "#ffffff" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 병합 미리보기용 정적 표 — 병합·행별 너비 반영, 토큰은 값으로 치환
function StaticResolvedTable({
  data,
  columns,
  row,
}: {
  data: TableKingData;
  columns: string[];
  row: string[];
}) {
  const cellsText = tableDataToRows(data) as string[][];
  const merges = data.merges ?? [];
  const covered = (r: number, c: number) =>
    merges.some((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c));
  const mergeAt = (r: number, c: number) => merges.find((m) => m.r === r && m.c === c);

  return (
    <table
      className="border-collapse text-[12px] text-ink"
      style={{ tableLayout: "fixed", width: data.widths[0]?.reduce((s, v) => s + v, 0) }}
    >
      <colgroup>
        {(data.widths[0] ?? []).map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {cellsText.map((r, ri) => (
          <tr key={ri} style={{ height: data.cellHeights[ri]?.[0] ?? 30 }}>
            {r.map((cell, ci) => {
              if (covered(ri, ci)) return null;
              const m = mergeAt(ri, ci);
              const resolved = resolveTokens(cell, columns, row);
              const changed = resolved !== cell;
              return (
                <td
                  key={ci}
                  colSpan={m?.cs ?? 1}
                  rowSpan={m?.rs ?? 1}
                  className={`border border-linestrong px-1.5 ${ri === 0 ? "bg-paper font-medium" : ""}`}
                >
                  {changed ? (
                    <span className="bg-emerald-50 text-emerald-700 rounded-[2px] px-0.5">{resolved}</span>
                  ) : (
                    resolved
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}



















