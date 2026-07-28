/**
 * 메모 말풍선 오버레이 (한컴 [입력-메모] 표시 대응) — 읽기 전용 v1.
 *
 * 문서에 달린 메모를 **쪽 오른쪽 여백**에 말풍선으로 띄운다. 편집(삽입/수정)은 v2:
 * 메모 본문은 각주와 달리 Control 트리 밖(구역 스트림 꼬리)에 살아서 커서·되돌리기가
 * 전제하는 (구역, 문단, 컨트롤) 주소 체계가 성립하지 않는다(조사 2026-07-28).
 *
 * 좌표는 다른 오버레이와 같은 정본을 쓴다 — getPageLeftResolved + getPageOffset + zoom.
 */
import type { VirtualScroll } from '@/view/virtual-scroll';

export interface MemoItem {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  memoIndex: number;
  text: string;
}

const LAYER_CLASS = 'memo-overlay-layer';

export class MemoOverlay {
  private layer: HTMLDivElement;
  private visible = true;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = LAYER_CLASS;
    this.layer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:8;';
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
   * 메모들을 다시 그린다.
   * @param memos 엔진 getMemos() 결과
   * @param rectOf 메모 앵커의 페이지 좌표를 구하는 함수(없으면 문단 시작 기준)
   */
  render(
    memos: MemoItem[],
    zoom: number,
    rectOf: (m: MemoItem) => { pageIndex: number; x: number; y: number; height: number } | null,
  ): void {
    this.ensureAttached();
    this.clear();
    if (!this.visible || memos.length === 0) return;

    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = (scrollContent as HTMLElement | null)?.clientWidth ?? 0;

    // 같은 쪽에 메모가 여러 개면 세로로 겹치지 않게 아래로 민다
    const lastBottomByPage = new Map<number, number>();

    for (const m of memos) {
      const rect = rectOf(m);
      if (!rect) continue;
      const pageLeft = this.virtualScroll.getPageLeftResolved(rect.pageIndex, contentWidth);
      const pageTop = this.virtualScroll.getPageOffset(rect.pageIndex);
      const pageWidth = this.virtualScroll.getPageWidth(rect.pageIndex);

      const bubble = document.createElement('div');
      bubble.className = 'memo-bubble';
      bubble.dataset.memoIndex = String(m.memoIndex);
      bubble.textContent = m.text;
      const top = Math.max(
        pageTop + rect.y * zoom,
        lastBottomByPage.get(rect.pageIndex) ?? 0,
      );
      // 쪽 오른쪽 바깥 여백에 배치(용지 밖) — 한컴 메모 표시와 같은 자리
      bubble.style.cssText = [
        'position:absolute',
        `left:${pageLeft + pageWidth + 8}px`,
        `top:${top}px`,
        'width:180px',
        'padding:6px 8px',
        'box-sizing:border-box',
        'background:#fff7d6',
        'border:1px solid #e0c96a',
        'border-radius:4px',
        'font-size:12px',
        'line-height:1.4',
        'white-space:pre-wrap',
        'box-shadow:0 1px 3px rgba(0,0,0,.15)',
        'pointer-events:auto',
      ].join(';');
      this.layer.appendChild(bubble);

      // 다음 말풍선이 겹치지 않도록 실제 높이를 재서 기록
      lastBottomByPage.set(rect.pageIndex, top + bubble.offsetHeight + 6);
    }
  }
}
