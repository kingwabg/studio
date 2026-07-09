// MultiSelectOverlay.tsx — 2개 이상 선택 시 지면에 뜨는 바운딩 박스 + 플로팅 그룹 툴바.
// "Ctrl로 여러 개 잡아 → 묶기 → 그룹" 인터랙션의 핵심 UI.
// 공간 그룹(groupId)은 논리 트리(parentId)와 직교 — 개요·펴기에 관여 안 함.
import { useCanvasStore } from "./store";
import { mmToPx } from "./geometry";

const ACCENT = "#2B5CE6";

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

  const left = mmToPx(x1);
  const top = mmToPx(y1);
  const w = mmToPx(x2 - x1);
  const h = mmToPx(y2 - y1);

  return (
    <>
      {/* 바운딩 박스 — 그룹이면 실선, 임시 다중선택이면 점선 */}
      <div
        className="absolute pointer-events-none z-[11] rounded-lg"
        style={{
          left: left - 4,
          top: top - 4,
          width: w + 8,
          height: h + 8,
          border: isGroup ? `1.5px solid ${ACCENT}` : `1.5px dashed ${ACCENT}`,
          background: "rgba(43,92,230,.04)",
        }}
      >
        <span className="absolute -top-[11px] left-3 px-1.5 py-0.5 text-[10px] font-bold rounded-sm text-white" style={{ background: ACCENT }}>
          {isGroup ? "그룹" : `${sel.length}개 선택`}
        </span>
      </div>

      {/* 플로팅 그룹 툴바 — 바운딩 위 중앙 */}
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
        <IconBtn title={anyLocked ? "잠금 해제" : "잠금"} onClick={() => setLocked(selectedIds, !anyLocked)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d={anyLocked ? "M4.6 6V4.4a2.4 2.4 0 0 1 4.4-1.3M2.6 6h8.8v6H2.6z" : "M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconBtn>
        <IconBtn title="선택 삭제" onClick={removeSelection} danger>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.4 3.8h9.2M5.4 3.8V2.6a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.2M3.6 3.8l.5 7.2a1.2 1.2 0 0 0 1.2 1.2h3.4a1.2 1.2 0 0 0 1.2-1.2l.5-7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </IconBtn>
      </div>
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
