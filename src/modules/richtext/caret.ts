// caret.ts — 캐럿/선택 오프셋 계산·복원 (emission 시뮬레이션 기반).
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)
import { collectEmissions, emitLen, emitAnchor } from "./emission";

// 선택 지점(node,offset)의 root 기준 평문 오프셋 — emission 시뮬레이션 기반
function textOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  // 요소 앵커(node=요소, offset=자식 인덱스) → "이 노드 앞" 지점으로 정규화
  let beforeNode: Node | null = null;
  let afterNode: Node | null = null;
  if (node.nodeType === Node.TEXT_NODE) {
    // 텍스트 앵커는 아래 루프에서 직접 처리
  } else if (offset < node.childNodes.length) {
    beforeNode = node.childNodes[offset];
  } else {
    afterNode = node; // 요소 끝 = 요소의 마지막 방출 뒤
  }
  let count = 0;
  for (const ev of collectEmissions(root)) {
    const anchor = emitAnchor(ev);
    if (node.nodeType === Node.TEXT_NODE && ev.kind === "text" && ev.node === node)
      return count + Math.min(offset, ev.node.data.length);
    if (beforeNode && (anchor === beforeNode || beforeNode.contains(anchor))) return count;
    if (afterNode && !afterNode.contains(anchor) && afterNode.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)
      return count;
    count += emitLen(ev);
  }
  return count;
}

// 현재 선택의 [start,end] 오프셋 (root 안이고 접혀있지 않을 때만)
export function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = textOffsetOf(root, range.startContainer, range.startOffset);
  const b = textOffsetOf(root, range.endContainer, range.endOffset);
  return a <= b ? [a, b] : [b, a];
}

// 평문 오프셋 → DOM 위치 (커서 복원용) — emission 시뮬레이션 기반.
// br/boundary 위치에 떨어지면 "그 뒤 요소의 시작"(= 다음 문단 첫 지점)에 캐럿을 둔다.
function locateOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
  let count = 0;
  const events = collectEmissions(root);
  for (const ev of events) {
    if (ev.kind === "text") {
      const len = ev.node.data.length;
      if (target <= count + len) return { node: ev.node, offset: target - count };
      count += len;
    } else if (ev.kind === "br") {
      if (target <= count) {
        const p = ev.node.parentNode as Node;
        return { node: p, offset: Array.prototype.indexOf.call(p.childNodes, ev.node) };
      }
      count += 1;
    } else {
      if (target <= count) {
        const p = ev.before.parentNode as Node;
        return { node: p, offset: Array.prototype.indexOf.call(p.childNodes, ev.before) };
      }
      count += 1;
      // 경계 직후(= 다음 문단 시작)에 떨어지면 그 div의 첫 지점 —
      // 목록 마커(data-marker, 직렬화 제외)가 있으면 그 뒤에 캐럿을 둔다
      if (target <= count) {
        const first = ev.before.firstChild;
        const off = first instanceof HTMLElement && first.dataset.marker !== undefined ? 1 : 0;
        return { node: ev.before, offset: off };
      }
    }
  }
  // 끝 — 마지막 문단 div의 끝 (없으면 root 끝)
  const lastPara = [...root.children].reverse().find((c) => c.hasAttribute?.("data-para"));
  if (lastPara) return { node: lastPara, offset: lastPara.childNodes.length };
  return { node: root, offset: root.childNodes.length };
}

export function setSelectionRange(root: HTMLElement, start: number, end: number) {
  const s = locateOffset(root, start);
  const e = locateOffset(root, end);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretEnd(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretFromPoint(root: HTMLElement, point: { x: number; y: number } | null) {
  if (!point) {
    placeCaretEnd(root);
    return;
  }
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  // ⚠ caretPositionFromPoint는 클릭 지점 "최상단" 요소 기준으로 캐럿을 찾는다. 다중선택/그룹
  // 오버레이(z-11)가 텍스트를 덮고 있으면 에디터가 아니라 오버레이를 집어 실패 → 끝으로
  // 폴백된다(그룹 상태에서만 커서가 끝으로 잡히던 원인). 지점 위에서 에디터보다 위에 있는
  // 요소들을 잠시 pointer-events:none로 눌러 텍스트를 뚫고 캐럿을 집는다(즉시 복원).
  const muted: { el: HTMLElement; prev: string }[] = [];
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    if (el === root || root.contains(el)) break; // 에디터 텍스트에 도달 — 위 요소만 눌렀으면 됨
    if (el instanceof HTMLElement && getComputedStyle(el).pointerEvents !== "none") {
      muted.push({ el, prev: el.style.pointerEvents });
      el.style.pointerEvents = "none";
    }
  }
  try {
    const range = document.createRange();
    const pos = doc.caretPositionFromPoint?.(point.x, point.y);
    if (pos && root.contains(pos.offsetNode)) {
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    } else {
      const legacyRange = doc.caretRangeFromPoint?.(point.x, point.y);
      if (!legacyRange || !root.contains(legacyRange.startContainer)) {
        placeCaretEnd(root);
        return;
      }
      range.setStart(legacyRange.startContainer, legacyRange.startOffset);
      range.collapse(true);
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } finally {
    for (const m of muted) m.el.style.pointerEvents = m.prev;
  }
}

// 캐럿 자리에 평문 삽입 (엔터=\n·붙여넣기 정규화용) — pre-wrap이라 \n이 줄바꿈으로 보인다
export function insertTextAtCaret(text: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tn = document.createTextNode(text);
  range.insertNode(tn);
  range.setStartAfter(tn);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
