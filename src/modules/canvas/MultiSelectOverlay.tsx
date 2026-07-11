// MultiSelectOverlay.tsx — 2개 이상 선택 시 지면에 뜨는 바운딩 박스 + 플로팅 그룹 툴바.
// "Ctrl로 여러 개 잡아 → 묶기 → 그룹" 인터랙션의 핵심 UI.
// 공간 그룹(groupId)은 논리 트리(parentId)와 직교 — 개요·펴기에 관여 안 함.
import { useEffect, useState } from "react";
import { useCanvasStore } from "./store";
import { useFollowStore } from "./snap";
import { collapsedHiddenIds, moveSetIds } from "../document/model";
import { blocksAtPoint, clampDeltaToSafeArea } from "./gesture";
import { mmToPx, pxToMm } from "./geometry";

const ACCENT = "#256EF4";

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
        danger ? "text-inksoft hover:bg-[color:var(--cat-red-soft)] hover:text-[color:var(--cat-red)]" : "text-inksoft hover:bg-paper hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function MultiSelectOverlay() {
  const doc = useCanvasStore((s) => s.doc);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const group = useCanvasStore((s) => s.groupSelection);
  const ungroup = useCanvasStore((s) => s.ungroupSelection);
  const align = useCanvasStore((s) => s.alignSelection);
  const setLocked = useCanvasStore((s) => s.setLocked);
  const removeSelection = useCanvasStore((s) => s.removeSelection);
  const nudgeMany = useCanvasStore((s) => s.nudgeMany);
  const select = useCanvasStore((s) => s.select);
  const selectGroup = useCanvasStore((s) => s.selectGroup);
  const selectMany = useCanvasStore((s) => s.selectMany);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // 드래그 중 시각 델타(px) — 이동은 transform으로만 보여주고, 스토어 커밋은 놓을 때 1회.
  // (예전엔 1mm 스텝마다 nudgeMany로 커밋 → 양자화 + 전체 리렌더로 끊기듯 움직였다)
  const [dragPx, setDragPx] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      setEditingTextId(detail?.blockId ?? null);
    };
    const onEnd = () => setEditingTextId(null);
    window.addEventListener("studio:text-editing-start", onStart);
    window.addEventListener("studio:text-editing-end", onEnd);
    return () => {
      window.removeEventListener("studio:text-editing-start", onStart);
      window.removeEventListener("studio:text-editing-end", onEnd);
    };
  }, []);

  if (selectedIds.length < 2) return null;
  const sel = doc.blocks.filter((b) => selectedIds.includes(b.id));
  if (sel.length < 2) return null;

  const x1 = Math.min(...sel.map((b) => b.x));
  const y1 = Math.min(...sel.map((b) => b.y));
  const x2 = Math.max(...sel.map((b) => b.x + b.w));
  const y2 = Math.max(...sel.map((b) => b.y + b.h));
  const gid = sel[0].groupId;
  const isGroup = !!gid && sel.every((b) => b.groupId === gid);
  const anyLocked = sel.some((b) => b.locked);
  const editingSelectedText = !!editingTextId && selectedIds.includes(editingTextId);

  const left = mmToPx(x1);
  const top = mmToPx(y1);
  const w = mmToPx(x2 - x1);
  const h = mmToPx(y2 - y1);

  const textBlockAtPoint = (clientX: number, clientY: number, overlay: HTMLElement) => {
    overlay.style.pointerEvents = "none";
    const hitboxes = Array.from(document.querySelectorAll<HTMLElement>("[data-text-hitbox]"));
    overlay.style.pointerEvents = "";
    const hits = hitboxes
      .map((hitbox) => {
        const rect = hitbox.getBoundingClientRect();
        const blockId = hitbox.dataset.textHitbox;
        const block = doc.blocks.find((item) => item.id === blockId && item.type === "text");
        if (!block) return null;
        const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        if (!inside) return null;
        return { block, area: rect.width * rect.height };
      })
      .filter(Boolean) as { block: (typeof doc.blocks)[number]; area: number }[];
    hits.sort((a, b) => a.area - b.area);
    return hits[0]?.block ?? null;
  };

  const focusSelectionAtPoint = (clientX: number, clientY: number, overlay: HTMLElement) => {
    const block = textBlockAtPoint(clientX, clientY, overlay);
    if (!block) return null;
    if (block.groupId) selectGroup(block.id);
    else if (selectedIds.includes(block.id)) selectMany([...selectedIds.filter((id) => id !== block.id), block.id]);
    else select(block.id);
    return block;
  };

  const openTextAtPoint = (clientX: number, clientY: number, overlay: HTMLElement) => {
    const block = focusSelectionAtPoint(clientX, clientY, overlay);
    if (!block) return;
    window.dispatchEvent(
      new CustomEvent("studio:edit-text-block", {
        detail: { blockId: block.id, x: clientX, y: clientY },
      })
    );
  };

  const openTextUnderOverlay = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openTextAtPoint(e.clientX, e.clientY, e.currentTarget);
  };
  // 오버레이가 덮은 지점의 최상단 블록 (모델 좌표 점 히트 — 접힌 블록 제외, 배열 순서 = z)
  const topBlockAtClient = (clientX: number, clientY: number) => {
    const pageEl = document.querySelector<HTMLElement>(".studio-page");
    if (!pageEl) return null;
    const r = pageEl.getBoundingClientRect();
    // rect 비례 환산 — 줌 배율과 무관하게 mm가 나온다
    const xMm = ((clientX - r.left) / r.width) * doc.page.w;
    const yMm = ((clientY - r.top) / r.height) * doc.page.h;
    const hiddenIds = collapsedHiddenIds(doc.blocks);
    const hits = blocksAtPoint(doc.blocks, xMm, yMm).filter((b) => !hiddenIds.has(b.id));
    return hits[hits.length - 1] ?? null;
  };

  const startOverlayDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    // 겹친 비선택 블록 클릭 구제(전 타입) — bbox 안이라도 맨 위가 선택 밖 블록이면
    // 오버레이가 가로채지 않고 그 블록을 선택한다 (피그마 동일). 이전엔 텍스트만 구제됐다.
    const top = topBlockAtClient(e.clientX, e.clientY);
    if (top && !selectedIds.includes(top.id)) {
      e.preventDefault();
      e.stopPropagation();
      if (top.groupId) selectGroup(top.id);
      else select(top.id);
      return;
    }
    focusSelectionAtPoint(e.clientX, e.clientY, e.currentTarget);
    if (e.detail >= 2) {
      e.preventDefault();
      e.stopPropagation();
      openTextAtPoint(e.clientX, e.clientY, e.currentTarget);
      return;
    }
    if (anyLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    // 함께 움직일 집합(트리 자손·그룹 확장)은 드래그당 1회 계산 — 단일 드래그와 동일 규칙
    const members = moveSetIds(doc.blocks, selectedIds);
    const moving = doc.blocks.filter((b) => members.has(b.id) && !b.locked);
    const SENTINEL = "__multi-overlay__"; // 실제 블록 id가 아니어서 모든 멤버가 follow
    const onMove = (ev: PointerEvent) => {
      // 이동 중에도 안전여백 클램프 — 시각이 여백 밖으로 나갔다 커밋에서 되돌아오는 어긋남 방지.
      // ⚠ 비반올림(gesture) 버전 — store 버전(정수 반올림)을 쓰면 1mm(3.78px) 양자화로 끊긴다.
      const c = clampDeltaToSafeArea(moving, pxToMm(ev.clientX - start.x), pxToMm(ev.clientY - start.y), doc.page);
      const dx = mmToPx(c.dx);
      const dy = mmToPx(c.dy);
      setDragPx({ x: dx, y: dy });
      useFollowStore.getState().setFollow(SENTINEL, dx, dy, members);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      useFollowStore.getState().clear();
      setDragPx(null);
      const c = clampDeltaToSafeArea(moving, pxToMm(ev.clientX - start.x), pxToMm(ev.clientY - start.y), doc.page);
      if (Math.round(c.dx) || Math.round(c.dy)) nudgeMany(selectedIds, c.dx, c.dy); // 커밋 1회(정수화는 store가)
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <>
      {/* 바운딩 박스 — 클릭/드래그하면 선택 전체를 한 덩어리처럼 이동한다. */}
      <div
        className={`absolute z-[11] rounded-lg ${editingSelectedText ? "pointer-events-none" : anyLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={editingSelectedText ? undefined : startOverlayDrag}
        onDoubleClick={openTextUnderOverlay}
        style={{
          left: left - 4,
          top: top - 4,
          width: w + 8,
          height: h + 8,
          transform: dragPx ? `translate3d(${dragPx.x}px, ${dragPx.y}px, 0)` : undefined,
          border: isGroup ? `1.5px solid ${ACCENT}` : `1.5px dashed ${ACCENT}`,
          background: "rgba(37,110,244,.025)",
          touchAction: "none",
        }}
      >
        <span className="absolute -top-[11px] left-3 px-1.5 py-0.5 text-[10px] font-bold rounded-sm text-white pointer-events-none" style={{ background: ACCENT }}>
          {isGroup ? "그룹" : `${sel.length}개 선택`}
        </span>
      </div>

      {/* 플로팅 그룹 툴바 — 바운딩 위 중앙 (드래그 중엔 숨김) */}
      {!editingSelectedText && !dragPx && (
      <div
        className="absolute z-40 flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
        style={{ left: left + w / 2, top: top - 48, transform: "translateX(-50%)", boxShadow: "var(--sh-pop)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isGroup ? (
          <button onClick={ungroup} title="그룹 해제 (⌘⇧G)" className="h-8 px-2.5 rounded-lg text-[12px] font-bold text-accent bg-accentsoft hover:bg-accent hover:text-onaccent flex items-center gap-1.5 transition-colors">
            <GlyphUngroup /> 해제
          </button>
        ) : (
          <button onClick={group} title="그룹 묶기 (⌘G) — 함께 이동" className="h-8 px-2.5 rounded-lg text-[12px] font-bold text-accent bg-accentsoft hover:bg-accent hover:text-onaccent flex items-center gap-1.5 transition-colors">
            <GlyphGroup /> 묶기
          </button>
        )}
        <span className="w-px h-4 bg-line mx-0.5" />
        <IconBtn title="왼쪽 정렬" onClick={() => align("left")}><GlyphAlign d="M2 2v10M4.5 4h7M4.5 8h4" /></IconBtn>
        <IconBtn title="가운데 정렬(가로)" onClick={() => align("hcenter")}><GlyphAlign d="M7 2v10M3.5 4h7M4.5 8h5" /></IconBtn>
        <IconBtn title="오른쪽 정렬" onClick={() => align("right")}><GlyphAlign d="M12 2v10M2.5 4h7M6 8h4" /></IconBtn>
        <IconBtn title="위 정렬" onClick={() => align("top")}><GlyphAlign d="M2 2h10M4 4.5v7M8 4.5v4" /></IconBtn>
        <IconBtn title="아래 정렬" onClick={() => align("bottom")}><GlyphAlign d="M2 12h10M4 2.5v7M8 5.5v4" /></IconBtn>
        <span className="w-px h-4 bg-line mx-0.5" />
        {isGroup ? (
          // 그룹 고정 — 멤버 전부 잠가 절대배치로 못 움직이게 핀. 해제는 고정 배지·이 버튼.
          <button
            onClick={() => setLocked(selectedIds, !anyLocked)}
            title={anyLocked ? "그룹 고정 해제" : "그룹 고정 (절대배치로 잠금)"}
            className={`h-8 px-2.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5 transition-colors ${
              anyLocked ? "bg-ink text-white hover:bg-inksoft" : "text-inksoft hover:bg-paper hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d={anyLocked ? "M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" : "M4.6 6V4.4a2.4 2.4 0 0 1 4.4-1.3M2.6 6h8.8v6H2.6z"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {anyLocked ? "고정됨" : "고정"}
          </button>
        ) : (
          <IconBtn title={anyLocked ? "잠금 해제" : "잠금"} onClick={() => setLocked(selectedIds, !anyLocked)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d={anyLocked ? "M4.6 6V4.4a2.4 2.4 0 0 1 4.4-1.3M2.6 6h8.8v6H2.6z" : "M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
        )}
        <IconBtn title="선택 삭제" onClick={removeSelection} danger>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.4 3.8h9.2M5.4 3.8V2.6a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.2M3.6 3.8l.5 7.2a1.2 1.2 0 0 0 1.2 1.2h3.4a1.2 1.2 0 0 0 1.2-1.2l.5-7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </IconBtn>
      </div>
      )}
    </>
  );
}

const GlyphAlign = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
);
const GlyphGroup = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 4h3.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
);
const GlyphUngroup = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.5 1.3" /><rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.5 1.3" /></svg>
);









