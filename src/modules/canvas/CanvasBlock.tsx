// CanvasBlock.tsx — 지면 위 블록 하나. dnd-kit useDraggable로 이동, 클릭으로 선택.
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block } from "../document/model";
import { mmToPx } from "./geometry";
import { useCanvasStore } from "./store";

export function CanvasBlock({ block }: { block: Block }) {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const selected = selectedId === block.id;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      // 선택과 드래그를 한 핸들러로 합친다 — listeners를 스프레드한 뒤 onPointerDown을
      // 따로 주면 dnd 리스너가 덮여 드래그가 죽는다. 그래서 명시적으로 둘 다 호출.
      onPointerDown={(e) => {
        select(block.id);
        listeners?.onPointerDown?.(e);
      }}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        height: mmToPx(block.h),
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : selected ? 10 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
      className={`rounded-[3px] bg-white overflow-hidden select-none ${
        selected ? "outline outline-2 outline-blue-500" : "outline outline-1 outline-slate-300"
      } ${isDragging ? "opacity-90 shadow-lg" : ""}`}
    >
      <BlockContent block={block} />
    </div>
  );
}

function BlockContent({ block }: { block: Block }) {
  if (block.type === "text")
    return (
      <div className="w-full h-full px-2 py-1 text-[13px] leading-snug text-slate-800 overflow-hidden">
        {block.text}
      </div>
    );
  if (block.type === "table")
    return (
      <table className="w-full h-full border-collapse text-[11px] text-slate-700">
        <tbody>
          {(block.rows ?? []).map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`border border-slate-300 px-1 ${r === 0 ? "bg-slate-50 font-medium" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400 text-[11px]">
      이미지
    </div>
  );
}
