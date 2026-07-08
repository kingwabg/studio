// resolve.ts — {{열이름}} 토큰 치환 엔진. 정규식 기반으로 단순·견고하게.
// UI는 칩(chip)으로 보여주지만 저장·병합의 진실은 이 토큰 문자열이다 (하이브리드 전략).
import { type CanvasDoc } from "../document/model";

export const TOKEN_RE = /\{\{([^{}]+)\}\}/g;

// 텍스트 하나 치환 — 모르는 열 이름은 토큰 그대로 남긴다(실수 발견이 쉽게)
export function resolveTokens(text: string, columns: string[], row: string[]): string {
  return text.replace(TOKEN_RE, (whole, name: string) => {
    const i = columns.indexOf(name.trim());
    return i >= 0 ? (row[i] ?? "") : whole;
  });
}

// 문서 전체 치환 — 행 하나로 새 문서(불변 복제)를 만든다
export function resolveDoc(doc: CanvasDoc, columns: string[], row: string[]): CanvasDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.type === "text" && b.text)
        return { ...b, text: resolveTokens(b.text, columns, row) };
      if (b.type === "table" && b.rows)
        return { ...b, rows: b.rows.map((r) => r.map((cell) => resolveTokens(cell, columns, row))) };
      return b;
    }),
  };
}

// 문서에 실제로 쓰인 토큰 목록 (매핑 상태 표시용)
export function usedTokens(doc: CanvasDoc): string[] {
  const found = new Set<string>();
  const scan = (t: string) => {
    for (const m of t.matchAll(TOKEN_RE)) found.add(m[1].trim());
  };
  for (const b of doc.blocks) {
    if (b.text) scan(b.text);
    if (b.rows) for (const r of b.rows) for (const c of r) scan(c);
  }
  return [...found];
}
