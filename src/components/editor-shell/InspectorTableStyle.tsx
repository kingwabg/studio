// InspectorTableStyle.tsx — 표·셀 탭: 표 스타일 프리셋 + 머리글/줄무늬/잠금 토글 + 셀 배경 + 세로 정렬.
// ⚠ 프리셋·토글은 아직 블록 상태(진실)만 갱신한다. 렌더 시각 반영(머리글 음영·줄무늬)은
//   CanvasBlock·exportCore 통합 단계에서 붙인다.
//   세로 정렬은 선택 셀의 vAlign에 실제 적용(studio:table-ribbon → 표 활성 상태에서만) —
//   block.valign은 표 블록에서 아무도 읽지 않아(감사 I3 CONFIRMED) 죽은 쓰기였다.
import { type Block, type TableStyle, type TextVAlign } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";
import { DsIcon, type DsIconName } from "../../ui/design-icons";
import { InsSection, InsToggle, InsTabs, InsSubLabel } from "./inspector-kit";
import { InspectorColor } from "./InspectorColor";

// KRDS 시맨틱 팔레트 — primary/warning/success/information/point
const CELL_COLORS = ["#FFFFFF", "#F4F5F6", "#256EF4", "#FFB114", "#228738", "#0B78CB", "#D63D4A"];
const PRESETS: { v: TableStyle; label: string }[] = [
  { v: "grid", label: "기본 격자" },
  { v: "header", label: "머리글" },
  { v: "stripe", label: "줄무늬" },
];
const VALIGNS: { v: TextVAlign; label: string }[] = [
  { v: "top", label: "위" },
  { v: "center", label: "가운데" },
  { v: "bottom", label: "아래" },
];
// table-king StyleToolbar 세로 정렬 버튼의 title — runStyleAction이 이 문자열로 버튼을 찾는다
const VALIGN_RIBBON_TITLE: Record<TextVAlign, string> = {
  top: "위쪽 정렬",
  center: "세로 가운데 정렬",
  bottom: "아래쪽 정렬",
};

// 프리셋 카드의 미니 표(3×3) — 머리글=첫 행 채움, 줄무늬=가운데 행 옅게.
function MiniTable({ kind }: { kind: TableStyle }) {
  const fillOf = (r: number) => {
    if (kind === "header" && r === 0) return "currentColor";
    if (kind === "stripe" && r === 1) return "color-mix(in srgb, currentColor 26%, transparent)";
    return "transparent";
  };
  return (
    <svg width="42" height="27" viewBox="0 0 42 27" fill="none" aria-hidden="true">
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => (
          <rect key={`${r}-${c}`} x={1 + c * 13.3} y={1 + r * 8.3} width="13.3" height="8.3" fill={fillOf(r)} stroke="currentColor" strokeWidth="1" />
        ))
      )}
    </svg>
  );
}

function StyleCard({ active, label, kind, onClick }: { active: boolean; label: string; kind: TableStyle; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-lg border-2 px-1.5 py-2.5 transition-colors ${
        active
          ? "border-[color:var(--ins-acc)] bg-[color:var(--ins-tint)] text-[color:var(--ins-acc)]"
          : "border-[color:var(--ins-fborder)] bg-white text-[color:var(--ins-sub)] hover:border-[color:var(--ins-track)]"
      }`}
    >
      <MiniTable kind={kind} />
      <span className="text-[10.5px] font-bold">{label}</span>
    </button>
  );
}

function ToggleRow({ icon, label, sub, on, onChange }: { icon: DsIconName; label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
        on ? "border-[color:var(--ins-acc)] bg-[color:var(--ins-tint)]" : "border-[color:var(--ins-fborder)] bg-white"
      }`}
    >
      <span className={`shrink-0 ${on ? "text-[color:var(--ins-acc)]" : "text-[color:var(--ins-ficon)]"}`}>
        <DsIcon name={icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold leading-tight text-[color:var(--ins-tlabel)]">{label}</div>
        {sub && <div className="mt-0.5 text-[10.5px] leading-tight text-[color:var(--ins-hint)]">{sub}</div>}
      </div>
      <InsToggle on={on} onChange={onChange} />
    </div>
  );
}

export function InspectorTableStyle({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const style = block.tableStyle ?? "grid";
  const valign = block.valign ?? "top";

  // 프리셋 선택 시 관련 토글도 함께 세팅(직관): header→머리글 on, stripe→줄무늬 on.
  const applyPreset = (v: TableStyle) => patch({ tableStyle: v, headerRow: v === "header", striped: v === "stripe" });

  return (
    <div className="flex flex-col gap-4">
      {/* 표 스타일 + 토글 */}
      <InsSection label="표 스타일" action={<InsSubLabel>프리셋</InsSubLabel>}>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <StyleCard key={p.v} kind={p.v} label={p.label} active={style === p.v} onClick={() => applyPreset(p.v)} />
          ))}
        </div>
        <ToggleRow icon="table-form" label="머리글 행 자동" on={!!block.headerRow} onChange={(v) => patch({ headerRow: v })} />
        <ToggleRow icon="border-all" label="첫 열 강조" on={!!block.firstCol} onChange={(v) => patch({ firstCol: v })} />
        <ToggleRow icon="table-list" label="줄무늬 행" on={!!block.striped} onChange={(v) => patch({ striped: v })} />
        <ToggleRow icon="lock" label="머리글 행 잠금" sub="크기가 커지지 않음" on={!!block.headerLock} onChange={(v) => patch({ headerLock: v })} />
        <ToggleRow icon="lock" label="첫 열 잠금" sub="너비가 변하지 않음" on={!!block.firstColLock} onChange={(v) => patch({ firstColLock: v })} />
      </InsSection>

      {/* 셀 배경 */}
      <InsSection label="셀 배경" action={<InsSubLabel>팔레트</InsSubLabel>}>
        <InspectorColor value={block.cellFill ?? "#FFFFFF"} presets={CELL_COLORS} onChange={(c) => patch({ cellFill: c })} />
      </InsSection>

      {/* 세로 정렬 — 선택 셀 vAlign에 적용(표 활성 상태에서만 반영, EditorToolbar와 같은 경로) */}
      <InsSection label="세로 정렬">
        <InsTabs
          options={VALIGNS}
          value={valign}
          onChange={(v) => {
            patch({ valign: v }); // 탭 표시 상태 유지용
            window.dispatchEvent(
              new CustomEvent("studio:table-ribbon", {
                detail: { blockId: block.id, kind: "style", title: VALIGN_RIBBON_TITLE[v] },
              })
            );
          }}
        />
      </InsSection>
    </div>
  );
}
