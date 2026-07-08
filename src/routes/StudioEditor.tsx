// StudioEditor.tsx — 새 모듈형 에디터. L/C/R 셸 조립 + dnd-kit 총괄 + 영속화(로드/오토세이브).
// Phase 2: 저장소는 repository(지금 localStorage). 문서는 라우트 :id로 식별.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { type BlockType } from "../modules/document/model";
import { pxToMm } from "../modules/canvas/geometry";
import { useCanvasStore } from "../modules/canvas/store";
import { CanvasStage } from "../modules/canvas/CanvasStage";
import { LeftPanel } from "../components/editor-shell/LeftPanel";
import { RightPanel } from "../components/editor-shell/RightPanel";
import { getRepository } from "../modules/document/repository";
import { buildHwpxBytes, downloadBytes } from "../modules/document/exportHwpx";

// 중첩 드롭 대상(지면 안의 텍스트/셀) 우선 — 포인터가 안쪽 대상 위면 그걸 고른다.
// 지면(stage)은 안쪽 대상이 없을 때의 폴백 (팔레트로 새 블록 만들 때).
const preferInner: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const inner = within.filter((c) => c.id !== "stage");
  return inner.length ? inner : within;
};

const repo = getRepository();
type SaveStatus = "idle" | "saving" | "saved";

export default function StudioEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false); // 로드 완료 전에는 오토세이브 금지(빈 문서로 덮어쓰기 방지)
  const [status, setStatus] = useState<SaveStatus>("idle");

  const title = useCanvasStore((s) => s.doc.title);
  const setTitle = useCanvasStore((s) => s.setTitle);
  const loadDoc = useCanvasStore((s) => s.loadDoc);
  const addBlock = useCanvasStore((s) => s.addBlock);
  const moveBlock = useCanvasStore((s) => s.moveBlock);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const setCell = useCanvasStore((s) => s.setCell);
  const doc = useCanvasStore((s) => s.doc);

  // 로드: :id의 문서를 저장소에서 불러온다. 없으면 홈으로.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    hydratedRef.current = false;
    repo.get(id).then((d) => {
      if (!alive) return;
      if (!d) {
        navigate("/studio", { replace: true });
        return;
      }
      loadDoc(d);
      hydratedRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, [id, loadDoc, navigate]);

  // 오토세이브: 문서가 바뀌면 1.2초 디바운스 후 저장. (로드 직후/다른 문서 상태는 건너뜀)
  useEffect(() => {
    if (!hydratedRef.current || doc.id !== id) return;
    setStatus("saving");
    const t = setTimeout(async () => {
      await repo.save(doc);
      setStatus("saved");
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, id]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over, delta } = e;
    const kind = active.data.current?.kind;

    if (kind === "block") {
      const b = useCanvasStore.getState().doc.blocks.find((x) => x.id === active.id);
      if (b) moveBlock(b.id, b.x + pxToMm(delta.x), b.y + pxToMm(delta.y));
      return;
    }

    // 데이터 알약 → 텍스트 블록/표 셀에 {{열이름}} 토큰 삽입 (엔진은 토큰, 화면은 칩)
    if (kind === "field") {
      const column = active.data.current?.column as string;
      const target = over?.data.current;
      if (!column || !target) return;
      const token = `{{${column}}}`;
      const blocks = useCanvasStore.getState().doc.blocks;
      if (target.kind === "textblock") {
        const b = blocks.find((x) => x.id === target.blockId);
        if (!b) return;
        // 시드 문구는 통째로 교체, 이미 내용이 있으면 뒤에 덧붙임
        const base = !b.text || b.text === "텍스트를 입력하세요" ? "" : b.text + " ";
        updateBlock(b.id, { text: base + token });
      } else if (target.kind === "cell") {
        const b = blocks.find((x) => x.id === target.blockId);
        const cur = b?.rows?.[target.r]?.[target.c] ?? "";
        setCell(target.blockId, target.r, target.c, cur ? cur + token : token);
      }
      return;
    }

    if (kind === "palette" && over) {
      const type = active.data.current?.type as BlockType;
      const stage = stageRef.current;
      const dropped = active.rect.current.translated;
      if (!stage || !dropped) return;
      const rect = stage.getBoundingClientRect();
      addBlock(type, pxToMm(dropped.left - rect.left), pxToMm(dropped.top - rect.top));
    }
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100 text-slate-800">
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200 bg-white">
        <Link to="/studio" className="text-slate-400 hover:text-slate-600 text-sm">
          ← 내 문서
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-sm font-medium text-slate-800 outline-none border-b border-transparent focus:border-slate-300 px-1"
        />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-slate-400">
            {status === "saving" ? "저장 중…" : status === "saved" ? "저장됨" : ""}
          </span>
          <button
            onClick={() => downloadBytes(buildHwpxBytes(doc), `${title || "문서"}.hwpx`)}
            className="rounded-lg bg-blue-600 text-white text-[12px] font-medium px-3 py-1.5 hover:bg-blue-700"
          >
            HWPX 내보내기
          </button>
          <Link to="/" className="text-[12px] text-blue-600 hover:underline">
            기존 편집기 →
          </Link>
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={preferInner} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex min-h-0">
          <LeftPanel />
          <CanvasStage ref={stageRef} />
          <RightPanel />
        </div>
      </DndContext>
    </div>
  );
}
