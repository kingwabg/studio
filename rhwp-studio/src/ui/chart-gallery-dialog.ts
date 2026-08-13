/** [차트 갤러리 2026-08-13] 차트 종류를 그림으로 고르는 팔레트 — 한컴 '차트 만들기' 정합.
 *
 * 한컴은 차트 버튼을 누르면 종류를 **그림 격자**로 먼저 보여주고, 고르면 데이터를 채운다.
 * 같은 순서로: 이 대화상자에서 종류를 고르면 `onPick` 으로 스타일 id 를 넘기고, 호출자가
 * 데이터 대화상자를 연다.
 *
 * 썸네일은 인라인 SVG 로 그린다 — 이미지 파일을 늘리지 않고, 한컴 팔레트와 같은 3색
 * (파랑·초록·회색) 도식으로 종류를 구분한다.
 */

import { ModalDialog } from './dialog';

/** 갤러리 한 칸 */
interface StyleItem {
  id: string;
  label: string;
  /** 썸네일 종류 — 그리기 함수 선택 */
  art:
    | 'column' | 'column-stacked' | 'column-100'
    | 'bar' | 'bar-stacked' | 'bar-100'
    | 'line' | 'line-marker' | 'line-stacked'
    | 'pie' | 'pie-exploded' | 'doughnut'
    | 'scatter' | 'scatter-line'
    | 'column-3d' | 'bar-3d' | 'pie-3d';
}

/** 그룹별 목록 — 엔진 CHART_STYLES 와 id 가 일치해야 한다(테스트로 고정) */
const GROUPS: Array<{ title: string; items: StyleItem[] }> = [
  {
    title: '세로 막대형',
    items: [
      { id: 'column', label: '묶은 세로 막대형', art: 'column' },
      { id: 'column-stacked', label: '누적 세로 막대형', art: 'column-stacked' },
      { id: 'column-100', label: '100% 기준 누적 세로 막대형', art: 'column-100' },
      { id: 'column-3d', label: '3차원 묶은 세로 막대형', art: 'column-3d' },
      { id: 'column-3d-stacked', label: '3차원 누적 세로 막대형', art: 'column-3d' },
    ],
  },
  {
    title: '가로 막대형',
    items: [
      { id: 'bar', label: '묶은 가로 막대형', art: 'bar' },
      { id: 'bar-stacked', label: '누적 가로 막대형', art: 'bar-stacked' },
      { id: 'bar-100', label: '100% 기준 누적 가로 막대형', art: 'bar-100' },
      { id: 'bar-3d', label: '3차원 묶은 가로 막대형', art: 'bar-3d' },
      { id: 'bar-3d-stacked', label: '3차원 누적 가로 막대형', art: 'bar-3d' },
    ],
  },
  {
    title: '꺾은선형',
    items: [
      { id: 'line', label: '꺾은선형', art: 'line' },
      { id: 'line-marker', label: '표식이 있는 꺾은선형', art: 'line-marker' },
      { id: 'line-stacked', label: '누적 꺾은선형', art: 'line-stacked' },
      { id: 'line-100', label: '100% 기준 누적 꺾은선형', art: 'line-stacked' },
      { id: 'line-marker-stacked', label: '표식이 있는 누적 꺾은선형', art: 'line-marker' },
    ],
  },
  {
    title: '원형',
    items: [
      { id: 'pie', label: '원형', art: 'pie' },
      { id: 'pie-exploded', label: '쪼개진 원형', art: 'pie-exploded' },
      { id: 'pie-3d', label: '3차원 원형', art: 'pie-3d' },
      { id: 'pie-of-pie', label: '원형 대 원형', art: 'doughnut' },
      { id: 'pie-of-bar', label: '원형 대 가로 막대형', art: 'doughnut' },
    ],
  },
  {
    title: '분산형',
    items: [
      { id: 'scatter', label: '표식만 있는 분산형', art: 'scatter' },
      { id: 'scatter-line', label: '직선이 있는 분산형', art: 'scatter-line' },
      { id: 'scatter-smooth', label: '곡선이 있는 분산형', art: 'scatter-line' },
    ],
  },
];

const BLUE = '#4472c4';
const GREEN = '#70ad47';
const GRAY = '#a5a5a5';

/** 썸네일 SVG — 한컴 팔레트와 같은 3색 도식 */
function thumbnail(art: StyleItem['art']): string {
  const axes = '<path d="M10 6 L10 46 L62 46" fill="none" stroke="#8c8c8c" stroke-width="1.5"/>';
  const r = (x: number, y: number, w: number, h: number, c: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  switch (art) {
    case 'column':
      return `${axes}${r(16, 18, 8, 28, BLUE)}${r(25, 26, 8, 20, GRAY)}${r(38, 30, 8, 16, BLUE)}${r(47, 22, 8, 24, GRAY)}`;
    case 'column-stacked':
      return `${axes}${r(18, 28, 10, 18, BLUE)}${r(18, 14, 10, 14, GRAY)}${r(18, 40, 10, 6, GREEN)}${r(40, 24, 10, 22, BLUE)}${r(40, 12, 10, 12, GRAY)}${r(40, 40, 10, 6, GREEN)}`;
    case 'column-100':
      return `${axes}${r(18, 24, 10, 22, BLUE)}${r(18, 8, 10, 16, GRAY)}${r(18, 40, 10, 6, GREEN)}${r(40, 20, 10, 26, BLUE)}${r(40, 8, 10, 12, GRAY)}${r(40, 40, 10, 6, GREEN)}`;
    case 'column-3d':
      return `${axes}<path d="M16 20 l4-4 h8 l-4 4 z" fill="${GRAY}"/>${r(16, 20, 8, 26, BLUE)}<path d="M38 28 l4-4 h8 l-4 4 z" fill="${GRAY}"/>${r(38, 28, 8, 18, GREEN)}`;
    case 'bar':
      return `${axes}${r(11, 12, 30, 7, BLUE)}${r(11, 22, 18, 7, GRAY)}${r(11, 32, 38, 7, BLUE)}`;
    case 'bar-stacked':
      return `${axes}${r(11, 13, 18, 8, BLUE)}${r(29, 13, 12, 8, GRAY)}${r(11, 26, 12, 8, BLUE)}${r(23, 26, 20, 8, GRAY)}${r(11, 37, 22, 8, GREEN)}`;
    case 'bar-100':
      return `${axes}${r(11, 13, 22, 8, BLUE)}${r(33, 13, 20, 8, GRAY)}${r(11, 26, 26, 8, BLUE)}${r(37, 26, 16, 8, GRAY)}${r(11, 37, 30, 8, GREEN)}${r(41, 37, 12, 8, GRAY)}`;
    case 'bar-3d':
      return `${axes}<path d="M11 12 l4-4 h30 l-4 4 z" fill="${GRAY}"/>${r(11, 12, 30, 8, BLUE)}<path d="M11 30 l4-4 h18 l-4 4 z" fill="${GRAY}"/>${r(11, 30, 18, 8, GREEN)}`;
    case 'line':
      return `${axes}<polyline points="14,36 26,22 38,30 54,14" fill="none" stroke="${BLUE}" stroke-width="2"/><polyline points="14,42 26,34 38,38 54,28" fill="none" stroke="${GREEN}" stroke-width="2"/>`;
    case 'line-marker':
      return `${axes}<polyline points="14,36 26,22 38,30 54,14" fill="none" stroke="${BLUE}" stroke-width="2"/>` +
        [[14, 36], [26, 22], [38, 30], [54, 14]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${BLUE}"/>`).join('');
    case 'line-stacked':
      return `${axes}<polyline points="14,40 26,32 38,36 54,24" fill="none" stroke="${GREEN}" stroke-width="2"/><polyline points="14,28 26,18 38,24 54,12" fill="none" stroke="${BLUE}" stroke-width="2"/>`;
    case 'pie':
      return `<circle cx="36" cy="26" r="18" fill="${GRAY}"/><path d="M36 26 L36 8 A18 18 0 0 1 52 32 Z" fill="${BLUE}"/><path d="M36 26 L52 32 A18 18 0 0 1 22 38 Z" fill="${GREEN}"/>`;
    case 'pie-exploded':
      return `<circle cx="34" cy="27" r="16" fill="${GRAY}"/><path d="M34 27 L34 11 A16 16 0 0 1 48 32 Z" fill="${BLUE}"/><path d="M40 32 L54 38 A16 16 0 0 1 26 44 Z" fill="${GREEN}" transform="translate(1,1)"/>`;
    case 'pie-3d':
      return `<ellipse cx="36" cy="30" rx="19" ry="13" fill="${GRAY}"/><path d="M36 30 L36 17 A19 13 0 0 1 53 34 Z" fill="${BLUE}"/><path d="M17 30 a19 13 0 0 0 38 0 v5 a19 13 0 0 1 -38 0 z" fill="#8f8f8f"/>`;
    case 'doughnut':
      return `<circle cx="36" cy="26" r="18" fill="${GRAY}"/><path d="M36 26 L36 8 A18 18 0 0 1 52 32 Z" fill="${BLUE}"/><path d="M36 26 L52 32 A18 18 0 0 1 22 38 Z" fill="${GREEN}"/><circle cx="36" cy="26" r="8" fill="#fff"/>`;
    case 'scatter':
      return `${axes}` + [[20, 34, BLUE], [30, 20, GREEN], [40, 30, BLUE], [50, 16, GREEN], [26, 40, BLUE], [46, 36, GREEN]]
        .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="${c}"/>`).join('');
    case 'scatter-line':
      return `${axes}<polyline points="18,38 30,24 42,30 54,16" fill="none" stroke="${BLUE}" stroke-width="1.5"/>` +
        [[18, 38], [30, 24], [42, 30], [54, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${GREEN}"/>`).join('');
    default:
      return axes;
  }
}

export class ChartGalleryDialog extends ModalDialog {
  private picked = 'column';
  /** 확인 시 고른 스타일 id */
  onPick: ((styleId: string) => void) | null = null;

  constructor(initial = 'column') {
    super('차트 만들기', 720, false);
    this.titleIcon = 'chart-bar';
    this.confirmLabel = '다음';
    this.picked = initial;
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'chart-gallery-body';

    for (const group of GROUPS) {
      const section = document.createElement('div');
      section.className = 'chart-gallery-group';

      const h = document.createElement('div');
      h.className = 'chart-gallery-group-title';
      h.textContent = group.title;
      section.appendChild(h);

      const grid = document.createElement('div');
      grid.className = 'chart-gallery-grid';
      for (const item of group.items) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'chart-gallery-cell';
        cell.dataset.style = item.id;
        cell.title = item.label;
        cell.setAttribute('aria-label', item.label);
        if (item.id === this.picked) cell.classList.add('selected');
        cell.innerHTML =
          `<svg viewBox="0 0 72 52" width="72" height="52" aria-hidden="true">${thumbnail(item.art)}</svg>`;
        cell.addEventListener('click', () => {
          for (const other of grid.parentElement!.parentElement!.querySelectorAll('.chart-gallery-cell')) {
            other.classList.remove('selected');
          }
          cell.classList.add('selected');
          this.picked = item.id;
          this.setSubject(item.label);
        });
        // 더블클릭 = 고르고 바로 다음
        cell.addEventListener('dblclick', () => {
          this.picked = item.id;
          this.onPick?.(this.picked);
          this.hide();
        });
        grid.appendChild(cell);
      }
      section.appendChild(grid);
      body.appendChild(section);
    }
    return body;
  }

  /** 타이틀 옆 선택 대상 표기 갱신(있으면) */
  private setSubject(label: string): void {
    const el = this.dialog?.querySelector('.dialog-subject');
    if (el) el.textContent = label;
  }

  protected onConfirm(): boolean {
    this.onPick?.(this.picked);
    return true;
  }
}

/** 테스트·다른 모듈이 쓰는 갤러리 목록(엔진 CHART_STYLES 와 일치해야 한다) */
export const GALLERY_STYLE_IDS: string[] = GROUPS.flatMap((g) => g.items.map((i) => i.id));
