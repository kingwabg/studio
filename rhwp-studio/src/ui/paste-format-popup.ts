/**
 * 붙여넣기 서식 정수기 (Format Cleanser) 팝업.
 *
 * 외부(웹·엑셀 등) HTML을 붙여넣을 때 캐럿 아래 작은 카드를 띄워
 * "서식 유지" vs "순수 텍스트(현재 문단 서식에 맞춤)" 를 고르게 한다.
 *
 * showPasteFormatPopup(): Promise<'rich' | 'plain' | null>
 *   - 'rich'  : 서식 유지 (기존 pasteHtml 경로)
 *   - 'plain' : 순수 텍스트 (현재 문단 서식)
 *   - null    : 취소 (Esc / 바깥클릭)
 */

export function showPasteFormatPopup(): Promise<'rich' | 'plain' | null> {
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.style.cssText =
      'position:fixed;z-index:21000;background:#fff;border:1px solid #c0c0c0;' +
      'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2);padding:8px;' +
      'display:flex;gap:6px;font-size:12px;';

    const makeBtn = (label: string, primary: boolean): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;' +
        (primary
          ? 'border:1px solid #2b6cb0;background:#2b6cb0;color:#fff;'
          : 'border:1px solid #c0c0c0;background:#f5f5f5;color:#222;');
      return b;
    };

    const richBtn = makeBtn('서식 유지', true);
    const plainBtn = makeBtn('순수 텍스트', false);
    card.appendChild(richBtn);
    card.appendChild(plainBtn);

    let done = false;
    const finish = (result: 'rich' | 'plain' | null): void => {
      if (done) return;
      done = true;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      card.remove();
      resolve(result);
    };

    const onOutside = (e: MouseEvent): void => {
      if (!card.contains(e.target as Node)) finish(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    };

    richBtn.addEventListener('click', () => finish('rich'));
    plainBtn.addEventListener('click', () => finish('plain'));

    document.body.appendChild(card);

    // 캐럿 아래 배치 (뷰포트 클램프). 캐럿이 없으면 화면 중앙 상단.
    const caret = document.querySelector('.caret');
    const cr = caret?.getBoundingClientRect();
    const cw = card.offsetWidth || 180;
    const ch = card.offsetHeight || 40;
    let left = cr && cr.height ? cr.left : (window.innerWidth - cw) / 2;
    let top = cr && cr.height ? cr.bottom + 6 : 80;
    left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - ch - 8));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    richBtn.focus();
    // 바깥클릭 리스너는 현재 클릭 이벤트 종료 후 등록
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  });
}
