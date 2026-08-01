/**
 * [캔버스 한컴 포크] 문단 템플릿 고르개 — 모달 그리드.
 * 인스펙터 「문단 템플릿…」 버튼이 연다. 카드를 누르면 onPick(template) 후 닫힌다.
 * 삽입 동작 자체는 호출자(인스펙터 applyTemplate)가 맡는다 — 여긴 고르기 UI만.
 */
import { ModalDialog } from './dialog';
import { mkEl, mkButton } from './canva-dom';

export interface DocTemplate {
  id: string;
  label: string;
  hint: string;
  body: string;
}

/**
 * 문단 템플릿 — 누르면 커서 자리에 서식된 시작 골격(제목+번호목록 등)을 통째로 넣는다.
 * body 는 ai-doc-insert 의 classifyLines 규칙대로 해석된다:
 *   첫 줄=제목(16pt 가운데), `1.`=대제목(13pt 굵게), `가.`=소제목(11pt 굵게), 그 외=본문(10pt).
 * 번호는 자동번호가 아니라 리터럴 텍스트 — numberingId/paraLevel 좌표 이슈를 피한다.
 */
export const DOC_TEMPLATES: DocTemplate[] = [
  { id: 'numlist', label: '제목 + 번호목록', hint: '제목 아래 굵은 번호 항목 3개',
    body: '제목을 입력하세요\n1. 첫 번째 항목\n2. 두 번째 항목\n3. 세 번째 항목' },
  { id: 'report', label: '제목 + 소제목 + 본문', hint: '제목·소제목·본문 한 줄',
    body: '문서 제목\n1. 개요\n여기에 본문 내용을 입력하세요.' },
  { id: 'minutes', label: '회의록', hint: '일시·참석자·안건·결정 사항',
    body: '회의록\n1. 일시·장소\n2. 참석자\n3. 안건\n4. 결정 사항' },
];

export class TemplatePickerModal extends ModalDialog {
  constructor(private opts: { onPick: (t: DocTemplate) => void }) {
    super('문단 템플릿', 460);
    this.titleIcon = 'layout';
  }

  protected createBody(): HTMLElement {
    const grid = mkEl('div', 'canva-tpl-grid');
    for (const t of DOC_TEMPLATES) {
      const card = mkButton('canva-style-card canva-tpl-pick', { title: t.hint });
      card.innerHTML = `<span class="canva-tpl-name">${t.label}</span>`
        + `<span class="canva-tpl-hint">${t.hint}</span>`;
      card.addEventListener('click', () => { this.opts.onPick(t); this.hide(); });
      grid.appendChild(card);
    }
    return grid;
  }

  protected onConfirm(): void {
    // 고르기는 카드 클릭으로 끝난다 — 확인 버튼은 그냥 닫기.
  }

  override show(): void {
    super.show();
    // 확인/취소 대신 「닫기」 하나로 (about-dialog 패턴).
    const footer = this.dialog.querySelector('.dialog-footer');
    if (footer) {
      footer.replaceChildren();
      const closeBtn = mkButton('dialog-btn dialog-btn-primary', { text: '닫기' });
      closeBtn.addEventListener('click', () => this.hide());
      footer.appendChild(closeBtn);
    }
  }
}
