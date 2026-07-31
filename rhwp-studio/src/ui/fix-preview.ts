/**
 * 「수정본」 재료 — 지금 문단을 맞춤법대로 고치면 어떤 문장이 되는지 조각으로 만든다.
 * (사용자 요청 2026-07-31: 견본 자리에 "문장 수정·맞춤법 수정본"이 나오게)
 *
 * 검사 자체는 lint/ 가 한다. 이 파일은 **검사 결과를 문장으로 되돌리는 일**만 맡아,
 * 우측 패널이 검사기를 직접 알지 않게 한다(규칙이 늘어도 인스펙터는 그대로).
 */
import type { FixPart } from './format-specimen';

/** lint 가 주는 항목 중 여기서 쓰는 부분만 (모듈 간 결합을 최소로) */
export interface LintItemLike {
  kind: 'spell' | 'format';
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  cell?: unknown;
  fix: { text: string } | { props: unknown } | null;
}

interface W {
  getParagraphLength(sec: number, para: number): number;
  getTextRange(sec: number, para: number, from: number, count: number): string;
}

/** 한 문단에 너무 긴 문장을 통째로 넣으면 패널이 밀린다 — 앞부분만 보여준다. */
const MAX_CHARS = 160;

/**
 * 커서 문단의 글자 치환 고침(맞춤법)을 문장 조각으로 만든다.
 * 서식 지적은 글자를 바꾸지 않으므로 여기서는 뺀다 — "수정본"은 문장이 어떻게 바뀌는지다.
 */
export function buildFixParts(
  w: W,
  items: LintItemLike[],
  sectionIndex: number,
  paragraphIndex: number,
): FixPart[] {
  const mine = items
    .filter((it) => it.kind === 'spell' && !it.cell && it.fix && 'text' in it.fix
      && it.sectionIndex === sectionIndex && it.paragraphIndex === paragraphIndex)
    .sort((a, b) => a.charOffset - b.charOffset);
  if (mine.length === 0) return [];

  let text = '';
  try {
    const len = w.getParagraphLength(sectionIndex, paragraphIndex);
    if (!len) return [];
    text = w.getTextRange(sectionIndex, paragraphIndex, 0, len);
  } catch {
    return [];
  }
  if (!text) return [];

  const parts: FixPart[] = [];
  let at = 0;
  for (const it of mine) {
    if (it.charOffset < at) continue; // 겹치면 앞의 것만(lint 가 이미 거르지만 방어)
    if (it.charOffset > at) parts.push({ text: text.slice(at, it.charOffset) });
    parts.push({
      text: text.slice(it.charOffset, it.charOffset + it.length),
      to: (it.fix as { text: string }).text,
    });
    at = it.charOffset + it.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });

  // 길면 자른다 — 고칠 곳이 남아 있는 한 잘라도 뜻이 통한다.
  let budget = MAX_CHARS;
  const out: FixPart[] = [];
  for (const p of parts) {
    if (budget <= 0) { out.push({ text: ' …' }); break; }
    out.push(p.text.length > budget ? { ...p, text: `${p.text.slice(0, budget)}…` } : p);
    budget -= p.text.length;
  }
  return out;
}
