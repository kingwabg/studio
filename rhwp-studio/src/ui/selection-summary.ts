/**
 * 선택 요약 — 우측 패널 배너의 "무엇이 걸려 있나" 한 줄.
 *
 * [2026-07-31 사용자 지적] 종전엔 커서 위치 문단만 말해서, Ctrl+A 로 문서를 통째로
 * 잡아도 "2번째 문단"이라고 표시했다. 배너의 존재 이유는 **이 패널의 서식이 어디에
 * 걸리는가**를 알려주는 것이므로 선택을 반영해야 한다.
 *
 * 한컴 상태바 오라클(웹한글 실측): 선택하면 `111/153 글자` — 선택 글자수/전체.
 * 문단 번호는 안 준다. 우리는 한 화면에서 **글자 서식(선택 글자에 걸림)** 과
 * **문단 모양(문단 전체에 걸림)** 을 같이 다루므로 두 축을 함께 적는다:
 *   선택 없음 → `1쪽 · 2번째 문단`  ·  한 문단 부분 → `2번째 문단 · 45자`
 *   여러 문단 → `2~4번째 문단 · 118자`
 */
import type { CharProperties } from '@/core/types';

/** 문단 수가 이보다 많으면 글자 수 합산을 생략한다(배너는 커서 이동마다 다시 그린다). */
const COUNT_LIMIT = 200;

interface Pos {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  parentParaIndex?: number;
}

interface WasmLike {
  getLogicalLength(sec: number, para: number): number;
  getCharPropertiesAt(sec: number, para: number, off: number): CharProperties;
  getPageOfPosition?: (sec: number, para: number) => { ok: boolean; page?: number | null };
}

interface CursorLike {
  getPosition?: () => Pos | undefined;
  hasSelection?: () => boolean;
  getSelectionOrdered?: () => { start: Pos; end: Pos } | null;
}

/** 본문 선택의 글자 수. 셀 안 선택은 규격이 달라 null. */
function countChars(w: WasmLike, s: Pos, e: Pos): number | null {
  if (s.parentParaIndex !== undefined || e.parentParaIndex !== undefined) return null;
  if (s.paragraphIndex === e.paragraphIndex) return Math.max(0, e.charOffset - s.charOffset);
  if (e.paragraphIndex - s.paragraphIndex > COUNT_LIMIT) return null;
  try {
    let n = Math.max(0, w.getLogicalLength(s.sectionIndex, s.paragraphIndex) - s.charOffset);
    for (let p = s.paragraphIndex + 1; p < e.paragraphIndex; p++) {
      n += w.getLogicalLength(s.sectionIndex, p);
    }
    return n + Math.max(0, e.charOffset);
  } catch {
    return null;
  }
}

/** 본문 배너 문구. 선택이 없으면 커서 문단, 있으면 걸친 범위 + 글자 수. */
export function describeBodySelection(cursor: CursorLike, w: WasmLike): string {
  const pos = cursor.getPosition?.();
  if (!pos) return '';
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;

  if (!sel) {
    const page = w.getPageOfPosition?.(pos.sectionIndex, pos.paragraphIndex);
    const p = page?.ok && page.page != null ? `${page.page + 1}쪽 · ` : '';
    return `${p}${pos.paragraphIndex + 1}번째 문단`;
  }

  const { start, end } = sel;
  const span = start.paragraphIndex === end.paragraphIndex
    ? `${start.paragraphIndex + 1}번째 문단`
    : `${start.paragraphIndex + 1}~${end.paragraphIndex + 1}번째 문단`;
  const n = countChars(w, start, end);
  // 쪽 접두는 선택에선 뺀다 — 여러 쪽에 걸치면 한 쪽 번호가 거짓이 된다.
  return n === null ? span : `${span} · ${n.toLocaleString('ko-KR')}자`;
}

/** 글자 서식 동일성 판정에 쓰는 서명(값이 같으면 같은 서식으로 본다). */
function sig(p: CharProperties): string {
  const q = p as unknown as Record<string, unknown>;
  return [
    p.bold, p.italic, p.underline, p.strikethrough, p.fontSize, p.textColor,
    q.fontFamily ?? (q.fontFamilies as string[] | undefined)?.[0], q.shadeColor,
  ].join('|');
}

/**
 * 선택 안에 서로 다른 글자 서식이 섞였는가.
 *
 * 전수 비교는 비싸다(배너는 커서 이동마다 갱신) — **표본**으로 판정한다:
 * 선택 시작·끝, 그리고 걸친 문단들의 첫 글자. 표본이 다르면 확실히 섞인 것이고,
 * 같아도 중간이 다를 수 있다(거짓 음성은 견본이 커서 값을 보여주는 종전과 같다).
 */
export function detectMixedFormat(cursor: CursorLike, w: WasmLike): boolean {
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;
  if (!sel) return false;
  const { start, end } = sel;
  if (start.parentParaIndex !== undefined) return false;
  try {
    const samples: string[] = [sig(w.getCharPropertiesAt(start.sectionIndex, start.paragraphIndex, start.charOffset))];
    const last = Math.min(end.paragraphIndex, start.paragraphIndex + COUNT_LIMIT);
    for (let p = start.paragraphIndex + 1; p <= last; p++) {
      samples.push(sig(w.getCharPropertiesAt(start.sectionIndex, p, 0)));
    }
    if (end.charOffset > 0) {
      samples.push(sig(w.getCharPropertiesAt(end.sectionIndex, end.paragraphIndex, Math.max(0, end.charOffset - 1))));
    }
    return new Set(samples).size > 1;
  } catch {
    return false;
  }
}
