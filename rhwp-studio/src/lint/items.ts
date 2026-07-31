/**
 * 검사 결과 한 건 — 맞춤법과 서식 규정이 **같은 형식**으로 흐른다.
 * (스펙: studio `docs/plans/format-linter.md` — "사용자 눈에는 밑줄 색 차이뿐")
 */
import type { CharProperties } from '@/core/types';
import { scanDocument, type SpellHit } from '@/ui/spell-dialog';
import { scanFormat, DEFAULT_SPEC, type CellRef, type FormatSpec } from './format-rules';

export interface LintItem {
  kind: 'spell' | 'format';
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  msg: string;
  /** "되요 → 돼요" / "12pt → 10pt" — 없으면 안내만 하고 고치지 않는다 */
  detail: string | null;
  /** 표 안 위반이면 셀 좌표(밑줄·적용 둘 다 이 좌표로 간다) */
  cell?: CellRef;
  /** 고침 — 글자를 바꾸거나(맞춤법) 글자 속성을 입히거나(서식) */
  fix: { text: string } | { props: Partial<CharProperties> } | null;
}

/** 같은 지적을 두 번 세지 않기 위한 키 — [무시]도 이 키로 기억한다 */
export function itemKey(it: LintItem): string {
  const c = it.cell ? `c${it.cell.ci}.${it.cell.cei}` : '';
  return `${it.kind}:${it.sectionIndex}:${it.paragraphIndex}:${c}:${it.charOffset}:${it.msg}`;
}

function fromSpell(h: SpellHit): LintItem {
  return {
    kind: 'spell',
    sectionIndex: h.sectionIndex, paragraphIndex: h.paragraphIndex,
    charOffset: h.charOffset, length: h.length,
    msg: h.msg,
    detail: h.suggestion != null ? `${h.text} → ${h.suggestion}` : null,
    fix: h.suggestion != null ? { text: h.suggestion } : null,
  };
}

/**
 * **맞춤법**끼리 같은 글자를 물면 앞의 것만 남긴다. 겹친 채로 [전부 적용]하면
 * 뒤 교정이 이미 바뀐 글자를 덮어 문장이 깨지기 때문이다(글자 치환이라 길이가 변한다).
 *
 * ⚠ 서식 지적은 겹쳐도 그대로 둔다 — 같은 구간이 "글꼴도 다르고 크기도 다르다"인 것은
 * 정상이고, 속성 적용은 길이를 바꾸지 않아 순서에 안전하다. (여기서 걸렀다가
 * 크기 위반이 통째로 사라진 실측 결함, 2026-07-31)
 */
function dropOverlaps(items: LintItem[]): LintItem[] {
  const out: LintItem[] = [];
  for (const it of items) {
    const clash = it.kind === 'spell' && out.some((p) =>
      p.kind === 'spell' && p.sectionIndex === it.sectionIndex &&
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
export function scanAll(wasm: never, withFormat = false, spec: FormatSpec = DEFAULT_SPEC): LintItem[] {
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
