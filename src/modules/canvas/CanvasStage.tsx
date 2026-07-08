// CanvasStage.tsx — A4 지면. 블록을 절대배치로 그리고, 팔레트 드롭 대상(useDroppable)이 된다.
// stageRef는 상위(StudioEditor)의 onDragEnd가 드롭 좌표를 지면 기준 mm로 환산할 때 쓴다.
import { forwardRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { mmToPx } from "./geometry";
import { useCanvasStore } from "./store";
import { CanvasBlock } from "./CanvasBlock";

export const CanvasStage = forwardRef<HTMLDivElement>(function CanvasStage(_props, ref) {
  const doc = useCanvasStore((s) => s.doc);
  const select = useCanvasStore((s) => s.select);
  const { setNodeRef } = useDroppable({ id: "stage" });

  return (
    <div className="flex-1 overflow-auto bg-slate-100 flex justify-center py-9">
      <div
        ref={(node) => {
          setNodeRef(node); // dnd-kit 드롭 대상
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node; // onDragEnd 좌표 환산용
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select(null); // 빈 지면 클릭 → 선택 해제
        }}
        style={{ width: mmToPx(doc.page.w), height: mmToPx(doc.page.h) }}
        className="relative bg-white shadow-[0_1px_3px_rgba(26,34,51,0.1),0_16px_48px_rgba(26,34,51,0.14)] rounded-[2px] shrink-0"
      >
        {doc.blocks.map((block) => (
          <CanvasBlock key={block.id} block={block} />
        ))}
        {doc.blocks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm pointer-events-none">
            왼쪽에서 블록을 끌어다 놓으세요
          </div>
        )}
      </div>
    </div>
  );
});
