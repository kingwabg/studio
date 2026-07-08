// StudioHome.tsx — 새 모듈형 스튜디오의 홈. 내 문서 목록 + 새 문서 생성.
// 저장소는 repository(지금 localStorage, 나중에 Supabase) — 이 컴포넌트는 인터페이스만 안다.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRepository, type DocMeta } from "../modules/document/repository";

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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="h-14 flex items-center px-8 border-b border-slate-200 bg-white">
        <span className="font-semibold text-[15px]">문서 스튜디오</span>
        <span className="ml-2 text-[11px] font-medium text-blue-600 bg-blue-50 rounded px-2 py-0.5">
          모듈형 (Phase 2)
        </span>
        <Link to="/" className="ml-auto text-[13px] text-slate-500 hover:text-slate-700">
          기존 편집기 →
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-14">
        <h1 className="text-2xl font-semibold mb-2">내 문서</h1>
        <p className="text-sm text-slate-500 mb-8">
          빈 캔버스에서 시작해 블록을 자유롭게 배치하세요. 작업은 자동 저장됩니다.
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <button
            onClick={startNew}
            className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 py-8 text-center hover:border-blue-400 hover:text-blue-600 text-slate-500 transition"
          >
            <div className="text-2xl leading-none mb-1">＋</div>
            <div className="text-[13px] font-medium">새 문서</div>
          </button>

          {loading ? (
            <p className="col-span-2 text-[13px] text-slate-400 self-center">불러오는 중…</p>
          ) : (
            docs.map((d) => (
              <div
                key={d.id}
                onClick={() => navigate(`/studio/editor/${d.id}`)}
                className="group relative rounded-xl border border-slate-200 bg-white overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-sm transition"
              >
                <div className="h-24 bg-slate-100 border-b border-slate-100" />
                <div className="px-3 py-2">
                  <div className="text-[13px] font-medium text-slate-800 truncate">{d.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{fmt(d.updatedAt)}</div>
                </div>
                <button
                  onClick={(e) => remove(d.id, e)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[11px] text-red-500 bg-white/90 rounded px-1.5 py-0.5 hover:text-red-600"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
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
