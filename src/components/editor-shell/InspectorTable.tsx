// InspectorTable.tsx — 표 블록 인스펙터: 표·셀 탭 + 표 편집 + 셀 안 여백 + 크기·위치 + 캡션.
// 표 편집(행/열/병합/나누기)은 EditorToolbar와 같은 studio:table-ribbon 이벤트로 위임
//   ⚠ 표가 활성(더블클릭 편집) 상태일 때만 실제 반영 — 툴바와 동일 조건.
// 셀 안 여백 = padX/padY(2값을 4칸으로), 캡션 = 신규 필드(화면 전용, 내보내기 미연결).
// 타이포·박스·탭·토글은 inspector-kit 단일 소스에서만 온다.
import { useState } from "react";
import { type Block, type TableKingData, padOf } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";
import { scaleHeights, scaleWidths } from "../../modules/canvas/tableScale";
import { MIN_COL_W, MIN_ROW_H } from "../../table-king/table/constants.js";
import { DsIcon, type DsIconName } from "../../ui/design-icons";
import { InsSection, InsNumber, InsTabs, InsToggle } from "./inspector-kit";
import { InspectorTableStyle } from "./InspectorTableStyle";

const CAP_POS = [
  { v: "top", label: "위" },
  { v: "bottom", label: "아래" },
  { v: "left", label: "왼쪽" },
  { v: "right", label: "오른쪽" },
] as const;

const ribbon = (blockId: string, detail: object) =>
  window.dispatchEvent(new CustomEvent("studio:table-ribbon", { detail: { blockId, ...detail } }));

// 표 편집 버튼 (아이콘 + 라벨) — 표 인스펙터 전용
function EditBtn({ icon, label, onClick }: { icon: DsIconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--ins-fborder)] text-[color:var(--ins-tlabel)] transition-colors hover:border-[color:var(--ins-acc)] hover:bg-[color:var(--ins-tint)] hover:text-[color:var(--ins-acc)]"
    >
      <DsIcon name={icon} size={16} /> {label}
    </button>
  );
}

export function InspectorTable({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const setTableData = useCanvasStore((s) => s.setTableData);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const pad = padOf(block);

  // 폭/높이는 표에서 데이터(widths/cellHeights) 파생이라 w/h만 patch하면 다음 표 편집이
  // 덮어써 사라진다(감사 I3 CONFIRMED — 죽은 쓰기). 트랙을 실제로 스케일해 커밋한다.
  const commitSize = (axis: "w" | "h", vMm: number) => {
    const data = block.data as TableKingData | undefined;
    if (!data) {
      patch({ [axis]: Math.max(1, vMm) }); // 레거시 rows 표는 종전 동작
      return;
    }
    const current = axis === "w" ? block.w : block.h;
    if (!(vMm > 0) || !(current > 0)) return;
    const ratio = vMm / current;
    if (Math.abs(ratio - 1) < 0.001) return;
    setTableData(block.id, {
      ...data,
      widths: axis === "w" ? scaleWidths(data.widths, ratio, MIN_COL_W) : data.widths,
      cellHeights: axis === "h" ? scaleHeights(data.cellHeights, ratio, MIN_ROW_H) : data.cellHeights,
      merges: data.merges ?? [],
    });
  };
  const [tab, setTab] = useState<"basic" | "cell">("basic");
  const capOn = !!block.captionOn;
  const capPos = block.captionPos ?? "top";

  return (
    <div className="flex flex-col gap-4">
      {/* 표·셀 탭 */}
      <InsTabs
        options={[
          { v: "basic", label: "기본" },
          { v: "cell", label: "표·셀" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "cell" ? (
        <InspectorTableStyle block={block} />
      ) : (
        <>
          {/* 표 편집 */}
          <InsSection label="표 편집">
            <div className="grid grid-cols-2 gap-2 text-[12px] font-semibold">
              <EditBtn icon="row-add" label="행 추가" onClick={() => ribbon(block.id, { kind: "primary", label: "행 추가" })} />
              <EditBtn icon="col-add" label="열 추가" onClick={() => ribbon(block.id, { kind: "primary", label: "열 추가" })} />
              <EditBtn icon="cell-merge" label="셀 병합" onClick={() => ribbon(block.id, { kind: "primary", label: "병합" })} />
              <EditBtn icon="cell-split" label="셀 나누기" onClick={() => ribbon(block.id, { kind: "split", rows: 2, cols: 2 })} />
            </div>
          </InsSection>

          {/* 셀 안 여백 (MM) — 위/아래=padY, 왼쪽/오른쪽=padX */}
          <InsSection label="셀 안 여백 (MM)">
            <div className="grid grid-cols-2 gap-2">
              <InsNumber label="위" value={pad.y} onChange={(v) => patch({ padY: Math.max(0, v) })} />
              <InsNumber label="아래" value={pad.y} onChange={(v) => patch({ padY: Math.max(0, v) })} />
              <InsNumber label="왼쪽" value={pad.x} onChange={(v) => patch({ padX: Math.max(0, v) })} />
              <InsNumber label="오른쪽" value={pad.x} onChange={(v) => patch({ padX: Math.max(0, v) })} />
            </div>
          </InsSection>

          {/* 크기 · 위치 (MM) — 크기 입력이라 compact(34px) */}
          <InsSection label="크기 · 위치 (MM)">
            <div className="grid grid-cols-2 gap-2">
              <InsNumber compact label="X" value={block.x} onChange={(v) => patch({ x: v })} />
              <InsNumber compact label="Y" value={block.y} onChange={(v) => patch({ y: v })} />
              <InsNumber compact label="폭" value={block.w} onChange={(v) => commitSize("w", v)} />
              <InsNumber compact label="높이" value={block.h} onChange={(v) => commitSize("h", v)} />
            </div>
          </InsSection>

          {/* 캡션 (화면 전용) */}
          <InsSection label="캡션">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-semibold text-[color:var(--ins-tlabel)]">캡션 표시</span>
              <InsToggle on={capOn} onChange={(v) => patch({ captionOn: v })} />
            </div>
            <InsTabs options={CAP_POS.map((p) => ({ v: p.v, label: p.label }))} value={capPos} onChange={(v) => patch({ captionPos: v })} />
            <div className="text-[12.5px] font-semibold">
              <input
                value={block.caption ?? ""}
                onChange={(e) => patch({ caption: e.target.value })}
                placeholder="(표 1) 캡션을 입력하세요"
                className="h-9 w-full rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 text-[color:var(--ins-value)] outline-none placeholder:text-[color:var(--ins-hint)] focus:border-[color:var(--ins-acc)]"
              />
            </div>
          </InsSection>
        </>
      )}
    </div>
  );
}
