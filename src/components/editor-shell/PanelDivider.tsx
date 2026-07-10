// PanelDivider.tsx — 좌·우 사이드바와 캔버스 사이의 경계. 드래그로 폭 조절한다.
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  LEFT_DEFAULT,
  RIGHT_DEFAULT,
  usePanelStore,
} from "../../modules/ui/theme";

export function PanelDivider({ side }: { side: "left" | "right" }) {
  const leftW = usePanelStore((s) => s.leftW);
  const rightW = usePanelStore((s) => s.rightW);
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const rightOpen = usePanelStore((s) => s.rightOpen);
  const setLeftW = usePanelStore((s) => s.setLeftW);
  const setRightW = usePanelStore((s) => s.setRightW);

  const [dragging, setDragging] = useState(false);
  const [previewW, setPreviewW] = useState<number | null>(null);

  const open = side === "left" ? leftOpen : rightOpen;
  const width = side === "left" ? leftW : rightW;
  const setWidth = side === "left" ? setLeftW : setRightW;
  const defaultW = side === "left" ? LEFT_DEFAULT : RIGHT_DEFAULT;

  // 드래그 리사이즈 — 열려 있을 때만. 좌측은 +dx, 우측은 -dx(경계가 안쪽으로 이동).
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!open) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    setPreviewW(startW);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const nextW = side === "left" ? startW + dx : startW - dx;
      setWidth(nextW);
      setPreviewW(usePanelStore.getState()[side === "left" ? "leftW" : "rightW"]);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
      setPreviewW(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const resetWidth = () => {
    if (!open) return;
    setWidth(defaultW);
  };
  const label = side === "left" ? "왼쪽 사이드바" : "오른쪽 사이드바";

  return (
    <div
      onPointerDown={startResize}
      onDoubleClick={resetWidth}
      title={`${label} 너비 조절 · 더블클릭 기본폭`}
      className={`studio-panel-divider relative shrink-0 h-full group/divider ${open ? "cursor-col-resize" : ""}`}
      style={{
        width: 12,
        marginLeft: side === "left" ? -4 : 0,
        marginRight: side === "right" ? -4 : 0,
        zIndex: 30,
      }}
    >
      {/* 넓은 히트 영역 + 중앙 경계선 */}
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full transition-colors ${
          dragging ? "bg-accent" : "bg-line group-hover/divider:bg-accent"
        }`}
      />

      {/* 드래그 그립 — 항상 희미하게 보이게 해서 '잡을 수 있음'을 알려준다 */}
      <div
        aria-hidden="true"
        className={`studio-divider-grip absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-14 rounded-full border transition-all flex items-center justify-center ${
          dragging
            ? "bg-accent text-onaccent border-accent shadow-[0_4px_14px_rgba(43,92,230,.28)]"
            : "bg-surface/95 text-inkfaint border-line opacity-55 group-hover/divider:opacity-100 group-hover/divider:text-accent group-hover/divider:border-accentline shadow-sm"
        }`}
      >
        <span className="flex flex-col gap-1">
          <span className="w-1 h-1 rounded-full bg-current" />
          <span className="w-1 h-1 rounded-full bg-current" />
          <span className="w-1 h-1 rounded-full bg-current" />
        </span>
      </div>

      {dragging && previewW !== null && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 rounded-md bg-ink text-surface text-[11px] font-semibold px-2 py-1 shadow-lg pointer-events-none tabular-nums ${
            side === "left" ? "left-4" : "right-4"
          }`}
        >
          {previewW}px
        </div>
      )}
    </div>
  );
}



