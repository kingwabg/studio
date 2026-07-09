// FontSelect.tsx — 지면 글꼴 선택 (서식바·우측 패널 공용).
// 폰트 레지스트리(fonts.ts)의 OFL 폰트를 카테고리별로 보여주고, 선택 시 지연 로딩 +
// 전각 캘리브레이션(ensureFont)을 트리거한다. 모든 폰트가 저작권 안전(OFL self-host).
import { CATEGORY_LABEL, FONTS, ensureFont, fontByKey, type FontCategory } from "../../modules/document/fonts";

const CATEGORIES: FontCategory[] = ["gothic", "myeongjo", "display", "hand"];

export function FontSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value?: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={fontByKey(value).key}
      disabled={disabled}
      title="지면 글꼴 — 전부 상업용 무료(OFL), 웹 자체 호스팅이라 저작권 안전"
      onChange={(e) => {
        const key = e.target.value;
        void ensureFont(key); // 지연 로딩 + 전각(1em) 캘리브레이션
        onChange(key);
      }}
      className={
        className ??
        "h-[30px] px-2 rounded-lg border border-line bg-surface text-[12.5px] text-ink min-w-[110px] outline-none hover:border-linestrong focus:border-accentline transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
      }
    >
      {CATEGORIES.map((cat) => (
        <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
          {FONTS.filter((f) => f.category === cat).map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
