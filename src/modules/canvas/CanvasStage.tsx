// CanvasStage.tsx — A4 지면 + 눈금자(상단·좌측). 블록을 절대배치로 그리고,
// 팔레트 드롭 대상(useDroppable)이 된다.
// stageRef는 상위(StudioEditor)의 onDragEnd가 드롭 좌표를 지면 기준 mm로 환산할 때 쓴다.
//
// 눈금자: 한글(HWP) 편집 화면처럼 지면 위·왼쪽에 밀착. 1mm/5mm/10mm 틱 + cm 숫자.
// SCALE = CSS mm(3.7795px)라 눈금 px가 곧 실제 mm — 공공기관 규격(여백 15/20mm 등)을
// 실무자가 눈으로 검증할 수 있다. 지면에 붙어 함께 스크롤된다.
import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SCALE, mmToPx } from "./geometry";
import { collapsedHiddenIds, descendantIds } from "../document/model";
import { useCanvasStore } from "./store";
import { useFollowStore } from "./snap";
import { useRightTabStore } from "../ui/theme";
import { CanvasBlock } from "./CanvasBlock";
import { MultiSelectOverlay } from "./MultiSelectOverlay";
import { SnapGuides, SelectionGuides } from "./SnapGuides";
import { IcText } from "../../ui/icons";

// 그룹 멤버를 개별로 끄는 동안, 그 요소가 속한 공간 그룹의 경계 박스를 띄워
// "이 요소는 이 그룹 소속"임을 보여준다 (피그마식 그룹 컨텍스트).
function DraggingGroupBox() {
  const activeId = useFollowStore((s) => s.activeId);
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const active = activeId ? blocks.find((b) => b.id === activeId) : null;
  if (!active?.groupId) return null;
  const members = blocks.filter((b) => b.groupId === active.groupId);
  if (members.length < 2) return null;
  const x1 = Math.min(...members.map((b) => b.x));
  const y1 = Math.min(...members.map((b) => b.y));
  const x2 = Math.max(...members.map((b) => b.x + b.w));
  const y2 = Math.max(...members.map((b) => b.y + b.h));
  return (
    <div
      className="absolute pointer-events-none z-[8]"
      style={{
        left: mmToPx(x1) - 6,
        top: mmToPx(y1) - 6,
        width: mmToPx(x2 - x1) + 12,
        height: mmToPx(y2 - y1) + 12,
        border: "1.5px dashed var(--groupline)",
        borderRadius: 8,
        background: "rgba(124,154,240,.05)",
      }}
    >
      <span
        className="absolute -top-[10px] left-3 px-1.5 leading-[15px] text-[10px] font-bold rounded-sm text-white"
        style={{ background: "var(--groupline)" }}
      >
        그룹
      </span>
    </div>
  );
}

const RULER = 26; // 눈금자 두께(px) — 시안 1b
// 토큰 기반 (다크 모드 대응) — SVG 속성도 CSS 변수 문자열을 받는다
const RULER_BG = "var(--surface)";
const RULER_BORDER = "var(--line)";
const TICK_MINOR = "var(--line)";
const TICK_MID = "var(--linestrong)";
const TICK_MAJOR = "var(--inkfaint)";
const LABEL = "var(--inkfaint)";
const SAFE_MARGIN_MM = 20;
const PROJECTION_FILL = "rgba(43, 92, 230, 0.18)";
const PROJECTION_STROKE = "rgba(43, 92, 230, 0.78)";
const PROJECTION_ALERT_FILL = "rgba(239, 68, 68, 0.2)";
const PROJECTION_ALERT_STROKE = "rgba(220, 38, 38, 0.82)";
const BOX_EPSILON_MM = 0.05;

type RulerProjection = {
  start: number;
  size: number;
  alert: boolean;
};

type MeasuredBlockBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function isSameMeasuredBox(a: MeasuredBlockBox | null, b: MeasuredBlockBox) {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < BOX_EPSILON_MM &&
    Math.abs(a.y - b.y) < BOX_EPSILON_MM &&
    Math.abs(a.w - b.w) < BOX_EPSILON_MM &&
    Math.abs(a.h - b.h) < BOX_EPSILON_MM
  );
}

const rulerSurface = {
  display: "block",
  userSelect: "none",
  pointerEvents: "auto",
} as const;

function ProjectionBand({ axis, projection }: { axis: "x" | "y"; projection?: RulerProjection }) {
  if (!projection || projection.size <= 0) return null;
  const start = mmToPx(projection.start);
  const size = mmToPx(projection.size);
  const fill = projection.alert ? PROJECTION_ALERT_FILL : PROJECTION_FILL;
  const stroke = projection.alert ? PROJECTION_ALERT_STROKE : PROJECTION_STROKE;

  if (axis === "x")
    return (
      <>
        <rect x={start} y={0} width={size} height={RULER} fill={fill} />
        <line x1={start} x2={start} y1={0} y2={RULER} stroke={stroke} strokeWidth={1.4} />
        <line x1={start + size} x2={start + size} y1={0} y2={RULER} stroke={stroke} strokeWidth={1.4} />
      </>
    );

  return (
    <>
      <rect x={0} y={start} width={RULER} height={size} fill={fill} />
      <line x1={0} x2={RULER} y1={start} y2={start} stroke={stroke} strokeWidth={1.4} />
      <line x1={0} x2={RULER} y1={start + size} y2={start + size} stroke={stroke} strokeWidth={1.4} />
    </>
  );
}

function PageMarginGuides({ page }: { page: { w: number; h: number } }) {
  const inset = mmToPx(SAFE_MARGIN_MM);
  const width = mmToPx(page.w - SAFE_MARGIN_MM * 2);
  const height = mmToPx(page.h - SAFE_MARGIN_MM * 2);
  if (width <= 0 || height <= 0) return null;

  return (
    <div className="absolute pointer-events-none z-0" style={{ left: inset, top: inset, width, height }}>
      <div
        className="absolute inset-0 rounded-[3px]"
        style={{
          border: "1px dashed rgba(43, 92, 230, 0.44)",
          boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.72)",
        }}
      />
    </div>
  );
}
// 수평 눈금자 — 1mm/5mm/10mm 위계를 나누고 cm 숫자는 큰 눈금 중앙에 둔다.
function RulerH({ mm, projection, onSelect }: { mm: number; projection?: RulerProjection; onSelect: () => void }) {
  const w = mmToPx(mm);
  const ticks = useMemo(() => {
    const t: React.ReactNode[] = [];
    for (let m = 0; m <= mm; m += 1) {
      const x = m * SCALE;
      const major = m % 10 === 0;
      const mid = !major && m % 5 === 0;
      t.push(
        <line
          key={m}
          x1={x}
          x2={x}
          y1={major ? 13 : mid ? 18 : 22}
          y2={RULER - 1}
          stroke={major ? TICK_MAJOR : mid ? TICK_MID : TICK_MINOR}
          strokeWidth={major ? 1.1 : 0.65}
        />
      );
      if (major && m > 0 && m < mm)
        t.push(
          <text
            key={`t${m}`}
            x={x}
            y={10}
            textAnchor="middle"
            fontSize={9}
            fontWeight={650}
            fill={LABEL}
            fontFamily="Pretendard, sans-serif"
          >
            {m / 10}
          </text>
        );
    }
    return t;
  }, [mm]);
  return (
    <svg
      width={w}
      height={RULER}
      className="block select-none cursor-pointer"
      style={{ ...rulerSurface, background: RULER_BG, borderBottom: `1px solid ${RULER_BORDER}` }}
      role="button"
      tabIndex={0}
      aria-label="상단 눈금자 - 페이지 속성"
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
    >
      <rect x="0" y="0" width={w} height={RULER} fill={RULER_BG} />
      <ProjectionBand axis="x" projection={projection} />
      {ticks}
    </svg>
  );
}

// 수직 눈금자
function RulerV({ mm, projection, onSelect }: { mm: number; projection?: RulerProjection; onSelect: () => void }) {
  const h = mmToPx(mm);
  const ticks = useMemo(() => {
    const t: React.ReactNode[] = [];
    for (let m = 0; m <= mm; m += 1) {
      const y = m * SCALE;
      const major = m % 10 === 0;
      const mid = !major && m % 5 === 0;
      t.push(
        <line
          key={m}
          y1={y}
          y2={y}
          x1={major ? 13 : mid ? 18 : 22}
          x2={RULER - 1}
          stroke={major ? TICK_MAJOR : mid ? TICK_MID : TICK_MINOR}
          strokeWidth={major ? 1.1 : 0.65}
        />
      );
      if (major && m > 0 && m < mm)
        t.push(
          <text
            key={`t${m}`}
            x={8}
            y={y + 3}
            textAnchor="middle"
            fontSize={8.5}
            fontWeight={650}
            fill={LABEL}
            fontFamily="Pretendard, sans-serif"
          >
            {m / 10}
          </text>
        );
    }
    return t;
  }, [mm]);
  return (
    <svg
      width={RULER}
      height={h}
      className="block select-none cursor-pointer"
      style={{ ...rulerSurface, background: RULER_BG, borderRight: `1px solid ${RULER_BORDER}` }}
      role="button"
      tabIndex={0}
      aria-label="좌측 눈금자 - 페이지 속성"
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
    >
      <rect x="0" y="0" width={RULER} height={h} fill={RULER_BG} />
      <ProjectionBand axis="y" projection={projection} />
      {ticks}
    </svg>
  );
}

export const CanvasStage = forwardRef<HTMLDivElement>(function CanvasStage(_props, ref) {
  const doc = useCanvasStore((s) => s.doc);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const selectMany = useCanvasStore((s) => s.selectMany);
  const selectPage = useCanvasStore((s) => s.selectPage);
  const setRightTab = useRightTabStore((s) => s.setTab);
  const insertTextAt = useCanvasStore((s) => s.insertTextAt);
  const { setNodeRef } = useDroppable({ id: "stage" });
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [measuredBlockBox, setMeasuredBlockBox] = useState<MeasuredBlockBox | null>(null);
  // 마퀴(빈 지면 드래그로 사각 범위 선택) — px 좌표(지면 원점 기준)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const startMarquee = (e: React.PointerEvent) => {
    const pageNode = pageRef.current;
    if (!pageNode) return;
    const rect = pageNode.getBoundingClientRect();
    const x0 = e.clientX - rect.left;
    const y0 = e.clientY - rect.top;
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) select(null); // 새 선택
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      moved = true;
      setMarquee({ x0, y0, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      if (!moved) return; // 클릭만 = 선택 해제로 끝
      const rx0 = Math.min(x0, ev.clientX - rect.left);
      const ry0 = Math.min(y0, ev.clientY - rect.top);
      const rx1 = Math.max(x0, ev.clientX - rect.left);
      const ry1 = Math.max(y0, ev.clientY - rect.top);
      const hit = useCanvasStore
        .getState()
        .doc.blocks.filter((b) => {
          const bx0 = mmToPx(b.x), by0 = mmToPx(b.y), bx1 = mmToPx(b.x + b.w), by1 = mmToPx(b.y + b.h);
          return bx0 < rx1 && bx1 > rx0 && by0 < ry1 && by1 > ry0;
        })
        .map((b) => b.id);
      if (hit.length) selectMany(hit);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pageW = mmToPx(doc.page.w);
  const pageH = mmToPx(doc.page.h);
  const selectedBlock = doc.blocks.find((block) => block.id === selectedId);
  // 아코디언 접기 — 접힌 조상을 가진 블록은 지면에서 숨긴다 (문서에는 그대로 존재)
  const visibleBlocks = useMemo(() => {
    const hidden = collapsedHiddenIds(doc.blocks);
    return hidden.size ? doc.blocks.filter((b) => !hidden.has(b.id)) : doc.blocks;
  }, [doc.blocks]);

  // 그룹 선택 테두리 (시안 1b) — 자식 있는 블록 선택 시 자신+자손을 감싸는 점선 박스.
  // 자석 그룹의 범위를 눈으로 보여준다 (부모를 끌면 이만큼이 함께 움직인다).
  const groupBox = useMemo(() => {
    if (!selectedBlock) return null;
    const kids = descendantIds(doc.blocks, selectedBlock.id);
    if (!kids.size) return null;
    const members = doc.blocks.filter((b) => b.id === selectedBlock.id || kids.has(b.id));
    const x1 = Math.min(...members.map((b) => b.x));
    const y1 = Math.min(...members.map((b) => b.y));
    const x2 = Math.max(...members.map((b) => b.x + b.w));
    const y2 = Math.max(...members.map((b) => b.y + b.h));
    const label = (selectedBlock.text ?? "그룹").slice(0, 18);
    return { x1, y1, x2, y2, label, count: kids.size };
  }, [selectedBlock, doc.blocks]);

  useLayoutEffect(() => {
    const pageNode = pageRef.current;
    if (!pageNode || !selectedId) {
      setMeasuredBlockBox(null);
      return;
    }

    const safeId = selectedId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const blockNode = pageNode.querySelector<HTMLElement>(`[data-block-id="${safeId}"]`);
    const tableNode = blockNode?.querySelector<HTMLElement>(`[data-tableblock="${safeId}"]`);
    const measuredNode = tableNode ?? blockNode;
    if (!measuredNode) {
      setMeasuredBlockBox(null);
      return;
    }

    let frameId = 0;
    let lastBox: MeasuredBlockBox | null = null;

    const measure = () => {
      const pageRect = pageNode.getBoundingClientRect();
      const blockRect = measuredNode.getBoundingClientRect();
      const nextBox = {
        x: (blockRect.left - pageRect.left) / SCALE,
        y: (blockRect.top - pageRect.top) / SCALE,
        w: blockRect.width / SCALE,
        h: blockRect.height / SCALE,
      };

      if (!isSameMeasuredBox(lastBox, nextBox)) {
        lastBox = nextBox;
        setMeasuredBlockBox(nextBox);
      }
    };

    const measureFrame = () => {
      measure();
      frameId = window.requestAnimationFrame(measureFrame);
    };

    measure();
    frameId = window.requestAnimationFrame(measureFrame);
    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(measuredNode);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [selectedId, doc.blocks]);

  const projectionBox = measuredBlockBox ?? selectedBlock;
  const projectionAlert = projectionBox
    ? projectionBox.x < SAFE_MARGIN_MM ||
      projectionBox.y < SAFE_MARGIN_MM ||
      projectionBox.x + projectionBox.w > doc.page.w - SAFE_MARGIN_MM ||
      projectionBox.y + projectionBox.h > doc.page.h - SAFE_MARGIN_MM
    : false;
  const projectionX = projectionBox ? { start: projectionBox.x, size: projectionBox.w, alert: projectionAlert } : undefined;
  const projectionY = projectionBox ? { start: projectionBox.y, size: projectionBox.h, alert: projectionAlert } : undefined;
  const selectRulerPage = () => {
    selectPage();
    setRightTab("props");
  };

  return (
    <div className="studio-canvas-pane flex-1 relative min-w-0">
    <div className="studio-workbench-label" aria-hidden="true">
      <span className="studio-workbench-dot" />
      A4 작업대
      <span>여백 20mm</span>
    </div>
    <div className="studio-canvas-scroll absolute inset-0 overflow-auto canvas-dots bg-canvas">
      {/* 지면 + 눈금자 묶음 — 가운데 정렬, 함께 스크롤 */}
      <div className="studio-page-frame w-max mx-auto my-8" style={{ position: "relative", paddingLeft: RULER, paddingTop: RULER }}>
        {/* 모서리 상자 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: RULER,
            height: RULER,
            background: RULER_BG,
            borderRight: `1px solid ${RULER_BORDER}`,
            borderBottom: `1px solid ${RULER_BORDER}`,
            boxShadow: "inset -1px -1px 0 rgba(255,255,255,0.9)",
            pointerEvents: "auto",
            userSelect: "none",
          }}
          role="button"
          tabIndex={0}
          aria-label="눈금자 모서리 - 페이지 속성"
          onClick={selectRulerPage}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectRulerPage()}
        />
        {/* 상단 눈금자 */}
        <div style={{ position: "absolute", top: 0, left: RULER }}>
          <RulerH mm={doc.page.w} projection={projectionX} onSelect={selectRulerPage} />
        </div>
        {/* 좌측 눈금자 */}
        <div style={{ position: "absolute", top: RULER, left: 0 }}>
          <RulerV mm={doc.page.h} projection={projectionY} onSelect={selectRulerPage} />
        </div>

        {/* A4 지면 */}
        <div
          ref={(node) => {
            pageRef.current = node;
            setNodeRef(node); // dnd-kit 드롭 대상
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node; // onDragEnd 좌표 환산용
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) startMarquee(e); // 빈 지면 드래그 → 마퀴 선택
          }}
          onDoubleClick={(e) => {
            // 텍스트 도구 — 빈 지면 더블클릭이면 그 자리에 텍스트를 만들고 바로 편집.
            // (블록 위 더블클릭은 그 블록이 처리하므로 target===지면일 때만)
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            insertTextAt((e.clientX - rect.left) / SCALE, (e.clientY - rect.top) / SCALE);
          }}
          style={{ width: pageW, height: pageH, boxShadow: "var(--sh-page)" }}
          className="studio-page relative bg-white shrink-0"
        >
          <PageMarginGuides page={doc.page} />
          {visibleBlocks.map((block) => (
            <CanvasBlock key={block.id} block={block} />
          ))}
          {/* 다중 선택 바운딩 + 그룹 툴바 */}
          <MultiSelectOverlay />
          {/* 마퀴(드래그 사각 선택) */}
          {marquee && (
            <div
              className="absolute pointer-events-none z-[12] rounded-[2px]"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                border: "1.5px solid #2B5CE6",
                background: "transparent",
                boxShadow: "0 0 0 1px rgba(255,255,255,.9)",
              }}
            />
          )}
          {/* 그룹 선택 점선 테두리 — 자석 그룹 범위 (시안: #7C9AF0 점선 + 칩) */}
          {groupBox && (
            <div
              className="absolute pointer-events-none z-[9]"
              style={{
                left: mmToPx(groupBox.x1) - 6,
                top: mmToPx(groupBox.y1) - 6,
                width: mmToPx(groupBox.x2 - groupBox.x1) + 12,
                height: mmToPx(groupBox.y2 - groupBox.y1) + 12,
                border: "1.5px dashed var(--groupline)",
                borderRadius: 7,
                background: "rgba(43,92,230,.02)",
              }}
            >
              <span
                className="absolute -top-[11px] right-2.5 bg-surface border border-accentline text-accent text-[10px] font-bold rounded-[5px] px-2 py-0.5 whitespace-nowrap"
                style={{ boxShadow: "var(--sh-card)" }}
              >
                그룹 · {groupBox.label} (하위 {groupBox.count})
              </span>
            </div>
          )}
          <DraggingGroupBox />
          <SelectionGuides />
          <SnapGuides />
          {doc.blocks.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-paper text-inkfaint">
                <IcText size={24} />
              </span>
              <p className="text-[13px] text-inkfaint">왼쪽에서 블록을 끌어다 놓으세요</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* 좌하단 페이지 pill · 우하단 줌 컨트롤 (시안 1b — 줌은 준비 중) */}
    <div className="studio-page-status absolute left-3 bottom-3 h-8 px-3 rounded-full bg-surface border border-line flex items-center text-[11.5px] font-medium text-inksoft pointer-events-none" style={{ boxShadow: "var(--sh-card)" }}>
      1/1 페이지 · A4 210×297mm
    </div>
    <div className="studio-zoom absolute right-3 bottom-3 h-8 rounded-full bg-surface border border-line flex items-center overflow-hidden" style={{ boxShadow: "var(--sh-card)" }}>
      <button title="축소 (준비 중)" className="w-8 h-full flex items-center justify-center text-inkfaint cursor-default">−</button>
      <span className="text-[11.5px] font-semibold text-inksoft px-1">100%</span>
      <button title="확대 (준비 중)" className="w-8 h-full flex items-center justify-center text-inkfaint cursor-default">＋</button>
    </div>
    </div>
  );
});

