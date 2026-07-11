// inspector-kit.tsx — 인스펙터 공용 UI 프리미티브. 타이포·박스·탭·토글의 단일 소스.
// 값은 확정 디자인 스펙(2026-07). 색·규격은 패널 스코프 CSS 변수(--ins-*, tailwind.css)를 참조한다
// — 팔레트 변경은 그 한 블록에서. 역할별 스케일:
//   섹션 제목 11/700·tracking .08em·--ins-title │ 필드 라벨 10.5/700·--ins-unit │ 값 12.5/600·--ins-value
//   토글 라벨 11.5/600·--ins-tlabel │ 힌트 11.5·--ins-hint │ 서브 10/700·--ins-sub │ 탭 11.5(active 700 accent)
//   필드 박스 36px(크기입력 34)·r9·--ins-fborder │ 아이콘 토글 34×34·r9 │ 세그 36px·r10·--ins-segbg
// ⚠ 폼 요소(input/button)는 전역 `font: inherit` 리셋 탓에 text-[..]·font-* 유틸이 안 먹는다.
//   크기·굵기는 래퍼 div에 걸어 자식이 상속하게 한다(색 유틸은 폼에도 먹어 클래스 그대로).
//   [[studio-inspector-form-font-reset]]
import { type ReactNode } from "react";

// 섹션 — 트래킹된 뮤트 제목(+우측 서브 링크) + 내용. 섹션 사이 16px은 부모 gap-4, 안쪽 9px은 여기서.
export function InsSection({ label, action, children }: { label?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[9px]">
      {(label || action) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-[11px] font-bold tracking-[0.08em] text-[color:var(--ins-title)]">{label}</span>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// 필드 박스 — 라벨(단위·접두, 왼쪽) + 값/컨트롤(오른쪽). 36px·r9·테두리. compact=34px(크기 입력).
// 래퍼가 값 타이포(12.5/600/value)를 상속시키고, 라벨 span은 자기 클래스로 덮는다.
export function InsField({ label, onClick, compact, children }: { label: string; onClick?: () => void; compact?: boolean; children: ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-1 rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 text-[12.5px] font-semibold text-[color:var(--ins-value)] transition-colors ${compact ? "h-[34px]" : "h-9"} ${
        onClick
          ? "cursor-pointer hover:border-[color:var(--ins-acc)]"
          : "focus-within:border-[color:var(--ins-acc)] focus-within:shadow-[0_0_0_3px_rgba(37,110,244,.15)]"
      }`}
    >
      <span className="shrink-0 text-[10.5px] font-bold text-[color:var(--ins-unit)]">{label}</span>
      {children}
    </div>
  );
}

// 숫자 입력 — 값 12.5/600/value, 단위 10.5/700/unit. label 주면 InsField, 없으면 단독 박스.
export function InsNumber({
  label,
  value,
  onChange,
  suffix,
  decimals = 1,
  disabled,
  placeholder,
  compact,
}: {
  label?: string;
  value?: number;
  onChange?: (v: number) => void;
  suffix?: string;
  decimals?: number;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const p = 10 ** decimals;
  const shown = value == null ? "" : Math.round(value * p) / p;
  const field = (
    <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
      <input
        type="number"
        disabled={disabled}
        value={shown}
        placeholder={placeholder}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-full min-w-0 appearance-none border-0 bg-transparent text-right tabular-nums text-[color:var(--ins-value)] outline-none focus:outline-none disabled:text-[color:var(--ins-unit)] placeholder:text-[color:var(--ins-hint)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="shrink-0 text-[10.5px] font-bold text-[color:var(--ins-unit)]">{suffix}</span>}
    </span>
  );
  if (label) return <InsField label={label} compact={compact}>{field}</InsField>;
  return (
    <div className={`flex items-center rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 text-[12.5px] font-semibold text-[color:var(--ins-value)] transition-colors focus-within:border-[color:var(--ins-acc)] focus-within:shadow-[0_0_0_3px_rgba(37,110,244,.15)] ${compact ? "h-[34px]" : "h-9"}`}>
      {field}
    </div>
  );
}

// 읽기 전용 값 (박스 안, 오른쪽). label 주면 InsField 안에.
export function InsRead({ label, children, faint }: { label?: string; children: ReactNode; faint?: boolean }) {
  const val = <span className={`tabular-nums ${faint ? "text-[color:var(--ins-unit)]" : "text-[color:var(--ins-value)]"}`}>{children}</span>;
  if (label) return <InsField label={label}>{val}</InsField>;
  return <div className="flex h-9 items-center justify-end rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 text-[12.5px] font-semibold">{val}</div>;
}

// pill 탭 — 컨테이너 36px·r10·segbg·p3. active 11.5/700/accent+흰배경+shadow, inactive 600/title.
// ⚠ 굵기는 폼 리셋 탓에 클래스가 안 먹어 inline으로(크기는 컨테이너 상속).
export function InsTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-0.5 rounded-lg bg-[color:var(--ins-segbg)] p-[3px] text-[11.5px]">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            style={{ fontWeight: on ? 700 : 600 }}
            className={`flex h-full flex-1 items-center justify-center gap-1.5 rounded-md transition-colors ${
              on ? "bg-white text-[color:var(--ins-acc)] shadow-[0_1px_3px_rgba(23,32,51,.12)]" : "text-[color:var(--ins-title)]"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// 온/오프 스위치 — 트랙 off=track, on=accent. radius-full.
export function InsToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-[color:var(--ins-acc)]" : "bg-[color:var(--ins-track)]"}`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? "translate-x-[16px]" : "translate-x-0.5"}`}
        style={{ boxShadow: "0 1px 2px rgba(16,24,40,.2)" }}
      />
    </button>
  );
}

// 아이콘 토글 (정렬·B/I/U/S) — 34×34·r9·테두리·아이콘색 ficon. active=accent 틴트+테두리.
// fluid=폭에 맞춰 채우는 정사각(좁은 패널에서 여러 개 나열 시 — 고정 34가 안 들어갈 때).
export function InsIconBtn({
  active,
  title,
  onClick,
  fluid,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  fluid?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        borderColor: active ? "var(--ins-acc)" : "var(--ins-fborder)",
        background: active ? "var(--ins-tint)" : "transparent",
        color: active ? "var(--ins-acc)" : "var(--ins-ficon)",
      }}
      className={`flex items-center justify-center rounded-lg border transition-colors ${fluid ? "aspect-square w-full min-w-0" : "h-[34px] w-[34px]"}`}
    >
      {children}
    </button>
  );
}

// 서브 라벨 pill ("준비 중" 등) — 10/600/sub, 점선.
export function InsPill({ children }: { children: ReactNode }) {
  return (
    <span
      title="준비 중"
      className="cursor-default select-none rounded-full border border-dashed border-[color:var(--ins-fborder)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--ins-sub)]"
    >
      {children}
    </span>
  );
}

// 서브 라벨 링크 (프리셋·팔레트·테두리>전체 등) — 10/700/sub.
export function InsSubLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-bold text-[color:var(--ins-sub)]">{children}</span>;
}

// 힌트/안내 문단 — 11.5·hint.
export function InsHint({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-[color:var(--ins-hint)]">{children}</p>;
}
