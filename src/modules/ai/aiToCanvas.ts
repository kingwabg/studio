// aiToCanvas.ts — AI 문서 도우미의 응답(JSON)을 새 캔버스 문서로 변환.
//
// AI 스키마는 기존 에디터(DocumentStudio AiPanel)와 동일한 {title, sections} —
// 모델이 검증된 형식을 그대로 쓰고, 게이트웨이 검증(validateDocJson)도 같은 규칙.
// 변환 결과는 "트리 문서": 섹션 머리글이 parentId 체인을 이루고 본문·표가 그 밑에
// 달린다 → 자석 그룹 이동·아코디언 접기·공문서 펴기가 AI 문서에도 그대로 작동한다.
// 텍스트는 전부 flow(흐름 본문) — 한글에서 커서가 흐르는 진짜 문서로 내보내진다.
import { type Block, type CanvasDoc, type TableKingData, createBlock } from "../document/model";
import { numberFor } from "../document/flatten";
import { SCALE } from "../canvas/geometry";
import { tableSizePx } from "../canvas/store";
// 표 시드는 검증된 table-king 엔진 스냅샷으로 (store.addBlock과 동일 경로)
import { makeTableKingData } from "../../table-king/TableKingBlock.jsx";

// ── AI 응답 스키마 ──
export interface AiSection {
  heading: string;
  level: 1 | 2 | 3;
  blocks: AiContentBlock[];
}
export type AiContentBlock =
  | { type: "para"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "table"; rows: string[][] };
export interface AiDocJson {
  title: string;
  sections: AiSection[];
}

// ── 게이트웨이 검증 — 기존 에디터와 동일 규칙 (통과 못 하면 캔버스에 손대지 않는다) ──
export function validateDocJson(obj: unknown): string | null {
  const o = obj as AiDocJson;
  if (!o || typeof o !== "object") return "응답이 객체가 아닙니다.";
  if (typeof o.title !== "string" || !o.title.trim()) return "title이 없습니다.";
  if (!Array.isArray(o.sections) || o.sections.length === 0) return "sections 배열이 비어 있습니다.";
  for (let i = 0; i < o.sections.length; i++) {
    const s = o.sections[i];
    if (typeof s.heading !== "string" || !s.heading.trim()) return `섹션 ${i}: heading이 없습니다.`;
    if (![1, 2, 3].includes(s.level)) return `섹션 ${i}: level은 1|2|3이어야 합니다.`;
    if (!Array.isArray(s.blocks) || s.blocks.length === 0) return `섹션 ${i}: blocks가 비어 있습니다.`;
    for (let j = 0; j < s.blocks.length; j++) {
      const b = s.blocks[j];
      if (b.type === "para") {
        if (typeof b.text !== "string") return `섹션 ${i} 블록 ${j}: para에 text가 없습니다.`;
      } else if (b.type === "list") {
        if (!Array.isArray(b.items) || b.items.length === 0)
          return `섹션 ${i} 블록 ${j}: list의 items가 비어 있습니다.`;
      } else if (b.type === "table") {
        if (!Array.isArray(b.rows) || b.rows.length === 0)
          return `섹션 ${i} 블록 ${j}: table의 rows가 비어 있습니다.`;
        const nCols = b.rows[0].length;
        if (nCols < 1 || nCols > 10) return `섹션 ${i} 블록 ${j}: 표는 1~10열이어야 합니다.`;
        for (const row of b.rows)
          if (row.length !== nCols) return `섹션 ${i} 블록 ${j}: 표의 모든 행은 같은 열 수여야 합니다.`;
      } else {
        return `섹션 ${i} 블록 ${j}: 알 수 없는 블록 타입 "${(b as { type: string }).type}"`;
      }
    }
  }
  return null;
}

const MARGIN = 20; // mm — flatten과 동일한 공문서 여백
const INDENT = 8; // mm — 깊이당 들여쓰기
const GAP = 3; // mm

// 텍스트 높이 추정(mm) — 한글 전각(1em) 조판 가정. 배치 직후 auto-height가 h를
// 실측으로 보정하지만 y는 생성 시점에 정해지므로, 과소 추정(겹침)만 피하면 된다.
const PT_TO_MM = 25.4 / 72;
function estTextH(text: string, wMm: number, pt: number): number {
  const charW = pt * PT_TO_MM; // 전각 폭
  const lineH = pt * PT_TO_MM * 1.6 + 0.8; // 줄간격 + 여유
  const usable = Math.max(10, wMm - 4); // 좌우 패딩 몫
  const lines = text
    .split("\n")
    .reduce((n, ln) => n + Math.max(1, Math.ceil((ln.length * charW) / usable)), 0);
  return lines * lineH + 2;
}

// AI JSON → 캔버스 블록 배열 (제목 + 번호 매긴 머리글 트리 + flow 본문 + 표)
export function aiJsonToBlocks(json: AiDocJson, page: CanvasDoc["page"]): Block[] {
  const blocks: Block[] = [];
  let y = 18;

  // 문서 제목
  const title = createBlock("text", MARGIN, y);
  Object.assign(title, {
    text: json.title.trim(),
    w: page.w - MARGIN * 2,
    flow: true,
    bold: true,
    fontSize: 16,
    align: "center",
  });
  blocks.push(title);
  y += 16;

  const idx = [0, 0, 0]; // 깊이별 머리글 카운터 (하위는 상위가 바뀌면 리셋)
  const lastHeading: (string | undefined)[] = [undefined, undefined, undefined];

  const pushText = (text: string, depth: number, opts: Partial<Block>, parentId?: string) => {
    const indent = MARGIN + depth * INDENT;
    const w = page.w - MARGIN - indent;
    const b = createBlock("text", indent, y);
    Object.assign(b, { text, w, flow: true, align: "left", parentId, ...opts });
    b.h = estTextH(text, w, b.fontSize ?? 10.5);
    blocks.push(b);
    y += b.h + GAP;
    return b;
  };

  for (const s of json.sections) {
    const depth = s.level - 1;
    idx[depth]++;
    for (let d = depth + 1; d < 3; d++) idx[d] = 0;
    y += 2; // 머리글 앞 여백
    const heading = pushText(
      `${numberFor(depth, idx[depth] - 1)} ${s.heading.trim()}`,
      depth,
      { bold: true, fontSize: depth === 0 ? 14 : depth === 1 ? 12 : 11 },
      depth > 0 ? lastHeading[depth - 1] : undefined
    );
    lastHeading[depth] = heading.id;

    const contentDepth = depth + 1;
    for (const cb of s.blocks) {
      if (cb.type === "para") {
        pushText(cb.text, contentDepth, { fontSize: 10.5 }, heading.id);
      } else if (cb.type === "list") {
        // 목록은 줄바꿈 텍스트 한 덩어리 — 내보내기에서 줄별 hp:p 문단이 된다
        const text = cb.items
          .map((it, i) => (cb.ordered ? `${i + 1}. ${it}` : `• ${it}`))
          .join("\n");
        pushText(text, contentDepth, { fontSize: 10.5 }, heading.id);
      } else {
        // 표 — table-king 스냅샷 시드, 크기는 스냅샷에서 파생 (store.addBlock과 동일)
        const indent = MARGIN + contentDepth * INDENT;
        const wMm = Math.min(150, page.w - MARGIN - indent);
        const tb = createBlock("table", indent, y);
        tb.parentId = heading.id;
        tb.data = makeTableKingData(cb.rows, Math.round(wMm * SCALE)) as TableKingData;
        tb.rows = undefined;
        const { wPx, hPx } = tableSizePx(tb.data);
        tb.w = wPx / SCALE;
        tb.h = hPx / SCALE;
        blocks.push(tb);
        y += tb.h + GAP + 1;
      }
    }
  }
  return blocks;
}
