// RightPanel.tsx — 선택한 블록의 속성 편집(위치·크기·내용).
// Phase 1은 순수 상태 편집. 값은 mm(모델 단위) 그대로 노출한다.
import { useCanvasStore } from "../../modules/canvas/store";

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-7 px-2 rounded border border-slate-200 text-slate-800 text-right outline-none focus:border-blue-400"
      />
    </label>
  );
}

export function RightPanel() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);

  return (
    <aside className="w-64 shrink-0 border-l border-slate-200 bg-white p-4">
      {!block ? (
        <p className="text-[12px] text-slate-400">블록을 선택하면 속성이 여기에 표시됩니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-slate-700">
              {block.type === "text" ? "텍스트" : block.type === "table" ? "표" : "이미지"} 속성
            </p>
            <button
              onClick={() => removeBlock(block.id)}
              className="text-[12px] text-red-500 hover:text-red-600"
            >
              삭제
            </button>
          </div>

          {block.type === "text" && (
            <textarea
              value={block.text ?? ""}
              onChange={(e) => updateBlock(block.id, { text: e.target.value })}
              rows={3}
              className="w-full px-2 py-1.5 rounded border border-slate-200 text-[13px] text-slate-800 outline-none focus:border-blue-400 resize-none"
            />
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <NumberField label="X (mm)" value={block.x} onChange={(v) => updateBlock(block.id, { x: v })} />
            <NumberField label="Y (mm)" value={block.y} onChange={(v) => updateBlock(block.id, { y: v })} />
            <NumberField label="폭 (mm)" value={block.w} onChange={(v) => updateBlock(block.id, { w: v })} />
            <NumberField label="높이 (mm)" value={block.h} onChange={(v) => updateBlock(block.id, { h: v })} />
          </div>
        </div>
      )}
    </aside>
  );
}
