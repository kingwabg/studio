// StudioRhwp.tsx — rhwp 에디터(rhwp-studio) 무수정 통째 탑재 (2026-07-11 사용자 지시).
// 전체화면 편집 라우트. iframe 마운트/프로브는 공용 RhwpEmbed로 단일화(중복 2회 룰).
// 우리 코드는 컨테이너+뒤로가기+상태 표시뿐 — rhwp 쪽은 한 줄도 수정하지 않는다.
import { useState } from "react";
import { Link } from "react-router-dom";
import { RhwpEmbed, type RhwpStatus } from "../modules/embed/RhwpEmbed";

export default function StudioRhwp() {
  const [status, setStatus] = useState<RhwpStatus>("loading");
  const [detail, setDetail] = useState("");

  return (
    <div className="studio-editor-shell flex h-screen flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3.5">
        <Link
          to="/"
          className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-inksoft transition-colors hover:bg-paper hover:text-ink"
        >
          ← 홈
        </Link>
        <span className="h-6 w-px bg-line" />
        <span className="text-[14px] font-bold">rhwp 에디터</span>
        <span className="rounded bg-accentsoft px-2 py-0.5 text-[10.5px] font-bold text-accent">무수정 임베드 · @rhwp/editor</span>
        {status === "loading" && <span className="text-[12px] text-inkfaint">불러오는 중…</span>}
        {status === "error" && (
          <span className="truncate text-[12px] text-red-600" title={detail}>
            로드 실패(rhwp 서버 필요): {detail.slice(0, 60)}
          </span>
        )}
      </header>
      <RhwpEmbed
        className="min-h-0 flex-1"
        onStatus={(s, d) => { setStatus(s); setDetail(d ?? ""); }}
      />
    </div>
  );
}
