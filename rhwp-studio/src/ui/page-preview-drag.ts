import type { PageMoveRange } from '../core/wasm-bridge';
import '../styles/page-preview-drag.css';

type Host = {
  ranges(): PageMoveRange[];
  selected?(source: number): number[];
  drop(page: number, before: number, pages?: number[]): void;
  announce(message: string): void;
  preview?(data: { x: number; y: number; pages: number[]; before?: number; transform: string; placeholder: boolean }): void;
};
type Box = { top: number; bottom: number; left: number; width: number; height: number };
type Drag = { pointer: number; source: number; x: number; y: number; active: boolean; ranges: PageMoveRange[]; pages: number[]; boxes: Box[]; scrollStart: number; offsetX: number; offsetY: number; before?: number };

// [캔버스 한컴 포크] 포인터 드래그로 입력기의 포커스를 유지하고 연결된 쪽을 함께 옮긴다.
export class PagePreviewDrag {
  private state: Drag | null = null;
  private raf = 0;
  private suppressClick = false;
  private ghost: HTMLElement | null = null;
  private gap: HTMLElement | null = null;
  private down = (e: PointerEvent) => this.start(e);
  private move = (e: PointerEvent) => this.update(e);
  private up = (e: PointerEvent) => this.finish(e);
  private cancelled = () => this.cancel();
  private scrolled = () => { if (this.state?.active) this.indicate(); };
  private key = (e: KeyboardEvent) => this.keyboard(e);
  private click = (e: MouseEvent) => {
    if (this.suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); this.suppressClick = false; }
  };

  constructor(private list: HTMLElement, private host: Host) {
    list.addEventListener('pointerdown', this.down);
    list.addEventListener('click', this.click, true);
    list.addEventListener('keydown', this.key);
  }

  private start(e: PointerEvent): void {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.page-preview-item');
    if (e.button !== 0 || !button) return;
    this.suppressClick = false; e.preventDefault();
    this.state = { pointer: e.pointerId, source: Number(button.dataset.page), x: e.clientX, y: e.clientY, active: false, ranges: [], pages: [], boxes: [], scrollStart: this.list.scrollTop, offsetX: 0, offsetY: 0 };
    document.addEventListener('pointermove', this.move);
    document.addEventListener('pointerup', this.up);
    document.addEventListener('pointercancel', this.cancelled);
    document.addEventListener('keydown', this.key);
    window.addEventListener('blur', this.cancelled);
    window.addEventListener('resize', this.cancelled);
    this.list.addEventListener('scroll', this.scrolled, { passive: true });
  }

  private update(e: PointerEvent): void {
    const state = this.state;
    if (!state || e.pointerId !== state.pointer) return;
    if (!state.active && Math.hypot(e.clientX - state.x, e.clientY - state.y) < 6) return;
    if (!state.active) {
      try {
        state.ranges = this.host.ranges();
        state.pages = this.selectedPages(state.source, state.ranges);
        if (!state.pages.length) throw new Error('이동할 쪽을 찾을 수 없습니다.');
      } catch (error) { this.host.announce(String(error)); this.cancel(); return; }
      const listBox = this.list.getBoundingClientRect();
      state.boxes = this.items().map(b => {
        const box = b.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left ?? listBox.left, width: box.width || listBox.width || 174, height: box.bottom - box.top };
      });
      state.scrollStart = this.list.scrollTop;
      const sourceBox = state.boxes[state.source];
      state.offsetX = state.x - sourceBox.left; state.offsetY = state.y - sourceBox.top;
      state.active = true;
      this.items().forEach((b, page) => b.classList.toggle('is-drag-source', state.pages.includes(page)));
      this.list.classList.add('is-reordering');
      this.lift(state);
      this.host.announce(`${this.label(state.pages)} 이동 중 · Esc로 취소`);
    }
    e.preventDefault(); state.x = e.clientX; state.y = e.clientY;
    this.indicate(); this.autoScroll();
  }

  private items(): HTMLElement[] { return Array.from(this.list.querySelectorAll<HTMLElement>('.page-preview-item')); }
  private selectedPages(source: number, ranges: PageMoveRange[]): number[] {
    const selected = this.host.selected?.(source) ?? [source];
    const requested = selected.includes(source) ? selected : [source];
    const pages = new Set<number>();
    for (const range of ranges) if (requested.some(p => p >= range.startPage && p <= range.endPage)) {
      for (let page = range.startPage; page <= range.endPage; page++) pages.add(page);
    }
    return [...pages].sort((a, b) => a - b);
  }
  private label(pages: number[]): string {
    if (pages.length === 1) return `${pages[0] + 1}쪽`;
    return pages.at(-1)! - pages[0] + 1 === pages.length ? `${pages[0] + 1}~${pages.at(-1)! + 1}쪽 함께` : `${pages.length}쪽 함께`;
  }
  private clearIndicator(): void {
    this.items().forEach(b => { b.classList.remove('drop-before', 'drop-after'); b.style.transform = ''; });
    if (this.gap) this.gap.hidden = true;
  }

  private lift(state: Drag): void {
    const ghost = document.createElement('div'); ghost.className = 'page-preview-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true'); ghost.style.width = `${state.boxes[state.source].width}px`;
    const source = this.items()[state.source].querySelector('canvas');
    if (source?.width && source.height) {
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      canvas.getContext('2d')?.drawImage(source, 0, 0); ghost.append(canvas);
    }
    const label = document.createElement('span'); label.textContent = this.label(state.pages); ghost.append(label);
    if (state.pages.length > 1) {
      const badge = document.createElement('strong'); badge.className = 'page-preview-drag-badge'; badge.textContent = `${state.pages.length}쪽`; ghost.append(badge);
    }
    document.body.append(ghost); this.ghost = ghost;
    const gap = document.createElement('div'); gap.className = 'page-preview-drop-space'; gap.setAttribute('aria-hidden', 'true'); gap.hidden = true;
    this.list.append(gap); this.gap = gap;
    this.paintGhost();
  }

  private paintGhost(): void {
    const state = this.state;
    if (!state?.active || !this.ghost) return;
    this.ghost.style.transformOrigin = `${state.offsetX}px ${state.offsetY}px`;
    this.ghost.style.transform = `translate3d(${Math.round(state.x - state.offsetX)}px, ${Math.round(state.y - state.offsetY)}px, 0) rotate(-2deg) scale(1.025)`;
    this.host.preview?.({ x: state.x, y: state.y, pages: state.pages, before: state.before, transform: this.ghost.style.transform, placeholder: !!this.gap && !this.gap.hidden });
  }

  private indicate(): void {
    const state = this.state;
    if (!state?.active) return;
    this.clearIndicator(); state.before = undefined;
    const rect = this.list.getBoundingClientRect();
    if (state.x < rect.left || state.x > rect.right || state.y < rect.top || state.y > rect.bottom) return;
    // 드래그 애니메이션이 hit 영역을 흔들지 않도록 원래 상자와 스크롤 변화량으로 판정한다.
    const scrollDelta = this.list.scrollTop - state.scrollStart;
    const page = state.boxes.findIndex(b => state.y >= b.top - scrollDelta && state.y <= b.bottom - scrollDelta);
    const group = state.ranges.find(r => page >= r.startPage && page <= r.endPage);
    if (!group) return;
    const box = state.boxes[page];
    const before = state.y < (box.top + box.bottom) / 2 - scrollDelta ? group.startPage : group.endPage + 1;
    const order = this.items().map((_, i) => i).filter(i => !state.pages.includes(i));
    const insert = order.filter(i => i < before).length;
    order.splice(insert, 0, ...state.pages);
    if (order.every((page, i) => page === i)) return;
    state.before = before;
    const items = this.items();
    if (before < items.length) items[before].classList.add('drop-before');
    else items.at(-1)?.classList.add('drop-after');
    const spacing = state.boxes.length > 1 ? state.boxes[1].top - state.boxes[0].bottom : 12;
    let top = state.boxes[0].top;
    let gapTop = top, gapHeight = 0;
    for (const page of order) {
      if (state.pages.includes(page)) { if (!gapHeight) gapTop = top; gapHeight += state.boxes[page].height + spacing; }
      else items[page].style.transform = `translateY(${Math.round(top - state.boxes[page].top)}px)`;
      top += state.boxes[page].height + spacing;
    }
    if (this.gap) {
      this.gap.hidden = false;
      this.gap.style.top = `${gapTop - rect.top + state.scrollStart}px`;
      this.gap.style.height = `${gapHeight - spacing}px`;
    }
  }

  private autoScroll(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const state = this.state;
      if (!state?.active) return;
      this.paintGhost();
      const box = this.list.getBoundingClientRect();
      const delta = state.x >= box.left && state.x <= box.right
        ? state.y < box.top + 32 ? -12 : state.y > box.bottom - 32 ? 12 : 0 : 0;
      if (!delta) return;
      const previous = this.list.scrollTop; this.list.scrollTop += delta;
      this.indicate();
      if (this.list.scrollTop !== previous) this.autoScroll();
    });
  }

  private finish(e: PointerEvent): void {
    const state = this.state;
    if (!state || e.pointerId !== state.pointer) return;
    if (state.active) { state.x = e.clientX; state.y = e.clientY; this.indicate(); }
    const before = state.before;
    this.cancel();
    if (state.active) {
      this.suppressClick = true;
      if (before !== undefined) this.commit(state.source, before, state.pages);
      else this.host.announce('쪽 이동을 취소했습니다.');
    }
  }

  private keyboard(e: KeyboardEvent): void {
    if (!this.state) this.suppressClick = false;
    if (e.key === 'Escape' && this.state) { e.preventDefault(); e.stopPropagation(); this.cancel(); this.host.announce('쪽 이동을 취소했습니다.'); return; }
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || this.state) return;
    const button = (e.target as HTMLElement).closest<HTMLElement>('.page-preview-item');
    if (!button || !this.list.contains(button)) return;
    e.preventDefault(); e.stopPropagation();
    try {
      const page = Number(button.dataset.page), ranges = this.host.ranges();
      const pages = this.selectedPages(page, ranges);
      const target = e.key === 'ArrowUp' ? ranges.filter(r => r.endPage < pages[0]).at(-1) : ranges.find(r => r.startPage > pages.at(-1)!);
      if (target) this.commit(page, e.key === 'ArrowUp' ? target.startPage : target.endPage + 1, pages);
    } catch (error) { this.host.announce(String(error)); }
  }

  private commit(source: number, before: number, pages: number[]): void {
    if (this.host.selected) this.host.drop(source, before, pages);
    else this.host.drop(source, before);
  }

  cancel(): void {
    this.state = null; cancelAnimationFrame(this.raf); this.raf = 0;
    this.ghost?.remove(); this.ghost = null; this.gap?.remove(); this.gap = null;
    this.clearIndicator(); this.items().forEach(b => b.classList.remove('is-drag-source')); this.list.classList.remove('is-reordering');
    document.removeEventListener('pointermove', this.move); document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.cancelled); document.removeEventListener('keydown', this.key); window.removeEventListener('blur', this.cancelled);
    window.removeEventListener('resize', this.cancelled); this.list.removeEventListener('scroll', this.scrolled);
  }

  dispose(): void {
    this.cancel(); this.list.removeEventListener('pointerdown', this.down); this.list.removeEventListener('click', this.click, true); this.list.removeEventListener('keydown', this.key);
  }
}
