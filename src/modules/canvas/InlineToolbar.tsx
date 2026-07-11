// InlineToolbar.tsx — 선택 위 플로팅 서식바 (CanvasBlock에서 분할 — 계획 3단계).
import { useState } from "react";
import {
  type ParaListType,
  type TextAlign,
  type TextRun,
  TEXT_DEFAULTS,
} from "../document/model";
import { type RichSelState, normalizeUrl } from "../richtext";
import { CATEGORY_LABEL, FONTS, ensureFont, fontByKey } from "../document/fonts";

// 서식바가 받는 선택 상태 — 훅(useRichText)의 RichSelState를 그대로 사용
export type InlineSel = RichSelState;
// ── 선택 위 플로팅 서식바 (굵게·기울임·색·크기·글꼴) ──
import { TEXT_COLOR_PRESETS } from "../../ui/presets"; // 정본 — 첫 값 #1A2233→#000000 수렴(화면 기본색과 일치)
// 형광펜 스와치 — 한글 형광펜 감성의 연한 톤 4 + 지우기("")
const INLINE_HIGHLIGHTS = ["#FDF3B4", "#D7F5DD", "#DBEAFE", "#FCE1E4", ""];

export function InlineToolbar({
  sel,
  toolbarRef,
  onApply,
  onApplyAlign,
  onApplyList,
  defaults,
}: {
  sel: InlineSel;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onApply: (patch: Partial<Omit<TextRun, "text">>) => void;
  onApplyAlign: (a: TextAlign) => void;
  onApplyList: (t: ParaListType) => void;
  defaults: { bold: boolean; italic: boolean; underline: boolean; strike: boolean };
}) {
  // 토글 끄기 값 — 블록 기본이 이미 보통이면 상속(undefined)으로 되돌리고, 블록이 굵으면
  // 명시적 false로 덮는다(그래야 인접 상속 런과 병합되지 않고 그 구간만 보통이 된다).
  const offBold = defaults.bold ? false : undefined;
  const offItalic = defaults.italic ? false : undefined;
  const offUnderline = defaults.underline ? false : undefined;
  const offStrike = defaults.strike ? false : undefined;
  const [fontOpen, setFontOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 서식바 위치 — 선택 사각 위쪽 중앙. 화면 밖으로 나가지 않게 좌우 클램프.
  const top = Math.max(8, sel.rect.top - 46);
  const left = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2), window.innerWidth - 8);
  const size = sel.fontSize ?? TEXT_DEFAULTS.fontSize;
  // 굵게/기울임 토글: 켜져 있으면 끄기(false로 명시 — 블록 기본이 굵을 수도 있으므로)
  const btn = "w-[28px] h-[28px] rounded-[7px] flex items-center justify-center text-inksoft hover:bg-paper transition-colors";
  const btnOn = "bg-accentsoft text-accent";

  return (
    <div
      ref={toolbarRef}
      // 포인터다운 기본 차단 → contentEditable 선택 유지(포커스·하이라이트 안 뺏김)
      onPointerDown={(e) => e.preventDefault()}
      style={{ position: "fixed", top, left, transform: "translateX(-50%)", zIndex: 70, boxShadow: "var(--sh-pop)" }}
      className="flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
    >
      <button className={`${btn} ${sel.bold ? btnOn : ""} font-extrabold text-[13px]`} title="굵게 (선택 구간)" onClick={() => onApply({ bold: sel.bold ? offBold : true })}>
        가
      </button>
      <button className={`${btn} ${sel.italic ? btnOn : ""} italic text-[13px]`} title="기울임 (선택 구간)" onClick={() => onApply({ italic: sel.italic ? offItalic : true })}>
        가
      </button>
      <button className={`${btn} ${sel.underline ? btnOn : ""} underline underline-offset-2 text-[13px]`} title="밑줄 (선택 구간)" onClick={() => onApply({ underline: sel.underline ? offUnderline : true })}>
        가
      </button>
      <button className={`${btn} ${sel.strike ? btnOn : ""} line-through text-[13px]`} title="취소선 (선택 구간)" onClick={() => onApply({ strike: sel.strike ? offStrike : true })}>
        가
      </button>
      {/* 링크 — URL 팝오버 (기존 링크면 프리필) */}
      <div className="relative">
        <button
          className={`${btn} ${sel.href ? btnOn : ""}`}
          title="링크 (선택 구간)"
          onClick={() => {
            setLinkUrl(sel.href ?? "");
            setLinkOpen((v) => !v);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M6.5 9.5l3-3M7 4.2l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M9 11.8l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {linkOpen && (
          <div
            className="absolute left-0 top-[34px] w-[228px] rounded-[9px] bg-surface border border-line p-2 z-10 flex items-center gap-1.5"
            style={{ boxShadow: "var(--sh-pop)" }}
          >
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onApply({ href: normalizeUrl(linkUrl) });
                  setLinkOpen(false);
                } else if (e.key === "Escape") setLinkOpen(false);
              }}
              placeholder="https://…"
              className="flex-1 h-[26px] px-2 rounded-[6px] border border-line bg-paper text-[12px] text-ink outline-none focus:border-accentline"
            />
            <button
              className="h-[26px] px-2 rounded-[6px] text-[11.5px] font-bold text-accent bg-accentsoft hover:bg-accent hover:text-onaccent transition-colors"
              onClick={() => {
                onApply({ href: normalizeUrl(linkUrl) });
                setLinkOpen(false);
              }}
            >
              적용
            </button>
            {sel.href && (
              <button
                className="h-[26px] px-1.5 rounded-[6px] text-[11.5px] text-inksoft hover:text-ink"
                title="링크 제거"
                onClick={() => {
                  onApply({ href: undefined });
                  setLinkOpen(false);
                }}
              >
                제거
              </button>
            )}
          </div>
        )}
      </div>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 크기 스테퍼 */}
      <button className={`${btn} text-[15px]`} title="작게" onClick={() => onApply({ fontSize: Math.max(6, Math.round((size - 0.5) * 2) / 2) })}>
        −
      </button>
      <span className="text-[11px] font-semibold text-ink tabular-nums w-8 text-center">{size}</span>
      <button className={`${btn} text-[15px]`} title="크게" onClick={() => onApply({ fontSize: Math.round((size + 0.5) * 2) / 2 })}>
        ＋
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 색 */}
      {TEXT_COLOR_PRESETS.map((c) => (
        <button
          key={c}
          title={`색 ${c}`}
          onClick={() => onApply({ color: c })}
          className="w-[18px] h-[18px] rounded-full mx-[1px] transition-transform hover:scale-[1.15] shrink-0"
          style={{ backgroundColor: c, border: `2px solid ${(sel.color ?? "").toUpperCase() === c.toUpperCase() ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.1)" }}
        />
      ))}
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 형광펜(글자 배경) — 런 전용. 빈 스와치 = 지우기(undefined → 상속 없음이라 무배경) */}
      {INLINE_HIGHLIGHTS.map((c) => (
        <button
          key={c || "none"}
          title={c ? `형광펜 ${c}` : "형광펜 지우기"}
          onClick={() => onApply({ bg: c || undefined })}
          className="w-[18px] h-[18px] rounded-[5px] mx-[1px] transition-transform hover:scale-[1.15] shrink-0 flex items-center justify-center"
          style={{ backgroundColor: c || "var(--surface)", border: `2px solid ${(sel.bg ?? "") === c ? "var(--accent)" : "var(--line)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.06)" }}
        >
          {!c && <span className="text-[9px] text-inkfaint leading-none">✕</span>}
        </button>
      ))}
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 문단 정렬 — 선택이 걸친 문단들에 적용 */}
      {(["left", "center", "right"] as TextAlign[]).map((a, i) => (
        <button
          key={a}
          className={`${btn} ${sel.align === a ? btnOn : ""} text-[11px] font-bold`}
          title={`${["왼쪽", "가운데", "오른쪽"][i]} 정렬 (문단)`}
          onClick={() => onApplyAlign(a)}
        >
          {["좌", "중", "우"][i]}
        </button>
      ))}
      {/* 목록 — 글머리(•)/번호(1.) 토글 (선택 걸친 문단) */}
      <button
        className={`${btn} ${sel.list === "bullet" ? btnOn : ""}`}
        title="글머리 기호 (문단)"
        onClick={() => onApplyList("bullet")}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
          <circle cx="2.2" cy="2.2" r="1.4" fill="currentColor" />
          <circle cx="2.2" cy="9.4" r="1.4" fill="currentColor" />
          <path d="M6 2.2h7M6 9.4h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`${btn} ${sel.list === "num" ? btnOn : ""} text-[10px] font-bold tracking-tight`}
        title="번호 목록 (문단)"
        onClick={() => onApplyList("num")}
      >
        1.
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 글꼴 — 커스텀 팝오버(네이티브 select는 blur로 선택 잃음) */}
      <div className="relative">
        <button
          className="h-[28px] px-2 rounded-[7px] text-[11.5px] text-ink hover:bg-paper transition-colors flex items-center gap-1 whitespace-nowrap max-w-[92px]"
          title="글꼴 (선택 구간)"
          onClick={() => setFontOpen((v) => !v)}
        >
          <span className="truncate">{fontByKey(sel.font).label}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {fontOpen && (
          <div
            className="absolute left-0 top-[32px] w-[168px] max-h-[240px] overflow-auto rounded-[9px] bg-surface border border-line py-1 z-10"
            style={{ boxShadow: "var(--sh-pop)" }}
          >
            {(["gothic", "myeongjo", "display", "hand", "safe", "compat"] as const).map((cat) => {
              const inCat = FONTS.filter((f) => f.category === cat);
              if (!inCat.length) return null;
              return (
                <div key={cat}>
                  <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold text-inkfaint tracking-[.06em]">{CATEGORY_LABEL[cat]}</div>
                  {inCat.map((f) => (
                    <button
                      key={f.key}
                      className={`w-full text-left px-2.5 py-1 text-[12px] hover:bg-paper transition-colors ${sel.font === f.key ? "text-accent font-bold" : "text-ink"}`}
                      onClick={() => {
                        void ensureFont(f.key);
                        onApply({ font: f.key });
                        setFontOpen(false);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 표: table-king 엔진 (기존 앱에서 이관) ──