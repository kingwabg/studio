// StudioEmbed.tsx — 판매용 문서 에디터 제품 페이지 (홈 "에디터" 탭).
//
// 라이브 데모 = 진짜 rhwp 엔진(rhwp-studio 7700)을 통째 임베드(iframe). 진짜 표·리본·수식 등
// 모든 편집 기능이 그대로. 경량화(2026-07-13): lazy=클릭 전까지 엔진(~13MB) 미로드.
// 다음 목표(사용자): rhwp 크롬(메뉴바·눈금자·상태바)을 숨기고 서식 리본만 보이게 + A4.
import { Link } from "react-router-dom";
import { RhwpEmbed } from "../modules/embed/RhwpEmbed";
import { IcBack } from "../ui/icons";

const SNIPPET = `import { createEditor } from "@rhwp/editor";

// 한컴(HWP/HWPX) 호환 문서 에디터를 통째로 임베드 — 표·수식·서식 전부
const editor = await createEditor(
  document.getElementById("editor"),
  { height: "640px" },
);`;

export default function StudioEmbed() {
  return (
    <div className="min-h-dvh bg-canvas">
      {/* 상단 바 */}
      <div className="h-[56px] bg-surface border-b border-line flex items-center gap-4 px-6">
        <Link to="/" className="flex items-center gap-1.5 text-[13px] font-semibold text-inksoft hover:text-ink transition-colors">
          <IcBack size={15} /> 홈
        </Link>
        <div className="text-[15px] font-extrabold text-ink">
          문서 에디터 <span className="text-[11px] font-bold text-accent bg-accentsoft rounded-full px-2 py-0.5 ml-1 align-middle">rhwp 임베드</span>
        </div>
      </div>

      <div className="max-w-[980px] mx-auto px-6 py-10 flex flex-col gap-8">
        {/* 히어로 */}
        <div>
          <h1 className="text-[26px] font-extrabold text-ink leading-tight" style={{ letterSpacing: "-0.01em" }}>
            웹에 그대로 얹는
            <br />
            <span className="text-accent">한컴(.hwpx) 호환 문서 에디터</span>
          </h1>
          <p className="mt-3 text-[14px] text-inksoft leading-relaxed max-w-[620px]">
            표·수식·서식까지 완전한 한글 문서 편집기를 몇 줄로 임베드합니다. 관공서 표준 한글 문서를
            그대로 열고 편집하고 내보냅니다 — 아래 데모가 곧 실제 엔진(rhwp)입니다.
          </p>
        </div>

        {/* 라이브 데모 — 진짜 rhwp 에디터 통째 임베드 */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[12px] font-bold text-inkfaint tracking-wide">라이브 데모 — 진짜 rhwp 엔진(표·리본·수식 전부)</span>
          <RhwpEmbed lazy embedChrome className="rounded-xl border border-line overflow-hidden shadow-sm" height="640px" />
          <p className="text-[11.5px] text-inkfaint">
            메뉴·눈금자·상태바 없이 <b className="text-inksoft">서식 리본만</b> — 글꼴·크기·서식 + 표·이미지·모양·링크.
            진짜 rhwp 엔진(셀 편집·수식)이 A4 지면에서 그대로 동작합니다. <b className="text-inksoft">로컬은 rhwp 서버(7700)</b> 필요.
          </p>
        </div>

        {/* 통합 코드 */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[12px] font-bold text-inkfaint tracking-wide">통합 코드 (@rhwp/editor)</span>
          <pre className="rounded-xl border border-line bg-surface p-4 text-[12px] leading-relaxed text-ink overflow-x-auto">
            <code>{SNIPPET}</code>
          </pre>
        </div>

        {/* 로드맵 정직 고지 */}
        <div className="rounded-xl border border-dashed border-linestrong p-4 text-[12.5px] text-inksoft leading-relaxed">
          <b className="text-ink">개발 프리뷰 안내</b> — 데모는 rhwp 에디터(무수정 임베드, @rhwp/editor)를 그대로 띄웁니다.
          자체 호스팅·npm 패키지·라이선스는 준비 중입니다.
        </div>
      </div>
    </div>
  );
}
