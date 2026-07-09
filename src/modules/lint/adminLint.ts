// adminLint.ts — 행정 공문서 서식 검사기(린터). 실무에서 가장 자주 반려당하는 규칙을
// 정규식·모델 규칙으로 검사하고, 결정론적으로 자동 수정한다. ESLint가 코드를 잡듯,
// 출력 전에 "행정 서식 오류"를 잡아준다. 순수 함수 — Node 하네스에서도 재사용 가능.
//
// 검사 항목(현장 5대 반려 포인트):
//  1. 개요 번호 체계  1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮ (표준 순서 강제)
//  3. 날짜 표기       2026.07.09 → 2026. 7. 9. (마침표+공백, 앞자리 0 제거, 끝 마침표)
//  4. '끝.' 표시      본문/표 끝에 끝. (본문은 2칸 뒤, 표는 아래 오른쪽 정렬)
//  5. 표 정렬         숫자 셀은 오른쪽 정렬 (결재권자가 단위를 한눈에)
import { type Block, type CanvasDoc, type TableKingData, createBlock } from "../document/model";

export type Severity = "error" | "warning" | "info";
export interface Finding {
  key: string; // 안정적 식별자 (중복 방지)
  rule: "hierarchy" | "date" | "ending" | "table-align";
  severity: Severity;
  title: string;
  detail: string;
  blockId?: string;
  fix?: (doc: CanvasDoc) => CanvasDoc; // 순수: 새 문서 반환
}

// ── 표준 개요 번호 (행정안전부 공문서 작성 기준) ──
const HANGUL = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허";
export function standardMarker(depth: number, idx: number): string {
  switch (depth) {
    case 0:
      return `${idx + 1}.`; // 1. 2. 3.
    case 1:
      return `${HANGUL[idx] ?? idx + 1}.`; // 가. 나. 다.
    case 2:
      return `${idx + 1})`; // 1) 2) 3)
    case 3:
      return `${HANGUL[idx] ?? idx + 1})`; // 가) 나)
    case 4:
      return `(${idx + 1})`; // (1) (2)
    case 5:
      return `(${HANGUL[idx] ?? idx + 1})`; // (가) (나)
    case 6:
      return String.fromCodePoint(0x2460 + Math.min(idx, 19)); // ① ② …
    default:
      return String.fromCodePoint(0x326e + Math.min(idx, 13)); // ㉮ ㉯ …
  }
}

// 개요 마커(표준·비표준 모두) 제거 — 재번호 시 기존 번호를 벗긴다.
// 로마숫자(Ⅰ.)·원문자·괄호형까지 포괄.
const MARKER_RE =
  /^\s*(?:\d+\.|[가-힣]\.|\d+\)|[가-힣]\)|\(\d+\)|\([가-힣]\)|[①-⑳]|[㉮-㉻]|[Ⅰ-Ⅻ]+\.)\s*/;
export const stripMarker = (t: string): string => t.replace(MARKER_RE, "");

// ── 트리 워크: 자식 있는 텍스트 = 머리글. y순으로 형제 정렬. ──
const childrenOf = (blocks: Block[], pid?: string) =>
  blocks.filter((b) => (b.parentId ?? undefined) === pid).sort((a, b) => a.y - b.y || a.x - b.x);
const hasKids = (blocks: Block[], id: string) => blocks.some((b) => b.parentId === id);

// 표준 개요 번호로 전체 트리 재번호 (머리글의 기존 마커를 벗기고 표준 마커 부여)
function renumberOutline(doc: CanvasDoc): CanvasDoc {
  const next = doc.blocks.map((b) => ({ ...b }));
  const byId = new Map(next.map((b) => [b.id, b]));
  const walk = (pid: string | undefined, depth: number) => {
    let hIdx = 0;
    for (const src of childrenOf(doc.blocks, pid)) {
      const b = byId.get(src.id)!;
      if (b.type === "text" && hasKids(doc.blocks, src.id)) {
        const body = stripMarker(b.text ?? "").trim();
        b.text = `${standardMarker(depth, hIdx)} ${body}`.trim();
        hIdx++;
      }
      walk(src.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return { ...doc, blocks: next };
}

// ── 규칙 1: 개요 번호 체계 ──
function lintHierarchy(doc: CanvasDoc): Finding[] {
  const mismatches: string[] = [];
  const walk = (pid: string | undefined, depth: number) => {
    let hIdx = 0;
    for (const b of childrenOf(doc.blocks, pid)) {
      if (b.type === "text" && hasKids(doc.blocks, b.id)) {
        const expected = standardMarker(depth, hIdx);
        const cur = (b.text ?? "").trim();
        if (!cur.startsWith(expected)) mismatches.push(`${cur.slice(0, 14)} → ${expected}`);
        hIdx++;
      }
      walk(b.id, depth + 1);
    }
  };
  walk(undefined, 0);
  if (!mismatches.length) return [];
  return [
    {
      key: "hierarchy",
      rule: "hierarchy",
      severity: "error",
      title: "개요 번호 체계가 표준과 다릅니다",
      detail: `표준 순서(1.→가.→1)→가)…) 위반 ${mismatches.length}건. 예: ${mismatches[0]}`,
      fix: renumberOutline,
    },
  ];
}

// ── 규칙 3: 날짜 표기 ──
// 연도(19·20xx) 기준 숫자 날짜를 "YYYY. M. D."로. 이미 표준이면 건드리지 않는다.
const DATE_RE = /((?:19|20)\d{2})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})\.?/g;
const toStdDate = (y: string, mo: string, d: string) => `${y}. ${Number(mo)}. ${Number(d)}.`;
function normalizeDates(text: string): { changed: boolean; text: string; sample?: string } {
  let changed = false;
  let sample: string | undefined;
  const out = text.replace(DATE_RE, (m, y, mo, d) => {
    const std = toStdDate(y, mo, d);
    if (m !== std) {
      changed = true;
      if (!sample) sample = `${m.trim()} → ${std}`;
    }
    return std;
  });
  return { changed, text: out, sample };
}
function lintDates(doc: CanvasDoc): Finding[] {
  const out: Finding[] = [];
  for (const b of doc.blocks) {
    if (b.type !== "text" || !b.text) continue;
    const r = normalizeDates(b.text);
    if (r.changed)
      out.push({
        key: `date:${b.id}`,
        rule: "date",
        severity: "warning",
        title: "날짜 표기가 표준과 다릅니다",
        detail: r.sample ?? "2026. 7. 9. 형식(마침표+공백, 끝 마침표)",
        blockId: b.id,
        fix: (d) => ({
          ...d,
          blocks: d.blocks.map((x) => (x.id === b.id ? { ...x, text: normalizeDates(x.text ?? "").text } : x)),
        }),
      });
  }
  return out;
}

// ── 규칙 4: '끝.' 표시 ──
// 문서 맨 끝(y 최대) 블록 기준. 본문 텍스트면 "  끝." 덧붙임, 표면 아래 오른쪽 정렬 끝. 추가.
const hasEndMark = (doc: CanvasDoc) => doc.blocks.some((b) => /끝\.\s*$/.test(b.text ?? ""));
function lintEnding(doc: CanvasDoc): Finding[] {
  const content = doc.blocks.filter((b) => b.type === "text" || b.type === "table");
  if (!content.length || hasEndMark(doc)) return [];
  const last = content.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
  const fix = (d: CanvasDoc): CanvasDoc => {
    if (last.type === "text") {
      // 본문: 글자 뒤 스페이스 2번 + 끝.
      return {
        ...d,
        blocks: d.blocks.map((x) => (x.id === last.id ? { ...x, text: `${(x.text ?? "").trimEnd()}  끝.` } : x)),
      };
    }
    // 표: 아래 한 줄 띄우고 오른쪽 정렬 끝.
    const end = createBlock("text", 20, Math.round(last.y + last.h + 4));
    Object.assign(end, { text: "끝.", flow: true, align: "right", w: doc.page.w - 40, fontSize: 12 });
    return { ...d, blocks: [...d.blocks, end] };
  };
  return [
    {
      key: "ending",
      rule: "ending",
      severity: "error",
      title: "'끝.' 표시가 없습니다",
      detail: last.type === "table" ? "표 아래 오른쪽 정렬로 '끝.'을 넣어야 합니다" : "본문 끝에 '  끝.'을 붙여야 합니다",
      blockId: last.id,
      fix,
    },
  ];
}

// ── 규칙 5: 표 숫자 셀 오른쪽 정렬 ──
const NUMERIC_RE = /^[\d,]+\s*(원|％|%|건|명|개|회|점|위)?$/;
function lintTableAlign(doc: CanvasDoc): Finding[] {
  const out: Finding[] = [];
  for (const b of doc.blocks) {
    if (b.type !== "table" || !b.data) continue;
    const d = b.data as TableKingData;
    let bad = 0;
    d.cells.forEach((row, r) =>
      row.forEach((cell) => {
        const t = (cell.text ?? "").trim();
        if (r > 0 && NUMERIC_RE.test(t) && (cell.style?.hAlign ?? "left") !== "right") bad++;
      })
    );
    if (!bad) continue;
    out.push({
      key: `table-align:${b.id}`,
      rule: "table-align",
      severity: "warning",
      title: "표의 숫자가 오른쪽 정렬이 아닙니다",
      detail: `숫자 셀 ${bad}칸 — 금액·건수는 오른쪽 정렬해야 단위를 한눈에 읽습니다`,
      blockId: b.id,
      fix: (doc2) => ({
        ...doc2,
        blocks: doc2.blocks.map((x) => {
          if (x.id !== b.id || !x.data) return x;
          const data = structuredClone(x.data) as TableKingData;
          data.cells.forEach((row, r) =>
            row.forEach((cell) => {
              const t = (cell.text ?? "").trim();
              if (r > 0 && NUMERIC_RE.test(t)) cell.style = { ...cell.style, hAlign: "right" };
            })
          );
          return { ...x, data };
        }),
      }),
    });
  }
  return out;
}

// 전체 검사 — 심각도(error→warning→info) 순
export function lintDoc(doc: CanvasDoc): Finding[] {
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return [...lintHierarchy(doc), ...lintDates(doc), ...lintEnding(doc), ...lintTableAlign(doc)].sort(
    (a, b) => order[a.severity] - order[b.severity]
  );
}

// 모두 수정 — 순차 적용(각 fix는 순수라 접어 나간다)
export function fixAll(doc: CanvasDoc): CanvasDoc {
  let cur = doc;
  // 재검사하며 남은 fixable을 적용 (최대 몇 회 — 서로 영향 최소)
  for (let i = 0; i < 5; i++) {
    const findings = lintDoc(cur).filter((f) => f.fix);
    if (!findings.length) break;
    for (const f of findings) cur = f.fix!(cur);
  }
  return cur;
}
