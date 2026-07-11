// StudioRhwp.tsx — rhwp 에디터(rhwp-studio) 무수정 통째 탑재 (2026-07-11 사용자 지시).
// 공식 임베드 패키지 @rhwp/editor 사용: iframe으로 rhwp-studio 전체(메뉴·툴바·표 편집)를
// 그대로 띄운다. 우리 코드는 컨테이너+뒤로가기뿐 — rhwp 쪽은 한 줄도 수정하지 않는다.
// 기본 studioUrl = https://edwardkim.github.io/rhwp/ (인터넷 필요). 자체 호스팅 전환은
// rhwp-studio를 빌드해 public/에 두고 createEditor(el, { studioUrl }) 옵션만 바꾸면 된다.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createEditor } from "@rhwp/editor";

export default function StudioRhwp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    void (async () => {
      try {
        // studioUrl 우선순위: ①환경변수(VITE_RHWP_STUDIO_URL — Codespaces 포워딩 URL 등)
        // ②입양본 dev 서버(레포 rhwp-studio/, 포트 7700 — launch.json "rhwp-studio"로 기동)
        // ③공식 데모(github.io) 폴백. rhwp-studio는 base=/ 절대 경로라 서브패스 서빙 불가 —
        // 별도 포트 루트 서빙이 무수정 원칙의 경로.
        const probe = (url: string) =>
          fetch(url, { method: "HEAD", mode: "cors" }).then((r) => r.ok).catch(() => false);
        const envUrl = import.meta.env.VITE_RHWP_STUDIO_URL as string | undefined;
        const LOCAL = "http://127.0.0.1:7700/";
        const studioUrl = envUrl ?? ((await probe(LOCAL)) ? LOCAL : undefined);
        const editor = await createEditor(host, {
          height: "100%",
          ...(studioUrl ? { studioUrl } : {}),
        });
        if (disposed) {
          editor?.destroy?.();
          return;
        }
        setStatus("ready");
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          setDetail(String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      host.replaceChildren(); // iframe 정리
    };
  }, []);

  return (
    <div className="studio-editor-shell flex h-screen flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3.5">
        <Link
          to="/studio"
          className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-inksoft transition-colors hover:bg-paper hover:text-ink"
        >
          ← 문서함
        </Link>
        <span className="h-6 w-px bg-line" />
        <span className="text-[14px] font-bold">rhwp 에디터</span>
        <span className="rounded bg-accentsoft px-2 py-0.5 text-[10.5px] font-bold text-accent">무수정 임베드 · @rhwp/editor</span>
        {status === "loading" && <span className="text-[12px] text-inkfaint">불러오는 중…</span>}
        {status === "error" && (
          <span className="truncate text-[12px] text-red-600" title={detail}>
            로드 실패(인터넷 연결 필요): {detail.slice(0, 60)}
          </span>
        )}
      </header>
      <div ref={hostRef} className="min-h-0 flex-1" />
    </div>
  );
}
