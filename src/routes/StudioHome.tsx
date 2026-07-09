// StudioHome.tsx — 업무24 홈 대시보드 (리디자인 시안 1a, docs/design/README.md).
// 네비(로고·탭·검색) → 히어로(시작 카드 6종) → 인기 템플릿 → 최근 문서.
// 시작 카드·템플릿은 껍데기가 아니라 시드 문서(starters.ts)로 실제 생성된다.
// 저장소는 repository(지금 localStorage, 나중에 Supabase) — 이 컴포넌트는 인터페이스만 안다.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRepository, type DocMeta } from "../modules/document/repository";
import { STARTERS, buildStarterDoc, type Starter } from "../modules/document/starters";
import { useThemeStore } from "../modules/ui/theme";
import { IcTrash, IcSearch, IcMoon, IcSun } from "../ui/icons";

const repo = getRepository();

// 미니 문서 썸네일 — 시작 카드 안 52×70 (첫 줄만 카테고리 색)
function MiniDoc({ tone }: { tone: string }) {
  return (
    <div
      className="bg-white rounded-[3px] flex flex-col gap-1"
      style={{ width: 52, height: 70, border: "1px solid #E4E8EF", boxShadow: "0 1px 3px rgba(16,24,40,.10)", padding: "8px 7px" }}
    >
      <div style={{ height: 5, width: "70%", borderRadius: 2, background: tone }} />
      <div style={{ height: 3, width: "100%", borderRadius: 2, background: "#E4E8EF" }} />
      <div style={{ height: 3, width: "88%", borderRadius: 2, background: "#E4E8EF" }} />
      <div style={{ height: 3, width: "94%", borderRadius: 2, background: "#EDF0F5" }} />
      <div style={{ height: 3, width: "60%", borderRadius: 2, background: "#EDF0F5" }} />
    </div>
  );
}

// 템플릿 카드 썸네일 — 틴트 배경에 하단 정렬 미니 A4 120×126
function TplThumb({ tone, tint }: { tone: string; tint: string }) {
  return (
    <div className="flex items-end justify-center overflow-hidden" style={{ height: 150, background: tint }}>
      <div
        className="bg-white flex flex-col gap-1.5"
        style={{
          width: 120, height: 126, border: "1px solid rgba(16,24,40,.08)",
          borderRadius: "4px 4px 0 0", boxShadow: "0 -2px 12px rgba(16,24,40,.10)", padding: "14px 13px",
        }}
      >
        <div style={{ height: 7, width: "64%", margin: "0 auto", borderRadius: 2, background: "#1A2233" }} />
        <div style={{ height: 4, width: "40%", borderRadius: 2, background: tone, marginTop: 5 }} />
        <div style={{ height: 3.5, width: "100%", borderRadius: 2, background: "#E4E8EF" }} />
        <div style={{ height: 3.5, width: "92%", borderRadius: 2, background: "#E4E8EF" }} />
        <div style={{ height: 4, width: "40%", borderRadius: 2, background: tone, marginTop: 5 }} />
        <div style={{ height: 3.5, width: "100%", borderRadius: 2, background: "#E4E8EF" }} />
        <div style={{ height: 3.5, width: "84%", borderRadius: 2, background: "#E4E8EF" }} />
      </div>
    </div>
  );
}

// 최근 문서 썸네일 — 78×100 스켈레톤 (표 자리 포함)
function RecentThumb() {
  return (
    <div className="h-[118px] bg-paper border-b border-line flex items-center justify-center">
      <div
        className="bg-white flex flex-col gap-1"
        style={{ width: 78, height: 100, border: "1px solid #E4E8EF", borderRadius: 3, boxShadow: "0 1px 4px rgba(16,24,40,.08)", padding: "10px 9px" }}
      >
        <div style={{ height: 5, width: "66%", margin: "0 auto", borderRadius: 2, background: "#1A2233" }} />
        <div style={{ height: 3, width: "100%", borderRadius: 2, background: "#E4E8EF", marginTop: 4 }} />
        <div style={{ height: 3, width: "90%", borderRadius: 2, background: "#E4E8EF" }} />
        <div style={{ height: 3, width: "96%", borderRadius: 2, background: "#EDF0F5" }} />
        <div style={{ height: 14, width: "100%", border: "1px solid #E4E8EF", borderRadius: 2, marginTop: 3 }} />
        <div style={{ height: 3, width: "70%", borderRadius: 2, background: "#EDF0F5" }} />
      </div>
    </div>
  );
}

// 인기 템플릿 메타 (시안 1a — starters 중 4종 노출)
const TPL_META: { key: string; meta: string; tag: string }[] = [
  { key: "official", meta: "기관 대외 서식", tag: "인기" },
  { key: "bizplan", meta: "표 개요서 구성", tag: "인기" },
  { key: "report", meta: "번호 서식 자동화", tag: "NEW" },
  { key: "minutes", meta: "참석자 안건 블록", tag: "무료" },
];

export default function StudioHome() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const dark = useThemeStore((s) => s.dark);
  const toggleDark = useThemeStore((s) => s.toggle);

  useEffect(() => {
    repo.list().then((list) => {
      setDocs(list);
      setLoading(false);
    });
  }, []);

  // 시작 카드/템플릿 → 시드 문서 생성 후 편집기로
  const start = async (s: Starter) => {
    const doc = buildStarterDoc(s);
    await repo.save(doc);
    navigate(`/studio/editor/${doc.id}`);
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await repo.remove(id);
    setDocs(await repo.list());
  };

  const tab = (label: string, active: boolean, extra?: string) => (
    <button
      key={label}
      title={active ? undefined : "준비 중"}
      className={`px-3.5 py-[7px] rounded-lg text-[13.5px] transition-colors ${
        active ? "bg-accentsoft text-accent font-semibold" : "text-inksoft font-medium hover:bg-paper hover:text-ink"
      } ${extra ?? ""}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-dvh bg-canvas" style={{ background: "var(--paper)" }}>
      {/* ── 상단 네비 60px ── */}
      <div className="h-[60px] bg-surface border-b border-line flex items-center gap-7 px-7">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent text-onaccent flex items-center justify-center text-[12px] font-extrabold tracking-tight">
            24
          </div>
          <div className="text-[16px] font-extrabold text-ink tracking-tight">업무24</div>
        </div>
        <div className="flex items-center gap-1">
          {tab("홈", true)}
          {tab("템플릿", false)}
          {tab("내 문서", false)}
        </div>
        {/* 검색 (⌘K — 준비 중) */}
        <div className="flex-1 flex justify-center">
          <div
            title="준비 중"
            className="w-[420px] max-w-full h-9 bg-paper border border-line rounded-[10px] flex items-center gap-2 px-3 hover:border-linestrong transition-colors cursor-text"
          >
            <span className="text-inkfaint"><IcSearch size={15} /></span>
            <span className="text-[13px] text-inkfaint">문서·템플릿 검색</span>
            <span className="ml-auto text-[11px] text-inkfaint border border-line rounded-[5px] px-1.5 py-px bg-surface">⌘K</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-[12.5px] text-inkfaint hover:text-inksoft transition-colors">기존 편집기 →</a>
          <button
            onClick={toggleDark}
            aria-label={dark ? "라이트 모드" : "다크 모드"}
            className="w-8 h-8 rounded-lg text-inksoft hover:bg-paper hover:text-ink flex items-center justify-center transition-colors"
          >
            {dark ? <IcSun size={16} /> : <IcMoon size={16} />}
          </button>
          <button title="준비 중" className="px-3.5 py-[7px] rounded-[9px] border border-accentline bg-accentsoft text-accent text-[13px] font-bold hover:bg-accent hover:text-onaccent transition-colors">
            업그레이드
          </button>
          <div className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-[12px] font-bold" style={{ color: "var(--surface)" }}>
            준
          </div>
        </div>
      </div>

      <div className="max-w-[1220px] mx-auto px-12 py-9 flex flex-col gap-9">
        {/* ── 히어로: 새 문서 시작 ── */}
        <div className="bg-hero border border-hero rounded-2xl flex flex-col gap-[22px]" style={{ padding: "32px 36px 30px" }}>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-ink tracking-tight">오늘은 어떤 문서를 만들까요?</div>
            <button title="준비 중" className="text-[13px] font-semibold text-accent hover:underline">템플릿 전체 보기 →</button>
          </div>
          <div className="flex gap-3.5 flex-wrap">
            {STARTERS.map((s) => (
              <button key={s.key} onClick={() => start(s)} className="w-32 flex flex-col items-center gap-2.5 cursor-pointer group">
                <div
                  className="w-32 h-24 bg-surface rounded-xl flex items-center justify-center transition-all group-hover:-translate-y-0.5 group-hover:border-accentline"
                  style={{ border: "1px solid var(--heroline)", boxShadow: "var(--sh-card)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--sh-card-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "var(--sh-card)")}
                >
                  <MiniDoc tone={s.tone} />
                </div>
                <div className="text-[13px] font-semibold text-ink">{s.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 인기 템플릿 ── */}
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2.5">
            <div className="text-[17px] font-bold text-ink">인기 템플릿</div>
            <div className="text-[12.5px] text-inkfaint">HWPX 내보내기 검증 완료</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TPL_META.map((t) => {
              const s = STARTERS.find((x) => x.key === t.key)!;
              return (
                <button
                  key={t.key}
                  onClick={() => start(s)}
                  className="bg-surface border border-line rounded-[14px] overflow-hidden text-left transition-all hover:-translate-y-0.5 hover:border-linestrong"
                  style={{ boxShadow: "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--sh-card-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                >
                  <TplThumb tone={s.tone} tint={s.tint} />
                  <div className="flex items-center gap-2 px-4 pt-3 pb-3.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-bold text-ink">{s.fixture?.title ?? s.name}</div>
                      <div className="text-[12px] text-inkfaint mt-0.5">{t.meta}</div>
                    </div>
                    <div className="text-[11px] font-bold rounded-[20px] px-2.5 py-[3px]" style={{ color: s.tone, background: s.tint }}>
                      {t.tag}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 최근 문서 ── */}
        <div className="flex flex-col gap-4 pb-10">
          <div className="flex items-baseline justify-between">
            <div className="text-[17px] font-bold text-ink">최근 문서</div>
            {docs.length > 0 && <span className="text-[12.5px] text-inkfaint">{docs.length}개</span>}
          </div>
          {loading ? (
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-3.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[170px] bg-surface border border-line rounded-xl opacity-50" />
              ))}
            </div>
          ) : docs.length === 0 ? (
            <p className="text-[13px] text-inkfaint">아직 문서가 없어요. 위에서 시작해보세요.</p>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-3.5">
              {docs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => navigate(`/studio/editor/${d.id}`)}
                  className="doc-card bg-surface border border-line rounded-xl overflow-hidden cursor-pointer relative transition-all hover:-translate-y-0.5"
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--sh-card-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                >
                  <RecentThumb />
                  <div className="px-3.5 pt-2.5 pb-3">
                    <div className="text-[13px] font-semibold text-ink truncate">{d.title}</div>
                    <div className="text-[11.5px] text-inkfaint mt-0.5">{fmt(d.updatedAt)}</div>
                  </div>
                  <button
                    aria-label="삭제"
                    onClick={(e) => remove(d.id, e)}
                    className="doc-del absolute top-2 right-2 w-7 h-7 rounded-full bg-surface border border-line text-inkfaint hover:text-red-500 hover:border-red-200 flex items-center justify-center transition-colors"
                  >
                    <IcTrash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 상대 시간 표기 (방금/N분 전/N시간 전/N일 전)
function fmt(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 수정";
  if (min < 60) return `${min}분 전 수정`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전 수정`;
  return `${Math.floor(hr / 24)}일 전 수정`;
}
