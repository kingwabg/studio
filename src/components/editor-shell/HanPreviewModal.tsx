// HanPreviewModal.tsx — 새 캔버스 문서를 rhwp로 조판해 "한글에서 여는 모습"을 보여준다.
// 내보내기 경로(exportHwpx→exportCore)가 만든 바이트를 그대로 소비 — 미리보기는 파생.
// 병합 데이터가 있으면 현재 레코드로 치환한 문서를 미리본다.
import { useEffect, useState } from "react";
import { type CanvasDoc } from "../../modules/document/model";
import { buildHwpxBytes } from "../../modules/document/exportHwpx";
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
      className="fixed inset-0 z-[90] bg-[rgba(26,34,51,0.45)] flex items-center justify-center"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(880px,94vw)] h-[90vh] bg-white rounded-2xl shadow-[0_24px_64px_rgba(26,34,51,0.35)] flex flex-col overflow-hidden"
      >
        <div className="h-13 min-h-[52px] px-4 border-b border-line flex items-center gap-2.5 shrink-0">
          <span className="text-accent">
            <IcEye size={17} />
          </span>
          <span className="text-[13.5px] font-semibold text-ink">한글 미리보기</span>
          <span className="text-[11.5px] text-inksoft">
            {state.status === "ok"
              ? `${state.pages.length}페이지 · rhwp 조판 — 한글에서 여는 모습`
              : state.status === "busy"
                ? "조판 중…"
                : "조판 실패"}
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
      </div>
    </div>
  );
}
