/**
 * 「문장 다듬기」 결과 팝오버 — 3가지 중 하나를 고른다.
 * 본문(호출·이름 가리기)은 ui/sentence-polish.ts.
 */
import { mkEl, mkButton } from './canva-dom';
import { polishParagraph } from './sentence-polish';

let pop: HTMLElement | null = null;
let onDown: ((e: MouseEvent) => void) | null = null;

export function closePolishPop(): void {
  if (onDown) document.removeEventListener('mousedown', onDown, true);
  onDown = null;
  pop?.remove();
  pop = null;
}

/** 팝오버를 열고 결과를 채운다. 고르면 apply 가 문서 교체를 맡는다. */
export async function openPolishPop(
  text: string,
  anchor: HTMLElement,
  apply: (to: string) => void,
): Promise<void> {
  closePolishPop();
  const el = mkEl('div', 'canva-polish-pop');
  el.appendChild(mkEl('div', 'canva-polish-head', '문장 다듬기'));
  const body = mkEl('div', 'canva-polish-body', '다듬는 중…');
  el.appendChild(body);
  document.body.appendChild(el);

  const r = anchor.getBoundingClientRect();
  const w = 320;
  el.style.left = `${Math.max(8, Math.min(r.left - w + r.width, window.innerWidth - w - 8))}px`;
  el.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 320)}px`;
  pop = el;

  onDown = (e: MouseEvent) => {
    if (el.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closePolishPop();
  };
  document.addEventListener('mousedown', onDown, true);

  const { versions, error } = await polishParagraph(text);
  if (pop !== el) return; // 기다리는 사이 닫혔다
  body.textContent = '';
  if (error || versions.length === 0) {
    body.classList.add('is-empty');
    body.textContent = error ?? '다듬을 결과를 받지 못했습니다';
    return;
  }
  versions.forEach((v, i) => {
    const b = mkButton('canva-polish-cand');
    b.appendChild(mkEl('span', 'canva-polish-num', String(i + 1)));
    b.appendChild(mkEl('span', 'canva-polish-text', v));
    b.addEventListener('mousedown', (e) => { e.preventDefault(); closePolishPop(); apply(v); });
    body.appendChild(b);
  });
}
