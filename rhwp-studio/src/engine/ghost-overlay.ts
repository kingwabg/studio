/**
 * 고스트 코멘트 오버레이 — 문서를 **전혀 건드리지 않는** 검토 메모.
 *
 * 한컴 메모(문서 IR 안 Control)와 다르다: 여기 메모는 캔버스 위 오버레이 DOM 이라
 * 문서 바이트에 안 들어가고, 인쇄/PDF(wasm SVG 를 새 창에 조립 — command/commands/file.ts)
 * 에도 구조상 안 나온다. "빨간 펜으로 적어두고 인쇄 전에 지우는" 왕복을 없애는 게 목적.
 *
 * 평소엔 본문 옆에 **작은 표식(점)** 만 두고, 마우스를 올릴 때만 내용을 펼친다 —
 * 본문을 가리지 않으면서 어디에 코멘트가 달렸는지는 보이게.
 *
 * 좌표는 다른 오버레이와 같은 정본을 쓴다 — getPageLeftResolved + getPageOffset + zoom
 * (memo-overlay.ts / caret-renderer.ts 와 동일 공식).
 */
import type { VirtualScroll } from '@/view/virtual-scroll';
import type { GhostComment } from '@/media/ghost-store';

const LAYER_CLASS = 'ghost-overlay-layer';

export interface GhostAnchorRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export class GhostOverlay {
  private layer: HTMLDivElement;
  private visible = true;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = LAYER_CLASS;
    // z-index: 캔버스 0 · 그리드 1~5 · 메모 8 · 캐럿 10 사이에서 7 (메모 아래, 격자 위)
    this.layer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:7;';
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.layer.style.display = on ? '' : 'none';
  }

  isVisible(): boolean { return this.visible; }

  clear(): void {
    this.layer.innerHTML = '';
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }

  private ensureAttached(): void {
    if (this.layer.parentElement) return;
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) scrollContent.appendChild(this.layer);
  }

  /**
   * 고스트 메모들을 다시 그린다.
   * @param rectOf 앵커의 페이지 좌표(없으면 그 메모는 건너뛴다 — 앵커를 잃은 메모)
   * @param onDelete 표식의 × 를 눌렀을 때
   */
  render(
    ghosts: GhostComment[],
    zoom: number,
    rectOf: (g: GhostComment) => GhostAnchorRect | null,
    onDelete: (id: string) => void,
  ): void {
    this.ensureAttached();
    this.clear();
    if (!this.visible || ghosts.length === 0) return;

    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = (scrollContent as HTMLElement | null)?.clientWidth ?? 0;

    for (const g of ghosts) {
      const rect = rectOf(g);
      if (!rect) continue;
      const pageLeft = this.virtualScroll.getPageLeftResolved(rect.pageIndex, contentWidth);
      const pageTop = this.virtualScroll.getPageOffset(rect.pageIndex);

      const dotSize = 12;
      const mark = document.createElement('div');
      mark.className = 'ghost-mark';
      mark.dataset.ghostId = g.id;
      // 표식은 **쪽 왼쪽 여백**에 둔다(그 줄 높이에 맞춰) — 앵커 글자 옆에 두면 본문을
      // 가린다(실측). 어느 줄에 달렸는지는 y 로 보이고, 내용은 hover 시 앵커 옆에 펼친다.
      // (Word/Docs 의 검토 표식 관례와 같다.)
      mark.style.cssText = [
        'position:absolute',
        `left:${pageLeft + 8}px`,
        `top:${pageTop + rect.y * zoom}px`,
        `width:${dotSize}px`,
        `height:${dotSize}px`,
        'border-radius:50%',
        'background:#7c5cff',
        'opacity:.75',
        'cursor:pointer',
        'pointer-events:auto',
        'box-shadow:0 0 0 2px rgba(255,255,255,.9)',
      ].join(';');
      mark.title = '고스트 코멘트 (인쇄·PDF 에는 안 나옵니다)';

      // 펼침 말풍선 — 기본 숨김, hover 시에만 표시(스펙: "마우스를 올릴 때만 보인다")
      const bubble = document.createElement('div');
      bubble.className = 'ghost-bubble';
      bubble.style.cssText = [
        'position:absolute',
        `left:${pageLeft + rect.x * zoom + 6}px`,
        `top:${pageTop + rect.y * zoom + 14}px`,
        'display:none',
        // 레이어(position:absolute, 폭 0)가 담는 블록이라 max-width 로는 shrink-to-fit 이
        // 최소폭(글자 1개)으로 무너진다(실측) — 고정 폭으로 못 박는다(memo-overlay 와 동일).
        'width:240px',
        'padding:8px 26px 8px 10px',
        'box-sizing:border-box',
        'background:#efeaff',
        'border:1px solid #b9a8ff',
        'border-radius:6px',
        'font-size:12px',
        'line-height:1.45',
        'white-space:pre-wrap',
        'color:#2b2350',
        'box-shadow:0 2px 8px rgba(60,40,140,.22)',
        'pointer-events:auto',
        'z-index:1',
      ].join(';');
      bubble.textContent = g.text;

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.title = '이 코멘트 지우기';
      del.style.cssText = [
        'position:absolute',
        'top:2px',
        'right:4px',
        'border:0',
        'background:transparent',
        'font-size:14px',
        'line-height:1',
        'cursor:pointer',
        'color:#6b5ea8',
      ].join(';');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(g.id);
      });
      bubble.appendChild(del);

      // hover 는 표식과 말풍선을 한 덩어리로 본다 — 말풍선으로 마우스를 옮겨도 안 닫히게
      let hideTimer: number | undefined;
      const show = (): void => {
        window.clearTimeout(hideTimer);
        bubble.style.display = '';
      };
      const hideSoon = (): void => {
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => { bubble.style.display = 'none'; }, 160);
      };
      mark.addEventListener('mouseenter', show);
      mark.addEventListener('mouseleave', hideSoon);
      bubble.addEventListener('mouseenter', show);
      bubble.addEventListener('mouseleave', hideSoon);

      this.layer.append(mark, bubble);
    }
  }
}
