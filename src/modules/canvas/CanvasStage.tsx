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
import { collapsedHiddenIds } from "../document/model";
import { useCanvasStore } from "./store";
import { useGuideStore } from "./snap";
import { CanvasBlock } from "./CanvasBlock";
import { IcText } from "../../ui/icons";

// 드래그 중 정렬 가이드 (캔바식 마젠타 점선) — 스냅이 걸린 선을 지면 전체로 그린다
function SnapGuides() {
  const v = useGuideStore((s) => s.v);
  const h = useGuideStore((s) => s.h);
  if (!v.length && !h.length) return null;
  return (
    <>
      {v.map((x) => (
        <div
          key={`v${x}`}
          style={{
            position: "absolute",
            left: mmToPx(x),
            top: 0,
            bottom: 0,
            width: 0,
            borderLeft: "1px dashed #EC4899",
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      ))}
      {h.map((y) => (
        <div
          key={`h${y}`}
          style={{
            position: "absolute",
            top: mmToPx(y),
            left: 0,
            right: 0,
            height: 0,
            borderTop: "1px dashed #EC4899",
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

const RULER = 28; // 눈금자 두께(px)
const RULER_BG = "#f8fafc";
const RULER_BORDER = "#dbe2ec";
const TICK_MINOR = "#e5eaf2";
const TICK_MID = "#cfd7e4";
const TICK_MAJOR = "#8d98aa";
const LABEL = "#6f7a8d";
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
  pointerEvents: "none",
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

// 수평 눈금자 — 1mm/5mm/10mm 위계를 나누고 cm 숫자는 큰 눈금 중앙에 둔다.
function RulerH({ mm, projection }: { mm: number; projection?: RulerProjection }) {
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
      className="block select-none"
      style={{ ...rulerSurface, background: RULER_BG, borderBottom: `1px solid ${RULER_BORDER}` }}
      aria-hidden="true"
    >
      <rect x="0" y="0" width={w} height={RULER} fill={RULER_BG} />
      <ProjectionBand axis="x" projection={projection} />
      {ticks}
    </svg>
  );
}

// 수직 눈금자
function RulerV({ mm, projection }: { mm: number; projection?: RulerProjection }) {
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
      className="block select-none"
      style={{ ...rulerSurface, background: RULER_BG, borderRight: `1px solid ${RULER_BORDER}` }}
      aria-hidden="true"
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
  const { setNodeRef } = useDroppable({ id: "stage" });
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [measuredBlockBox, setMeasuredBlockBox] = useState<MeasuredBlockBox | null>(null);

  const pageW = mmToPx(doc.page.w);
  const pageH = mmToPx(doc.page.h);
  const selectedBlock = doc.blocks.find((block) => block.id === selectedId);
  // 아코디언 접기 — 접힌 조상을 가진 블록은 지면에서 숨긴다 (문서에는 그대로 존재)
  const visibleBlocks = useMemo(() => {
    const hidden = collapsedHiddenIds(doc.blocks);
    return hidden.size ? doc.blocks.filter((b) => !hidden.has(b.id)) : doc.blocks;
  }, [doc.blocks]);

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

  return (
    <div className="flex-1 overflow-auto canvas-dots bg-canvas">
      {/* 지면 + 눈금자 묶음 — 가운데 정렬, 함께 스크롤 */}
      <div className="w-max mx-auto my-8" style={{ position: "relative", paddingLeft: RULER, paddingTop: RULER }}>
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
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
        {/* 상단 눈금자 */}
        <div style={{ position: "absolute", top: 0, left: RULER }}>
          <RulerH mm={doc.page.w} projection={projectionX} />
        </div>
        {/* 좌측 눈금자 */}
        <div style={{ position: "absolute", top: RULER, left: 0 }}>
          <RulerV mm={doc.page.h} projection={projectionY} />
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
            if (e.target === e.currentTarget) select(null); // 빈 지면 클릭 → 선택 해제
          }}
          style={{ width: pageW, height: pageH }}
          className="relative bg-white shrink-0 ring-1 ring-black/5 shadow-[0_1px_3px_rgba(26,34,51,0.08),0_20px_50px_-12px_rgba(26,34,51,0.18)]"
        >
          {visibleBlocks.map((block) => (
            <CanvasBlock key={block.id} block={block} />
          ))}
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
  );
});
