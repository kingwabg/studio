// render.tsx — 읽기 모드 렌더 (RichRead·토큰 칩·전각 보정 스크립트 분할).
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계.
//  splitRunsToParasView는 dom.ts의 splitRunsToParas로 통일 — 계획 문서에 명시된 정리)
import { Fragment } from "react";
import { type Block, type TextAlign, type TextRun, blockRuns } from "../document/model";
import { splitByHangul } from "../document/fonts";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { runCssObj } from "./style";
import { splitRunsToParas } from "./dom";

// 읽기 모드: 런을 스타일 span으로, 각 span 안에서 {{토큰}}은 칩으로 렌더.
// 문단별 정렬이 있으면 문단마다 div(text-align)로 감싼다 — 없으면 기존 flat 렌더
// 그대로(옛 문서·검증된 경로 무손상). div 스택은 pre-wrap \n과 같은 세로 배치.
export function RichRead({ block }: { block: Block }) {
  const runs = blockRuns(block);
  const aligns = block.paraAligns;
  const lists = block.paraLists;
  if (aligns?.some((a) => a != null) || lists?.some((l) => l != null)) {
    const paras = splitRunsToParas(runs);
    return (
      <>
        {paras.map((paraRuns, pi) => {
          // 목록 마커 — 편집 모드 markerTextAt과 같은 규칙(연속 num 이어 세기)
          const lt = lists?.[pi];
          let marker: string | null = null;
          if (lt === "bullet") marker = "• ";
          else if (lt === "num") {
            let n = 1;
            for (let k = pi - 1; k >= 0 && lists![k] === "num"; k--) n++;
            marker = `${n}. `;
          }
          return (
            <div key={pi} style={aligns?.[pi] ? { textAlign: aligns[pi] as TextAlign } : undefined}>
              {marker && (
                <span style={{ display: "inline-block", minWidth: "1.3em", userSelect: "none" }}>{marker}</span>
              )}
              {paraRuns.length ? paraRuns.map((run, i) => <RunSpan key={i} block={block} run={run} />) : <br />}
            </div>
          );
        })}
      </>
    );
  }
  return (
    <>
      {runs.map((run, i) => (
        <RunSpan key={i} block={block} run={run} />
      ))}
    </>
  );
}

// 읽기 모드 런 span — 하이퍼링크면 Ctrl/⌘+클릭으로 새 탭 열기(일반 클릭은 블록 선택 유지).
function RunSpan({ block, run }: { block: Block; run: TextRun }) {
  const href = run.href;
  return (
    <span
      style={{ ...runCssObj(block, run), ...(href ? { cursor: "pointer" } : {}) }}
      title={href ? `${href} (Ctrl+클릭으로 열기)` : undefined}
      onClick={
        href
          ? (e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                window.open(href, "_blank", "noopener,noreferrer");
              }
            }
          : undefined
      }
    >
      <TokenText text={run.text} />
    </span>
  );
}

// 전각 보정 선택 적용 — 한글 구간은 컨테이너의 letter-spacing(전각 보정)을 상속하고,
// 숫자·라틴 구간은 spacing 0으로 자연폭. HWP 조판(한글만 전각, 나머지 반각)과 동일한
// 규칙이라 혼합 텍스트도 화면 줄바꿈 = 한글 줄바꿈이 유지된다.
export function ScriptText({ text }: { text: string }) {
  const segs = splitByHangul(text);
  return (
    <>
      {segs.map((s, i) =>
        s.hangul ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : (
          <span key={i} style={{ letterSpacing: 0 }}>
            {s.text}
          </span>
        )
      )}
    </>
  );
}

// {{토큰}}을 칩으로, 미리보기 중이면 실제 값(강조)으로 렌더
export function TokenText({ text }: { text: string }) {
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  if (dataset && previewIndex !== null) {
    const resolved = resolveTokens(text, dataset.columns, dataset.rows[previewIndex] ?? []);
    if (resolved !== text)
      return (
        <span className="bg-emerald-50 text-emerald-700 rounded-[2px] px-0.5">
          <ScriptText text={resolved} />
        </span>
      );
    return <ScriptText text={resolved} />;
  }

  const parts = text.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = new RegExp(`^${TOKEN_RE.source}$`).exec(p);
        return m ? (
          <span
            key={i}
            className="inline-block align-baseline rounded-full bg-accentsoft text-accent px-1.5 text-[0.85em] leading-normal mx-0.5"
          >
            {m[1].trim()}
          </span>
        ) : (
          <ScriptText key={i} text={p} />
        );
      })}
    </>
  );
}
