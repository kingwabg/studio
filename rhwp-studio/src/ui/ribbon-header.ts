/**
 * 리본 헤더 (디자인 "rhwp 헤더·리본 재설계" 2a — 2행 88px)
 *
 * 기존 3단(메뉴바 + 아이콘 툴바 + 서식바)을 2행으로 합친다.
 *  1행 44px: 브랜드 · 파일 메뉴 · 작업 흐름 탭(홈·삽입·레이아웃·검토) · 문서 제목 · 테마
 *  2행 44px: 활성 탭의 리본 (Phosphor 아이콘 30px, 라벨은 툴팁)
 *
 * 설계 원칙
 * - 한컴 스프라이트(920KB SVG 2장) → Phosphor 아이콘 폰트(로컬 벤더링, currentColor)
 * - 모든 버튼은 기존 `data-cmd` 를 그대로 쓴다 — 명령 체계·단축키는 손대지 않는다
 * - 리본에 자리가 없는 항목은 「⋯」 패널로, 상세 서식은 「자세히」로 내린다
 * - 표 조작은 헤더 컨텍스트 탭이 아니라 우측 속성 패널로 (디자인 2c, 후속)
 */

export type RibbonItem =
  | { kind: 'btn'; icon: string; label: string; cmd?: string; primary?: boolean }
  | { kind: 'gap' }
  | { kind: 'combo'; label: string; width: number; cmd?: string }
  /** 기존 Toolbar 가 소유한 실제 컨트롤(#font-name 등)을 이 자리로 옮겨 담는다 */
  | { kind: 'slot'; slot: string; width: number }
  | { kind: 'expander'; label: string; cmd?: string }
  | { kind: 'over'; icon: string; label: string; key?: string; cmd?: string };

const P = (icon: string, label: string, cmd?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd });
const PP = (icon: string, label: string, cmd?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd, primary: true });
const gap = (): RibbonItem => ({ kind: 'gap' });
const combo = (label: string, width: number, cmd?: string): RibbonItem =>
  ({ kind: 'combo', label, width, cmd });
const slot = (name: string, width: number): RibbonItem => ({ kind: 'slot', slot: name, width });
const O = (icon: string, label: string, key?: string, cmd?: string): RibbonItem =>
  ({ kind: 'over', icon, label, key, cmd });

export const RIBBON_TABS: Array<{ id: string; label: string; items: RibbonItem[] }> = [
  {
    id: 'home',
    label: '홈',
    // 홈 = 편집 + 서식 필수를 한 줄에 (탭 전환 없이 "쓰기 → 꾸미기")
    items: [
      // 되돌리기·잘라내기 묶음은 '편집' 탭으로 옮겼다(2026-07-30) — 홈은 서식에 전념한다.
      // 글꼴·크기는 Toolbar 가 소유한 실제 컨트롤을 옮겨 온다(상태 동기·이벤트 유지)
      slot('font-name', 132),
      slot('font-size', 68),
      gap(),
      P('text-b', '굵게', 'format:bold'),
      P('text-italic', '기울임', 'format:italic'),
      P('text-underline', '밑줄', 'format:underline'),
      // 디자인 2a 홈 리본은 글자 색·형광펜을 여기 둔다. 전용 색 명령이 없어(패널의
      // 스와치는 format-char 이벤트를 직접 쏜다) 색 설정이 있는 글자 모양으로 보낸다.
      P('palette', '글자 색', 'format:char-shape'),
      P('highlighter', '형광펜', 'format:char-shape'),
      gap(),
      P('text-align-left', '왼쪽 정렬', 'format:align-left'),
      P('text-align-center', '가운데 정렬', 'format:align-center'),
      P('text-align-justify', '양쪽 정렬', 'format:align-justify'),
      P('arrows-vertical', '줄 간격', 'format:line-spacing'),
      gap(),
      P('list-numbers', '문단 번호', 'format:toggle-numbering'),
      P('list-bullets', '글머리표', 'format:toggle-bullet'),
      P('text-indent', '한 수준 증가', 'format:level-increase'),
      P('text-outdent', '한 수준 감소', 'format:level-decrease'),
      gap(),
      { kind: 'expander', label: '자세히', cmd: 'format:char-shape' },
      O('text-align-right', '오른쪽 정렬', 'Alt+Shift+H', 'format:align-right'),
      O('paragraph', '문단 모양', '', 'format:para-shape'),
      O('text-aa', '글자 모양', '', 'format:char-shape'),
      O('text-strikethrough', '취소선', '', 'format:strikethrough'),
    ],
  },
  {
    id: 'edit',
    label: '편집',
    // 되돌리기·오려두기 묶음의 집. 찾기 계열도 여기로 모아 홈·검토와 겹치지 않게 한다
    // (헤더 재설계의 '같은 명령이 세 곳에 중복되지 않는다' 규칙).
    items: [
      PP('arrow-counter-clockwise', '되돌리기', 'edit:undo'),
      PP('arrow-clockwise', '다시 실행', 'edit:redo'),
      gap(),
      P('scissors', '오려 두기', 'edit:cut'),
      P('copy', '복사', 'edit:copy'),
      P('clipboard-text', '붙이기', 'edit:paste'),
      gap(),
      P('paint-brush', '모양 복사', 'edit:format-copy'),
      P('paint-bucket', '모양 붙여넣기', 'edit:format-paste'),
      gap(),
      P('selection-all', '모두 선택', 'edit:select-all'),
      P('eraser', '지우기', 'edit:delete'),
      gap(),
      P('magnifying-glass', '찾기', 'edit:find'),
      P('text-t', '찾아 바꾸기', 'edit:find-replace'),
      P('crosshair', '찾아가기', 'edit:goto'),
      O('arrow-counter-clockwise', '다시 찾기', 'Ctrl+L', 'edit:find-again'),
    ],
  },
  {
    id: 'insert',
    label: '삽입',
    items: [
      PP('table', '표', 'table:create'),
      PP('image', '그림', 'insert:image'),
      PP('shapes', '도형', 'insert:shape'),
      P('text-t', '글상자', 'insert:textbox'),
      gap(),
      P('math-operations', '수식', 'insert:equation'),
      P('asterisk', '문자표', 'insert:symbols'),
      P('brackets-curly', '필드 입력', 'insert:field'),
      gap(),
      P('link-simple', '하이퍼링크', 'insert:hyperlink'),
      P('bookmark-simple', '책갈피', 'insert:bookmark'),
      gap(),
      P('note', '각주', 'insert:footnote'),
      P('notebook', '미주', 'insert:endnote'),
      gap(),
      P('list-dashes', '차례 만들기', 'insert:toc'),
      P('text-align-left', '상용구', 'insert:snippet'),
      gap(),
      P('sliders-horizontal', '개체 속성', 'insert:picture-props'),
      O('subtitles', '캡션 넣기', 'Ctrl+N,C', 'insert:caption-toggle'),
      O('arrow-clockwise', '오른쪽 90° 회전', '', 'insert:rotate-cw'),
      O('flip-horizontal', '좌우 대칭', '', 'insert:flip-horz'),
      O('flip-vertical', '상하 대칭', '', 'insert:flip-vert'),
      O('trash', '개체 지우기', 'Delete', 'insert:picture-delete'),
    ],
  },
  {
    id: 'layout',
    label: '레이아웃',
    items: [
      PP('article', '편집 용지', 'file:page-setup'),
      P('selection', '쪽 테두리/배경', 'page:page-border'),
      gap(),
      PP('arrow-line-up', '머리말', 'page:header-create'),
      PP('arrow-line-down', '꼬리말', 'page:footer-create'),
      P('hash', '쪽 번호', 'page:insert-field-pagenum'),
      P('number-square-one', '새 번호로 시작', 'page:new-page-num'),
      gap(),
      P('rows', '쪽 나누기', 'page:break'),
      P('columns', '단 나누기', 'page:column-break'),
      P('columns-plus-right', '단 설정', 'page:col-settings'),
      gap(),
      P('grid-four', '격자 보기', 'view:toggle-grid'),
      P('grid-nine', '격자 설정', 'view:grid-settings'),
      gap(),
      P('rectangle-dashed', '구역 설정', 'page:section-settings'),
      P('stack-simple', '바탕쪽', 'page:masterpage'),
      P('printer', '인쇄', 'file:print'),
      O('eye-slash', '현재 쪽만 감추기', '', 'page:hide-current'),
      O('crop', '잘림 보기', '', 'view:toggle-clip'),
    ],
  },
  {
    id: 'review',
    label: '검토',
    items: [
      PP('git-diff', '문서 비교', 'edit:compare-documents'),
      PP('clock-counter-clockwise', '이력 관리', 'edit:document-history'),
      gap(),
      P('spell-check', '맞춤법 검사', 'edit:spellcheck'),
      gap(),
      P('brackets-angle', '조판 부호', 'view:ctrl-mark'),
      P('arrow-elbow-down-left', '문단 부호', 'view:para-mark'),
      gap(),
      P('magnifying-glass-plus', '확대', 'view:zoom-in'),
      P('magnifying-glass-minus', '축소', 'view:zoom-out'),
      gap(),
      PP('gear-six', '환경 설정', 'tool:options'),
      O('info', '제품 정보', '', 'file:about'),
    ],
  },
];

/** 아이콘 굵기 — 디자인 2b (기본값 듀오톤) */
export type IconWeight = 'duotone' | 'regular' | 'fill' | 'bold';
const WEIGHT_CLASS: Record<IconWeight, string> = {
  duotone: 'ph-duotone',
  regular: 'ph',
  fill: 'ph-fill',
  bold: 'ph-bold',
};

export class RibbonHeader {
  private root: HTMLElement;
  private tabRow!: HTMLDivElement;
  private ribbonRow!: HTMLDivElement;
  private titleEl!: HTMLSpanElement;
  private statusEl!: HTMLSpanElement;
  private activeTab = 'home';
  private weight: IconWeight = 'duotone';
  private overflowPanel: HTMLDivElement | null = null;
  private themeBtn!: HTMLButtonElement;
  /** 현재 테마 모드 — system → light → dark 순환 */
  private themeMode: 'system' | 'light' | 'dark' = 'system';
  /** 테마 명령 실행 위임 (main.ts 가 디스패처를 물려준다) */
  onCommand: ((cmd: string) => void) | null = null;
  /** 슬롯 이름 → 옮겨 담을 실제 DOM (탭 전환마다 다시 꽂는다) */
  private adopted = new Map<string, HTMLElement>();
  /** 편집 모드 컨텍스트 리본(머리말/꼬리말·각주) — 켜지면 일반 리본을 덮는다 */
  private contextRow: HTMLDivElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  /** 부팅 시 저장된 테마 모드를 반영한다 */
  setThemeMode(mode: 'system' | 'light' | 'dark'): void {
    this.themeMode = mode;
    this.renderThemeButton();
  }

  private renderThemeButton(): void {
    const spec = {
      system: { icon: 'circle-half', title: '테마: 시스템 (클릭해 밝게)' },
      light: { icon: 'sun', title: '테마: 밝게 (클릭해 어둡게)' },
      dark: { icon: 'moon', title: '테마: 어둡게 (클릭해 시스템)' },
    }[this.themeMode];
    this.themeBtn.title = spec.title;
    this.themeBtn.innerHTML = '';
    this.themeBtn.appendChild(this.icon(spec.icon, 17));
  }

  private cycleTheme(): void {
    const next = { system: 'light', light: 'dark', dark: 'system' } as const;
    this.themeMode = next[this.themeMode];
    this.renderThemeButton();
    this.onCommand?.(`view:theme-${this.themeMode}`);
  }

  /**
   * 기존 컨트롤을 리본 슬롯으로 입양한다.
   * DOM 이동은 이벤트 리스너·객체 참조를 보존하므로 Toolbar 의 상태 동기가 그대로 산다.
   */
  adopt(slotName: string, el: HTMLElement): void {
    this.adopted.set(slotName, el);
    el.classList.add('rb-adopted');
    this.placeAdopted();
  }

  private placeAdopted(): void {
    for (const [name, el] of this.adopted) {
      const host = this.ribbonRow.querySelector<HTMLElement>(`.rb-slot[data-slot="${name}"]`);
      if (host && el.parentElement !== host) host.appendChild(el);
    }
  }

  /** 아이콘 굵기 변경 (디자인 2b Tweaks) */
  setIconWeight(w: IconWeight): void {
    this.weight = w;
    this.renderRibbon();
  }

  /** 문서 제목·저장 상태 표시 */
  setDocumentInfo(fileName: string, statusText: string): void {
    this.titleEl.textContent = fileName;
    this.statusEl.textContent = statusText;
  }

  private icon(name: string, size = 19): HTMLElement {
    const i = document.createElement('i');
    i.className = `${WEIGHT_CLASS[this.weight]} ph-${name}`;
    i.style.fontSize = `${size}px`;
    return i;
  }

  private build(): void {
    this.root.classList.add('ribbon-header');

    // ── 1행: 브랜드 · 파일 · 탭 · 문서 제목 ──
    this.tabRow = document.createElement('div');
    this.tabRow.className = 'rb-row rb-row-tabs';

    const brand = document.createElement('div');
    brand.className = 'rb-brand';
    brand.innerHTML = '<span class="rb-brand-main">rhwp</span><span class="rb-brand-sub">studio</span>';
    this.tabRow.appendChild(brand);

    // '파일' 은 기존 #menu-bar 드롭다운(절대배치로 1행에 겹침)이 담당한다 —
    // 항목이 많고 명령 배선(menu-bar.ts)이 촘촘해 그대로 재사용하는 편이 안전하다.
    const fileSlot = document.createElement('span');
    fileSlot.className = 'rb-file-slot';
    this.tabRow.appendChild(fileSlot);

    const tabs = document.createElement('div');
    tabs.className = 'rb-tabs';
    for (const t of RIBBON_TABS) {
      const b = document.createElement('button');
      b.className = 'rb-tab';
      b.type = 'button';
      b.dataset.rbTab = t.id;
      b.textContent = t.label;
      b.addEventListener('click', () => this.setActiveTab(t.id));
      tabs.appendChild(b);
    }
    this.tabRow.appendChild(tabs);

    // 캔버스/문서 모드 토글이 들어올 자리 (canva-sidebars.ts 가 채운다)
    const modeSlot = document.createElement('div');
    modeSlot.className = 'rb-mode-slot';
    this.tabRow.appendChild(modeSlot);

    const docInfo = document.createElement('div');
    docInfo.className = 'rb-doc';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'rb-doc-title';
    this.titleEl.textContent = '새 문서.hwp';
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'rb-doc-status';
    this.statusEl.textContent = '';
    docInfo.append(this.titleEl, this.statusEl);
    this.tabRow.appendChild(docInfo);

    // ── 우측 유틸 (구 헤더의 인쇄·도움·테마를 되살린다) ──
    // ⚠ 테마는 view:theme-{system|light|dark} 3개 명령이다. 'view:theme-toggle' 같은
    //   단일 명령은 없다(1차 배포에서 없는 명령을 붙여 다크모드가 죽었던 실수, 2026-07-29).
    const printBtn = document.createElement('button');
    printBtn.className = 'rb-icon-btn';
    printBtn.type = 'button';
    printBtn.title = '인쇄 (Ctrl+P)';
    printBtn.dataset.cmd = 'file:print';
    printBtn.appendChild(this.icon('printer', 17));
    this.tabRow.appendChild(printBtn);

    const helpBtn = document.createElement('button');
    helpBtn.className = 'rb-icon-btn';
    helpBtn.type = 'button';
    helpBtn.title = '제품 정보';
    helpBtn.dataset.cmd = 'file:about';
    helpBtn.appendChild(this.icon('question', 17));
    this.tabRow.appendChild(helpBtn);

    this.themeBtn = document.createElement('button');
    this.themeBtn.className = 'rb-icon-btn';
    this.themeBtn.type = 'button';
    this.tabRow.appendChild(this.themeBtn);
    this.renderThemeButton();
    this.themeBtn.addEventListener('click', () => this.cycleTheme());

    // ── 2행: 리본 ──
    this.ribbonRow = document.createElement('div');
    this.ribbonRow.className = 'rb-row rb-row-ribbon';

    this.root.append(this.tabRow, this.ribbonRow);
    this.setActiveTab('home');
  }

  /**
   * 컨텍스트 리본을 켠다 — 머리말/꼬리말·각주 편집처럼 "이 모드에서만 쓰는" 명령용.
   * 구 아이콘 툴바의 .tb-headerfooter-group / .tb-note-group 이 하던 일을 대신한다.
   * @param spec null 이면 끄고 일반 리본으로 돌아간다
   */
  setContext(spec: { label: string; icon: string; items: Array<{ icon: string; label: string; cmd: string }> } | null): void {
    this.contextRow?.remove();
    this.contextRow = null;
    if (!spec) { this.ribbonRow.style.display = ''; return; }

    const row = document.createElement('div');
    row.className = 'rb-row rb-row-ribbon rb-row-context';

    const badge = document.createElement('span');
    badge.className = 'rb-ctx-badge';
    badge.appendChild(this.icon(spec.icon, 16));
    const bl = document.createElement('span');
    bl.textContent = spec.label;
    badge.appendChild(bl);
    row.appendChild(badge);

    const sep = document.createElement('span');
    sep.className = 'rb-sep';
    row.appendChild(sep);

    for (const it of spec.items) {
      const b = document.createElement('button');
      b.className = 'rb-btn is-primary';
      b.type = 'button';
      b.title = it.label;
      b.dataset.cmd = it.cmd;
      b.appendChild(this.icon(it.icon));
      const l = document.createElement('span');
      l.className = 'rb-btn-label';
      l.textContent = it.label;
      b.appendChild(l);
      row.appendChild(b);
    }

    this.ribbonRow.style.display = 'none';
    this.root.appendChild(row);
    this.contextRow = row;
  }

  setActiveTab(id: string): void {
    this.activeTab = id;
    for (const b of Array.from(this.tabRow.querySelectorAll<HTMLElement>('.rb-tab'))) {
      b.classList.toggle('is-active', b.dataset.rbTab === id);
    }
    this.renderRibbon();
  }

  getActiveTab(): string { return this.activeTab; }

  private renderRibbon(): void {
    const tab = RIBBON_TABS.find((t) => t.id === this.activeTab) ?? RIBBON_TABS[0];
    this.ribbonRow.innerHTML = '';
    this.closeOverflow();

    const overItems = tab.items.filter((i): i is Extract<RibbonItem, { kind: 'over' }> => i.kind === 'over');

    for (const item of tab.items) {
      if (item.kind === 'over') continue;
      if (item.kind === 'gap') {
        const s = document.createElement('span');
        s.className = 'rb-sep';
        this.ribbonRow.appendChild(s);
        continue;
      }
      if (item.kind === 'combo') {
        const c = document.createElement('button');
        c.className = 'rb-combo';
        c.type = 'button';
        c.style.width = `${item.width}px`;
        if (item.cmd) c.dataset.cmd = item.cmd;
        c.innerHTML = `<span>${item.label}</span>`;
        c.appendChild(this.icon('caret-down', 12));
        this.ribbonRow.appendChild(c);
        continue;
      }
      if (item.kind === 'slot') {
        const host = document.createElement('span');
        host.className = 'rb-slot';
        host.dataset.slot = item.slot;
        host.style.width = `${item.width}px`;
        this.ribbonRow.appendChild(host);
        continue;
      }
      if (item.kind === 'expander') {
        const e = document.createElement('button');
        e.className = 'rb-expander';
        e.type = 'button';
        if (item.cmd) e.dataset.cmd = item.cmd;
        e.textContent = item.label;
        e.appendChild(this.icon('caret-right', 12));
        this.ribbonRow.appendChild(e);
        continue;
      }
      const b = document.createElement('button');
      b.className = item.primary ? 'rb-btn is-primary' : 'rb-btn';
      b.type = 'button';
      b.title = item.label;
      if (item.cmd) b.dataset.cmd = item.cmd;
      b.appendChild(this.icon(item.icon));
      if (item.primary) {
        const l = document.createElement('span');
        l.className = 'rb-btn-label';
        l.textContent = item.label;
        b.appendChild(l);
      }
      this.ribbonRow.appendChild(b);
    }

    if (overItems.length > 0) {
      const more = document.createElement('button');
      more.className = 'rb-more';
      more.type = 'button';
      more.title = '더 보기';
      more.appendChild(this.icon('dots-three', 17));
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleOverflow(more, overItems);
      });
      this.ribbonRow.appendChild(more);
    }

    this.placeAdopted();
  }

  private closeOverflow(): void {
    this.overflowPanel?.remove();
    this.overflowPanel = null;
  }

  private toggleOverflow(anchor: HTMLElement, items: Array<Extract<RibbonItem, { kind: 'over' }>>): void {
    if (this.overflowPanel) { this.closeOverflow(); return; }
    const panel = document.createElement('div');
    panel.className = 'rb-overflow';
    for (const it of items) {
      const row = document.createElement('button');
      row.className = 'rb-over-item';
      row.type = 'button';
      if (it.cmd) row.dataset.cmd = it.cmd;
      row.appendChild(this.icon(it.icon, 16));
      const label = document.createElement('span');
      label.className = 'rb-over-label';
      label.textContent = it.label;
      row.appendChild(label);
      if (it.key) {
        const key = document.createElement('span');
        key.className = 'rb-over-key';
        key.textContent = it.key;
        row.appendChild(key);
      }
      row.addEventListener('click', () => this.closeOverflow());
      panel.appendChild(row);
    }
    const r = anchor.getBoundingClientRect();
    panel.style.top = `${r.bottom + 4}px`;
    panel.style.left = `${Math.max(8, r.right - 260)}px`;
    document.body.appendChild(panel);
    this.overflowPanel = panel;
    const off = (ev: MouseEvent) => {
      if (!panel.contains(ev.target as Node)) { this.closeOverflow(); document.removeEventListener('mousedown', off, true); }
    };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
}
