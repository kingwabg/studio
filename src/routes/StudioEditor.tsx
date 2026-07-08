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
import { IcBack, IcDownload, IcLogo } from "../ui/icons";

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
      } else if (target.kind === "tableblock") {
        // table-king 셀 특정: 드롭 좌표 밑의 셀 input을 찾아 그 값에 토큰을 덧붙인다.
        // table-king 내부를 안 건드리고 공개 DOM(제어 input의 onChange)만 쓰는 경로.
        const ae = e.activatorEvent as PointerEvent;
        const fx = (ae?.clientX ?? 0) + delta.x;
        const fy = (ae?.clientY ?? 0) + delta.y;
        const under = document.elementFromPoint(fx, fy);
        const input =
          under?.tagName === "INPUT"
            ? (under as HTMLInputElement)
            : under?.closest("td, th")?.querySelector("input");
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          setter.call(input, input.value ? input.value + token : token);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return;
    }

    if (kind === "palette" && over) {
      const type = active.data.current?.type as BlockType;
      const flow = active.data.current?.flow as boolean | undefined;
      const stage = stageRef.current;
      const dropped = active.rect.current.translated;
      if (!stage || !dropped) return;
      const rect = stage.getBoundingClientRect();
      addBlock(
        type,
        pxToMm(dropped.left - rect.left),
        pxToMm(dropped.top - rect.top),
        // 본문(흐름): 본문답게 넓은 기본 폭 + 안내 문구
        flow ? { flow: true, w: 170, text: "본문을 입력하세요. 한글에서 이어 쓸 수 있는 진짜 문단으로 내보내집니다." } : undefined
      );
    }
  }

  return (
    <div className="studio-root h-screen flex flex-col bg-canvas text-ink">
      <header className="h-[52px] shrink-0 flex items-center gap-2 px-3 border-b border-line bg-white">
        <Link
          to="/studio"
          className="flex items-center gap-1 h-8 pl-2 pr-3 rounded-lg text-inksoft hover:bg-paper hover:text-ink transition-colors text-[13px] font-medium"
        >
          <IcBack size={16} /> 내 문서
        </Link>
        <span className="w-px h-5 bg-line mx-1" />
        <span className="text-accent">
          <IcLogo size={16} />
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 없는 문서"
          className="text-[14px] font-semibold text-ink outline-none border border-transparent hover:border-line focus:border-accentline rounded-md px-2 py-1 -ml-0.5 min-w-40 transition-colors"
        />
        <span
          className={`text-[11.5px] transition-colors ${
            status === "saving" ? "text-inkfaint" : status === "saved" ? "text-inksoft" : "text-transparent"
          }`}
        >
          {status === "saving" ? "저장 중…" : "저장됨"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => downloadBytes(buildHwpxBytes(doc), `${title || "문서"}.hwpx`)}
            className="flex items-center gap-1.5 rounded-lg bg-accent text-white text-[12.5px] font-semibold px-3.5 h-[34px] hover:bg-accenthover active:scale-[0.98] transition-all shadow-[0_1px_2px_rgba(43,92,230,0.25)]"
          >
            <IcDownload size={15} /> HWPX 내보내기
          </button>
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
