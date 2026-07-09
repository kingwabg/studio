// SnapGuides.tsx — 스마트 정렬 가이드 렌더 (보라색 점선 구간선 + 거리 배지).
// 계산은 snap.ts(computeSnap)가, 상태는 useGuideStore가 갖는다 — 여긴 그리기만.
// 구간선: 지면 전체를 관통하지 않고 정렬에 참여한 요소들의 범위만(피그마식).
//         단, 지면 기준선(가장자리·정중앙)은 전체 관통(page=true).
import { useMemo } from "react";
import { selectionGuides, useGuideStore, useInspectStore, useFollowStore, type SnapGuide } from "./snap";
import { useCanvasStore } from "./store";
import { mmToPx } from "./geometry";

const OVER = 4; // 요소 구간선 양끝 여유(px) — 가장자리에 살짝 튀어나오게

// 점선 구간선 렌더 (드래그 가이드·정렬선 오버레이 공용).
//  - 중심선(center): 실선·1.5px·진하게 — "핵심은 중심선" 강조.
//  - 모서리선: 점선·1px. dim(항상 표시)이면 모서리는 연하게, 중심선만 또렷하게.
function GuideLines({ guides, dim }: { guides: SnapGuide[]; dim?: boolean }) {
  return (
    <>
      {guides.map((g, i) => {
        const strong = !!g.center;
        const border = `${strong ? 1.5 : 1}px ${strong ? "solid" : "dashed"} var(--guide)`;
        const opacity = dim ? (strong ? 1 : 0.35) : 1;
        if (g.axis === "v") {
          const top = g.page ? 0 : mmToPx(g.from) - OVER;
          const height = g.page ? "100%" : mmToPx(g.to - g.from) + OVER * 2;
          return (
            <div
              key={`g${i}`}
              className="absolute pointer-events-none z-[49]"
              style={{ left: mmToPx(g.at), top, height, width: 0, borderLeft: border, opacity }}
            />
          );
        }
        const left = g.page ? 0 : mmToPx(g.from) - OVER;
        const width = g.page ? "100%" : mmToPx(g.to - g.from) + OVER * 2;
        return (
          <div
            key={`g${i}`}
            className="absolute pointer-events-none z-[49]"
            style={{ top: mmToPx(g.at), left, width, height: 0, borderTop: border, opacity }}
          />
        );
      })}
    </>
  );
}

export function SnapGuides() {
  const guides = useGuideStore((s) => s.guides);
  const badges = useGuideStore((s) => s.badges);
  if (!guides.length && !badges.length) return null;

  return (
    <>
      <GuideLines guides={guides} />

      {/* 거리 배지 — 이동 블록과 가장 가까운 이웃 사이 간격(mm), 드래그/넛지 때만 (진한 보라) */}
      {badges.map((b, i) => (
        <div
          key={`b${i}`}
          className="absolute pointer-events-none z-[51] -translate-x-1/2 -translate-y-1/2 rounded-[4px] px-1.5 h-[16px] flex items-center text-[10px] font-bold tabular-nums whitespace-nowrap"
          style={{
            left: mmToPx(b.cx),
            top: mmToPx(b.cy),
            background: "var(--guide)",
            color: "#fff",
            boxShadow: "0 1px 3px rgba(124,92,252,.4)",
          }}
        >
          {b.mm}mm
        </div>
      ))}
    </>
  );
}

// 정렬 점선 항상 표시 — "정렬선" 토글이 켜지면, 선택한 요소가 지금 다른 요소·지면과
// 맞춰져 있는 정렬 점선을 드래그하지 않아도 계속 보여준다(수정 단계 눈검사용).
// 드래그 중에는 SnapGuides의 실시간 가이드가 대신하므로 겹쳐 그리지 않는다.
export function SelectionGuides() {
  const showGuides = useInspectStore((s) => s.showGuides);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const doc = useCanvasStore((s) => s.doc);
  const dragging = useFollowStore((s) => s.activeId !== null);
  const guides = useMemo(
    () => (showGuides && selectedId && !dragging ? selectionGuides(doc, selectedId) : []),
    [showGuides, selectedId, doc, dragging]
  );
  if (!guides.length) return null;
  return <GuideLines guides={guides} dim />;
}
