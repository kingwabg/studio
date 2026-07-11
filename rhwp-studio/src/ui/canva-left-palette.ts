/**
 * [캔버스 한컴 포크] 좌측 캔바식 개체 삽입 팔레트.
 * 캔바처럼 큰 카드를 클릭 → 기존 rhwp 삽입 커맨드를 dispatch (엔진 로직 재발명 없음).
 *  글상자=insert:textbox · 표=table:create · 도형=insert:shape · 그림=insert:image
 * 삽입은 rhwp의 배치 모드(클릭/드래그로 위치 지정)로 이어져 "자유 배치" 감각을 유지한다.
 */
import type { CanvaServices } from './canva-services';

interface ObjPreset {
  cmd: string;
  label: string;
  icon: string; // 인라인 SVG path 내용
}

// 인라인 SVG (1.4px 스트로크, 이모지 금지 규칙 준수)
const ICONS: Record<string, string> = {
  textbox: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M8 9h8M8 13h5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  shape: '<circle cx="8" cy="9" r="4.2"/><rect x="12" y="12" width="8" height="7" rx="1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="9" r="1.7"/><path d="M4 18l5-5 3 3 3-4 5 6"/>',
};

const PRESETS: ObjPreset[] = [
  { cmd: 'insert:textbox', label: '글상자', icon: ICONS.textbox },
  { cmd: 'table:create', label: '표', icon: ICONS.table },
  { cmd: 'insert:shape', label: '도형', icon: ICONS.shape },
  { cmd: 'insert:image', label: '그림', icon: ICONS.image },
];

export class CanvaLeftPalette {
  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
  }

  private render(): void {
    const pane = document.createElement('div');
    pane.className = 'canva-pane';

    const label = document.createElement('div');
    label.className = 'canva-section-label';
    label.textContent = '개체 삽입';
    pane.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'canva-palette-grid';
    for (const p of PRESETS) {
      const card = document.createElement('button');
      card.className = 'canva-obj-card';
      card.type = 'button';
      card.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>` +
        `<span>${p.label}</span>`;
      // mousedown(preventDefault)로 편집 포커스/선택 보존 후 dispatch
      card.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.services.dispatcher.dispatch(p.cmd, { anchorEl: card });
      });
      grid.appendChild(card);
    }
    pane.appendChild(grid);

    const hint = document.createElement('div');
    hint.className = 'canva-hint';
    hint.textContent = '개체를 고르면 문서 위 원하는 자리를 클릭·드래그해 배치합니다.';
    pane.appendChild(hint);

    this.root.appendChild(pane);
  }
}
