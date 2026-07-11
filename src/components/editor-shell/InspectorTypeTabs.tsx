// InspectorTypeTabs.tsx — 인스펙터 타입 탭(텍스트/표/이미지/그룹). 선택 블록 타입을 강조 표시.
// 디자인 인스펙터의 ptype 탭. 블록 타입은 바꿀 수 없으므로 현재 타입만 활성으로 나타낸다(지표).
import { type Block } from "../../modules/document/model";

const TABS = [
  { key: "text", label: "텍스트" },
  { key: "table", label: "표" },
  { key: "image", label: "이미지" },
  { key: "group", label: "그룹" },
] as const;

export function InspectorTypeTabs({ block }: { block: Block }) {
  const active = block.groupId ? "group" : block.type;
  return (
    <div className="mx-4 mb-3 mt-2 flex h-9 items-center gap-0.5 rounded-lg bg-[color:var(--ins-segbg)] p-[3px] text-[11.5px]">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <div
            key={t.key}
            style={{ fontWeight: on ? 700 : 600 }}
            className={`flex h-full flex-1 items-center justify-center rounded-md text-center transition-colors ${
              on ? "bg-white text-[color:var(--ins-acc)] shadow-[0_1px_3px_rgba(23,32,51,.12)]" : "text-[color:var(--ins-title)]"
            }`}
          >
            {t.label}
          </div>
        );
      })}
    </div>
  );
}
