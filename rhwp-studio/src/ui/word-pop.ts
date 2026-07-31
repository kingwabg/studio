/**
 * 낱말 교정 팝오버 — 「확인할 낱말」을 누르면 후보를 보여주고 고른 것으로 바꾼다.
 *
 * ⚠ 후보를 자동 적용하지 않는다(사용자 결정 2026-07-31). hunspell 의 한국어 후보는
 *   자주 엉뚱하다 — "모드게" 의 후보가 "모드께/모드가/모드기" 이고 정답 "모두가" 는
 *   들어 있지 않다. 사람이 보고 고르게 하고, 일괄 적용에는 넣지 않는다.
 */
import { mkEl, mkButton } from './canva-dom';
import { candidatesFor } from './para-proofread';

let pop: HTMLElement | null = null;
let onDown: ((e: MouseEvent) => void) | null = null;

export function closeWordPop(): void {
  if (onDown) document.removeEventListener('mousedown', onDown, true);
  onDown = null;
  pop?.remove();
  pop = null;
}

/**
 * 낱말 후보 팝오버를 연다.
 * @param apply 고른 후보로 바꾼다(호출부가 문서 편집을 맡는다)
 */
export function openWordPop(word: string, anchor: HTMLElement, apply: (to: string) => void): void {
  closeWordPop();
  const el = mkEl('div', 'canva-word-pop');
  const cands = candidatesFor(word);
  if (cands.length === 0) {
    el.appendChild(mkEl('div', 'canva-word-pop-empty', '고칠 후보를 찾지 못했습니다'));
  } else {
    for (const c of cands) {
      const b = mkButton('canva-word-cand');
      b.textContent = c;
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        closeWordPop();
        apply(c);
      });
      el.appendChild(b);
    }
  }
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  // 패널이 오른쪽 끝이라 왼쪽으로 펼친다 — 그대로 두면 화면 밖으로 나간다.
  const w = el.offsetWidth || 160;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  el.style.top = `${Math.min(r.bottom + 4, window.innerHeight - el.offsetHeight - 8)}px`;
  pop = el;

  onDown = (e: MouseEvent) => {
    if (el.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closeWordPop();
  };
  document.addEventListener('mousedown', onDown, true);
}
