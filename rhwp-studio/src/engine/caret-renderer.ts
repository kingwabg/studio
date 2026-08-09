import type { CursorRect, SelectionRect } from '@/core/types';
import { VirtualScroll } from '@/view/virtual-scroll';

/** 하늘색 캐럿 — 공백/문단 시작은 세로 바, 글자 뒤는 그 글자 폭의 밑줄 (한컴 스타일). */
const CARET_COLOR = '#87CEEB';

/** Canvas 위에 깜박이는 캐럿을 렌더링한다 */
export class CaretRenderer {
  private caretEl: HTMLDivElement;
  private blinkTimer: number | null = null;
  private visible = false;
  private currentRect: CursorRect | null = null;
  /** 직전 글자의 화면 rect. null 이면 세로 캐럿 (문단 시작·공백·컨트롤 뒤·조회 실패). */
  private prevCharProbe: (() => SelectionRect | null) | null = null;

  // IME 조합 중 여부 — 조합 글자는 엔진이 문서에 넣어 캔버스가 직접 그린다.
  // 캐럿 렌더러는 그 아래 밑줄(가로선)만 담당한다. 종전엔 블랙박스+흰 글자
  // 오버레이로 캔버스 글자를 덮었는데, 줌/스크롤에서 어긋나면 글자가 두 개
  // 겹쳐 보였다(2026-08-10 사용자 신고 — 한컴 실측: 조합 글자 정상 표시 +
  // 글리프 폭 밑줄만 깜빡임).
  private isCompMode = false;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.caretEl = document.createElement('div');
    this.caretEl.className = 'caret';
    this.caretEl.style.cssText =
      `position:absolute;width:2px;background:${CARET_COLOR};pointer-events:none;z-index:10;display:none;`;

    // scroll-content 안에 배치 (스크롤과 함께 이동)
    const scrollContent = container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.caretEl);
    } else {
      container.appendChild(this.caretEl);
    }
  }

  /** 캐럿을 표시한다 */
  show(rect: CursorRect, zoom: number): void {
    this.ensureAttached();
    this.currentRect = rect;
    this.updatePosition(zoom);
    this.caretEl.style.display = 'block';
    this.startBlink();
  }

  /** 캐럿을 숨긴다 */
  hide(): void {
    this.stopBlink();
    this.caretEl.style.display = 'none';
    this.isCompMode = false;
    this.currentRect = null;
  }

  /** 직전 글자 rect 공급자를 배선한다 (input-handler 가 커서 위치·wasm 으로 계산). */
  setPrevCharProbe(probe: () => SelectionRect | null): void {
    this.prevCharProbe = probe;
  }

  /** 줌/스크롤 변경 시 위치를 갱신한다 */
  updatePosition(zoom: number): void {
    if (!this.currentRect) return;
    const { pageIndex } = this.currentRect;
    // [부팅 캐럿 2026-07-28] 용지 폭이 아직 없으면 화면 위치를 알 수 없다 — 이때 좌표를
    // 억지로 찍으면(옛 코드: contentWidth/2, 그 다음 판: 0) 캐럿이 용지 밖에서 깜빡인다.
    // 위치를 정하지 않고 기다렸다가 'page-layout-changed' 신호에 다시 그린다.
    if (!(this.virtualScroll.getPageWidth(pageIndex) > 0)) {
      this.caretEl.style.display = 'none';
      return;
    }
    // 조합 중엔 showComposition 이 조합 글자·밑줄 위치를 소유한다 — 여기서 덮지 않는다.
    if (this.isCompMode) return;
    this.caretEl.style.display = 'block';

    // 글자 뒤 캐럿 = 그 글자 폭의 밑줄 (한컴 스타일). 직전 글자 rect 를 그대로 쓰므로
    // 줄바꿈 직후에도 글자가 있는 줄에 정확히 붙는다. 실패·부재 시 세로 바.
    const prev = this.prevCharProbe?.() ?? null;
    if (prev && prev.width > 0 && this.virtualScroll.getPageWidth(prev.pageIndex) > 0) {
      const pageOffset = this.virtualScroll.getPageOffset(prev.pageIndex);
      const pageLeft = this.calcPageLeft(prev.pageIndex);
      // 밑줄 앵커는 rect 바닥 — 기준선 추정(y+0.8·h)은 50pt에서 글자를 12px 관통했다.
      // 실측(12pt·50pt 픽셀 계측): 한글 잉크 바닥 = 글자 rect 바닥 − 1px.
      this.caretEl.style.left = `${pageLeft + prev.x * zoom}px`;
      this.caretEl.style.top = `${pageOffset + (prev.y + prev.height) * zoom}px`;
      this.caretEl.style.width = `${Math.max(2, prev.width * zoom)}px`;
      this.caretEl.style.height = '2px';
      return;
    }

    const { x, y, height } = this.clampCaretRect(this.currentRect, zoom);
    const pageOffset = this.virtualScroll.getPageOffset(pageIndex);
    const pageLeft = this.calcPageLeft(pageIndex);

    this.caretEl.style.left = `${pageLeft + x * zoom}px`;
    this.caretEl.style.top = `${pageOffset + y * zoom}px`;
    this.caretEl.style.width = '2px';
    this.caretEl.style.height = `${height * zoom}px`;
  }

  /** 새 CursorRect로 갱신한다 (깜박임 리셋) */
  update(rect: CursorRect, zoom: number): void {
    this.ensureAttached();
    this.currentRect = rect;
    this.updatePosition(zoom);
    // 조합 모드가 아닐 때만 일반 캐럿 표시
    if (!this.isCompMode) {
      this.caretEl.style.display = 'block';
      this.caretEl.style.opacity = '1';
      this.visible = true;
      this.startBlink();
    }
  }

  /** 드래그 중 캐럿 위치를 갱신한다 (기존 깜박임 타이머 유지) */
  updateLive(rect: CursorRect, zoom: number): void {
    this.ensureAttached();
    this.currentRect = rect;
    this.updatePosition(zoom);
    if (!this.isCompMode) {
      this.caretEl.style.display = 'block';
      this.caretEl.style.opacity = '1';
      this.visible = true;
      if (this.blinkTimer === null) {
        this.startBlink();
      }
    }
  }

  /** IME 조합 밑줄 캐럿(가로선)을 표시한다 — 조합 글자 자체는 캔버스가 그린다. */
  showComposition(startRect: CursorRect, charWidth: number, zoom: number): void {
    this.ensureAttached();
    this.isCompMode = true;

    const { pageIndex } = startRect;
    const box = this.clampCompositionBox(startRect, charWidth);
    const pageOffset = this.virtualScroll.getPageOffset(pageIndex);
    const pageLeft = this.calcPageLeft(pageIndex);

    // 조합 글자 폭 가로선을 글자 상자 바닥 바로 아래에 — 깜빡임은 이 선만
    // (한컴 실측: 조합 글자는 고정 표시, 밑줄이 캐럿 주기로 깜빡인다).
    this.caretEl.style.left = `${pageLeft + box.x * zoom}px`;
    this.caretEl.style.top = `${pageOffset + (box.y + box.h) * zoom + 1}px`;
    this.caretEl.style.width = `${Math.max(2, box.w * zoom)}px`;
    this.caretEl.style.height = '2px';
    this.caretEl.style.display = 'block';
    this.visible = true;
    this.startBlink();
  }

  /** IME 조합 밑줄을 끝내고 일반 캐럿으로 복귀한다 */
  hideComposition(): void {
    this.isCompMode = false;
  }

  /** 셀 bbox가 있는 캐럿은 DOM 선 폭까지 셀 안에 남도록 보정한다. */
  private clampCaretRect(rect: CursorRect, zoom: number): { x: number; y: number; height: number } {
    const bounds = rect.cellBounds;
    if (!bounds) return rect;

    const caretWidth = 2 / Math.max(zoom, 0.01);
    const height = Math.min(rect.height, Math.max(0, bounds.h));
    const maxX = Math.max(bounds.x, bounds.x + bounds.w - caretWidth);
    const maxY = Math.max(bounds.y, bounds.y + bounds.h - height);
    return {
      x: Math.min(Math.max(rect.x, bounds.x), maxX),
      y: Math.min(Math.max(rect.y, bounds.y), maxY),
      height,
    };
  }

  /** 조합 밑줄은 Canvas clip을 받지 않으므로 셀 가시 bbox로 별도 제한한다. */
  private clampCompositionBox(
    rect: CursorRect,
    charWidth: number,
  ): { x: number; y: number; w: number; h: number } {
    let x = rect.x;
    let y = rect.y;
    let w = Math.max(charWidth, rect.height * 0.6);
    let h = rect.height;
    const bounds = rect.cellBounds;
    if (!bounds) return { x, y, w, h };

    w = Math.min(w, Math.max(0, bounds.w));
    h = Math.min(h, Math.max(0, bounds.h));
    const maxX = Math.max(bounds.x, bounds.x + bounds.w - w);
    const maxY = Math.max(bounds.y, bounds.y + bounds.h - h);
    x = Math.min(Math.max(x, bounds.x), maxX);
    y = Math.min(Math.max(y, bounds.y), maxY);
    return { x, y, w, h };
  }

  /** 페이지의 화면 X 좌표를 계산한다 (그리드/단일 열 공통) */
  private calcPageLeft(pageIndex: number): number {
    // [H4 2026-07-28] 중앙 정렬 계산은 VirtualScroll 한 곳 — 여기 사본이 따로 있어서
    // 폭 미확정 시 contentWidth/2 로 튀는 부팅 버그를 그대로 갖고 있었다(캐럿만 용지
    // 밖에서 깜빡임). getPageLeftResolved 가 폭 폴백까지 책임진다.
    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;
    return this.virtualScroll.getPageLeftResolved(pageIndex, contentWidth);
  }

  /** 캐럿 엘리먼트가 DOM에 없으면 재부착한다 (loadDocument 후 컨테이너 교체 대응) */
  private ensureAttached(): void {
    if (this.caretEl.parentElement) return;
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) scrollContent.appendChild(this.caretEl);
  }

  private startBlink(): void {
    this.stopBlink();
    this.visible = true;
    this.caretEl.style.opacity = '1';
    this.blinkTimer = window.setInterval(() => {
      this.visible = !this.visible;
      this.caretEl.style.opacity = this.visible ? '1' : '0';
    }, 500);
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  dispose(): void {
    this.stopBlink();
    this.caretEl.remove();
  }
}
