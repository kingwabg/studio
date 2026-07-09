// PanelDivider.tsx — 좌·우 사이드바와 캔버스 사이의 경계. 드래그로 폭 조절(밀고 당기기),
// 가운데 손잡이 버튼으로 접기/펴기. 상태는 usePanelStore(localStorage 유지).
import { usePanelStore } from "../../modules/ui/theme";

export function PanelDivider({ side }: { side: "left" | "right" }) {
  const leftW = usePanelStore((s) => s.leftW);
  const rightW = usePanelStore((s) => s.rightW);
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const rightOpen = usePanelStore((s) => s.rightOpen);
  const setLeftW = usePanelStore((s) => s.setLeftW);
  const setRightW = usePanelStore((s) => s.setRightW);
  const toggleLeft = usePanelStore((s) => s.toggleLeft);
  const toggleRight = usePanelStore((s) => s.toggleRight);

  const open = side === "left" ? leftOpen : rightOpen;
  const toggle = side === "left" ? toggleLeft : toggleRight;

  // 드래그 리사이즈 — 열려 있을 때만. 좌측은 +dx, 우측은 −dx(경계가 안쪽으로 이동).
  const startResize = (e: React.PointerEvent) => {
    if (!open) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftW : rightW;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = side === "left" ? startW + dx : startW - dx;
      (side === "left" ? setLeftW : setRightW)(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // 접힘 방향에 따른 손잡이 화살표 (‹ ›) — 열림/닫힘 × 좌/우
  const chevronLeft = side === "left" ? open : !open; // 왼쪽을 가리키면 접기(왼) / 펴기(오)
  return (
    <div
      onPointerDown={startResize}
      className={`relative shrink-0 h-full group/divider ${open ? "cursor-col-resize" : ""}`}
      style={{ width: 7, marginLeft: side === "left" ? -3 : 0, marginRight: side === "right" ? -3 : 0, zIndex: 30 }}
    >
      {/* 경계선 — 호버 시 강조 */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-line group-hover/divider:bg-accent transition-colors" />
      {/* 손잡이 (접기/펴기) */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
        title={open ? "접기" : "펴기"}
        aria-label={open ? "패널 접기" : "패널 펴기"}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-9 rounded-md bg-surface border border-line text-inkfaint hover:text-accent hover:border-accentline flex items-center justify-center opacity-0 group-hover/divider:opacity-100 transition-all shadow-sm"
        style={{ opacity: open ? undefined : 1 }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d={chevronLeft ? "M6.5 2l-3 3 3 3" : "M3.5 2l3 3-3 3"}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
