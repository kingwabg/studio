type PageMenuItem = { label: string; action: () => void; danger?: boolean; disabled?: boolean };

/** [캔버스 한컴 포크] 선택한 쪽의 작업을 실행하는 작은 컨텍스트 메뉴. */
export class PagePreviewMenu {
  private element: HTMLDivElement | null = null;
  private anchor: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private outside = (event: PointerEvent) => {
    if (this.element && !this.element.contains(event.target as Node)) this.hide(false);
  };
  private scroll = (event: Event) => {
    if (this.element && !this.element.contains(event.target as Node)) this.hide(false);
  };
  private dismiss = () => this.hide(false);
  private keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); this.hide(true); return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const enabled = this.buttons.filter(button => !button.disabled);
    if (!enabled.length) return;
    const current = enabled.findIndex(button => button === document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : current < 0 ? event.key === 'ArrowDown' ? 0 : enabled.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    this.focus(enabled[index]);
  };

  show(x: number, y: number, items: PageMenuItem[], anchor: HTMLElement): void {
    this.hide(false);
    if (!items.length) return;
    const menu = document.createElement('div');
    menu.className = 'page-preview-context-menu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '페이지 작업'); menu.tabIndex = -1;
    menu.style.position = 'fixed'; menu.style.boxSizing = 'border-box'; menu.style.left = '0px'; menu.style.top = '0px';
    menu.style.maxWidth = `${Math.max(0, window.innerWidth - 8)}px`;
    menu.style.maxHeight = `${Math.max(0, window.innerHeight - 8)}px`; menu.style.overflow = 'auto';
    menu.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('keydown', this.keydown);
    this.buttons = items.map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
      button.className = `page-preview-context-item${item.danger ? ' is-danger' : ''}`;
      button.setAttribute('role', 'menuitem'); button.textContent = item.label; button.disabled = !!item.disabled;
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.disabled || this.element !== menu) return;
        try { item.action(); } finally { if (this.element === menu) this.hide(false); }
      });
      menu.append(button); return button;
    });
    this.element = menu; this.anchor = anchor;
    document.body.append(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(Number.isFinite(x) ? x : 4, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(Number.isFinite(y) ? y : 4, window.innerHeight - box.height - 4))}px`;
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('scroll', this.scroll, true);
    window.addEventListener('resize', this.dismiss); window.addEventListener('blur', this.dismiss);
    const first = this.buttons.find(button => !button.disabled);
    if (first) this.focus(first); else menu.focus({ preventScroll: true });
  }

  private focus(button: HTMLButtonElement): void {
    this.buttons.forEach(item => { item.tabIndex = item === button ? 0 : -1; });
    button.focus({ preventScroll: true });
  }

  hide(restoreFocus = false): void {
    const menu = this.element, anchor = this.anchor;
    this.element = null; this.anchor = null; this.buttons = [];
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('scroll', this.scroll, true);
    window.removeEventListener('resize', this.dismiss); window.removeEventListener('blur', this.dismiss);
    menu?.removeEventListener('keydown', this.keydown); menu?.remove();
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  dispose(): void { this.hide(false); }
}
