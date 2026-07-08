// LeftPanel.tsx — 블록 팔레트(드래그 소스) + 레이어 목록.
// 팔레트 항목을 지면으로 끌어다 놓으면 StudioEditor의 onDragEnd가 블록을 추가한다.
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type BlockType } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";

const PALETTE: { type: BlockType; label: string }[] = [
  { type: "text", label: "텍스트" },
  { type: "table", label: "표" },
  { type: "image", label: "이미지" },
];

function PaletteItem({ type, label }: { type: BlockType; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { kind: "palette", type },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 cursor-grab select-none hover:border-blue-400 hover:text-blue-600 ${
        isDragging ? "opacity-60 shadow-md z-50" : ""
      }`}
    >
      {label}
    </div>
  );
}

export function LeftPanel() {
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="px-3 py-3 border-b border-slate-100">
        <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">블록</p>
        <div className="flex flex-col gap-2">
          {PALETTE.map((p) => (
            <PaletteItem key={p.type} type={p.type} label={p.label} />
          ))}
        </div>
      </div>
      <div className="px-3 py-3 flex-1 overflow-auto">
        <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">
          레이어 ({blocks.length})
        </p>
        <div className="flex flex-col gap-1">
          {blocks.map((b) => (
            <button
              key={b.id}
              onClick={() => select(b.id)}
              className={`text-left px-2 py-1.5 rounded text-[12px] truncate ${
                selectedId === b.id ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {b.type === "text" ? `텍스트 · ${b.text ?? ""}` : b.type === "table" ? "표" : "이미지"}
            </button>
          ))}
          {blocks.length === 0 && <p className="text-[12px] text-slate-300">아직 블록이 없습니다</p>}
        </div>
      </div>
    </aside>
  );
}
