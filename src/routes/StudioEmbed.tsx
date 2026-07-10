// StudioEmbed.tsx — 판매용 임베드 에디터 제품 페이지 (홈 "에디터" 탭).
//
// 구성: 히어로(셀링포인트) → 라이브 데모(진짜 동작하는 EmbedEditor) →
// HWPX 다운로드(차별화 증명) → 통합 코드 스니펫(개발자 대상 판매 어필).
// 데모가 곧 제품 — 여기서 동작하는 그대로를 SDK로 패키징해 판다.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmbedEditor, embedValueToDoc, type EmbedValue } from "../modules/embed/EmbedEditor";
import { buildHwpxBytesAsync, downloadBytes } from "../modules/document/exportHwpx";
import { type CanvasDoc } from "../modules/document/model";
import { IcBack, IcDownload } from "../ui/icons";

const SNIPPET = `import { EmbedEditor } from "@upmu24/editor";

<EmbedEditor
  placeholder="내용을 입력하세요…"
  onChange={(v) => save(v.runs)}   // runs = 서식 포함 JSON
/>

// 한 줄로 한글(.hwpx) 파일 생성 — 국내 유일
const hwpx = await toHwpx(v);`;

export default function StudioEmbed() {
  const valueRef = useRef<EmbedValue | null>(null);
  const [busy, setBusy] = useState(false);

  const downloadHwpx = async () => {
    const v = valueRef.current;
    if (!v || !v.text.trim()) {
      alert("에디터에 내용을 입력한 뒤 내려받아 보세요.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await buildHwpxBytesAsync(embedValueToDoc(v) as unknown as CanvasDoc);
      downloadBytes(bytes, "임베드에디터.hwpx");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      {/* 상단 바 */}
      <div className="h-[56px] bg-surface border-b border-line flex items-center gap-4 px-6">
        <Link to="/studio" className="flex items-center gap-1.5 text-[13px] font-semibold text-inksoft hover:text-ink transition-colors">
          <IcBack size={15} /> 홈
        </Link>
        <div className="text-[15px] font-extrabold text-ink">
          임베드 에디터 <span className="text-[11px] font-bold text-accent bg-accentsoft rounded-full px-2 py-0.5 ml-1 align-middle">개발 프리뷰</span>
        </div>
      </div>

      <div className="max-w-[860px] mx-auto px-6 py-10 flex flex-col gap-8">
        {/* 히어로 */}
        <div>
          <h1 className="text-[26px] font-extrabold text-ink leading-tight" style={{ letterSpacing: "-0.01em" }}>
            어디에나 넣는 리치텍스트 에디터,
            <br />
            <span className="text-accent">한글(.hwpx)로 내보내지는</span> 유일한 컴포넌트
          </h1>
          <p className="mt-3 text-[14px] text-inksoft leading-relaxed max-w-[560px]">
            폼·게시판·관리자 페이지 어디든 몇 줄로 붙입니다. 서식은 JSON(runs)으로 저장되고,
            같은 데이터가 관공서 표준 한글 문서로 그대로 나갑니다 — 저작권 안전 폰트 내장.
          </p>
        </div>

        {/* 라이브 데모 */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-inkfaint tracking-wide">라이브 데모 — 직접 써보세요</span>
            <button
              onClick={downloadHwpx}
              disabled={busy}
              className="flex items-center gap-1.5 h-[34px] px-3.5 rounded-lg text-[12.5px] font-bold text-onaccent bg-accent hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <IcDownload size={14} /> {busy ? "생성 중…" : "이 내용을 한글로 (.hwpx)"}
            </button>
          </div>
          <EmbedEditor
            placeholder="여기에 입력해 보세요 — 굵게, 형광펜, 목록, 링크…"
            minHeight={200}
            onChange={(v) => {
              valueRef.current = v;
            }}
          />
          <p className="text-[11.5px] text-inkfaint">
            굵게/기울임/밑줄/취소선 · 글자색 · 형광펜 · 정렬 · 글머리/번호 목록 · 링크 · 실행취소 — 기본형 구성입니다.
          </p>
        </div>

        {/* 통합 코드 */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[12px] font-bold text-inkfaint tracking-wide">통합 코드 (React)</span>
          <pre className="rounded-xl border border-line bg-surface p-4 text-[12px] leading-relaxed text-ink overflow-x-auto">
            <code>{SNIPPET}</code>
          </pre>
        </div>

        {/* 로드맵 정직 고지 */}
        <div className="rounded-xl border border-dashed border-linestrong p-4 text-[12.5px] text-inksoft leading-relaxed">
          <b className="text-ink">개발 프리뷰 안내</b> — 지금 이 페이지의 에디터는 실제 동작하는 제품 코어입니다.
          npm 패키지·라이선스·표/이미지 확장은 준비 중이며, 문서 에디터(캔버스)와 같은 편집 엔진을 공유합니다.
        </div>
      </div>
    </div>
  );
}
