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
import { useFollowStore, useGuideStore } from "./snap";
import { dragMemberIds, planMove } from "./gesture";
import { scaleHeights, scaleWidths } from "./tableScale";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { IcGrip, IcCopy, IcImage, IcTrash } from "../../ui/icons";
import { TableKingBlock, makeTableKingData, tableDataToRows } from "../../table-king/TableKingBlock.jsx";
// 외곽 리사이즈의 콘텐츠 하한(텍스트가 안 잘리는 최소 폭/높이) — 경계 드래그와 같은 규칙 공유
import { buildContentMinWidths, buildContentMinRows } from "../../table-king/hooks/useBoundaryDrag";
import { MIN_COL_W as TK_MIN_COL_W, MIN_ROW_H as TK_MIN_ROW_H } from "../../table-king/table/constants.js";
import "../../table-king/table-king.css";

import { LEGACY_TEXT_INK, TEXT_BORDER, TEXT_SURFACE, measureNaturalWidthPx } from "../richtext";

const MIN_W = 12; // mm
const MIN_H = 8; // mm
const PAGE_MARGIN_MM = 20; // A4 안전 여백 기준
// 색 상수·normalizeTextColor는 richtext/style로 이동 — 아래 둘은 셸(테두리·채움) 전용이라 남긴다.
const normalizeTextBorderColor = (color?: string) => (!color || color.toUpperCase() === LEGACY_TEXT_INK ? TEXT_BORDER : color);
const normalizeTextFill = (fill?: string) => (!fill || fill === "transparent" || fill === "rgba(0, 0, 0, 0)" ? TEXT_SURFACE : fill);

import { ImageContent } from "./ImageContent";
import { TextContent } from "./TextContent";
import { TableKingContent } from "./TableContent";


// ⚠ memo — 마퀴/오버레이 등 CanvasStage의 로컬 상태 변경이 모든 블록(무거운 table-king
// 포함)을 재렌더하지 않게 한다. 스토어는 블록을 불변 갱신(변경 블록만 새 참조)하므로
// block 참조 비교로 충분하고, 선택·팔로우 등 반응 상태는 내부 zustand 구독이 처리한다.
export const CanvasBlock = memo(function CanvasBlock({ block }: { block: Block }) {
  const select = useCanvasStore((s) => s.select);
  const selectGroup = useCanvasStore((s) => s.selectGroup);
  const toggleSelect = useCanvasStore((s) => s.toggleSelect);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const setTableData = useCanvasStore((s) => s.setTableData);
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
  const textClickPoint = (e: RMouseEvent<HTMLDivElement> | RPointerEvent<HTMLDivElement>) => {
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

  useEffect(() => {
    if (!isTable || !selected || editing || locked) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (event.key === "Enter") {
        event.preventDefault();
        setEditing(true);
      }
      if (event.key === "F5") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, isTable, locked, selected]);
  // 더블클릭 진입. 표: 셀 편집 모드(그전엔 객체 선택=이동). 텍스트: 글자 편집.
  const handleBlockDoubleClick = (e: RMouseEvent<HTMLDivElement>) => {
    if (locked) return;
    if (isTable) {
      setEditing(true); // 표 = 객체 선택 → 더블클릭으로 셀 편집(table-king active)
      return;
    }
    if (block.type !== "text") return;
    // 더블클릭도 상자 안 어디서든 진입 (히트박스 게이트 제거 — 위 onPointerDown과 동일 정책)
    setTextCaretPoint(textClickPoint(e));
    setEditing(true);
  };
  const startObjectBorderMove = (e: RPointerEvent) => {
    if ((!isTable && !isText) || locked || editing) return;
    e.stopPropagation();
    e.preventDefault();
    selectBlockOrGroup();
    const start = { px: e.clientX, py: e.clientY, x: block.x, y: block.y };
    // ⚠ 이동 중 store 갱신 금지 — 매 pointermove마다 updateBlock하면 table-king 그리드·
    //   인스펙터·눈금자가 전부 프레임마다 리렌더되고, mm 반올림 탓에 3.78px씩 튄다(버벅임).
    //   dnd-kit 경로와 동일한 planMove(클램프→자석 스냅→재클램프, gesture.ts) + 래퍼 transform.
    //   자손은 FollowStore로 동반, 커밋은 moveBlock/nudgeMany 1회 — 이동 수식 3중 구현 해소.
    const node = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-block-id]");
    const st0 = useCanvasStore.getState();
    const members = dragMemberIds(st0.doc.blocks, st0.selectedIds, block);
    let last = { x: start.x, y: start.y };
    const onMove = (ev: globalThis.PointerEvent) => {
      const plan = planMove(
        useCanvasStore.getState().doc,
        block,
        start.x + pxToMm(ev.clientX - start.px),
        start.y + pxToMm(ev.clientY - start.py),
        members
      );
      last = plan;
      useGuideStore.getState().setGuides(plan.guides, plan.badges);
      const dxPx = mmToPx(plan.x - start.x);
      const dyPx = mmToPx(plan.y - start.y);
      if (node) node.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)`;
      useFollowStore.getState().setFollow(block.id, dxPx, dyPx, members);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      useGuideStore.getState().clear();
      useFollowStore.getState().clear();
      // 커밋(반올림) 후 transform 해제 — pointerup은 discrete 이벤트라 페인트 전에 플러시됨.
      // 다중 선택이면 dnd-kit dragEnd와 동일하게 선택 전체를 같은 델타로.
      const st = useCanvasStore.getState();
      if (st.selectedIds.length > 1 && st.selectedIds.includes(block.id))
        st.nudgeMany(st.selectedIds, last.x - start.x, last.y - start.y);
      else st.moveBlock(block.id, Math.round(last.x), Math.round(last.y));
      if (node) node.style.transform = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startResize = (e: RPointerEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault();
    const s = { px: e.clientX, py: e.clientY, x: block.x, y: block.y, w: block.w, h: block.h };
    // 표: 이동과 같은 규약 — 미리보기는 래퍼 transform(그리드·텍스트·배경이 한 덩어리로
    // 붙어 움직임), 커밋은 pointerup 1회. 프레임마다 setTableData하면 내부 state↔store
    // 왕복 동기가 한 프레임씩 어긋나 "내용물이 표에서 분리돼 보이는" 증상이 났다(보고 ①).
    // 스케일 하한 = 콘텐츠 최소 폭/높이(경계 드래그와 같은 규칙) — 텍스트보다 작아질 수 없다(보고 ⑤).
    const isTableResize = block.type === "table";
    const tableStartData = isTableResize
      ? (block.data ?? (makeTableKingData(block.rows ?? [[""]], mmToPx(s.w)) as TableKingData))
      : null;
    let minScaleX = 0;
    let minScaleY = 0;
    if (tableStartData) {
      const minW = buildContentMinWidths(tableStartData.cells) as number[][];
      // 실제 셀 상하 여백(padOf)을 하한 공식에 반영 — 경계 드래그(TableContent 주입)와 같은 규칙
      const minRows = buildContentMinRows(tableStartData.cells, mmToPx(padOf(block).y) * 2) as number[];
      tableStartData.widths.forEach((row, r) =>
        row.forEach((w0, c) => {
          if (w0 > 0) minScaleX = Math.max(minScaleX, Math.max(TABLE_RESIZE_MIN_COL_W, minW[r]?.[c] ?? 0) / w0);
        })
      );
      tableStartData.cellHeights.forEach((row, r) =>
        row.forEach((h0) => {
          if (h0 > 0) minScaleY = Math.max(minScaleY, Math.max(TABLE_RESIZE_MIN_ROW_H, minRows[r] ?? 0) / h0);
        })
      );
    }
    const resizeNode = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-block-id]");
    let tableLast: { sx: number; sy: number } | null = null;
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
      if (isTableResize && tableStartData) {
        const floorX = minScaleX > 0 ? Math.min(minScaleX, 1) : 0; // 이미 하한 이하인 표는 현 크기가 바닥
        const floorY = minScaleY > 0 ? Math.min(minScaleY, 1) : 0;
        const sx = Math.max(floorX, s.w > 0 ? w / s.w : 1);
        const sy = Math.max(floorY, s.h > 0 ? h / s.h : 1);
        tableLast = { sx, sy };
        if (resizeNode) {
          // 고정 모서리(끄는 방향의 반대)를 origin으로 — 위치+크기가 한 transform으로 표현됨
          resizeNode.style.transformOrigin = `${dir.includes("w") ? "right" : "left"} ${dir.includes("n") ? "bottom" : "top"}`;
          resizeNode.style.transform = `scale(${sx}, ${sy})`;
        }
      } else if (block.type === "text") {
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
      if (isTableResize && tableStartData) {
        if (resizeNode) {
          resizeNode.style.transform = "";
          resizeNode.style.transformOrigin = "";
        }
        if (tableLast) {
          const { sx, sy } = tableLast;
          // 원자 커밋 1회 — 위치+데이터를 setTableData(pos)로 함께. 따로 커밋하면
          // ①히스토리가 2항목으로 갈라져 Ctrl+Z 한 번에 반쪽만 풀리고 ②updateBlock이
          // 낡은 w로 x를 클램프해 미리보기와 다른 자리에 착지했다(감사 E2 CONFIRMED).
          const wMm = s.w * sx;
          const hMm = s.h * sy;
          const nx = dir.includes("w") ? s.x + (s.w - wMm) : s.x;
          const ny = dir.includes("n") ? s.y + (s.h - hMm) : s.y;
          setTableData(block.id, scaleTableKingData(tableStartData, sx, sy), {
            x: Math.round(nx),
            y: Math.round(ny),
          });
        }
      }
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
        if (isText) {
          // 블록 상자 안이면 어디를 눌러도 편집 진입 — 글리프 히트박스 밖(여백)을 "빈 곳"으로
          // 취급해 선택 해제하던 게이트 제거. 캐럿은 textClickPoint가 마우스 위치를
          // 히트박스 안으로 클램프해 가장 가까운 지점에 놓는다(사용자 요청: 위치 기반 클릭).
          if (!(e.ctrlKey || e.metaKey || e.shiftKey) && !locked) {
            e.stopPropagation();
            selectBlockOrGroup();
            setTextCaretPoint(textClickPoint(e));
            setEditing(true);
            return;
          }
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
        isText || isTable ? "" : "bg-white"
      } ${
        isText || isTable
          ? "" // 텍스트/표: 바깥 블록 박스는 그리지 않는다
          : selected
            ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(37,110,244,0.18)]"
            : "outline outline-1 outline-line hover:outline-2 hover:outline-accent"
      } ${isDragging && !isTable ? "opacity-95 shadow-[0_8px_24px_rgba(26,34,51,0.18)]" : ""}`}
    >
      <div
        className={
          isText
            ? `rounded-[3px] overflow-hidden transition-[outline-color,box-shadow] ${
                selected
                  ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(37,110,244,0.18)]"
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
          // 세로 정렬(valign 설정 시만): 상자를 block.h까지 세로로 벌려(minHeight) 내용을
          // 위/가운데/아래로 배치. 내용이 더 크면 자라서 클리핑 없음(H5: valign 미설정=현행 auto).
          ...(isText && block.valign
            ? {
                display: "flex",
                flexDirection: "column" as const,
                justifyContent: block.valign === "center" ? "center" : block.valign === "bottom" ? "flex-end" : "flex-start",
                minHeight: mmToPx(block.h),
              }
            : {}),
        }}
      >
        {block.type === "text" ? (
          <TextContent block={block} editing={editing} initialCaretPoint={textCaretPoint} onDoneEditing={finishEditing} />
        ) : isTable ? (
          <TableKingContent
            block={block}
            active={editing}
            onEnterEditing={() => setEditing(true)}
            onExitEditing={() => setEditing(false)}
            resizeHandles={
              !editing && !locked
                ? (
                    <>
                      {selected && (
                        <div
                          title="표 이동"
                          data-table-object-surface="true"
                          onPointerDown={startObjectBorderMove}
                          className="table-object-move-surface absolute inset-0 z-20 rounded-[2px] cursor-move"
                        />
                      )}
                      {OBJECT_BORDER_HITBOXES.map((hitbox) => (
                        <div
                          key={hitbox.key}
                          title="표 이동"
                          data-table-object-border="true"
                          onPointerDown={startObjectBorderMove}
                          className="table-object-control absolute z-30"
                          style={hitbox.style}
                        />
                      ))}
                      {soleSelected && RESIZE_HANDLES.map((handle) => (
                        <div
                          key={handle.dir}
                          title="표 전체 크기 조절"
                          onPointerDown={(event) => startResize(event, handle.dir)}
                          className="table-object-control absolute z-40 bg-white border-[1.5px] border-accent rounded-[2px]"
                          style={handle.style}
                        />
                      ))}
                    </>
                  )
                : null
            }
          />
        ) : (
          <ImageContent block={block} locked={locked} />
        )}
      </div>

      {/* 고정 배지 — 클릭하면 해제(그룹이면 그룹 전체). 잠긴 요소는 플로팅바가 없어
          이 배지가 유일한 해제 통로다. */}
      {isText && !editing && !locked && (
        <>
          {TEXT_OBJECT_BORDER_HITBOXES.map((hitbox) => (
            <div
              key={hitbox.key}
              title="텍스트 이동"
              data-text-object-border="true"
              onPointerDown={startObjectBorderMove}
              className="text-object-control absolute z-30"
              style={hitbox.style}
            />
          ))}
        </>
      )}

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
                backgroundColor: "#256EF4",
                borderColor: "#FFFFFF",
                boxShadow: "0 0 0 2px #256EF4, 0 2px 10px rgba(37,110,244,0.38)",
                cursor: "default",
              }}
            />
          )}
          {/* 표 핸들은 실제 .table-frame 안에 렌더한다. 텍스트/이미지만 블록 기준 핸들을 사용한다. */}
          {!isTable && RESIZE_HANDLES.filter((handle) => (isText ? handle.dir.length === 2 : true)).map((handle) => (
            <div
              key={handle.dir}
              title={isText ? "폭 조절" : "크기 조절"}
              onPointerDown={(event) => startResize(event, handle.dir)}
              className="absolute z-30 bg-white border-[1.5px] border-accent rounded-[2px]"
              style={isText ? textWidthHandleStyle(handle.style) : handle.style}
            />
          ))}        </>
      )}
    </div>
  );
});

const HANDLE = 8;
const off = -HANDLE / 2;

// 표 엔진 최소 트랙과 같은 값 — 재선언 금지(값 표류 방지). table/constants.js가 단일 소스.
const TABLE_RESIZE_MIN_COL_W = TK_MIN_COL_W;
const TABLE_RESIZE_MIN_ROW_H = TK_MIN_ROW_H;
const OBJECT_BORDER_HITBOXES: { key: string; style: React.CSSProperties }[] = [
  { key: "top", style: { top: -6, left: 0, right: 0, height: 12, cursor: "move" } },
  { key: "right", style: { top: 0, right: -6, bottom: 0, width: 12, cursor: "move" } },
  { key: "bottom", style: { left: 0, right: 0, bottom: -6, height: 12, cursor: "move" } },
  { key: "left", style: { top: 0, left: -6, bottom: 0, width: 12, cursor: "move" } },
];
const TABLE_OBJECT_BORDER_HITBOXES = OBJECT_BORDER_HITBOXES;
const TEXT_OBJECT_BORDER_HITBOXES: { key: string; style: React.CSSProperties }[] = [
  { key: "top", style: { top: -8, left: 0, right: 0, height: 8, cursor: "move" } },
  { key: "right", style: { top: 0, right: -8, bottom: 0, width: 8, cursor: "move" } },
  { key: "bottom", style: { left: 0, right: 0, bottom: -8, height: 8, cursor: "move" } },
  { key: "left", style: { top: 0, left: -8, bottom: 0, width: 8, cursor: "move" } },
];

function scaleTableKingData(data: TableKingData, scaleX: number, scaleY: number): TableKingData {
  // ⚠ 경계(누적) 공간 반올림(tableScale.ts) — 셀 단위 독립 round는 공유 경계를 행마다
  //   1px씩 찢는다(표 감사 실측 170/169/170). 통선 드래그 그룹(EPS 0.6px)도 함께 깨진다.
  return {
    ...data,
    widths: scaleWidths(data.widths, scaleX, TABLE_RESIZE_MIN_COL_W),
    cellHeights: scaleHeights(data.cellHeights, scaleY, TABLE_RESIZE_MIN_ROW_H),
    merges: data.merges ?? [],
  };
}


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



















