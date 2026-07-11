/**
 * [캔버스 한컴 포크] 셀 내용 지우기 3지선다 대화상자 (한글 DEL 동작 재현)
 * "선택된 셀들을 지웁니다. 내용만 지우고 셀 모양은 남겨 둘까요? 예/아니오/취소"
 *  - 예:   내용만 지우기 (셀 모양 유지)          → 'content'
 *  - 아니오: 내용 + 셀 모양(배경) 지우기          → 'shape'
 *  - 취소: 아무것도 안 함                         → 'cancel'
 * ModalDialog는 2버튼 고정이라 이 케이스만 독립 구현(같은 CSS 클래스 재사용).
 */
import { buildDialogShell, mkDialogBtn } from './canva-dom';

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

    // 공용 뼈대(canva-dom) — 클래스·구조는 기존과 동일
    const { overlay, body, footer } = buildDialogShell('한글', '380px', () => finish('cancel'));
    body.style.cssText = 'padding:16px 20px;line-height:1.6;white-space:pre-line;';
    body.textContent = '선택된 셀들을 지웁니다.\n내용만 지우고 셀 모양은 남겨 둘까요?';

    const yesBtn = mkDialogBtn('예', true, () => finish('content'));
    footer.appendChild(yesBtn);
    footer.appendChild(mkDialogBtn('아니오', false, () => finish('shape')));
    footer.appendChild(mkDialogBtn('취소', false, () => finish('cancel')));

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
