// RibbonDropdown.tsx — 포맷 툴바의 드롭다운 셸(정렬·표정렬·표테두리 공용).
// ColorPopover와 같은 열림/닫힘 규약(로컬 open + 바깥 pointerdown/Escape).
// ⚠ 패널은 portal로 body에 렌더한다 — .studio-toolbar-shell이 overflow-y:hidden이라
//   일반 absolute 패널은 잘린다(InlineToolbar와 같은 회피). 위치는 트리거 rect로 계산.
// EditorToolbar는 이 셸에 메뉴 내용만 끼워 넣어 배선만 담당한다(성장 규칙).
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type RibbonDropdownProps = {
  label: string; // 트리거에 보이는 글자(예: "텍스트 정렬")
  icon: ReactNode; // 트리거 앞 아이콘
  title?: string; // 툴팁 — 없으면 label
  children: ReactNode; // 패널 내용
};

function Chevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: "var(--inkfaint)" }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RibbonDropdown({ label, icon, title, children }: RibbonDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // portal 대상 = 에디터 셸. body로 보내면 퍼플 토큰(var(--accent))이 상속 안 됨.
  // 셸은 transform/filter가 없어 fixed 좌표가 뷰포트 기준으로 정확(툴바 backdrop-filter/
  // overflow는 탈출). 셸이 없으면 body 폴백.
  const portalTarget: HTMLElement =
    triggerRef.current?.closest<HTMLElement>(".studio-editor-shell") ??
    (typeof document !== "undefined" ? document.body : (null as unknown as HTMLElement));

  // 트리거 바로 아래로 패널 위치 계산 (fixed = 뷰포트 좌표 = getBoundingClientRect)
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 9 });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title ?? label}
        className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-bold transition-colors ${
          open ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span className="whitespace-nowrap">{label}</span>
        <Chevron />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] flex flex-col gap-3 rounded-[13px] border border-line bg-surface p-[13px] text-ink"
            style={{ left: pos.left, top: pos.top, boxShadow: "var(--sh-pop)" }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </div>,
          portalTarget
        )}
    </>
  );
}

// 패널 안의 라벨 있는 묶음(예: "가로" / "세로").
export function DropSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold tracking-[.06em] text-inkfaint">{label}</div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

// 패널 안의 32×32 아이콘 선택 버튼 — active면 퍼플 소프트.
export function DropIconButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        active ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
