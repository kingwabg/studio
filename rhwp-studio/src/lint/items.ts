/**
 * 검사 결과 한 건 — 맞춤법과 서식 규정이 **같은 형식**으로 흐른다.
 * (스펙: studio `docs/plans/format-linter.md` — "사용자 눈에는 밑줄 색 차이뿐")
 */
import type { CharProperties } from '@/core/types';
import { scanDocument, type SpellHit } from '@/ui/spell-dialog';
import { scanFormat, DEFAULT_SPEC, type CellRef, type FormatSpec } from './format-rules';

/**
 * 지적 종류. 앞 셋은 **글자를 바꾸는** 교정이고 'format' 만 글자 속성을 바꾼다.
 * 철자/문법은 "틀렸다", 문장은 "이렇게 쓰면 낫다" — 무게가 달라 색과 묶음을 나눈다.
 */
export type LintKind = 'spell' | 'grammar' | 'style' | 'format' | 'dict';

/** 글자를 치환하는 종류인가 — 겹침 판정·수정본이 이 셋만 본다 */
export function isTextKind(k: LintKind): boolean {
  return k === 'spell' || k === 'grammar' || k === 'style' || k === 'dict';
}

export interface LintItem {
  kind: LintKind;
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  msg: string;
  /** "되요 → 돼요" / "12pt → 10pt" — 없으면 안내만 하고 고치지 않는다 */
  detail: string | null;
  /** 표 안 위반이면 셀 좌표(밑줄·적용 둘 다 이 좌표로 간다) */
  cell?: CellRef;
  /**
   * 고침 — 글자를 바꾸거나(맞춤법) 글자 속성을 입히거나(서식).
   * ⚠ 사전 지적은 **null 이다**. hunspell 의 후보가 한국어에선 자주 엉뚱해서
   *   ("모드게" → "모드께/모드가/모드기", 정답 "모두가"는 없음) 자동 적용하면
   *   [전부 적용]이 문서를 망친다. 후보는 카드에서 사람이 고른다(사용자 결정 2026-07-31).
   */
  fix: { text: string } | { props: Partial<CharProperties> } | null;
  /** 사전 지적일 때 그 어절 — 카드를 열 때 이 말로 후보를 뽑는다 */
  word?: string;
}

/** 같은 지적을 두 번 세지 않기 위한 키 — [무시]도 이 키로 기억한다 */
export function itemKey(it: LintItem): string {
  const c = it.cell ? `c${it.cell.ci}.${it.cell.cei}` : '';
  return `${it.kind}:${it.sectionIndex}:${it.paragraphIndex}:${c}:${it.charOffset}:${it.msg}`;
}

const CAT_KIND: Record<string, LintKind> = { 철자: 'spell', 문법: 'grammar', 문장: 'style' };

function fromSpell(h: SpellHit): LintItem {
  return {
    kind: CAT_KIND[h.cat] ?? 'spell',
    sectionIndex: h.sectionIndex, paragraphIndex: h.paragraphIndex,
    charOffset: h.charOffset, length: h.length,
    msg: h.msg,
    detail: h.suggestion != null ? `${h.text} → ${h.suggestion}` : null,
    fix: h.suggestion != null ? { text: h.suggestion } : null,
  };
}

/**
 * **글자를 바꾸는 지적끼리** 같은 자리를 물면 앞의 것만 남긴다. 겹친 채로 [전부 적용]하면
 * 뒤 교정이 이미 바뀐 글자를 덮어 문장이 깨진다(치환이라 길이가 변한다).
 * ⚠ 철자·문법·문장은 서로도 겹칠 수 있으므로 **한 무리로** 본다(종류별로 나눠 보면
 *   '되어지'(문법)와 '되요'(철자)가 같은 자리에서 둘 다 적용된다).
 *
 * ⚠ 서식 지적은 겹쳐도 그대로 둔다 — 같은 구간이 "글꼴도 다르고 크기도 다르다"인 것은
 * 정상이고, 속성 적용은 길이를 바꾸지 않아 순서에 안전하다. (여기서 걸렀다가
 * 크기 위반이 통째로 사라진 실측 결함, 2026-07-31)
 */
function dropOverlaps(items: LintItem[]): LintItem[] {
  const out: LintItem[] = [];
  for (const it of items) {
    const clash = isTextKind(it.kind) && out.some((p) =>
      isTextKind(p.kind) && p.sectionIndex === it.sectionIndex &&
      p.paragraphIndex === it.paragraphIndex &&
      it.charOffset < p.charOffset + p.length && p.charOffset < it.charOffset + it.length);
    if (!clash) out.push(it);
  }
  return out;
}

/**
 * 문서 전체 검사 — 맞춤법 + (켜져 있으면) 서식 규정.
 *
 * ⚠ `withFormat` 기본값이 false 인 이유(실측 2026-07-31): 실제 6쪽 문서를 열었더니 서식
 * 지적만 **558건**이 나왔다. 규격 검사는 "이 문서를 우리 서식에 맞춘다"는 의도적 행위이지
 * 상시 감시가 아니다 — 상시로 켜면 화면이 밑줄로 덮여 맞춤법까지 같이 무시당한다.
 * 그래서 맞춤법은 늘 켜고, 서식은 사용자가 켤 때만 본다.
 */
/**
 * ⚠ 사전 검사는 여기 없다. 문서 전체에 돌리면 복합명사 때문에 공문 한 장에 78건이
 *   떴다(2026-07-31 실측: 십억원·통합재정수지·사회보장성기금 … 전부 맞는 말).
 *   그래서 **커서가 있는 문단만** 보고 결과도 우측 패널에만 낸다 — ui/para-proofread.ts.
 *   (사용자 결정: "카카오톡처럼 내가 쓴 것만, 원할 때")
 */
export function scanAll(
  wasm: never,
  withFormat = false,
  spec: FormatSpec = DEFAULT_SPEC,
): LintItem[] {
  const spell = scanDocument(wasm).map(fromSpell);
  let format: LintItem[] = [];
  try {
    if (withFormat) format = scanFormat(wasm, spec).map((f) => ({
      kind: 'format' as const,
      sectionIndex: f.sectionIndex, paragraphIndex: f.paragraphIndex,
      charOffset: f.charOffset, length: f.length,
      msg: f.msg, detail: f.detail, cell: f.cell, fix: { props: f.props },
    }));
  } catch { /* 서식 검사 실패는 맞춤법까지 죽이지 않는다 */ }
  const all = [...spell, ...format].sort(
    (a, b) => a.sectionIndex - b.sectionIndex || a.paragraphIndex - b.paragraphIndex
      || a.charOffset - b.charOffset);
  return dropOverlaps(all);
}
