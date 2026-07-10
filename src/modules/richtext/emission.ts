// emission.ts — 편집 DOM 선형화. domToRuns의 텍스트 방출 규칙과 1:1 동일해야
// 오프셋 계산/복원(caret.ts)과 문단 파생(dom.ts)에서 커서가 튀지 않는다.
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)

// ── 선형화(emission) — domToRuns의 텍스트 방출 규칙과 1:1 동일 ──
// 문단 div 경계·BR을 \n 1글자로 세는 규칙을 오프셋 계산/복원과 domToRuns가 공유해야
// 서식 적용·undo 후 커서가 튀지 않는다. 이벤트: text(길이 n) / br(1) / boundary(1).
export type EmitEvent =
  | { kind: "text"; node: Text }
  | { kind: "br"; node: HTMLElement }
  | { kind: "boundary"; before: HTMLElement };
export function collectEmissions(root: HTMLElement): EmitEvent[] {
  const out: EmitEvent[] = [];
  let emitted = false; // 지금까지 글자를 내보냈나 (첫 블록 앞엔 경계 없음)
  let endsNL = false; // 마지막 방출이 \n로 끝났나 (경계 중복 방지 — domToRuns와 동일)
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text;
        if (t.data.length) {
          out.push({ kind: "text", node: t });
          endsNL = t.data.endsWith("\n");
          emitted = true;
        }
      } else if (child.nodeName === "BR") {
        out.push({ kind: "br", node: child as HTMLElement });
        endsNL = true;
        emitted = true;
      } else if (child instanceof HTMLElement) {
        if (child.dataset.marker !== undefined) return; // 목록 마커 — domToRuns와 동일하게 제외
        if (/^(DIV|P)$/.test(child.nodeName) && emitted && !endsNL) {
          out.push({ kind: "boundary", before: child });
          endsNL = true;
        }
        walk(child);
      }
    });
  };
  walk(root);
  return out;
}
export const emitLen = (ev: EmitEvent) => (ev.kind === "text" ? ev.node.data.length : 1);
export const emitAnchor = (ev: EmitEvent): Node => (ev.kind === "text" ? ev.node : ev.kind === "br" ? ev.node : ev.before);
