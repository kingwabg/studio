// InspectorDimensions.tsx — 인스펙터 '치수 · 여백 (PX)' 섹션.
// 디자인: 너비/높이(px) + 안쪽 여백·바깥 여백(각각 접기, 상/우/하/좌 4칸).
// 모델은 mm·2값 패딩이라: 너비/높이는 mm↔px 변환, 안쪽 여백 4칸은 상하=padY·좌우=padX로 매핑.
// 바깥 여백은 모델에 없어 0 고정 표시(placeholder). 타이포·박스는 inspector-kit 단일 소스.
import { useState, type ReactNode } from "react";
import { type Block, padOf } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";
import { SCALE } from "../../modules/canvas/geometry";
import { InsSection, InsNumber, InsField } from "./inspector-kit";

const toPx = (mm: number) => Math.round(mm * SCALE * 1000) / 1000;
const toMm = (px: number) => px / SCALE;

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(label === "안쪽 여백");
  return (
    <div className="flex flex-col gap-2 text-[11px] font-bold">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 tracking-[0.08em] text-[color:var(--ins-title)]"
      >
        <span className={`inline-block text-[color:var(--ins-unit)] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        {label}
      </button>
      {open && <div className="grid grid-cols-4 gap-1.5">{children}</div>}
    </div>
  );
}

export function InspectorDimensions({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const pad = padOf(block);
  const isText = block.type === "text";

  return (
    <InsSection label="치수 · 여백 (PX)">
      {/* 너비 / 높이 — 크기 입력이라 compact(34px) */}
      <div className="grid grid-cols-2 gap-2">
        <InsNumber compact label="너비" suffix="px" decimals={0} value={toPx(block.w)} onChange={(px) => patch({ w: toMm(px) })} />
        {isText ? (
          <InsField compact label="높이">
            <span className="text-[color:var(--ins-unit)]">자동</span>
          </InsField>
        ) : (
          <InsNumber compact label="높이" suffix="px" decimals={0} value={toPx(block.h)} onChange={(px) => patch({ h: toMm(px) })} />
        )}
      </div>

      {/* 안쪽 여백 — 상/우/하/좌 (모델 2값: 상하=padY, 좌우=padX) */}
      <Collapsible label="안쪽 여백">
        <InsNumber compact decimals={0} value={toPx(pad.y)} onChange={(px) => patch({ padY: Math.max(0, toMm(px)) })} />
        <InsNumber compact decimals={0} value={toPx(pad.x)} onChange={(px) => patch({ padX: Math.max(0, toMm(px)) })} />
        <InsNumber compact decimals={0} value={toPx(pad.y)} onChange={(px) => patch({ padY: Math.max(0, toMm(px)) })} />
        <InsNumber compact decimals={0} value={toPx(pad.x)} onChange={(px) => patch({ padX: Math.max(0, toMm(px)) })} />
      </Collapsible>

      {/* 바깥 여백 — 모델 미지원(0 고정) */}
      <Collapsible label="바깥 여백">
        <InsNumber compact decimals={0} value={0} disabled />
        <InsNumber compact decimals={0} value={0} disabled />
        <InsNumber compact decimals={0} value={0} disabled />
        <InsNumber compact decimals={0} value={0} disabled />
      </Collapsible>
    </InsSection>
  );
}
