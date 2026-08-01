/**
 * 템플릿 편집 모드 바 — 문서 위(에디터 영역 최상단)에 뜨는 슬림 배너.
 * 커스텀 템플릿 「수정」을 누르면 그 템플릿 내용을 새 문서로 열면서 이 바가 뜬다.
 * "지금 템플릿을 편집 중"이라는 표시 + 이름·저장(덮어쓰기)·삭제·닫기를 한자리에 둔다.
 * 상태·저장 로직은 호출자(인스펙터)가 콜백으로 넘긴다 — 여긴 바 UI만.
 */
import { mkEl, mkButton } from './canva-dom';

let barEl: HTMLElement | null = null;

export interface TemplateEditBarOpts {
  label: string;
  onSave: (name: string) => void;
  onDelete: () => void;
}

export function closeTemplateEditBar(): void {
  barEl?.remove();
  barEl = null;
}

export function openTemplateEditBar(opts: TemplateEditBarOpts): void {
  closeTemplateEditBar();
  // 레이아웃: #studio-root(세로) > 리본/메뉴 + #canva-workspace(가로: 에디터+패널).
  //   전폭 배너는 studio-root 안, canva-workspace 앞(리본과 작업영역 사이)에 넣는다.
  const workspace = document.getElementById('canva-workspace');
  const parent = workspace?.parentElement;
  if (!workspace || !parent) return;

  const bar = mkEl('div', 'tpl-edit-bar');
  bar.appendChild(mkEl('span', 'tpl-edit-mark', '✎ 템플릿 편집 중'));

  const input = mkEl('input', 'tpl-edit-name');
  input.type = 'text';
  input.value = opts.label;
  input.placeholder = '템플릿 이름';
  bar.appendChild(input);

  const spacer = mkEl('span', 'tpl-edit-spacer');
  bar.appendChild(spacer);

  const save = mkButton('tpl-edit-btn tpl-edit-save', { text: '저장' });
  save.addEventListener('click', () => opts.onSave(input.value.trim()));
  const del = mkButton('tpl-edit-btn tpl-edit-del', { text: '삭제' });
  del.addEventListener('click', () => opts.onDelete());
  const close = mkButton('tpl-edit-btn', { text: '닫기' });
  close.addEventListener('click', () => closeTemplateEditBar());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); opts.onSave(input.value.trim()); } });
  bar.append(save, del, close);

  parent.insertBefore(bar, workspace);
  barEl = bar;
  input.focus();
  input.select();
}
