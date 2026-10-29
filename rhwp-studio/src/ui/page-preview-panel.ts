import type { CanvaServices } from './canva-services';
import { PagePreviewDrag } from './page-preview-drag';
import { PagePreviewMenu } from './page-preview-menu';
import { normalizePageSelection } from '../core/page-selection';
import type { PageEditAction, PageMoveRange } from '../core/wasm-bridge';
import '../styles/page-preview-panel.css';

type Preview = { button: HTMLButtonElement; canvas: HTMLCanvasElement; state: HTMLElement; badge: HTMLElement; dirty: boolean };

/** [캔버스 한컴 포크] 쪽 탐색과 원본 객체를 보존하는 페이지 순서 이동. */
export class PagePreviewPanel {
  readonly element = document.createElement('aside');
  private list = document.createElement('div');
  private count = document.createElement('span');
  private status = document.createElement('div');
  private toolbar = document.createElement('div');
  private selectionCount = document.createElement('span');
  private selected = new Set<number>();
  private selectionMode = false;
  private selectionPinned = false;
  private anchor = 0;
  private rangeCache: PageMoveRange[] | null = null;
  private duplicateButton!: HTMLButtonElement;
  private importButton!: HTMLButtonElement;
  private resizeHandle!: HTMLDivElement;
  /** 접기 전 폭 — 펼 때 되돌린다 */
  private expandedWidth = 0;
  /** 다른 문서에서 쪽 가져오기 — 호출부(canva-sidebars)가 파일 선택을 담당한다. */
  onImport: (() => void) | null = null;
  private deleteButton!: HTMLButtonElement;
  private blankButton!: HTMLButtonElement;
  private upButton!: HTMLButtonElement;
  private downButton!: HTMLButtonElement;
  private menu = new PagePreviewMenu();
  private drag: PagePreviewDrag;
  private slots: Preview[] = [];
  private visible = new Set<number>();
  private observer: IntersectionObserver;
  private off: (() => void)[] = [];
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current = -1;
  private trace = new URLSearchParams(window.location.search).get('pagePreviewTrace') === '1';

  constructor(workspace: HTMLElement, private services: CanvaServices) {
    this.element.className = 'page-preview-panel';
    this.element.setAttribute('aria-label', '페이지 미리보기');
    const header = document.createElement('div'); header.className = 'page-preview-header';
    const title = document.createElement('strong'); title.textContent = '▧ 쪽 미리보기';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '‹';
    toggle.setAttribute('aria-label', '페이지 패널 접기'); toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('mousedown', e => e.preventDefault());
    toggle.addEventListener('click', () => {
      const collapsed = this.element.classList.toggle('is-collapsed');
      // [캔버스 한컴 포크] 폭 조절로 넣은 **인라인 width** 가 .is-collapsed(36px) 를 이겨
      // 접어도 넓은 채로 남았다(2026-10-29 신고). 접을 땐 인라인 폭을 지워 CSS 를 따르게 하고,
      // 펼 때 저장해 둔 폭을 되돌린다.
      if (collapsed) {
        const w = Math.round(this.element.getBoundingClientRect().width);
        if (w > 40) this.expandedWidth = w;
        this.element.style.width = '';
      } else if (this.expandedWidth) {
        this.element.style.width = `${this.expandedWidth}px`;
      }
      toggle.textContent = collapsed ? '›' : '‹';
      toggle.setAttribute('aria-label', collapsed ? '페이지 패널 펼치기' : '페이지 패널 접기');
      toggle.setAttribute('aria-expanded', String(!collapsed)); this.list.hidden = collapsed;
      this.menu.hide(); this.log('toggle', { collapsed });
    });
    header.append(title, this.count, toggle);

    // [캔버스 한컴 포크] P2-1(2026-10-29 사용자 지시): 왼쪽 패널 **폭 조절**.
    // 오른쪽 모서리를 끌어 150~420px 로 조절하고, 값은 localStorage 에 남긴다.
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'page-preview-resize';
    this.resizeHandle.setAttribute('role', 'separator');
    this.resizeHandle.setAttribute('aria-orientation', 'vertical');
    this.resizeHandle.setAttribute('aria-label', '쪽 미리보기 폭 조절');
    this.resizeHandle.title = '끌어서 폭 조절';
    this.element.appendChild(this.resizeHandle);
    this.installResize();
    this.list.className = 'page-preview-list'; this.list.setAttribute('aria-label', '문서 쪽 목록');
    this.list.addEventListener('contextmenu', e => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('.page-preview-item');
      if (!button) return;
      e.preventDefault(); e.stopPropagation(); this.openMenu(Number(button.dataset.page), e.clientX, e.clientY);
    });
    this.list.addEventListener('keydown', e => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      const button = (e.target as HTMLElement).closest<HTMLElement>('.page-preview-item');
      if (!button) return;
      e.preventDefault(); e.stopPropagation(); const box = button.getBoundingClientRect();
      this.openMenu(Number(button.dataset.page), box.left + 12, box.top + 28);
    });
    this.status.className = 'page-preview-status'; this.status.setAttribute('role', 'status');
    this.status.textContent = '드래그하여 순서 변경 · Alt+↑/↓';
    this.buildSelectionToolbar();
    this.element.append(header, this.toolbar, this.list, this.status); workspace.prepend(this.element);
    this.drag = new PagePreviewDrag(this.list, {
      ranges: () => this.ranges(),
      selected: page => {
        if (!this.selected.has(page)) this.setSelected(this.expanded([page]));
        this.selectionPinned = true;
        return [...this.selected];
      },
      announce: message => { this.status.textContent = message; },
      preview: this.trace ? data => this.log('drag-preview', data) : undefined,
      drop: (page, before, pages) => this.edit('move', pages ?? [page], before),
    });
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page);
        if (entry.isIntersecting) this.visible.add(page);
        else {
          this.visible.delete(page);
          const slot = this.slots[page];
          if (slot) { slot.canvas.width = 0; slot.canvas.height = 0; slot.dirty = true; slot.canvas.hidden = true; slot.state.hidden = false; }
        }
      }
      this.pump();
    }, { root: this.list, rootMargin: '120px' });
    const bus = services.eventBus;
    this.off.push(bus.on('current-page-changed', (page) => { this.syncCount(); this.select(Number(page)); }));
    this.off.push(bus.on('document-pages-loaded', () => this.reset()));
    for (const event of ['document-changed', 'document-view-changed']) this.off.push(bus.on(event, () => this.invalidate()));
    this.off.push(bus.on('document-page-invalidated', payload => this.invalidate((payload as { pageIndex?: number })?.pageIndex)));
    this.reset();
  }

  private reset(): void {
    this.menu.hide();
    this.drag.cancel();
    this.rangeCache = null; this.selectionPinned = false; this.selected.clear(); this.anchor = 0;
    this.observer.disconnect(); this.visible.clear();
    this.slots.forEach(s => { s.canvas.width = 0; s.canvas.height = 0; });
    this.list.replaceChildren(); this.slots = []; this.current = -1;
    this.syncCount(); this.select(0); this.log('document', { pages: this.slots.length });
  }

  private syncCount(): void {
    const total = this.services.wasm.pageCount;
    this.count.textContent = `${total}쪽`;
    while (this.slots.length > total) {
      const slot = this.slots.pop()!; this.observer.unobserve(slot.button); slot.button.remove();
      slot.canvas.width = 0; slot.canvas.height = 0; this.visible.delete(this.slots.length);
    }
    while (this.slots.length < total) {
      const page = this.slots.length, info = this.services.wasm.getPageInfo(page);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'page-preview-item';
      button.dataset.page = String(page); button.setAttribute('aria-label', `${page + 1}쪽으로 이동`);
      button.title = `${page + 1}쪽 · 드래그 또는 Alt+↑/↓로 순서 변경`;
      const paper = document.createElement('div'); paper.className = 'page-preview-paper'; paper.style.aspectRatio = `${info.width} / ${info.height}`;
      const canvas = document.createElement('canvas'); canvas.hidden = true; canvas.setAttribute('aria-hidden', 'true');
      const state = document.createElement('span'); state.className = 'page-preview-state'; state.textContent = '미리보기 준비 중';
      const heading = document.createElement('div'); heading.className = 'page-preview-item-heading';
      const label = document.createElement('span'); label.textContent = `${page + 1} 쪽`; label.className = 'page-preview-number';
      const badge = document.createElement('span'); badge.textContent = '현재 쪽'; badge.className = 'page-preview-current'; badge.hidden = page !== this.current;
      heading.append(label, badge); paper.append(canvas, state); button.append(heading, paper);
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', e => this.choose(page, e));
      const check = document.createElement('span'); check.className = 'page-preview-check'; check.setAttribute('aria-hidden', 'true');
      paper.append(check);
      this.list.append(button); this.slots.push({ button, canvas, state, badge, dirty: true }); this.observer.observe(button);
    }
    this.paintSelection();
  }

  private select(page: number): void {
    if (page < 0 || page >= this.slots.length || page === this.current) return;
    this.slots[this.current]?.button.removeAttribute('aria-current');
    if (this.slots[this.current]) this.slots[this.current].badge.hidden = true;
    this.current = page;
    if (!this.selectionPinned) { this.anchor = page; this.setSelected(this.expanded([page])); }
    const button = this.slots[page].button; button.setAttribute('aria-current', 'page');
    this.slots[page].badge.hidden = false;
    const box = button.getBoundingClientRect(), list = this.list.getBoundingClientRect();
    if (box.top < list.top || box.bottom > list.bottom) this.list.scrollTop += box.top - list.top;
    this.log('current', { page: page + 1, total: this.slots.length });
  }

  private invalidate(page?: number): void {
    this.menu.hide();
    this.drag.cancel();
    this.rangeCache = null; this.selectionPinned = false;
    this.setSelected(this.current >= 0 && this.current < this.slots.length ? [this.current] : []);
    this.status.textContent = '드래그하여 순서 변경 · Alt+↑/↓';
    if (this.timer) clearTimeout(this.timer);
    if (Number.isInteger(page) && this.slots[page!]) this.slots[page!].dirty = true;
    else this.slots.forEach(s => { s.dirty = true; });
    this.timer = setTimeout(() => { this.timer = undefined; this.syncCount(); this.pump(); }, 200);
  }

  private pump(): void {
    if (this.raf || this.list.hidden) return;
    const page = [...this.visible].find(p => this.slots[p]?.dirty);
    if (page === undefined) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const slot = this.slots[page];
      if (!slot || !this.visible.has(page) || this.list.hidden) { this.pump(); return; }
      const info = this.services.wasm.getPageInfo(page), started = performance.now();
      try {
        const scale = (slot.canvas.parentElement?.clientWidth || 166) * Math.min(window.devicePixelRatio || 1, 2) / info.width;
        this.services.wasm.renderPageToCanvas(page, slot.canvas, scale);
        slot.canvas.hidden = false; slot.state.hidden = true; slot.button.dataset.rendered = 'true';
        this.log('render', { page: page + 1, width: slot.canvas.width, height: slot.canvas.height, ms: Math.round(performance.now() - started) });
      } catch (error) {
        slot.state.textContent = '미리보기를 표시할 수 없습니다'; slot.state.hidden = false;
        console.warn('[page-preview]', { page: page + 1, error: String(error) });
      }
      slot.dirty = false; this.pump();
    });
  }

  private log(event: string, data: Record<string, unknown>): void {
    if (this.trace) console.info('[page-preview]', JSON.stringify({ event, ...data }));
  }

  private edit(action: PageEditAction, pages = [...this.selected], before?: number): void {
    this.menu.hide(false);
    try {
      const handler = this.services.getInputHandler();
      const result = handler?.editPages(action, pages, before);
      if (!result?.changed) return;
      this.rangeCache = null; this.syncCount(); this.selectionPinned = true;
      this.setSelected(result.newSelectedPages); this.anchor = result.newStartPage;
      const verb = action === 'move' ? '이동' : action === 'duplicate' ? '복제' : '삭제';
      this.status.textContent = action === 'insertBlank'
        ? `빈 쪽 ${result.newSelectedPages.length}개를 추가했습니다. 되돌리기로 복원할 수 있습니다.`
        : `${result.affectedPages.length}쪽을 ${verb}했습니다. 되돌리기로 복원할 수 있습니다.`;
      this.log('pages-edit', { beforeSlot: before, ...result });
      this.services.navigateToPage?.(result.newStartPage);
      handler?.focus();
    } catch (error) {
      this.status.textContent = String(error).replace(/^Error: /, '');
      this.log('pages-edit-blocked', { action, pages, beforeSlot: before, error: String(error) });
    }
  }

  private ranges(): PageMoveRange[] {
    return this.rangeCache ??= this.services.wasm.getPageMoveRanges().ranges;
  }
  private expanded(pages: number[]): number[] {
    try { return normalizePageSelection(pages, this.ranges()); }
    catch { return pages.filter(p => p >= 0 && p < this.services.wasm.pageCount); }
  }
  private setSelected(pages: number[]): void {
    this.selected = new Set(pages.filter(p => p >= 0 && p < this.services.wasm.pageCount));
    this.paintSelection();
  }
  private paintSelection(): void {
    this.element.classList.toggle('has-multi-selection', this.selectionMode || this.selected.size > 1);
    this.slots.forEach((slot, p) => {
      const selected = this.selected.has(p);
      slot.button.classList.toggle('is-selected', selected);
      slot.button.setAttribute('aria-pressed', String(selected));
      const check = slot.button.querySelector('.page-preview-check'); if (check) check.textContent = selected ? '✓' : '';
    });
    this.selectionCount.textContent = `선택된 쪽: ${this.selected.size}개`;
    if (this.duplicateButton) this.duplicateButton.disabled = this.selected.size === 0;
    if (this.deleteButton) this.deleteButton.disabled = this.selected.size === 0;
    if (this.blankButton) this.blankButton.disabled = this.selected.size === 0;
    if (this.upButton) this.upButton.disabled = !this.moveTarget('up');
    if (this.downButton) this.downButton.disabled = !this.moveTarget('down');
  }
  private moveTarget(direction: 'up' | 'down'): PageMoveRange | undefined {
    if (!this.selected.size) return;
    try {
      const pages = [...this.selected];
      return direction === 'up' ? this.ranges().filter(r => r.endPage < Math.min(...pages)).at(-1)
        : this.ranges().find(r => r.startPage > Math.max(...pages));
    } catch { return; }
  }
  private moveSelected(direction: 'up' | 'down'): void {
    const target = this.moveTarget(direction);
    if (target) this.edit('move', [...this.selected], direction === 'up' ? target.startPage : target.endPage + 1);
  }
  private openMenu(page: number, x: number, y: number): void {
    this.drag.cancel();
    if (!this.selected.has(page)) this.setSelected(this.expanded([page]));
    this.selectionPinned = true; this.anchor = page;
    const pages = [...this.selected];
    this.menu.show(x, y, [
      { label: '빈 페이지 추가', action: () => this.edit('insertBlank', pages) },
      { label: '선택 페이지 복제', action: () => this.edit('duplicate', pages) },
      { label: '선택 페이지 삭제', danger: true, action: () => this.edit('delete', pages) },
    ], this.slots[page].button);
    this.log('context-menu', { pages: pages.map(p => p + 1) });
  }
  private choose(page: number, event: MouseEvent): void {
    if (event.shiftKey) {
      this.selectionPinned = true;
      this.setSelected(this.expanded(Array.from({ length: Math.abs(page - this.anchor) + 1 }, (_, i) => Math.min(page, this.anchor) + i)));
    } else if (this.selectionMode || event.ctrlKey || event.metaKey) {
      const group = this.expanded([page]), selected = new Set(this.selected), remove = group.every(p => selected.has(p));
      group.forEach(p => remove ? selected.delete(p) : selected.add(p));
      this.selectionPinned = true; this.anchor = page; this.setSelected([...selected]);
    } else {
      this.selectionPinned = false; this.anchor = page; this.setSelected(this.expanded([page]));
      this.log('navigate', { page: page + 1 }); this.services.navigateToPage?.(page);
    }
    this.log('selection', { pages: [...this.selected].map(p => p + 1) });
  }
  private buildSelectionToolbar(): void {
    this.toolbar.className = 'page-preview-toolbar';
    const button = (text: string, label: string, action: () => void) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
      b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', action); return b;
    };
    const actions = document.createElement('div'); actions.className = 'page-preview-actions';
    const actionButton = (icon: string, text: string, label: string, action: () => void) => {
      const b = button('', label, action), symbol = document.createElement('span'), caption = document.createElement('span');
      symbol.className = 'page-preview-action-icon'; symbol.setAttribute('aria-hidden', 'true');
      symbol.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></svg>`;
      caption.textContent = text; b.append(symbol, caption); return b;
    };
    this.blankButton = actionButton('M14 3H5v18h14V8z M14 3v5h5 M8 14h8 M12 10v8', '새 쪽', '선택한 페이지 뒤에 빈 페이지 추가', () => this.edit('insertBlank'));
    this.duplicateButton = actionButton('M9 8h11v13H9z M15 8V3H4v13h5', '복제', '선택한 페이지 복제', () => this.edit('duplicate'));
    this.deleteButton = actionButton('M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', '삭제', '선택한 페이지 삭제', () => this.edit('delete')); this.deleteButton.className = 'is-danger';
    this.upButton = actionButton('M12 20V4 M6 10l6-6 6 6', '위로', '선택한 페이지 위로 이동', () => this.moveSelected('up'));
    this.downButton = actionButton('M12 4v16 M6 14l6 6 6-6', '아래로', '선택한 페이지 아래로 이동', () => this.moveSelected('down'));
    // [캔버스 한컴 포크] '불러오기' — 다른 문서의 쪽을 가져오는 진입점(P2 에서 연결).
    // 자리와 이벤트 훅만 P1 에서 만든다: 호출부가 onImport 를 지정하면 그쪽이 파일 선택창을 연다.
    this.importButton = actionButton('M12 3v12 M8 11l4 4 4-4 M4 17v3h16v-3', '불러오기', '다른 문서에서 쪽 가져오기', () => this.onImport?.());
    actions.append(this.blankButton, this.duplicateButton, this.deleteButton, this.upButton, this.downButton, this.importButton);
    const selection = document.createElement('div'); selection.className = 'page-preview-selection';
    const mode = button('선택', '여러 페이지 선택 모드', () => {
      this.selectionMode = !this.selectionMode; this.selectionPinned = this.selectionMode;
      mode.setAttribute('aria-pressed', String(this.selectionMode));
      if (!this.selectionMode) this.setSelected(this.expanded([Math.max(0, this.current)]));
      this.paintSelection();
    }); mode.setAttribute('aria-pressed', 'false');
    const all = button('전체', '모든 페이지 선택', () => {
      this.selectionPinned = true; this.setSelected(Array.from({ length: this.services.wasm.pageCount }, (_, p) => p));
      this.log('selection', { pages: [...this.selected].map(p => p + 1) });
    });
    const hint = document.createElement('small'); hint.textContent = 'Ctrl/⌘ · Shift 선택';
    selection.append(this.selectionCount, hint);
    const tools = document.createElement('div'); tools.className = 'page-preview-select-tools'; tools.append(mode, all);
    // (엔진 재빌드로 쪽 편집 API 가 들어왔으므로 비활성 잠금은 제거 — 2026-10-29)
    this.toolbar.append(actions, selection, tools);
  }

  /**
   * 패널 폭 조절 — 핸들을 끌어 150~420px. 값은 localStorage(`rhwpPagePanelWidth`)에 남긴다.
   * 범위를 두는 이유: 너무 좁으면 썸네일이 뭉개지고, 너무 넓으면 본문을 덮는다.
   */
  private installResize(): void {
    const KEY = 'rhwpPagePanelWidth';
    const MIN = 150, MAX = 420;
    const apply = (w: number): void => {
      this.element.style.width = `${Math.min(MAX, Math.max(MIN, Math.round(w)))}px`;
    };
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isFinite(saved) && saved >= MIN) apply(saved);
    } catch { /* ignore */ }

    let dragging = false;
    const onMove = (e: MouseEvent): void => {
      if (!dragging) return;
      const left = this.element.getBoundingClientRect().left;
      apply(e.clientX - left);
    };
    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.element.classList.remove('is-resizing');
      try { localStorage.setItem(KEY, String(Math.round(this.element.getBoundingClientRect().width))); } catch { /* ignore */ }
      this.log('resize', { width: Math.round(this.element.getBoundingClientRect().width) });
    };
    this.resizeHandle.addEventListener('mousedown', (e) => {
      if (this.element.classList.contains('is-collapsed')) return;
      e.preventDefault();
      dragging = true;
      this.element.classList.add('is-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });
  }

  dispose(): void {
    this.menu.dispose();
    this.drag.dispose();
    this.off.forEach(off => off()); this.observer.disconnect();
    cancelAnimationFrame(this.raf); clearTimeout(this.timer);
    this.slots.forEach(s => { s.canvas.width = 0; s.canvas.height = 0; }); this.element.remove();
  }
}
