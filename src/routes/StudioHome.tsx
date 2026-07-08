// StudioHome.tsx — 새 모듈형 스튜디오의 홈. 내 문서 목록 + 새 문서 생성.
// 저장소는 repository(지금 localStorage, 나중에 Supabase) — 이 컴포넌트는 인터페이스만 안다.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRepository, type DocMeta } from "../modules/document/repository";
import { IcPlus, IcTrash, IcLogo, IcFile } from "../ui/icons";

const repo = getRepository();

export default function StudioHome() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    repo.list().then((list) => {
      setDocs(list);
      setLoading(false);
    });
  }, []);

  const startNew = async () => {
    const doc = await repo.create("제목 없는 문서");
    navigate(`/studio/editor/${doc.id}`);
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await repo.remove(id);
    setDocs(await repo.list());
  };

  return (
    <div className="studio-root min-h-screen bg-paper text-ink">
      <header className="h-14 flex items-center px-8 border-b border-line bg-white">
        <div className="flex items-center gap-2.5">
          <span className="text-accent">
            <IcLogo size={22} />
          </span>
          <span className="font-bold text-[15px] tracking-tight">문서 스튜디오</span>
          <span className="text-[11px] font-semibold text-accent bg-accentsoft rounded-md px-2 py-0.5">
            베타
          </span>
        </div>
        <Link
          to="/"
          className="ml-auto text-[13px] text-inksoft hover:text-ink transition-colors"
        >
          기존 편집기 →
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-14">
        <h1 className="text-[26px] font-bold tracking-tight mb-1.5">내 문서</h1>
        <p className="text-[14px] text-inksoft mb-9">
          빈 캔버스에서 시작해 블록을 자유롭게 배치하세요. 작업은 자동 저장됩니다.
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <button
            onClick={startNew}
            className="group rounded-2xl border-2 border-dashed border-linestrong bg-white/60 px-5 py-10 text-center hover:border-accent hover:bg-accentsoft/40 transition-all duration-150"
          >
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-accentsoft text-accent mb-3 group-hover:scale-110 transition-transform">
              <IcPlus size={22} />
            </span>
            <div className="text-[13.5px] font-semibold text-ink">새 문서</div>
            <div className="text-[11.5px] text-inkfaint mt-0.5">A4 · 자유 배치</div>
          </button>

          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-line bg-white animate-pulse">
                  <div className="h-28 bg-canvas rounded-t-2xl" />
                  <div className="px-3.5 py-3 space-y-2">
                    <div className="h-3 w-3/4 bg-line rounded" />
                    <div className="h-2.5 w-1/2 bg-line rounded" />
                  </div>
                </div>
              ))
            : docs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => navigate(`/studio/editor/${d.id}`)}
                  className="group relative rounded-2xl border border-line bg-white overflow-hidden cursor-pointer hover:border-accentline hover:shadow-[0_2px_8px_rgba(26,34,51,0.06),0_12px_28px_rgba(26,34,51,0.08)] transition-all duration-150"
                >
                  <div className="h-28 thumb-grad flex items-center justify-center border-b border-line text-inkfaint">
                    <IcFile size={26} />
                  </div>
                  <div className="px-3.5 py-3">
                    <div className="text-[13px] font-semibold text-ink truncate">{d.title}</div>
                    <div className="text-[11px] text-inkfaint mt-0.5">{fmt(d.updatedAt)}</div>
                  </div>
                  <button
                    onClick={(e) => remove(d.id, e)}
                    aria-label="삭제"
                    className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg text-inkfaint bg-white/90 border border-line opacity-0 group-hover:opacity-100 hover:text-red-500 hover:border-red-200 transition-all"
                  >
                    <IcTrash size={15} />
                  </button>
                </div>
              ))}
        </div>

        {!loading && docs.length === 0 && (
          <p className="text-[13px] text-inkfaint mt-6">
            아직 문서가 없어요. 새 문서로 시작해보세요.
          </p>
        )}
      </main>
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
