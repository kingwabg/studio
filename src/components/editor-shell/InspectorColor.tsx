// InspectorColor.tsx — 인스펙터 인라인 색상 편집(스와치 + 그라데이션·색조 피커 + HEX).
// 디자인 인스펙터의 '색' 섹션: 팝오버가 아니라 패널에 펼쳐진 풀 피커. react-colorful 사용.
import { HexColorInput, HexColorPicker } from "react-colorful";

export function InspectorColor({
  value,
  presets = [],
  onChange,
}: {
  value: string;
  presets?: string[];
  onChange: (color: string) => void;
}) {
  const cur = (value || "#000000").toUpperCase();
  return (
    <div className="flex flex-col gap-2.5">
      {/* 프리셋 스와치 행 + 사용자색 추가 */}
      <div className="flex items-center gap-2">
        {presets.map((c) => {
          const on = c.toUpperCase() === cur;
          return (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onChange(c)}
              className="h-6 w-6 rounded-full transition-transform hover:scale-110"
              style={{ background: c, boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : "0 0 0 1px rgba(16,24,40,.14)" }}
            />
          );
        })}
        <span
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-linestrong text-[15px] leading-none text-inkfaint"
          aria-hidden="true"
        >
          +
        </span>
      </div>
      {/* 그라데이션(채도·명도) + 색조 슬라이더 */}
      <div className="studio-inspector-picker">
        <HexColorPicker color={cur} onChange={onChange} />
      </div>
      {/* HEX 입력 + 현재색 — 부모에 12px를 줘 폼 요소(input)가 상속(font:inherit 리셋 회피) */}
      <div className="flex items-center gap-2 text-[12px] font-bold">
        <span className="text-[10px] font-bold text-inkfaint">HEX</span>
        <HexColorInput
          color={cur}
          onChange={onChange}
          prefixed
          className="studio-color-input h-8 flex-1 rounded-lg border border-line bg-paper px-2.5 text-[12px] font-bold text-ink outline-none focus:border-accentline"
        />
        <span className="h-8 w-8 shrink-0 rounded-lg border border-line" style={{ background: cur }} />
      </div>
    </div>
  );
}
