// RightPanel.tsx — 선택한 블록의 속성 편집(위치·크기·내용).
// Phase 1은 순수 상태 편집. 값은 mm(모델 단위) 그대로 노출한다.
import { useCanvasStore } from "../../modules/canvas/store";
import { IcText, IcTable, IcImage, IcTrash } from "../../ui/icons";

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
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-inkfaint">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 px-2.5 rounded-lg border border-line text-ink text-[12.5px] text-right outline-none focus:border-accent focus:ring-2 focus:ring-accentsoft transition-all bg-white"
      />
    </label>
  );
}

export function RightPanel() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);

  const kind =
    block?.type === "text"
      ? { label: "텍스트", icon: <IcText size={15} /> }
      : block?.type === "table"
        ? { label: "표", icon: <IcTable size={15} /> }
        : { label: "이미지", icon: <IcImage size={15} /> };

  return (
    <aside className="w-64 shrink-0 border-l border-line bg-white flex flex-col">
      {!block ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-paper text-inkfaint">
            <IcText size={18} />
          </span>
          <p className="text-[12px] text-inkfaint leading-relaxed">
            블록을 선택하면
            <br />
            속성이 여기에 표시됩니다
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-line">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-accentsoft text-accent">
              {kind.icon}
            </span>
            <span className="text-[13px] font-semibold text-ink">{kind.label}</span>
            <button
              onClick={() => removeBlock(block.id)}
              aria-label="블록 삭제"
              className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-inkfaint hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <IcTrash size={15} />
            </button>
          </div>

          <div className="px-4 py-4 flex flex-col gap-4">
            {block.type === "text" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-inkfaint">내용</span>
                <textarea
                  value={block.text ?? ""}
                  onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                  rows={3}
                  className="px-2.5 py-2 rounded-lg border border-line text-ink text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accentsoft transition-all resize-none leading-relaxed bg-white"
                />
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2">위치 · 크기 (mm)</p>
              <div className="grid grid-cols-2 gap-2.5">
                <NumberField label="X" value={block.x} onChange={(v) => updateBlock(block.id, { x: v })} />
                <NumberField label="Y" value={block.y} onChange={(v) => updateBlock(block.id, { y: v })} />
                <NumberField label="폭" value={block.w} onChange={(v) => updateBlock(block.id, { w: v })} />
                <NumberField label="높이" value={block.h} onChange={(v) => updateBlock(block.id, { h: v })} />
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
