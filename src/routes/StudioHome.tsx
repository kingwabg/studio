// StudioHome.tsx — 새 모듈형 스튜디오의 홈. Phase 1은 "새 문서 시작"만.
// Phase 2에서 Supabase의 내 문서 목록을 여기에 채운다.
import { Link, useNavigate } from "react-router-dom";
import { useCanvasStore } from "../modules/canvas/store";

export default function StudioHome() {
  const navigate = useNavigate();
  const reset = useCanvasStore((s) => s.reset);

  const startNew = () => {
    reset("제목 없는 문서");
    navigate("/studio/editor");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="h-14 flex items-center px-8 border-b border-slate-200 bg-white">
        <span className="font-semibold text-[15px]">문서 스튜디오</span>
        <span className="ml-2 text-[11px] font-medium text-blue-600 bg-blue-50 rounded px-2 py-0.5">
          모듈형 (Phase 1)
        </span>
        <Link to="/" className="ml-auto text-[13px] text-slate-500 hover:text-slate-700">
          기존 편집기 →
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-16">
        <h1 className="text-2xl font-semibold mb-2">무엇을 만들까요?</h1>
        <p className="text-sm text-slate-500 mb-8">
          빈 캔버스에서 시작해 블록을 자유롭게 배치하세요.
        </p>
        <button
          onClick={startNew}
          className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-left hover:border-blue-400 hover:shadow-sm transition"
        >
          <div className="text-[15px] font-medium text-slate-800">새 캔버스 문서</div>
          <div className="text-[12px] text-slate-500 mt-1">A4 · 자유 배치 · 드래그 앤 드롭</div>
        </button>
      </main>
    </div>
  );
}
