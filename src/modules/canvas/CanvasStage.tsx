// CanvasStage.tsx — A4 지면 + 눈금자(상단·좌측). 블록을 절대배치로 그리고,
// 팔레트 드롭 대상(useDroppable)이 된다.
// stageRef는 상위(StudioEditor)의 onDragEnd가 드롭 좌표를 지면 기준 mm로 환산할 때 쓴다.
//
// 눈금자: 한글(HWP) 편집 화면처럼 지면 위·왼쪽에 밀착. 1mm/5mm/10mm 틱 + cm 숫자.
// SCALE = CSS mm(3.7795px)라 눈금 px가 곧 실제 mm — 공공기관 규격(여백 15/20mm 등)을
// 실무자가 눈으로 검증할 수 있다. 지면에 붙어 함께 스크롤된다.
import { forwardRef, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SCALE, mmToPx } from "./geometry";
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

const RULER = 22; // 눈금자 두께(px)
const TICK_FAINT = "#d5dae3";
const TICK_STRONG = "#98a2b3";
const LABEL = "#8a94a6";

// 수평 눈금자 — mm 길이만큼, 10mm마다 cm 숫자
function RulerH({ mm }: { mm: number }) {
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
          y1={major ? 6 : mid ? 12 : 16}
          y2={RULER}
          stroke={major ? TICK_STRONG : TICK_FAINT}
          strokeWidth={major ? 1 : 0.6}
        />
      );
      if (major && m > 0 && m < mm)
        t.push(
          <text key={`t${m}`} x={x + 3} y={11} fontSize={8.5} fill={LABEL} fontFamily="Pretendard, sans-serif">
            {m / 10}
          </text>
        );
    }
    return t;
  }, [mm]);
  return (
    <svg width={w} height={RULER} className="block bg-white" style={{ borderBottom: "1px solid #e4e8ef" }}>
      {ticks}
    </svg>
  );
}

// 수직 눈금자
function RulerV({ mm }: { mm: number }) {
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
          x1={major ? 6 : mid ? 12 : 16}
          x2={RULER}
          stroke={major ? TICK_STRONG : TICK_FAINT}
          strokeWidth={major ? 1 : 0.6}
        />
      );
      if (major && m > 0 && m < mm)
        t.push(
          <text key={`t${m}`} x={4} y={y + 10} fontSize={8.5} fill={LABEL} fontFamily="Pretendard, sans-serif">
            {m / 10}
          </text>
        );
    }
    return t;
  }, [mm]);
  return (
    <svg width={RULER} height={h} className="block bg-white" style={{ borderRight: "1px solid #e4e8ef" }}>
      {ticks}
    </svg>
  );
}

export const CanvasStage = forwardRef<HTMLDivElement>(function CanvasStage(_props, ref) {
  const doc = useCanvasStore((s) => s.doc);
  const select = useCanvasStore((s) => s.select);
  const { setNodeRef } = useDroppable({ id: "stage" });

  const pageW = mmToPx(doc.page.w);
  const pageH = mmToPx(doc.page.h);

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
            background: "white",
            borderRight: "1px solid #e4e8ef",
            borderBottom: "1px solid #e4e8ef",
          }}
        />
        {/* 상단 눈금자 */}
        <div style={{ position: "absolute", top: 0, left: RULER }}>
          <RulerH mm={doc.page.w} />
        </div>
        {/* 좌측 눈금자 */}
        <div style={{ position: "absolute", top: RULER, left: 0 }}>
          <RulerV mm={doc.page.h} />
        </div>

        {/* A4 지면 */}
        <div
          ref={(node) => {
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
          {doc.blocks.map((block) => (
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
