// RhwpEmbed.tsx — rhwp-studio(7700)를 통째로 띄우는 iframe 임베드 (공용 컴포넌트).
//
// 판매 데모(StudioEmbed)와 전체화면 편집(StudioRhwp)이 공유한다 — @rhwp/editor createEditor
// 프로브/마운트 로직 단일 소스(중복 2회 룰). rhwp는 한 줄도 수정하지 않는 무수정 임베드.
//
// 경량화(2026-07-13): rhwp 엔진은 WASM ~13MB(rhwp 코어 6.5MB + CanvasKit 7MB)로 엔진 자체는
// 줄일 수 없다 — 대신 lazy=true면 클릭 전까지 아예 로드하지 않는다(클릭-투-로드). 판매 페이지가
// 방문 즉시 13MB를 당기지 않게 해 페이지는 가볍게 뜨고, 사용자가 원할 때만 엔진을 내려받는다.
// studioUrl 우선순위: ①VITE_RHWP_STUDIO_URL ②로컬 7700(dev:rhwp) ③@rhwp/editor 기본(github.io).
import { useEffect, useRef, useState } from "react";
import { createEditor } from "@rhwp/editor";

export type RhwpStatus = "loading" | "ready" | "error";

export function RhwpEmbed({
  className = "",
  height = "100%",
  lazy = false,
  embedChrome = false,
  onStatus,
}: {
  className?: string;
  height?: string;
  /** true면 클릭 전까지 rhwp(~13MB)를 로드하지 않는다 — 판매 페이지 경량화용. */
  lazy?: boolean;
  /** true면 rhwp를 ?embed=1로 띄워 메뉴·눈금자·상태바를 숨기고 리본만 보이게(판매 페이지용). */
  embedChrome?: boolean;
  onStatus?: (status: RhwpStatus, detail?: string) => void;
}) {
  const [activated, setActivated] = useState(!lazy); // lazy면 클릭으로만 활성화
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<RhwpStatus>("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!activated) return; // 아직 클릭 전 — 엔진 로드 안 함
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const set = (s: RhwpStatus, d = "") => {
      if (disposed) return;
      setStatus(s);
      setDetail(d);
      onStatus?.(s, d);
    };
    void (async () => {
      try {
        const probe = (url: string) =>
          fetch(url, { method: "HEAD", mode: "cors" }).then((r) => r.ok).catch(() => false);
        const envUrl = import.meta.env.VITE_RHWP_STUDIO_URL as string | undefined;
        const LOCAL = "http://127.0.0.1:7700/";
        // [캔버스 한컴 포크] self-host한 우리 포크 빌드(public/rhwp-app, `npm run build:rhwp-app`).
        // 업스트림 github.io 폴백을 이걸로 대체 — 배포·7700 없이도 항상 우리 커스텀(캔버스 모드·
        // 표 UX·?embed=1·AI)이 나온다. 같은 출처라 CORS도 없음.
        const SELF = "/rhwp-app/";
        let studioUrl = envUrl ?? ((await probe(LOCAL)) ? LOCAL : SELF);
        // 임베드 모드(?embed=1) — 우리 포크가 크롬을 숨기고 리본만 노출(SELF·7700 모두 지원).
        if (embedChrome) studioUrl += studioUrl.includes("?") ? "&embed=1" : "?embed=1";
        const editor = await createEditor(host, { height, studioUrl });
        if (disposed) {
          editor?.destroy?.();
          return;
        }
        set("ready");
      } catch (e) {
        set("error", String(e));
      }
    })();
    return () => {
      disposed = true;
      host.replaceChildren(); // iframe 정리
    };
    // onStatus는 안정 콜백 가정 — 재마운트 유발 방지 위해 deps 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, activated, embedChrome]);

  // 지연 로딩 포스터 — 클릭 전까지 엔진을 안 내려받는다(방문 즉시 페이지 가볍게 뜸)
  if (!activated) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 bg-paper text-center ${className}`} style={{ height }}>
        <button
          onClick={() => setActivated(true)}
          className="flex items-center gap-2 h-11 px-5 rounded-xl bg-accent text-onaccent text-[14px] font-bold hover:opacity-90 transition-opacity"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7-4.5-7-4.5Z" /></svg>
          rhwp 문서 에디터 데모 열기
        </button>
        <p className="text-[11.5px] text-inkfaint max-w-[300px] leading-relaxed">
          클릭하면 실제 한글 호환 편집기를 불러옵니다 (엔진 약 13MB) — 페이지는 그전까지 가볍게 유지됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas px-6 text-center text-[13px] text-inkfaint">
          {status === "loading"
            ? "rhwp 에디터 불러오는 중…"
            : `rhwp 서버(7700)가 필요합니다 · ${detail.slice(0, 80)}`}
        </div>
      )}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
