// HanPreviewModal.tsx — 새 캔버스 문서를 rhwp로 조판해 "한글에서 여는 모습"을 보여준다.
// 내보내기 경로(exportHwpx→exportCore)가 만든 바이트를 그대로 소비 — 미리보기는 파생.
// 병합 데이터가 있으면 현재 레코드로 치환한 문서를 미리본다.
import { useCallback, useEffect, useRef, useState } from "react";
import { type CanvasDoc } from "../../modules/document/model";
import { buildHwpxBytesAsync, downloadBytes } from "../../modules/document/exportHwpx";
import { DEFAULT_FONT, ensureFont, fontByKey } from "../../modules/document/fonts";
import { PageSnapshot } from "../../modules/canvas/PageSnapshot";
import { useMergeStore } from "../../modules/merge/store";
import { resolveDoc } from "../../modules/merge/resolve";
import { IcEye, IcClose } from "../../ui/icons";

type ViewMode = "preview" | "split" | "overlay";

// rhwp getValidationWarnings() 반환 형식 (#177)
interface HwpxWarnings {
  count: number;
  summary: Record<string, number>;
  warnings: { section: number; paragraph: number; kind: string; cell: unknown }[];
}
type State =
  | { status: "busy" }
  | { status: "ok"; pages: string[]; warnings: HwpxWarnings | null; reflowed: number }
  | { status: "error"; message: string };

export function HanPreviewModal({ doc, onClose }: { doc: CanvasDoc; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "busy" });
  const [detailOpen, setDetailOpen] = useState(false);
  const [fixTried, setFixTried] = useState(false);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [overlayOpacity, setOverlayOpacity] = useState(70); // 겹치기: rhwp 레이어 불투명도
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);
  const aliveRef = useRef(true);
  // 비교에 쓸 "화면" 문서 — 병합 미리보기 중이면 치환된 문서(미리보기와 같은 입력)
  const snapshotDoc =
    dataset && previewIndex !== null ? resolveDoc(doc, dataset.columns, dataset.rows[previewIndex] ?? []) : doc;

  // 조판 + rhwp 비표준 검증(getValidationWarnings). autoFix면 reflowLinesegs로 자동 보정.
  const runRender = useCallback(
    async (autoFix: boolean) => {
      setState({ status: "busy" });
      try {
        // 미리보기(rhwp SVG)는 hwpx가 선언한 폰트 이름을 CSS font-family로 그린다 —
        // 문서가 쓰는 폰트를 미리 로드+별칭(hwpxName→webFamily)해 맑은고딕 폴백을 막는다.
        const usedKeys = new Set<string>([DEFAULT_FONT]);
        for (const b of doc.blocks) if (b.type === "text" && b.font) usedKeys.add(b.font);
        await Promise.all([...usedKeys].map((k) => ensureFont(k).catch(() => {})));
        // 병합 미리보기 중이면 현재 레코드로 치환한 문서를 조판
        const target =
          dataset && previewIndex !== null
            ? resolveDoc(doc, dataset.columns, dataset.rows[previewIndex] ?? [])
            : doc;
        const bytes = await buildHwpxBytesAsync(target); // 이미지 자산 포함
        const { renderHwpxWithReview } = await import("../../hwpx/hanPreview.js");
        const { pages, warnings, reflowed } = await renderHwpxWithReview(bytes, { autoFix });
        if (aliveRef.current) setState({ status: "ok", pages, warnings, reflowed });
      } catch (e) {
        if (aliveRef.current) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [doc, dataset, previewIndex]
  );

  useEffect(() => {
    aliveRef.current = true;
    void runRender(false);
    return () => {
      aliveRef.current = false;
    };
    // doc 스냅샷 1회 조판 — 열 때의 상태를 보여주면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warnings = state.status === "ok" ? state.warnings : null;
  const warnCount = warnings?.count ?? 0;

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[90] flex items-center justify-center"
      style={{ background: "rgba(16,22,35,.46)", backdropFilter: "blur(3px)" }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(880px,94vw)] h-[90vh] bg-surface rounded-[18px] flex flex-col overflow-hidden"
        style={{ boxShadow: "var(--sh-pop)" }}
      >
        <div className="min-h-[58px] px-4 border-b border-line flex items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-[9px] bg-accentsoft text-accent">
            <IcEye size={16} />
          </span>
          <div className="flex flex-col">
            <span className="text-[13.5px] font-bold text-ink">한글 미리보기</span>
            <span className="text-[11px] text-inkfaint">한글(HWP) 화면과 동일한 조판으로 렌더링됩니다</span>
          </div>
          {/* HWPX 비표준 검증 상태 — rhwp getValidationWarnings() 결과 (시안 1d) */}
          {state.status === "ok" && warnCount === 0 && (
            <span className="ml-2 flex items-center gap-1 text-[11px] font-bold text-success bg-successsoft rounded-full px-2.5 py-1">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              HWPX 표준 준수
            </span>
          )}
          {state.status === "ok" && warnCount > 0 && (
            <button
              onClick={() => setDetailOpen((v) => !v)}
              title="자세히 보기"
              className="ml-2 flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1 text-[color:var(--cat-orange)] bg-[color:var(--cat-orange-soft)] hover:brightness-95 transition"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5l5 8.5H1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6 5v2.2M6 8.7v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              HWPX 비표준 {warnCount}건
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ transform: detailOpen ? "rotate(180deg)" : undefined }}>
                <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {state.status === "ok" && state.reflowed > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-success">자동 보정 {state.reflowed}건 적용됨</span>
          )}
          {state.status === "ok" && fixTried && state.reflowed === 0 && warnCount > 0 && (
            <span className="text-[11px] text-inkfaint">보정 대상 없음 (상자 텍스트는 셀 단위)</span>
          )}
          <span className="text-[11.5px] text-inksoft ml-1">
            {state.status === "ok" ? `${state.pages.length}페이지` : state.status === "busy" ? "조판 중…" : "조판 실패"}
          </span>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-inksoft hover:bg-paper hover:text-ink transition-colors"
          >
            <IcClose size={16} />
          </button>
        </div>

        {/* 보기 모드 툴바 — 미리보기 / 나란히 / 겹치기(오버레이) */}
        <div className="shrink-0 border-b border-line px-4 h-[42px] flex items-center gap-2">
          <div className="flex bg-paper border border-line rounded-[8px] p-[3px] gap-[3px]">
            {(
              [
                ["preview", "미리보기"],
                ["split", "나란히"],
                ["overlay", "겹치기"],
              ] as [ViewMode, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`px-3 h-[26px] rounded-[6px] text-[12px] font-semibold transition-colors ${
                  mode === v ? "bg-surface text-accent shadow-sm" : "text-inksoft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "split" && (
            <span className="text-[11px] text-inkfaint">왼쪽=화면(캔버스) · 오른쪽=한글 미리보기(rhwp)</span>
          )}
          {mode === "overlay" && (
            <span className="text-[11px] text-inkfaint">화면 위에 미리보기를 겹침 — 줄바꿈이 같으면 글자가 포개지고, 다르면 두 겹으로 어긋나 보임</span>
          )}
          {mode === "overlay" && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-inkfaint">미리보기 진하게</span>
              <input
                type="range"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-[110px]"
              />
            </div>
          )}
        </div>

        {/* HWPX 비표준 상세 (rhwp "자세히 보기" 이식) — lineseg 미계산 등 경고 목록 + 자동 보정 */}
        {state.status === "ok" && warnCount > 0 && detailOpen && (
          <div className="shrink-0 border-b border-line bg-[color:var(--cat-orange-soft)]/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-ink leading-relaxed">
                  이 문서는 HWPX 명세를 일부 준수하지 않는 값을 포함합니다 (경고 {warnCount}건). 미리보기가 렌더러(rhwp)의 재조판에
                  의존하므로 화면과 줄바꿈이 다를 수 있어요. <b>자동 보정</b>은 줄 정보를 다시 계산해 렌더 안정성을 높입니다.
                </p>
                <ul className="mt-2 flex flex-col gap-0.5 max-h-[120px] overflow-auto">
                  {Object.entries(warnings?.summary ?? {}).map(([msg, n]) => (
                    <li key={msg} className="text-[11px] text-inksoft">
                      • {msg}: <b className="text-ink">{n}건</b>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => {
                  setFixTried(true);
                  void runRender(true);
                }}
                className="shrink-0 h-[30px] px-3 rounded-lg bg-[color:var(--cat-orange)] text-white text-[12px] font-bold hover:brightness-95 transition"
              >
                자동 보정
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-canvas py-6 px-4 flex flex-col items-center gap-5">
          {state.status === "busy" && (
            <div className="m-auto flex flex-col items-center gap-3 text-inkfaint">
              <span className="w-8 h-8 rounded-full border-2 border-line border-t-accent animate-spin" />
              <span className="text-[12.5px]">한글 조판 준비 중…</span>
            </div>
          )}
          {state.status === "error" && (
            <div className="m-auto text-center text-inksoft text-[12.5px] leading-relaxed">
              미리보기 조판에 실패했어요.
              <br />
              <span className="font-mono text-[11px] text-inkfaint">{state.message}</span>
            </div>
          )}
          {state.status === "ok" && mode === "preview" &&
            state.pages.map((svg, i) => (
              <div
                key={i}
                className="leading-[0] bg-white rounded-[2px] shadow-[0_1px_3px_rgba(26,34,51,0.1),0_12px_32px_rgba(26,34,51,0.14)]"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}

          {/* 나란히 — 왼쪽 화면(정적), 오른쪽 rhwp 미리보기 1페이지. 폭 맞춰 축소. */}
          {state.status === "ok" && mode === "split" && (
            <div className="flex items-start gap-5" style={{ transform: "scale(0.5)", transformOrigin: "top center" }}>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[13px] font-bold text-inksoft">화면 (캔버스)</span>
                <div className="rounded-[2px] shadow-[0_1px_3px_rgba(26,34,51,0.1),0_12px_32px_rgba(26,34,51,0.14)]">
                  <PageSnapshot doc={snapshotDoc} />
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[13px] font-bold text-inksoft">한글 미리보기 (rhwp)</span>
                <div
                  className="leading-[0] rounded-[2px] shadow-[0_1px_3px_rgba(26,34,51,0.1),0_12px_32px_rgba(26,34,51,0.14)]"
                  dangerouslySetInnerHTML={{ __html: state.pages[0] ?? "" }}
                />
              </div>
            </div>
          )}

          {/* 겹치기 — 화면 위에 rhwp 1페이지를 같은 크기로 포갬. multiply라 흰 배경은 사라지고
              두 텍스트만 겹친다(줄바꿈 일치=포개짐, 불일치=두 겹). 슬라이더로 rhwp 진하기. */}
          {state.status === "ok" && mode === "overlay" && (
            <div className="relative rounded-[2px] shadow-[0_1px_3px_rgba(26,34,51,0.1),0_12px_32px_rgba(26,34,51,0.14)]">
              <PageSnapshot doc={snapshotDoc} />
              <div
                className="absolute inset-0 leading-[0]"
                style={{ opacity: overlayOpacity / 100, mixBlendMode: "multiply" }}
                dangerouslySetInnerHTML={{ __html: state.pages[0] ?? "" }}
              />
            </div>
          )}
        </div>

        {/* 푸터 (시안 1d): 페이지 수 · 조판 정보 · 닫기/내보내기 */}
        <div className="h-[60px] shrink-0 border-t border-line px-4 flex items-center gap-3">
          <span className="text-[12px] text-inksoft font-medium">
            {state.status === "ok" ? `1 / ${state.pages.length}` : "—"}
          </span>
          <span className="text-[11.5px] text-inkfaint">{fontByKey(DEFAULT_FONT).label} · A4 210×297mm</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-[34px] px-3.5 rounded-[9px] border border-line text-[13px] font-semibold text-inksoft hover:bg-paper hover:text-ink transition-colors"
            >
              닫기
            </button>
            <button
              onClick={async () => downloadBytes(await buildHwpxBytesAsync(doc), `${doc.title || "문서"}.hwpx`)}
              className="h-[34px] px-4 rounded-[9px] bg-accent text-onaccent text-[13px] font-bold hover:bg-accenthover transition-colors"
              style={{ boxShadow: "0 1px 2px rgba(43,92,230,.35)" }}
            >
              HWPX 내보내기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
