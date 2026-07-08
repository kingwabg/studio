// RightPanel.tsx — 선택한 블록의 속성 편집(내용·글자 스타일·위치·크기).
import { type ReactNode } from "react";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, type TextAlign, TEXT_DEFAULTS } from "../../modules/document/model";
import { IcText, IcTable, IcImage, IcTrash } from "../../ui/icons";

const TEXT_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#DC2626", "#16A34A", "#B45309"];

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
        className="h-8 px-2.5 rounded-lg border border-line text-ink text-[12.5px] text-right outline-none focus:border-accent focus:ring-accentsoft transition-all bg-white"
      />
    </label>
  );
}

function SegBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex-1 h-8 flex items-center justify-center rounded-md text-[13px] transition-colors ${
        active ? "bg-white text-accent shadow-sm font-semibold" : "text-inksoft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function TextStyleControls({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const align = block.align ?? TEXT_DEFAULTS.align;
  const aligns: { v: TextAlign; label: string }[] = [
    { v: "left", label: "좌" },
    { v: "center", label: "중" },
    { v: "right", label: "우" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <NumberField
          label="글자 크기 (pt)"
          value={block.fontSize ?? TEXT_DEFAULTS.fontSize}
          onChange={(v) => patch({ fontSize: Math.max(6, v) })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-inkfaint">스타일</span>
          <div className="flex gap-1.5 h-8">
            <button
              onClick={() => patch({ bold: !block.bold })}
              className={`flex-1 rounded-lg border text-[13px] font-bold transition-colors ${
                block.bold ? "border-accent bg-accentsoft text-accent" : "border-line text-inksoft hover:border-accentline"
              }`}
            >
              B
            </button>
            <button
              onClick={() => patch({ italic: !block.italic })}
              className={`flex-1 rounded-lg border text-[13px] italic transition-colors ${
                block.italic ? "border-accent bg-accentsoft text-accent" : "border-line text-inksoft hover:border-accentline"
              }`}
            >
              I
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-inkfaint">정렬</span>
        <div className="flex gap-1 p-1 rounded-lg bg-paper">
          {aligns.map((a) => (
            <SegBtn key={a.v} active={align === a.v} onClick={() => patch({ align: a.v })} title={`${a.label} 정렬`}>
              {a.label}
            </SegBtn>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-inkfaint">글자색</span>
        <div className="flex gap-2">
          {TEXT_COLORS.map((c) => {
            const on = (block.color ?? TEXT_DEFAULTS.color).toUpperCase() === c.toUpperCase();
            return (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                aria-label={`색 ${c}`}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  on ? "ring-2 ring-accent border-white" : "border-line"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
      </div>
    </div>
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
    <aside className="w-64 shrink-0 border-l border-line bg-white flex flex-col overflow-auto">
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
          <div className="flex items-center gap-2 px-4 h-12 border-b border-line sticky top-0 bg-white">
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
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-inkfaint">내용</span>
                  <textarea
                    value={block.text ?? ""}
                    onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                    rows={2}
                    placeholder="더블클릭으로 지면에서 바로 편집할 수도 있어요"
                    className="px-2.5 py-2 rounded-lg border border-line text-ink text-[13px] outline-none focus:border-accent focus:ring-accentsoft transition-all resize-none leading-relaxed bg-white"
                  />
                </div>
                <TextStyleControls block={block} />

                {/* 본문(흐름) 토글 — 한글에서 이어 쓸 수 있는 진짜 문단으로 내보내기 */}
                <button
                  onClick={() => updateBlock(block.id, { flow: !block.flow })}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                    block.flow ? "border-emerald-300 bg-emerald-50" : "border-line hover:border-accentline"
                  }`}
                >
                  <span>
                    <span className={`block text-[12px] font-semibold ${block.flow ? "text-emerald-700" : "text-ink"}`}>
                      본문으로 내보내기
                    </span>
                    <span className="block text-[11px] text-inkfaint mt-0.5">
                      한글에서 커서가 흐르는 진짜 문단 (길면 페이지 넘김)
                    </span>
                  </span>
                  <span
                    className={`w-8 h-[18px] rounded-full relative transition-colors shrink-0 ${
                      block.flow ? "bg-emerald-500" : "bg-line"
                    }`}
                  >
                    <span
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${
                        block.flow ? "left-[16px]" : "left-[2px]"
                      }`}
                    />
                  </span>
                </button>
                <div className="h-px bg-line" />
              </>
            )}

            <div>
              <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2">위치 · 크기 (mm)</p>
              <div className="grid grid-cols-2 gap-2.5">
                <NumberField label="X" value={block.x} onChange={(v) => updateBlock(block.id, { x: v })} />
                <NumberField label="Y" value={block.y} onChange={(v) => updateBlock(block.id, { y: v })} />
                <NumberField label="폭" value={block.w} onChange={(v) => updateBlock(block.id, { w: v })} />
                {block.type === "text" ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-inkfaint">높이</span>
                    <span className="h-8 px-2.5 rounded-lg bg-paper text-inkfaint text-[12px] flex items-center justify-end">
                      자동 · {Math.round(block.h)}
                    </span>
                  </label>
                ) : (
                  <NumberField label="높이" value={block.h} onChange={(v) => updateBlock(block.id, { h: v })} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
