/**
 * AI 문서 작성 — 문서 모델 (2026-08-05, 「Hwpx 한글 도우미」 주문서 이식).
 *
 * 주문서의 설계 원칙을 그대로 지킨다:
 *   · 섹션 3레벨(Ⅰ. / 1. / 가.) — 번호는 **여기서 자동 할당**, 모델이 지어내지 않는다
 *   · 블록 3종(para / list / table) — 이외 타입은 받지 않는다
 *   · 모든 편집은 주소 기반 — 이 모델이 유일한 진실이고, 지면은 모델을 실체화한 결과다
 *
 * 주문서와 다른 점(의도된 변경): Python/FastAPI/Redis 서버 대신 **브라우저 안 TS**다.
 * 문서가 이미 편집기 안에 있으므로 저장소 계층이 필요 없고, 페이지 계산은 높이 추정
 * 공식(주문서 §6) 대신 **진짜 rhwp 엔진의 조판 결과**를 읽는다(review.ts).
 * 주문서 자신의 원칙 4번("페이지는 추정 금지")을 우리가 더 잘 지키는 길이다.
 */

export type Block = ParaBlock | ListBlock | TableBlock;

export interface ParaBlock { type: 'para'; text: string; }
export interface ListBlock { type: 'list'; items: string[]; ordered: boolean; }
export interface TableBlock {
  type: 'table';
  rows: string[][];
  /** merge_cells 로 쌓인 병합 지시 — 실체화 때 엔진에 그대로 전달 */
  merges: Array<{ top: number; left: number; bottom: number; right: number }>;
}

export interface Section {
  heading: string;
  level: 1 | 2 | 3;
  blocks: Block[];
  pageBreakBefore: boolean;
  /** assignSectionNumbers 가 채운다 — "Ⅰ" / "1" / "가" */
  number: string;
}

export interface WriterDocument {
  title: string;
  sections: Section[];
  /** 줄간격 % (100~250). 주문서 기본 160. */
  lineSpacing: number;
}

export function createDocument(): WriterDocument {
  return { title: '', sections: [], lineSpacing: 160 };
}

/**
 * 로마 숫자 — 한국 공문서는 **전각 단일 문자**(Ⅱ·Ⅲ·…·Ⅻ)를 쓴다.
 * ⚠ Ⅰ 을 이어 붙여 합성하면 "ⅠⅠ" 처럼 보인다(실측으로 잡은 버그) — 12까지는 표에서
 *   바로 뽑고, 그 너머(현실적으로 없음)만 Ⅻ+합성으로 처리한다.
 */
const ROMAN_UNITS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
export function toRoman(n: number): string {
  const v = Math.max(1, n);
  if (v <= 12) return ROMAN_UNITS[v - 1];
  return 'Ⅻ' + toRoman(v - 12);
}

const HANGUL = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
export function toHangul(n: number): string {
  return HANGUL[(n - 1) % HANGUL.length];
}

/**
 * 섹션 번호 자동 할당(주문서 §3.2 그대로).
 * 같은 레벨 카운터 증가 + 하위 레벨 리셋 — add/delete/편집 뒤 매번 다시 돈다.
 * 모델이 번호를 직접 쓰지 못하게 하는 것이 요점이다(Ⅱ 다음에 Ⅳ 가 나오는 사고 방지).
 */
export function assignSectionNumbers(doc: WriterDocument): void {
  const counters = [0, 0, 0];
  for (const s of doc.sections) {
    const idx = s.level - 1;
    counters[idx] += 1;
    for (let i = idx + 1; i < 3; i++) counters[i] = 0;
    s.number = s.level === 1 ? toRoman(counters[0])
      : s.level === 2 ? String(counters[1])
      : toHangul(counters[2]);
  }
}

/** 섹션 제목의 표시형 — "Ⅰ. 개요" / "1. 세부 현황" / "가. 조사 방법" */
export function headingLabel(s: Section): string {
  return `${s.number}. ${s.heading}`;
}

// ── 검증 (주문서 §5 의 한도 그대로) ──────────────────────────

export const LIMITS = {
  title: 200, heading: 200, paraText: 10_000, listItems: 100,
  tableRows: 50, tableCols: 10, cellText: 500, blocksPerSection: 50,
} as const;

/** 블록 하나를 검증·정규화한다. 문제가 있으면 사람이 아니라 **모델이 읽을** 오류 문자열. */
export function validateBlock(raw: unknown): Block | string {
  if (!raw || typeof raw !== 'object') return 'ERROR: 블록은 객체여야 합니다';
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'para': {
      const text = String(b.text ?? '').trim();
      if (!text) return 'ERROR: para.text 가 비었습니다';
      if (text.length > LIMITS.paraText) return `ERROR: para.text ${LIMITS.paraText}자 초과`;
      return { type: 'para', text };
    }
    case 'list': {
      const items = Array.isArray(b.items) ? b.items.map((x) => String(x).trim()).filter(Boolean) : [];
      if (items.length === 0) return 'ERROR: list.items 가 비었습니다';
      if (items.length > LIMITS.listItems) return `ERROR: list.items ${LIMITS.listItems}개 초과`;
      return { type: 'list', items, ordered: b.ordered === true };
    }
    case 'table': {
      const rows = Array.isArray(b.rows)
        ? b.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : null))
        : null;
      if (!rows || rows.length === 0 || rows.some((r) => r === null)) return 'ERROR: table.rows 형식 오류';
      const clean = rows as string[][];
      if (clean.length > LIMITS.tableRows) return `ERROR: 표 ${LIMITS.tableRows}행 초과`;
      const cols = clean[0].length;
      if (cols < 1 || cols > LIMITS.tableCols) return `ERROR: 표 열 수는 1~${LIMITS.tableCols} (현재 ${cols})`;
      for (let i = 0; i < clean.length; i++) {
        // 주문서가 가장 힘줘 말한 검증 — 모든 행의 열 수가 같아야 한다
        if (clean[i].length !== cols) return `ERROR: ${i}행 열 수 ${clean[i].length} ≠ 첫 행 ${cols}`;
        for (const cell of clean[i]) {
          if (cell.length > LIMITS.cellText) return `ERROR: 셀 ${LIMITS.cellText}자 초과`;
        }
      }
      return { type: 'table', rows: clean, merges: [] };
    }
    default:
      return `ERROR: 블록 type 은 para|list|table 만 (받음: ${String(b.type)})`;
  }
}

/** 문서 안의 모든 표를 문서 순서로 — 주소 기반 표 편집(table_index)의 근거. */
export function listTables(doc: WriterDocument): Array<{ table: TableBlock; section: Section }> {
  const out: Array<{ table: TableBlock; section: Section }> = [];
  for (const s of doc.sections) {
    for (const b of s.blocks) if (b.type === 'table') out.push({ table: b, section: s });
  }
  return out;
}
