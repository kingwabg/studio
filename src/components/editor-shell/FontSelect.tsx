// FontSelect.tsx — 지면 글꼴 선택 (서식바·우측 패널 공용).
// 폰트 레지스트리(fonts.ts)의 OFL 폰트를 카테고리별로 보여주고, 선택 시 지연 로딩 +
// 전각 캘리브레이션(ensureFont)을 트리거한다. 모든 폰트가 저작권 안전(OFL self-host).
import { CATEGORY_LABEL, FONTS, ensureFont, fontByKey, fontCss, type FontCategory } from "../../modules/document/fonts";

// 안심글꼴·호환은 항목이 있을 때만 노출 (안심글꼴은 public/fonts 반입 후 등장)
const CATEGORIES: FontCategory[] = ["gothic", "myeongjo", "display", "hand", "safe", "compat"];

export function FontSelect({
  value,
  onChange,
  disabled,
  className,
  fullWidth,
}: {
  value?: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
}) {
  const cur = fontByKey(value);
  // 디자인: 네이티브 화살표 대신 커스텀 chevron + 현재 폰트를 그 서체로 미리보기(트리거).
  return (
    <div className={`relative items-center text-[12.5px] font-semibold ${fullWidth ? "flex w-full" : "inline-flex"}`}>
      <select
        value={cur.key}
        disabled={disabled}
        title="지면 글꼴 — 전부 상업용 무료(OFL), 웹 자체 호스팅이라 저작권 안전"
        onChange={(e) => {
          const key = e.target.value;
          void ensureFont(key); // 지연 로딩 + 전각(1em) 캘리브레이션
          onChange(key);
        }}
        style={{ fontFamily: fontCss(cur.key).fontFamily }}
        className={
          className ??
          "appearance-none h-8 pl-2.5 pr-7 rounded-lg border border-line bg-surface text-[12.5px] font-semibold text-ink min-w-[112px] outline-none hover:border-linestrong focus:border-accentline transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
        }
      >
        {CATEGORIES.map((cat) => {
          const inCat = FONTS.filter((f) => f.category === cat);
          if (!inCat.length) return null; // 빈 카테고리(안심글꼴 미반입 등)는 숨김
          return (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {inCat.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <span className="pointer-events-none absolute right-2 text-inkfaint" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}
