/**
 * 문단 교정 — **지금 쓰고 있는 문단만** 사전으로 확인한다.
 *
 * 왜 문단만인가(사용자 결정 2026-07-31): 문서 전체에 사전을 돌렸더니 공문 한 장에
 * 78건이 떴다. 열어 보니 십억원·통합재정수지·사회보장성기금처럼 **맞는 복합명사**였다.
 * 한국어는 명사를 자유롭게 붙여 쓰는데 사전이 그 조합을 다 담을 수 없다.
 *
 * "카카오톡처럼 내가 쓴 것만, 원할 때 고치기" — 범위를 한 문단으로 좁히면
 * ① 남는 오탐이 서너 개뿐이고 ② 한곳(우측 패널)에 모여 있어 무시하기도 쉽다.
 * 캔버스에는 밑줄을 긋지 않는다. 밑줄은 정확도가 높은 규칙 검사만 쓴다.
 */
import { isKnownWord, isDictReady, suggestWord } from '@/lint/dict';

export interface WordCheck {
  word: string;
  /** 문단 안 시작 위치(글자) */
  at: number;
  len: number;
}

interface W {
  getParagraphLength(sec: number, para: number): number;
  getTextRange(sec: number, para: number, from: number, count: number): string;
  getSectionCount?(): number;
}

/** 한 문단에 표시할 최대 개수 — 이보다 많으면 읽히지 않는다 */
const MAX = 6;

/**
 * 한 글자짜리 단위 접미사 — "십억원"의 '원'처럼 홀로 붙는 말.
 * ⚠ 한 글자를 전부 인정하면 "모드게" 가 "모드"+"게" 로 쪼개져 **진짜 오타가 통과**한다.
 *   그래서 단위로 쓰이는 것만 목록으로 못 박는다.
 */
const UNIT_TAIL = new Set([
  '원', '개', '명', '년', '월', '일', '회', '차', '건', '쪽', '장',
  '층', '급', '성', '별', '률', '율', '액', '량', '품', '료', '비',
]);
// ⚠ 여기 무엇을 넣을지가 정확도와 소음이 맞바뀌는 지점이다. 넓히면 복합명사는 조용해지지만
//   **진짜 오타가 통과**한다 — '대'를 넣었더니 "되는대"(오타)가 "되는"+"대"로 쪼개져
//   그냥 지나갔다(2026-07-31 실측). 그래서 어미로 쓰일 수 있는 글자
//   (대·도·시·기·상·내·외·간·식·형·용·적·화·력 …)는 **넣지 않는다**.
//   복합명사가 한둘 남는 건 감수한다 — 문단 하나에 칩 한 개는 무시하기 쉽지만,
//   놓친 오타는 이 기능의 존재 이유를 없앤다.

/**
 * 복합명사인가 — 아는 말들로 **끝까지 쪼개지면** 맞는 것으로 친다.
 *
 * 실측(2026-07-31): 두 조각만 보면 공문 오탐이 114 → 78건에 그쳤다. 한국어는 명사를
 * 셋 넷씩 붙이기 때문이다(사립학교+교직원+연금+기금). 그래서 재귀로 끝까지 본다.
 *
 * ⚠ 조각은 **2글자 이상**이어야 한다(단위 접미사만 예외). 1글자를 허용하면 거의 모든
 *   말이 쪼개져 오타를 놓친다 — 정확도와 소음이 정면으로 맞바뀌는 지점이다.
 */
function isCompoundOfKnown(word: string, memo = new Map<string, boolean>()): boolean {
  const hit = memo.get(word);
  if (hit !== undefined) return hit;
  memo.set(word, false); // 재귀 중 같은 조각을 다시 물으면 실패로 친다(무한 방지)
  for (let i = 2; i <= word.length - 1; i++) {
    const head = word.slice(0, i);
    const tail = word.slice(i);
    if (!isKnownWord(head)) continue;
    const tailOk = tail.length === 1
      ? UNIT_TAIL.has(tail)
      : isKnownWord(tail) || isCompoundOfKnown(tail, memo);
    if (tailOk) { memo.set(word, true); return true; }
  }
  return false;
}

/** 검사에서 뺄 어절 — 숫자·영문이 섞이면(2026년도, A반) 오탐이 많다. */
function skip(w: string): boolean {
  return w.length < 2 || !/[가-힣]/.test(w) || /[0-9A-Za-z]/.test(w);
}

/** 커서가 있는 문단에서 사전이 모르는 어절을 찾는다. 사전이 아직 없으면 빈 배열. */
export function proofreadParagraph(w: W, sec: number, para: number): WordCheck[] {
  if (!isDictReady()) return [];
  let text = '';
  try {
    const len = w.getParagraphLength(sec, para);
    if (!len) return [];
    text = w.getTextRange(sec, para, 0, len) ?? '';
  } catch {
    return [];
  }
  const out: WordCheck[] = [];
  for (const m of text.matchAll(/[가-힣]+/g)) {
    if (out.length >= MAX) break;
    const word = m[0];
    if (skip(word) || isKnownWord(word) || isCompoundOfKnown(word)) continue;
    out.push({ word, at: m.index ?? 0, len: word.length });
  }
  return out;
}

/** 그 낱말의 교정 후보 — 카드를 열 때만 뽑는다(후보 생성이 낱말당 수 ms 다). */
export function candidatesFor(word: string): string[] {
  return suggestWord(word);
}
