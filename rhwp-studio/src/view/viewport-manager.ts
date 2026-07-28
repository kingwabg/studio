import { EventBus } from '@/core/event-bus';

export class ViewportManager {
  private scrollY = 0;
  private scrollX = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private zoom = 1.0;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onScrollBound: () => void;
  private onWheelBound: (e: WheelEvent) => void;

  constructor(private eventBus: EventBus) {
    this.onScrollBound = this.onScroll.bind(this);
    this.onWheelBound = this.onWheel.bind(this);
  }

  /** 스크롤 컨테이너에 연결한다 */
  attachTo(container: HTMLElement): void {
    this.detach();
    this.container = container;
    container.addEventListener('scroll', this.onScrollBound, { passive: true });
    container.addEventListener('wheel', this.onWheelBound, { passive: false });

    this.resizeObserver = new ResizeObserver(() => {
      this.updateViewportSize();
      this.eventBus.emit('viewport-resize', this.viewportWidth, this.viewportHeight);
    });
    this.resizeObserver.observe(container);
    // [부팅 점프 2026-07-28] 용지 중앙 정렬의 기준은 바깥 컨테이너가 아니라
    // #scroll-content 의 clientWidth 다 — 스크롤바가 사라지면 바깥 크기는 그대로인 채
    // 안쪽만 바뀐다(실측 820→834). 안쪽도 관찰해야 그때 캐럿이 용지를 따라간다.
    const content = container.querySelector('#scroll-content');
    if (content) this.resizeObserver.observe(content);
    this.updateViewportSize();
  }

  /** 연결을 해제한다 */
  detach(): void {
    if (this.container) {
      this.container.removeEventListener('scroll', this.onScrollBound);
      this.container.removeEventListener('wheel', this.onWheelBound);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container = null;
  }

  private onScroll(): void {
    if (!this.container) return;
    this.scrollY = this.container.scrollTop;
    this.scrollX = this.container.scrollLeft;
    this.eventBus.emit('viewport-scroll', this.scrollY, this.scrollX);
  }

  /** Ctrl+휠: 브라우저 줌 대신 문서 줌 */
  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    // deltaY < 0 → 확대, deltaY > 0 → 축소
    const step = 0.1;
    const direction = e.deltaY < 0 ? 1 : -1;
    this.setZoom(this.zoom + step * direction);
  }

  private updateViewportSize(): void {
    if (!this.container) return;
    this.viewportWidth = this.container.clientWidth;
    this.viewportHeight = this.container.clientHeight;
  }

  getScrollY(): number {
    return this.scrollY;
  }

  getScrollX(): number {
    return this.scrollX;
  }

  getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  getZoom(): number {
    return this.zoom;
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.25, Math.min(4.0, zoom));
    this.eventBus.emit('zoom-changed', this.zoom);
  }

  setScrollTop(y: number): void {
    if (this.container) {
      this.container.scrollTop = y;
      this.scrollY = this.container.scrollTop;
    }
  }
}
