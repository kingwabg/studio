// dom.ts — 인라인 리치 텍스트 직렬화: runs ↔ contentEditable DOM.
// 편집 표면은 contentEditable(런=span, 문단=div[data-para]) — 진실은 runs다.
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)
import {
  type Block,
  type ParaListType,
  type TextAlign,
  type TextRun,
  normalizeRuns,
  runsToText,
} from "../document/model";
import { splitByHangul } from "../document/fonts";
import { runCssObj } from "./style";
import { collectEmissions } from "./emission";

// ═════════════════ 인라인 리치 텍스트: contentEditable 직렬화 ═════════════════
// 편집 표면은 contentEditable(런=span). 진실은 스토어의 runs다. 타이핑 중에는 DOM을
// 다시 그리지 않고(한글 IME·커서 보존), input에서 DOM→runs로 읽어 스토어에 반영한다.
// 서식 적용(선택 구간)만 DOM을 다시 그리고 오프셋으로 커서를 복원한다.

// 런 → span 엘리먼트. dataset이 직렬화의 진실(readRunStyle이 이것만 읽는다).
// inline style은 보이기용 — 브라우저가 span을 쪼개도 dataset이 함께 복제돼 서식이 산다.
export function runToSpanEl(block: Block, run: TextRun): HTMLSpanElement {
  const span = document.createElement("span");
  // bold/italic은 3-상태 — 명시값(true/false)만 dataset에 기록(undefined=상속은 미기록).
  if (run.bold !== undefined) span.dataset.b = run.bold ? "1" : "0";
  if (run.italic !== undefined) span.dataset.i = run.italic ? "1" : "0";
  if (run.underline !== undefined) span.dataset.u = run.underline ? "1" : "0";
  if (run.strike !== undefined) span.dataset.s = run.strike ? "1" : "0";
  if (run.color) span.dataset.color = run.color;
  if (run.href) span.dataset.href = run.href;
  if (run.bg) span.dataset.bg = run.bg;
  if (run.fontSize != null) span.dataset.size = String(run.fontSize);
  if (run.font) span.dataset.font = run.font;
  Object.assign(span.style, runCssObj(block, run) as Record<string, string>);
  // 편집 표면도 읽기 모드(ScriptText)와 똑같이 — 비한글 구간은 letterSpacing 0(전각 보정
  // 제외)로. 이렇게 안 하면 편집 중(균일 spacing)과 편집 종료 후(한글만 spacing) 박스
  // 너비/높이가 달라진다. domToRuns는 dataset만 읽으므로 이 하위 span(무-dataset)의
  // 텍스트는 부모 런 스타일로 되합쳐진다(직렬화 안전).
  const segs = splitByHangul(run.text);
  if (segs.length <= 1) {
    span.textContent = run.text;
  } else {
    for (const seg of segs) {
      if (seg.hangul) span.appendChild(document.createTextNode(seg.text));
      else {
        const sub = document.createElement("span");
        sub.style.letterSpacing = "0";
        sub.textContent = seg.text;
        span.appendChild(sub);
      }
    }
  }
  return span;
}

// 런을 \n 기준 문단(run 그룹) 배열로 — 편집 시드·읽기 렌더·정렬 배열이 공유하는 분할 규칙
export function splitRunsToParas(runs: TextRun[]): TextRun[][] {
  const paras: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) paras.push([]);
      if (part) paras[paras.length - 1].push({ ...run, text: part });
    });
  }
  return paras;
}

// 문단 i의 목록 마커 텍스트 — 번호는 연속 num 구간에서 이어 센다(끊기면 1부터)
export function markerTextAt(lists: (ParaListType | null)[] | undefined, i: number): string | null {
  const t = lists?.[i];
  if (!t) return null;
  if (t === "bullet") return "• ";
  let n = 1;
  for (let k = i - 1; k >= 0 && lists![k] === "num"; k--) n++;
  return `${n}. `;
}

// 목록 마커 span — 편집 불가·선택 불가·직렬화 제외(data-marker를 domToRuns/emission이 스킵)
function markerSpanEl(text: string): HTMLSpanElement {
  const m = document.createElement("span");
  m.setAttribute("data-marker", "");
  m.contentEditable = "false";
  m.style.userSelect = "none";
  m.style.display = "inline-block";
  m.style.minWidth = "1.3em";
  m.textContent = text;
  return m;
}

// contentEditable을 현재 런으로 채운다 (편집 진입·서식 적용 시).
// 구조 = 문단마다 <div data-para style="text-align:…" data-list="bullet|num"> —
// 문단별 정렬·목록이 편집 중에도 보이고, Enter는 div 분할, domToRuns는 div 경계를
// \n으로 되읽는다. 빈 문단은 <br> 하나(높이 확보 + 커서 진입 가능).
export function seedEditable(
  el: HTMLElement,
  block: Block,
  runs: TextRun[],
  paraAligns?: (TextAlign | null)[],
  paraLists?: (ParaListType | null)[]
) {
  const paras = splitRunsToParas(runs);
  const divs = paras.map((paraRuns, i) => {
    const div = document.createElement("div");
    div.setAttribute("data-para", "");
    const a = paraAligns?.[i];
    if (a) div.style.textAlign = a;
    const list = paraLists?.[i];
    if (list) div.setAttribute("data-list", list);
    const marker = markerTextAt(paraLists, i);
    if (marker) div.appendChild(markerSpanEl(marker));
    if (paraRuns.length) div.append(...paraRuns.map((r) => runToSpanEl(block, r)));
    else div.appendChild(document.createElement("br"));
    return div;
  });
  el.replaceChildren(...divs);
}

export function readRunStyle(el: HTMLElement): Partial<TextRun> {
  const d = el.dataset;
  const st: Partial<TextRun> = {};
  if (d.b !== undefined) st.bold = d.b === "1"; // "0"=강제 보통도 보존
  if (d.i !== undefined) st.italic = d.i === "1";
  if (d.u !== undefined) st.underline = d.u === "1";
  if (d.s !== undefined) st.strike = d.s === "1";
  if (d.color) st.color = d.color;
  if (d.href) st.href = d.href;
  if (d.bg) st.bg = d.bg;
  if (d.size) st.fontSize = Number(d.size);
  if (d.font) st.font = d.font;
  return st;
}

// DOM(편집 중 자유 변형된 상태) → 정규화된 런 배열. 줄바꿈은 \n 텍스트·BR·블록경계 모두 흡수.
export function domToRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, style: Partial<TextRun>) => {
    if (text) runs.push({ text, ...style });
  };
  const walk = (node: Node, style: Partial<TextRun>) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child as Text).data, style);
      } else if (child.nodeName === "BR") {
        push("\n", style);
      } else if (child instanceof HTMLElement) {
        if (child.dataset.marker !== undefined) return; // 목록 마커는 장식 — 직렬화 제외
        const isBlock = /^(DIV|P)$/.test(child.nodeName);
        // 엔터로 생긴 블록 요소 앞에는 줄바꿈 (이미 \n로 끝났으면 생략 — 중복 방지)
        if (isBlock && runs.length && !runsToText(runs).endsWith("\n")) push("\n", style);
        walk(child, { ...style, ...readRunStyle(child) });
      }
    });
  };
  walk(root, {});
  return normalizeRuns(runs);
}

// 편집 DOM에서 문단별 정렬 배열을 파생 — 모델 문단(text.split("\n"))과 index가 일치하도록
// emission을 재생하며 각 문단의 "첫 내용이 속한 div"의 textAlign을 기록한다.
export function paraAlignsFromDom(root: HTMLElement): (TextAlign | null)[] {
  const alignOf = (n: Node | null): TextAlign | null => {
    const div = (n instanceof HTMLElement ? n : n?.parentElement)?.closest?.("[data-para]") as HTMLElement | null;
    const a = div?.style.textAlign;
    return a === "left" || a === "center" || a === "right" ? a : null;
  };
  const aligns: (TextAlign | null)[] = [null];
  let cur = 0;
  const setA = (n: Node) => {
    if (aligns[cur] == null) aligns[cur] = alignOf(n);
  };
  for (const ev of collectEmissions(root)) {
    if (ev.kind === "text") {
      const parts = ev.node.data.split("\n");
      if (parts[0]) setA(ev.node);
      for (let i = 1; i < parts.length; i++) {
        cur++;
        aligns[cur] = null;
        if (parts[i]) setA(ev.node);
      }
    } else if (ev.kind === "br") {
      setA(ev.node); // 빈 문단의 정렬 = br이 든 div
      cur++;
      aligns[cur] = null;
    } else {
      cur++;
      aligns[cur] = alignOf(ev.before); // 새 문단 = 경계 뒤 div
    }
  }
  return aligns;
}

// 편집 DOM에서 문단별 목록 배열 파생 — paraAlignsFromDom과 같은 재생 규칙(div data-list)
export function paraListsFromDom(root: HTMLElement): (ParaListType | null)[] {
  const listOf = (n: Node | null): ParaListType | null => {
    const div = (n instanceof HTMLElement ? n : n?.parentElement)?.closest?.("[data-para]") as HTMLElement | null;
    const v = div?.getAttribute("data-list");
    return v === "bullet" || v === "num" ? v : null;
  };
  const lists: (ParaListType | null)[] = [null];
  let cur = 0;
  const setL = (n: Node) => {
    if (lists[cur] == null) lists[cur] = listOf(n);
  };
  for (const ev of collectEmissions(root)) {
    if (ev.kind === "text") {
      const parts = ev.node.data.split("\n");
      if (parts[0]) setL(ev.node);
      for (let i = 1; i < parts.length; i++) {
        cur++;
        lists[cur] = null;
        if (parts[i]) setL(ev.node);
      }
    } else if (ev.kind === "br") {
      setL(ev.node);
      cur++;
      lists[cur] = null;
    } else {
      cur++;
      lists[cur] = listOf(ev.before);
    }
  }
  return lists;
}

// 오프셋이 속한 문단 인덱스 — 평문 기준(\n 개수)
export const paraIdxAt = (text: string, offset: number) =>
  (text.slice(0, Math.max(0, Math.min(offset, text.length))).match(/\n/g) ?? []).length;

// [start,end) 교체 시 문단 속성 배열(정렬·목록)도 함께 스플라이스 —
// 삽입된 새 문단은 시작 문단의 값을 상속
export function spliceAligns<T>(
  aligns: (T | null)[],
  text: string,
  start: number,
  end: number,
  insertedText: string
): (T | null)[] {
  const pFrom = paraIdxAt(text, start);
  const pTo = paraIdxAt(text, end);
  const added = (insertedText.match(/\n/g) ?? []).length;
  const inherit = aligns[pFrom] ?? null;
  return [
    ...aligns.slice(0, pFrom + 1),
    ...Array.from({ length: added }, () => inherit),
    ...aligns.slice(pTo + 1),
  ];
}

// Enter — 캐럿 위치에서 현재 문단 div를 둘로 쪼갠다 (뒤쪽이 정렬 상속, 캐럿은 새 문단 시작)
export function splitParagraphAtCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  range.deleteContents(); // 선택 상태면 지우고 분할
  const anchor = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
  const para = anchor?.closest?.("[data-para]") as HTMLElement | null;
  if (!para || !root.contains(para)) return false;
  const tail = document.createRange();
  tail.selectNodeContents(para);
  tail.setStart(range.startContainer, range.startOffset);
  const frag = tail.extractContents();
  const next = document.createElement("div");
  next.setAttribute("data-para", "");
  if (para.style.textAlign) next.style.textAlign = para.style.textAlign;
  const listType = para.getAttribute("data-list");
  if (listType) next.setAttribute("data-list", listType); // 목록 상속 (마커는 Enter 후 재시드가 그림)
  next.appendChild(frag);
  // 빈 쪽엔 br로 높이·커서 자리 확보
  if (!(next.textContent ?? "").length && !next.querySelector("br")) next.appendChild(document.createElement("br"));
  if (!(para.textContent ?? "").length && !para.querySelector("br")) para.appendChild(document.createElement("br"));
  para.after(next);
  const r = document.createRange();
  r.setStart(next, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}
