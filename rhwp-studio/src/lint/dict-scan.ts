/**
 * 사전 검사 — 문단을 어절로 잘라 "사전에 없는 말"을 찾는다.
 *
 * 규칙 검사(ui/spell-dialog.ts)는 **아는 오타만** 잡는다. 이쪽은 반대로 **모르는 말**을
 * 잡는다 — 둘은 서로 못 하는 일을 한다.
 *
 * ⚠ 조사를 떼지 않는다. 한국어 활용·조사는 사전의 활용 규칙(ko.aff 11MB)이 처리한다 —
 *   우리가 어절을 쪼개면 오히려 틀린다("아동에게"는 통째로 사전에 맞는 말이다).
 *
 * ⚠ 고칠 후보(suggest)는 여기서 뽑지 않는다. hunspell 의 후보 생성은 한 단어에 수 ms 라
 *   문서 전체에 돌리면 검사가 멈춘다. 후보는 사용자가 밑줄을 눌렀을 때 그 자리에서 뽑는다.
 */
import { isKnownWord } from './dict';

export interface DictHit {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  word: string;
}

/** 검사에서 뺄 어절 — 숫자·영문·기호·한 글자는 사전이 판단할 대상이 아니다. */
function skip(w: string): boolean {
  if (w.length < 2) return true;
  if (!/[가-힣]/.test(w)) return true;      // 한글이 없으면 대상 밖
  if (/[0-9A-Za-z]/.test(w)) return true;   // 숫자·영문이 섞이면(2026년도, A반) 오탐이 많다
  return false;
}

/** 문단 하나를 어절로 잘라 위치와 함께 돌려준다. */
function tokenize(text: string): Array<{ word: string; at: number }> {
  const out: Array<{ word: string; at: number }> = [];
  // 한글·한자만 어절로 본다. 괄호·따옴표·문장부호는 경계다.
  const re = /[가-힣ㄱ-ㅎㅏ-ㅣ一-龥]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ word: m[0], at: m.index });
  return out;
}

interface W {
  getSectionCount?(): number;
  getParagraphCount(sec: number): number;
  getParagraphLength(sec: number, para: number): number;
  getTextRange(sec: number, para: number, from: number, count: number): string;
}

/** 문서 전체에서 사전에 없는 어절을 찾는다. 사전이 없으면 빈 배열(조용히 통과). */
export function scanDictionary(w: W): DictHit[] {
  const hits: DictHit[] = [];
  const secCount = w.getSectionCount?.() ?? 1;
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = w.getParagraphCount(sec);
    for (let para = 0; para < paraCount; para++) {
      let text = '';
      try {
        const len = w.getParagraphLength(sec, para);
        if (!len) continue;
        text = w.getTextRange(sec, para, 0, len) ?? '';
      } catch { continue; }
      if (!text) continue;
      for (const t of tokenize(text)) {
        if (skip(t.word)) continue;
        if (isKnownWord(t.word)) continue;
        hits.push({
          sectionIndex: sec, paragraphIndex: para,
          charOffset: t.at, length: t.word.length, word: t.word,
        });
      }
    }
  }
  return hits;
}
