/**
 * [캔버스 한컴 포크] 셀 내용 지우기 3지선다 대화상자 (한글 DEL 동작 재현)
 * "선택된 셀들을 지웁니다. 내용만 지우고 셀 모양은 남겨 둘까요? 예/아니오/취소"
 *  - 예:   내용만 지우기 (셀 모양 유지)          → 'content'
 *  - 아니오: 내용 + 셀 모양(배경) 지우기          → 'shape'
 *  - 취소: 아무것도 안 함                         → 'cancel'
 * ModalDialog는 2버튼 고정이라 이 케이스만 독립 구현(같은 CSS 클래스 재사용).
 */
export type CellClearChoice = 'content' | 'shape' | 'cancel';

export function showCellClearChoice(): Promise<CellClearChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CellClearChoice) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(v);
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-wrap';
    dialog.style.width = '380px';

    const titleBar = document.createElement('div');
    titleBar.className = 'dialog-title';
    titleBar.textContent = '한글';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialog-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => finish('cancel'));
    titleBar.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.style.cssText = 'padding:16px 20px;line-height:1.6;white-space:pre-line;';
    body.textContent = '선택된 셀들을 지웁니다.\n내용만 지우고 셀 모양은 남겨 둘까요?';

    const footer = document.createElement('div');
    footer.className = 'dialog-footer';
    const mk = (label: string, primary: boolean, val: CellClearChoice) => {
      const b = document.createElement('button');
      b.className = primary ? 'dialog-btn dialog-btn-primary' : 'dialog-btn';
      b.textContent = label;
      b.addEventListener('click', () => finish(val));
      return b;
    };
    const yesBtn = mk('예', true, 'content');
    footer.appendChild(yesBtn);
    footer.appendChild(mk('아니오', false, 'shape'));
    footer.appendChild(mk('취소', false, 'cancel'));

    dialog.appendChild(titleBar);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Escape') finish('cancel');
      else if (e.key === 'Enter') finish('content');
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    yesBtn.focus();
  });
}
