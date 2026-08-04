/**
 * [문단 템플릿 2026-08-04] 독스식 플라이아웃 — 버튼 옆에 작은 미리보기 카드가 바로 떠서
 * 슥 보고 클릭으로 삽입한다(문서를 가리는 모달 없이). 저장·수정·삭제 등 관리는
 * 하단 「템플릿 관리…」로 기존 모달(TemplatePickerModal)에 넘긴다.
 */
import { mkEl, mkButton } from './canva-dom';
import { buildTemplatePreview, DOC_TEMPLATES, type DocTemplate } from './template-picker-modal';
import { listTemplates } from '@/media/template-store';

export interface TemplateFlyoutOpts {
  onPick: (t: DocTemplate) => void;
  onManage: () => void;
}

let current: HTMLDivElement | null = null;

function close(): void {
  current?.remove();
  current = null;
  document.removeEventListener('mousedown', onOutside, true);
}

function onOutside(e: MouseEvent): void {
  if (current && !current.contains(e.target as Node)) close();
}

export function showTemplateFlyout(anchorEl: HTMLElement, opts: TemplateFlyoutOpts): void {
  if (current) { close(); return; }

  const panel = mkEl('div', 'tpl-flyout') as HTMLDivElement;
  const grid = mkEl('div', 'tpl-fly-grid');
  panel.appendChild(grid);

  const addCard = (t: DocTemplate) => {
    const card = mkButton('tpl-fly-card', { title: t.hint });
    card.appendChild(buildTemplatePreview(t.body));
    card.appendChild(mkEl('span', 'tpl-fly-name', t.label));
    card.addEventListener('click', () => { close(); opts.onPick(t); });
    grid.appendChild(card);
  };
  DOC_TEMPLATES.forEach(addCard);

  const manage = mkButton('tpl-fly-manage', { text: '템플릿 관리…' });
  manage.addEventListener('click', () => { close(); opts.onManage(); });
  panel.appendChild(manage);

  // 인스펙터(오른쪽 패널) 버튼 기준 — 왼쪽으로 펼친다. 너비 확정 후 위치 재조정.
  const rect = anchorEl.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = `${Math.min(rect.top, window.innerHeight - 220)}px`;
  panel.style.left = '0px';
  panel.style.visibility = 'hidden';
  document.body.appendChild(panel);
  const w = panel.getBoundingClientRect().width;
  panel.style.left = `${Math.max(8, rect.left - w - 8)}px`;
  panel.style.visibility = '';
  current = panel;

  // 내 템플릿은 비동기 로드 후 뒤에 붙인다 — 늦게 떠도 기본 카드는 즉시 보인다.
  void listTemplates().then((customs) => {
    if (current !== panel) return;
    for (const c of customs) {
      addCard({ id: c.id, label: c.label, hint: `${c.body.split('\n').length}줄 · 내 템플릿`, body: c.body });
    }
    const w2 = panel.getBoundingClientRect().width;
    panel.style.left = `${Math.max(8, rect.left - w2 - 8)}px`;
  });

  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
