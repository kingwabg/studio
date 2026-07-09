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
  type Modifier,
} from "@dnd-kit/core";
import { type BlockType, moveSetIds } from "../modules/document/model";
import { mmToPx, pxToMm } from "../modules/canvas/geometry";
import { useCanvasStore } from "../modules/canvas/store";
import { computeSnap, isAltPressed, setAltPressed, useFollowStore, useGuideStore } from "../modules/canvas/snap";
import { CanvasStage } from "../modules/canvas/CanvasStage";
import { LeftPanel } from "../components/editor-shell/LeftPanel";
import { RightPanel } from "../components/editor-shell/RightPanel";
import { getRepository } from "../modules/document/repository";
import { buildHwpxBytes, downloadBytes } from "../modules/document/exportHwpx";
import { flattenDoc } from "../modules/document/flatten";
import { HanPreviewModal } from "../components/editor-shell/HanPreviewModal";
import { EditorToolbar } from "../components/editor-shell/EditorToolbar";
import { PanelDivider } from "../components/editor-shell/PanelDivider";
import { useThemeStore } from "../modules/ui/theme";
import { IcBack, IcDownload, IcEye, IcMoon, IcSparkles, IcSun } from "../ui/icons";

// 중첩 드롭 대상(지면 안의 텍스트/셀) 우선 — 포인터가 안쪽 대상 위면 그걸 고른다.
// 지면(stage)은 안쪽 대상이 없을 때의 폴백 (팔레트로 새 블록 만들 때).
const preferInner: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const inner = within.filter((c) => c.id !== "stage");
  return inner.length ? inner : within;
};

// 스마트 자석 스냅 — 드래그 중 실시간으로 다른 블록·지면 선에 ±2mm 하드 스냅.
// Alt를 누르면 해제(정밀 조정). dragEnd에서도 같은 computeSnap을 적용해
// 시각과 최종 좌표가 항상 일치한다.
// ⚠ modifier는 렌더 경로에서 호출될 수 있어 여기서 setState 금지 —
//    가이드 표시는 onDragMove(이벤트 핸들러)가 담당한다.
const snapModifier: Modifier = ({ active, transform }) => {
  if (active?.data.current?.kind !== "block" || isAltPressed()) return transform;
  const s = useCanvasStore.getState();
  const b = s.doc.blocks.find((x) => x.id === active.id);
  if (!b) return transform;
  const candX = b.x + pxToMm(transform.x);
  const candY = b.y + pxToMm(transform.y);
  const snap = computeSnap(s.doc, b.id, candX, candY, b.w, b.h);
  return {
    ...transform,
    x: transform.x + mmToPx(snap.x - candX),
    y: transform.y + mmToPx(snap.y - candY),
  };
};

const repo = getRepository();
type SaveStatus = "idle" | "saving" | "saved";

export default function StudioEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false); // 로드 완료 전에는 오토세이브 금지(빈 문서로 덮어쓰기 방지)
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [previewing, setPreviewing] = useState(false);
  const dark = useThemeStore((s) => s.dark);
  const toggleDark = useThemeStore((s) => s.toggle);

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

  // Alt = 스냅 해제 (누르는 동안) — 스냅 모디파이어가 읽는 전역 플래그
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Alt" && setAltPressed(true);
    const up = (e: KeyboardEvent) => e.key === "Alt" && setAltPressed(false);
    const blur = () => setAltPressed(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // 한글식 단축키: Ctrl+Z/Y(실행취소), Delete(선택 블록 삭제).
  // 입력 중(인풋/텍스트영역/표 셀)에는 절대 가로채지 않는다 — 브라우저·table-king 몫.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      const st = useCanvasStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        st.undo();
      } else if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        st.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedIds.length) {
        e.preventDefault();
        st.removeSelection();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        st.groupSelection(); // ⌘G 그룹 묶기
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        st.ungroupSelection(); // ⌘⇧G 그룹 해제
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over, delta } = e;
    const kind = active.data.current?.kind;

    if (kind === "block") {
      const st = useCanvasStore.getState();
      const b = st.doc.blocks.find((x) => x.id === active.id);
      if (b) {
        const candX = b.x + pxToMm(delta.x);
        const candY = b.y + pxToMm(delta.y);
        // 드래그 중 보여준 것과 같은 스냅을 최종 좌표에도 적용 (Alt면 원시 좌표)
        const pos = isAltPressed() ? { x: candX, y: candY } : computeSnap(st.doc, b.id, candX, candY, b.w, b.h);
        // 다중 선택(임시)이면 선택 전체를 같은 델타로 — 그룹·트리는 nudgeMany가 확장.
        if (st.selectedIds.length > 1 && st.selectedIds.includes(b.id)) {
          st.nudgeMany(st.selectedIds, pos.x - b.x, pos.y - b.y);
        } else {
          moveBlock(b.id, pos.x, pos.y); // 단일: moveSetIds로 그룹·자손 동반
        }
      }
      useGuideStore.getState().clear();
      useFollowStore.getState().clear();
      return;
    }

    // 레이어 트리 중첩: 레이어 행을 다른 행에 드롭 → 자식으로, 루트 영역에 드롭 → 해제
    if (kind === "layer") {
      const draggedId = active.data.current?.blockId as string;
      const target = over?.data.current;
      if (!draggedId || !target) return;
      const st = useCanvasStore.getState();
      if (target.kind === "layer" && target.blockId !== draggedId) st.setParent(draggedId, target.blockId);
      else if (target.kind === "layerroot") st.setParent(draggedId, null);
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
    // .studio-root는 StudioTheme 래퍼가 제공 — 여기서 또 붙이면 다크 변수를 라이트로 되덮는다
    <div className="h-screen flex flex-col bg-canvas text-ink">
      {/* 상단 액션 바 52px (시안 1b) — 좌: 복귀·로고·제목·저장 / 우: 3단 위계 버튼 + 다크 */}
      <header
        className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-line bg-surface relative z-[3]"
        style={{ boxShadow: "0 1px 2px rgba(16,24,40,.03)" }}
      >
        <Link
          to="/studio"
          className="flex items-center gap-1.5 h-8 pl-1.5 pr-2.5 rounded-lg text-inksoft hover:bg-paper hover:text-ink transition-colors text-[13px] font-medium"
        >
          <IcBack size={14} /> 내 문서
        </Link>
        <span className="w-px h-5 bg-line" />
        <div className="flex items-center gap-2">
          <div className="w-[22px] h-[22px] rounded-md bg-accent text-onaccent flex items-center justify-center text-[9px] font-extrabold">
            24
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 없는 문서"
            className="text-[14.5px] font-bold text-ink tracking-tight outline-none border border-transparent hover:border-line hover:bg-paper focus:border-accentline rounded-[7px] px-2 py-1 min-w-40 transition-colors bg-transparent"
          />
          <span
            className={`flex items-center gap-1 text-[12px] transition-colors ${
              status === "saving" ? "text-inkfaint" : status === "saved" ? "text-inkfaint" : "text-transparent"
            }`}
          >
            {status === "saved" && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5L5 9l4.5-5.5" stroke="var(--success)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {status === "saving" ? "저장 중…" : "저장됨"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleDark}
            aria-label={dark ? "라이트 모드" : "다크 모드"}
            className="w-8 h-8 rounded-lg text-inksoft hover:bg-paper hover:text-ink flex items-center justify-center transition-colors"
          >
            {dark ? <IcSun size={15} /> : <IcMoon size={15} />}
          </button>
          <button
            onClick={async () => {
              // 마인드맵 → 공문서: 트리를 개요 번호 문서로 펴서 "새 문서"로 저장·이동 (원본 보존)
              const flat = flattenDoc(useCanvasStore.getState().doc);
              await repo.save(flat);
              navigate(`/studio/editor/${flat.id}`);
            }}
            title="트리 구조를 개요 번호(Ⅰ/1/가)가 매겨진 공문서로 펴서 새 문서로 만듭니다"
            className="flex items-center gap-1.5 rounded-[9px] text-inksoft text-[13px] font-semibold px-3 h-[34px] hover:bg-paper hover:text-ink transition-colors"
          >
            <IcSparkles size={14} /> 공문서로 펴기
          </button>
          <button
            onClick={() => setPreviewing(true)}
            className="flex items-center gap-1.5 rounded-[9px] border border-line bg-surface text-ink text-[13px] font-semibold px-3 h-[34px] hover:border-linestrong hover:bg-paper transition-colors"
          >
            <IcEye size={14} /> 한글 미리보기
          </button>
          <button
            onClick={() => downloadBytes(buildHwpxBytes(doc), `${title || "문서"}.hwpx`)}
            className="flex items-center gap-1.5 rounded-[9px] bg-accent text-onaccent text-[13px] font-bold px-3.5 h-[34px] hover:bg-accenthover active:scale-[0.98] transition-all"
            style={{ boxShadow: "0 1px 2px rgba(43,92,230,.35)" }}
          >
            <IcDownload size={14} /> HWPX 내보내기
          </button>
        </div>
      </header>

      {previewing && <HanPreviewModal doc={doc} onClose={() => setPreviewing(false)} />}

      <EditorToolbar />

      <DndContext
        sensors={sensors}
        collisionDetection={preferInner}
        modifiers={[snapModifier]}
        onDragMove={(e) => {
          // 가이드 표시 + 자석 그룹 팔로우 — 이벤트 핸들러에서 안전하게 setState
          const a = e.active;
          if (a?.data.current?.kind !== "block") {
            useGuideStore.getState().clear();
            return;
          }
          const st = useCanvasStore.getState();
          const b = st.doc.blocks.find((x) => x.id === a.id);
          if (!b) return;
          // 함께 움직일 집합 — 다중 선택이면 선택 전체, 아니면 이 블록 하나에서
          // moveSetIds로 트리 자손·그룹 멤버까지 확장 (드래그당 1회).
          const seed = st.selectedIds.length > 1 && st.selectedIds.includes(b.id) ? st.selectedIds : [b.id];
          const members = moveSetIds(st.doc.blocks, seed);
          const candX = b.x + pxToMm(e.delta.x);
          const candY = b.y + pxToMm(e.delta.y);
          if (isAltPressed()) {
            useGuideStore.getState().clear();
            // Alt(스냅 해제)여도 자손 팔로우는 유지
            useFollowStore.getState().setFollow(String(a.id), e.delta.x, e.delta.y, members);
            return;
          }
          const snap = computeSnap(st.doc, b.id, candX, candY, b.w, b.h);
          useGuideStore.getState().setGuides(snap.guides, snap.badges);
          // 자손이 따라올 시각 델타 = 스냅 반영된 최종 델타 (부모의 실제 화면 이동량)
          useFollowStore.getState().setFollow(String(a.id), mmToPx(snap.x - b.x), mmToPx(snap.y - b.y), members);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          useGuideStore.getState().clear();
          useFollowStore.getState().clear();
        }}
      >
        <div className="flex-1 flex min-h-0">
          <LeftPanel />
          <PanelDivider side="left" />
          <CanvasStage ref={stageRef} />
          <PanelDivider side="right" />
          <RightPanel />
        </div>
      </DndContext>
    </div>
  );
}
