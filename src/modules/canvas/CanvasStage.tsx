// CanvasStage.tsx — A4 지면. 블록을 절대배치로 그리고, 팔레트 드롭 대상(useDroppable)이 된다.
// stageRef는 상위(StudioEditor)의 onDragEnd가 드롭 좌표를 지면 기준 mm로 환산할 때 쓴다.
import { forwardRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { mmToPx } from "./geometry";
import { useCanvasStore } from "./store";
import { CanvasBlock } from "./CanvasBlock";
import { IcText } from "../../ui/icons";

export const CanvasStage = forwardRef<HTMLDivElement>(function CanvasStage(_props, ref) {
  const doc = useCanvasStore((s) => s.doc);
  const select = useCanvasStore((s) => s.select);
  const { setNodeRef } = useDroppable({ id: "stage" });

  return (
    <div className="flex-1 overflow-auto canvas-dots bg-canvas flex justify-center py-10 px-6">
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
        className="relative bg-white rounded-[3px] shrink-0 self-start ring-1 ring-black/5 shadow-[0_1px_3px_rgba(26,34,51,0.08),0_20px_50px_-12px_rgba(26,34,51,0.18)]"
      >
        {doc.blocks.map((block) => (
          <CanvasBlock key={block.id} block={block} />
        ))}
        {doc.blocks.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-paper text-inkfaint">
              <IcText size={24} />
            </span>
            <p className="text-[13px] text-inkfaint">왼쪽에서 블록을 끌어다 놓으세요</p>
          </div>
        )}
      </div>
    </div>
  );
});
