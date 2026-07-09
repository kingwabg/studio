// SnapGuides.tsx — 드래그 중 스마트 정렬 가이드 렌더 (보라색 점선 구간선 + 거리 배지).
// 계산은 snap.ts(computeSnap)가, 상태는 useGuideStore가 갖는다 — 여긴 그리기만.
// 구간선: 지면 전체를 관통하지 않고 정렬에 참여한 요소들의 범위만(피그마식).
//         단, 지면 기준선(가장자리·정중앙)은 전체 관통(page=true).
import { useGuideStore } from "./snap";
import { mmToPx } from "./geometry";

const OVER = 4; // 요소 구간선 양끝 여유(px) — 가장자리에 살짝 튀어나오게

export function SnapGuides() {
  const guides = useGuideStore((s) => s.guides);
  const badges = useGuideStore((s) => s.badges);
  if (!guides.length && !badges.length) return null;

  return (
    <>
      {guides.map((g, i) => {
        const dashed = `1px dashed var(--guide)`;
        if (g.axis === "v") {
          const top = g.page ? 0 : mmToPx(g.from) - OVER;
          const height = g.page ? "100%" : mmToPx(g.to - g.from) + OVER * 2;
          return (
            <div
              key={`g${i}`}
              className="absolute pointer-events-none z-[50]"
              style={{ left: mmToPx(g.at), top, height, width: 0, borderLeft: dashed }}
            />
          );
        }
        const left = g.page ? 0 : mmToPx(g.from) - OVER;
        const width = g.page ? "100%" : mmToPx(g.to - g.from) + OVER * 2;
        return (
          <div
            key={`g${i}`}
            className="absolute pointer-events-none z-[50]"
            style={{ top: mmToPx(g.at), left, width, height: 0, borderTop: dashed }}
          />
        );
      })}

      {/* 거리 배지 — 이동 블록과 가장 가까운 이웃 사이 간격(mm) */}
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
