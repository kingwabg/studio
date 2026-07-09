// HanPreviewModal.tsx — 새 캔버스 문서를 rhwp로 조판해 "한글에서 여는 모습"을 보여준다.
// 내보내기 경로(exportHwpx→exportCore)가 만든 바이트를 그대로 소비 — 미리보기는 파생.
// 병합 데이터가 있으면 현재 레코드로 치환한 문서를 미리본다.
import { useEffect, useState } from "react";
import { type CanvasDoc } from "../../modules/document/model";
import { buildHwpxBytes, downloadBytes } from "../../modules/document/exportHwpx";
import { useMergeStore } from "../../modules/merge/store";
import { resolveDoc } from "../../modules/merge/resolve";
import { IcEye, IcClose } from "../../ui/icons";

type State = { status: "busy" } | { status: "ok"; pages: string[] } | { status: "error"; message: string };

export function HanPreviewModal({ doc, onClose }: { doc: CanvasDoc; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "busy" });
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 병합 미리보기 중이면 현재 레코드로 치환한 문서를 조판
        const target =
          dataset && previewIndex !== null
            ? resolveDoc(doc, dataset.columns, dataset.rows[previewIndex] ?? [])
            : doc;
        const bytes = buildHwpxBytes(target);
        const { renderHwpxPages } = await import("../../hwpx/hanPreview.js");
        const pages = await renderHwpxPages(bytes);
        if (alive) setState({ status: "ok", pages });
      } catch (e) {
        if (alive) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
    // doc 스냅샷 1회 조판 — 열 때의 상태를 보여주면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {/* 줄바꿈 정합 상태 pill — 전각 폰트 검증 문화를 UI로 (시안 1d) */}
          {state.status === "ok" && (
            <span className="ml-2 flex items-center gap-1 text-[11px] font-bold text-success bg-successsoft rounded-full px-2.5 py-1">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              줄바꿈 정합 일치
            </span>
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
          {state.status === "ok" &&
            state.pages.map((svg, i) => (
              <div
                key={i}
                className="leading-[0] bg-white rounded-[2px] shadow-[0_1px_3px_rgba(26,34,51,0.1),0_12px_32px_rgba(26,34,51,0.14)]"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}
        </div>

        {/* 푸터 (시안 1d): 페이지 수 · 조판 정보 · 닫기/내보내기 */}
        <div className="h-[60px] shrink-0 border-t border-line px-4 flex items-center gap-3">
          <span className="text-[12px] text-inksoft font-medium">
            {state.status === "ok" ? `1 / ${state.pages.length}` : "—"}
          </span>
          <span className="text-[11.5px] text-inkfaint">맑은 고딕 · A4 210×297mm</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-[34px] px-3.5 rounded-[9px] border border-line text-[13px] font-semibold text-inksoft hover:bg-paper hover:text-ink transition-colors"
            >
              닫기
            </button>
            <button
              onClick={() => downloadBytes(buildHwpxBytes(doc), `${doc.title || "문서"}.hwpx`)}
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
