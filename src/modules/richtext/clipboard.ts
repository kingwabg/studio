// clipboard.ts — 서식 복사/붙여넣기(런 ↔ HTML 화이트리스트) + URL 정규화.
// (CanvasBlock.tsx에서 기계적 이동 — docs/refactoring-plan.md 1단계)
import { type Block, type TextRun, normalizeRuns, runsToText } from "../document/model";

// URL 정규화 — 스킴 없으면 https:// 붙임. 빈 값은 undefined(링크 제거).
export function normalizeUrl(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^(https?:|mailto:|tel:|ftp:)/i.test(s)) return s;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return `mailto:${s}`;
  return `https://${s}`;
}

// ── 서식 복사/붙여넣기: 런 ↔ HTML ──
// 복사: 선택 런을 인라인 스타일 span으로 직렬화(블록 상속값을 구워 넣음 — 다른 블록에
// 붙여도 서식 유지). 붙여넣기: 외부 HTML을 화이트리스트(굵기·기울임·밑줄·취소선·색·
// 형광펜·크기)만 남기고 런으로 변환 — 글꼴은 레지스트리 밖 폰트가 섞이므로 제외.
const escHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function runsToClipboardHtml(runs: TextRun[], block: Block): string {
  const body = runs
    .map((r) => {
      const st: string[] = [];
      if (r.bold ?? block.bold) st.push("font-weight:700");
      if (r.italic ?? block.italic) st.push("font-style:italic");
      const deco = [
        (r.underline ?? block.underline) ? "underline" : "",
        (r.strike ?? block.strike) ? "line-through" : "",
      ].filter(Boolean).join(" ");
      if (deco) st.push(`text-decoration:${deco}`);
      const color = r.color ?? block.color;
      if (color) st.push(`color:${color}`);
      if (r.bg) st.push(`background-color:${r.bg}`);
      const pt = r.fontSize ?? block.fontSize;
      if (pt) st.push(`font-size:${pt}pt`);
      return `<span style="${st.join(";")}">${escHtml(r.text).replace(/\n/g, "<br>")}</span>`;
    })
    .join("");
  return `<div>${body}</div>`;
}

// CSS 색 → hex (rgb()/#hex만 허용 — 이름 색상 등은 화이트리스트 밖이라 버림)
function cssColorToHex(v: string): string | null {
  if (!v) return null;
  const m = v.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // 완전 투명
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  return null;
}

export function runsFromClipboardHtml(html: string): TextRun[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const runs: TextRun[] = [];
  type St = Partial<Omit<TextRun, "text">>;
  const push = (text: string, st: St) => {
    if (text) runs.push({ text, ...st });
  };
  const parseSize = (v: string): number | null => {
    const m = v.match(/^([\d.]+)(pt|px)$/);
    if (!m) return null;
    const pt = Math.round((m[2] === "pt" ? parseFloat(m[1]) : (parseFloat(m[1]) * 72) / 96) * 2) / 2;
    return pt >= 6 && pt <= 96 ? pt : null;
  };
  const BLOCKY = /^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|UL|OL|TABLE|TBODY)$/;
  const walk = (node: Node, st: St) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child as Text).data.replace(/ /g, " "), st); // nbsp → 일반 공백
        return;
      }
      if (child.nodeName === "BR") {
        push("\n", st);
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (/^(SCRIPT|STYLE|META|TITLE|HEAD)$/.test(child.nodeName)) return;
      const next: St = { ...st };
      const tag = child.nodeName;
      if (tag === "B" || tag === "STRONG") next.bold = true;
      if (tag === "I" || tag === "EM") next.italic = true;
      if (tag === "U") next.underline = true;
      if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;
      const cs = child.style;
      const fw = cs.fontWeight;
      if (fw) {
        if (fw === "bold" || fw === "bolder" || parseInt(fw) >= 600) next.bold = true;
        else if (fw === "normal" || parseInt(fw) <= 400) next.bold = false;
      }
      if (cs.fontStyle === "italic") next.italic = true;
      else if (cs.fontStyle === "normal") next.italic = false;
      const deco = cs.textDecorationLine || cs.textDecoration;
      if (deco) {
        if (deco.includes("underline")) next.underline = true;
        if (deco.includes("line-through")) next.strike = true;
        if (deco.includes("none")) {
          next.underline = false;
          next.strike = false;
        }
      }
      const color = cssColorToHex(cs.color);
      if (color) next.color = color;
      const bg = cssColorToHex(cs.backgroundColor);
      if (bg && bg !== "#FFFFFF") next.bg = bg;
      const size = cs.fontSize ? parseSize(cs.fontSize) : null;
      if (size) next.fontSize = size;
      // 블록 요소 경계 = 줄바꿈 (이미 \n로 끝났으면 중복 방지)
      if (BLOCKY.test(tag) && runs.length && !runsToText(runs).endsWith("\n")) push("\n", st);
      walk(child, next);
    });
  };
  walk(doc.body, {});
  return normalizeRuns(runs);
}
