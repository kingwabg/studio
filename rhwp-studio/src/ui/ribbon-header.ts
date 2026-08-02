/**
 * 리본 헤더 (디자인 "rhwp 헤더·리본 재설계" 2a — 2행 106px)
 *
 * 기존 3단(메뉴바 + 아이콘 툴바 + 서식바)을 2행으로 합친다.
 *  1행 44px: 브랜드 · 파일 메뉴 · 작업 흐름 탭(홈·편집·삽입·레이아웃·도구·검토) · 문서 제목 · 테마
 *  2행 62px: 활성 탭의 리본 — **모든 버튼에 아이콘 아래 이름**(50px 타일)
 *
 * 2행을 44 → 62px 로 키운 이유(디자인 2a): 아이콘만으로는 무슨 명령인지 배우는 데
 * 툴팁을 기다려야 했다. 이름을 붙이면 한 번에 읽힌다 — 한컴·워드가 라벨을 다는 이유다.
 * 자리가 모자라는 만큼은 「⋯ 편집」에서 탭별로 켜고 끈다(DEFAULT_OFF 가 초기값).
 *
 * 설계 원칙
 * - 한컴 스프라이트(920KB SVG 2장) → Phosphor 아이콘 폰트(로컬 벤더링, currentColor)
 * - 모든 버튼은 기존 `data-cmd` 를 그대로 쓴다 — 명령 체계·단축키는 손대지 않는다
 * - 리본에 자리가 없는 항목은 「⋯」 패널로, 상세 서식은 「자세히」로 내린다
 * - 표 조작은 헤더 컨텍스트 탭이 아니라 우측 속성 패널로 (디자인 2c, 후속)
 */

import {
  RIBBON_TABS, DEFAULT_OFF, loadHidden, saveHidden, type RibbonItem,
} from './ribbon-tabs';
import { createValueBox, type ValueBox } from './ribbon-valuebox';

export { RIBBON_TABS, type RibbonItem };

export type IconWeight = 'duotone' | 'regular' | 'fill' | 'bold';
const WEIGHT_CLASS: Record<IconWeight, string> = {
  duotone: 'ph-duotone',
  regular: 'ph',
  fill: 'ph-fill',
  bold: 'ph-bold',
};

export class RibbonHeader {
  /** 탭별로 리본에서 접어 둔 명령 라벨 */
  private hidden: Record<string, string[]> = loadHidden();

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
  onCommand: ((cmd: string, params?: Record<string, unknown>) => void) | null = null;
  /** 슬롯 이름 → 옮겨 담을 실제 DOM (탭 전환마다 다시 꽂는다) */
  private adopted = new Map<string, HTMLElement>();
  /** 편집 모드 컨텍스트 리본(머리말/꼬리말·각주) — 켜지면 일반 리본을 덮는다 */
  private contextRow: HTMLDivElement | null = null;
  /**
   * 지금 커서 자리에 **적용돼 있는** 서식의 명령 id 들 — 해당 리본 버튼을 켜 둔다.
   * 탭을 바꾸면 버튼이 다시 그려지므로, 상태를 여기 들고 있다가 렌더 끝에 다시 칠한다.
   */
  private activeCmds = new Set<string>();
  /** 값 상자들 — 커서 자리 값이 바뀌면 여기로 밀어 넣는다. 탭 재렌더마다 새로 만든다 */
  private valueBoxes = new Map<string, ValueBox>();
  /** 값 상자에 마지막으로 밀어 넣은 값 — 재렌더 후 복원용 */
  private valueState = new Map<string, number | undefined>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  /**
   * 커서 자리의 **글자 서식**을 리본에 반영한다 (굵게·기울임·밑줄·취소선).
   * 단위는 서식의 자연 단위 — 글자 서식은 선택 영역 또는 커서 앞 글자다
   * (input-handler 의 cursor-format-changed 가 그 값을 밀어 준다).
   */
  setCharState(props: Record<string, unknown>): void {
    const on = (cmd: string, v: unknown): void => {
      if (v) this.activeCmds.add(cmd);
      else this.activeCmds.delete(cmd);
    };
    on('format:bold', props.bold);
    on('format:italic', props.italic);
    on('format:underline', props.underline);
    on('format:strikethrough', props.strikethrough);
    // 크기 값 상자 — 저장 단위는 HWPUNIT(1pt=100)
    const fs = Number(props.fontSize ?? 0);
    this.setValueBox('font-size', fs > 0 ? fs / 100 : undefined);
    this.paintActive();
  }

  /** 값 상자에 지금 값을 밀어 넣는다(상자가 아직 안 그려졌어도 상태는 남는다) */
  private setValueBox(key: string, v: number | undefined): void {
    this.valueState.set(key, v);
    this.valueBoxes.get(key)?.setValue(v);
  }

  /**
   * 커서 **문단**의 서식을 리본에 반영한다 (정렬·문단 번호·글머리표·들여쓰기).
   * 문단 서식의 자연 단위는 커서가 있는 문단 하나다.
   */
  setParaState(props: Record<string, unknown>): void {
    // 정렬 — 넷 중 하나만 켜진다
    const align = (props.alignment as string) ?? 'justify';
    for (const [key, cmd] of Object.entries({
      left: 'format:align-left',
      center: 'format:align-center',
      right: 'format:align-right',
      justify: 'format:align-justify',
    })) {
      if (key === align) this.activeCmds.add(cmd);
      else this.activeCmds.delete(cmd);
    }
    // 문단 번호 / 글머리표 — headType 이 정본
    const head = (props.headType as string) ?? 'None';
    const num = head === 'Number' || head === 'Outline';
    if (num) this.activeCmds.add('format:toggle-numbering');
    else this.activeCmds.delete('format:toggle-numbering');
    if (head === 'Bullet') this.activeCmds.add('format:toggle-bullet');
    else this.activeCmds.delete('format:toggle-bullet');
    // 들여쓰기/내어쓰기 — 이 둘은 증감 명령이지만 "지금 들어가 있나"를 보여 준다
    // (사용자 요청 2026-08-03). 왼쪽 여백이 있으면 들여쓰기, 첫 줄이 음수면 내어쓰기.
    const marginLeft = Number(props.marginLeft ?? 0);
    const indent = Number(props.indent ?? 0);
    if (marginLeft > 0.5) this.activeCmds.add('format:indent-increase');
    else this.activeCmds.delete('format:indent-increase');
    if (indent < -0.5) this.activeCmds.add('format:indent-decrease');
    else this.activeCmds.delete('format:indent-decrease');
    // 값 상자 — 저장은 px, 보여 주는 건 pt (패널과 같은 관례)
    const toPt = (px: number): number => (px * 72) / 96;
    this.setValueBox('indent', Math.round(toPt(marginLeft) * 10) / 10);
    this.setValueBox('outdent', Math.round(toPt(Math.max(0, -indent)) * 10) / 10);
    const ls = props.lineSpacingType === 'Percent' && props.lineSpacing !== undefined
      ? Math.round(Number(props.lineSpacing))
      : undefined;
    this.setValueBox('line-spacing', ls);
    this.paintActive();
  }

  /** 활성 명령 집합을 지금 그려진 버튼들에 칠한다 — 렌더 뒤에도 다시 부른다 */
  private paintActive(): void {
    const btns = this.root.querySelectorAll<HTMLElement>('[data-cmd]');
    for (const b of btns) {
      const cmd = b.dataset.cmd;
      if (!cmd) continue;
      b.classList.toggle('is-active', this.activeCmds.has(cmd));
    }
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
      // prepend — 라벨이 붙은 자리에서는 컨트롤이 이름 **위**에 와야 한다
      if (host && el.parentElement !== host) host.prepend(el);
      // 입양 컨트롤 안의 Phosphor 아이콘도 리본과 같은 굵기를 따른다(2b Tweaks)
      for (const ic of Array.from(el.querySelectorAll<HTMLElement>('.rb-adopt-ic'))) {
        const glyph = Array.from(ic.classList).find((c) => c.startsWith('ph-') && c !== 'ph-duotone');
        ic.className = `${WEIGHT_CLASS[this.weight]} ${glyph ?? ''} rb-adopt-ic`;
      }
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

    const off = new Set(this.hidden[tab.id] ?? []);
    // 접어 둔 버튼은 「⋯ 편집」 목록으로 내려간다 — 사라지는 게 아니라 옮겨 간다.
    const overItems: Array<Extract<RibbonItem, { kind: 'over' }>> = [
      ...tab.items.filter((i): i is Extract<RibbonItem, { kind: 'over' }> => i.kind === 'over'),
      // 접어 둔 버튼은 「⋯」 목록에서 바로 실행할 수 있다. 칸(콤보·피커)은 실행할
      // 명령이 없어 목록에 올리지 않는다 — 켜야 쓸 수 있다는 걸 스위치가 말해 준다.
      ...tab.items.flatMap((i) => (i.kind === 'btn' && off.has(i.label)
        ? [{ kind: 'over', icon: i.icon, label: i.label, cmd: i.cmd } as Extract<RibbonItem, { kind: 'over' }>]
        : [])),
    ];

    for (const item of tab.items) {
      if (item.kind === 'over') continue;
      if (item.kind === 'btn' && off.has(item.label)) continue;
      // 칸(스타일·글꼴·크기·색)도 접을 수 있다 — 버튼만 되던 것을 넓혔다(2026-08-01)
      if (item.kind === 'slot' && item.label && off.has(item.label)) continue;
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
        host.className = item.label ? 'rb-slot has-label' : 'rb-slot';
        host.dataset.slot = item.slot;
        host.style.width = `${item.width}px`;
        if (item.label) {
          const l = document.createElement('span');
          l.className = 'rb-btn-label';
          l.textContent = item.label;
          host.appendChild(l);
        }
        this.ribbonRow.appendChild(host);
        continue;
      }
      if (item.kind === 'value') {
        // 값 상자 — 슬롯과 같은 테두리 칸에 담아 크기·줄 간격·들여쓰기가 한 모양이 된다.
        const host = document.createElement('span');
        host.className = 'rb-slot has-label';
        host.style.width = `${item.width}px`;
        const vb = createValueBox({
          // 아이콘 단추: cmd 가 있으면 한 번에 적용, 없으면 프리셋 목록을 연다.
          leadIcon: {
            svg: this.icon(item.icon, 15).outerHTML,
            title: item.hint ?? item.label,
            cmd: item.iconCmd,
            onClick: item.iconCmd
              ? () => this.onCommand?.(item.iconCmd!)
              : undefined,
          },
          unit: item.unit,
          presets: item.presets,
          step: item.step,
          min: item.min,
          max: item.max,
          decimals: item.decimals,
          title: item.hint ?? item.label,
          onCommit: (v) => this.onCommand?.(item.cmd, { value: v }),
        });
        host.appendChild(vb.el);
        const l = document.createElement('span');
        l.className = 'rb-slot-label';
        l.textContent = item.label;
        host.appendChild(l);
        this.ribbonRow.appendChild(host);
        this.valueBoxes.set(item.key, vb);
        vb.setValue(this.valueState.get(item.key));
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
      b.title = item.hint ?? item.label;
      if (item.cmd) b.dataset.cmd = item.cmd;
      b.appendChild(this.icon(item.icon, 20));
      // 라벨은 **모든 버튼**에 붙는다(디자인 2a). primary 는 이제 굵기 강조일 뿐이다.
      const l = document.createElement('span');
      l.className = 'rb-btn-label';
      l.textContent = item.label;
      b.appendChild(l);
      this.ribbonRow.appendChild(b);
    }

    // 「⋯ 편집」은 항상 있다 — 접어 둔 명령을 꺼내는 유일한 문이라 조건부로 숨기면
    // 되돌릴 길이 사라진다(옛 구현은 overItems 가 0이면 버튼 자체가 없었다).
    const more = document.createElement('button');
    more.className = 'rb-more';
    more.type = 'button';
    more.title = '이 탭에 보일 명령 고르기';
    more.appendChild(this.icon('dots-three', 20));
    const ml = document.createElement('span');
    ml.className = 'rb-btn-label';
    ml.textContent = '편집';
    more.appendChild(ml);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleEditPanel(more, tab, overItems);
    });
    this.ribbonRow.appendChild(more);

    this.placeAdopted();
    // 버튼을 새로 그렸으니 지금 커서 자리의 서식 상태를 다시 칠한다 — 안 그러면 탭을
    // 바꿀 때마다 켜져 있던 굵게·정렬 표시가 꺼진 채로 남는다.
    this.paintActive();
  }

  private closeOverflow(): void {
    this.overflowPanel?.remove();
    this.overflowPanel = null;
  }

  /**
   * 「⋯ 편집」 패널 — 위쪽은 접어 둔 명령(눌러서 바로 실행), 아래쪽은 이 탭의 모든
   * 버튼을 켜고 끄는 목록. 디자인 2a 의 "이 탭에 보일 명령 · N개 · 기본값".
   */
  private toggleEditPanel(
    anchor: HTMLElement,
    tab: { id: string; label: string; items: RibbonItem[] },
    overItems: Array<Extract<RibbonItem, { kind: 'over' }>>,
  ): void {
    if (this.overflowPanel) { this.closeOverflow(); return; }
    const off = new Set(this.hidden[tab.id] ?? []);
    // 켜고 끌 수 있는 것 = 이름을 가진 버튼과 칸 전부(순서는 리본에 놓인 순서 그대로)
    const all: Array<{ icon: string; label: string }> = tab.items.flatMap((i) => {
      if (i.kind === 'btn') return [{ icon: i.icon, label: i.label }];
      if (i.kind === 'slot' && i.label) return [{ icon: i.icon ?? 'square', label: i.label }];
      return [];
    });

    const panel = document.createElement('div');
    panel.className = 'rb-overflow rb-editpanel';

    // 위: 접어 둔 명령 — 목록에서 바로 실행할 수 있어야 '접기'가 감추기가 아니게 된다
    if (overItems.length > 0) {
      for (const it of overItems) {
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
    }

    // 아래: 켜고 끄기
    const head = document.createElement('div');
    head.className = 'rb-edit-head';
    const ht = document.createElement('span');
    ht.className = 'rb-edit-title';
    ht.textContent = '이 탭에 보일 명령';
    const cnt = document.createElement('span');
    cnt.className = 'rb-edit-count';
    const paintCount = () => {
      const n = all.filter((x) => !(this.hidden[tab.id] ?? []).includes(x.label)).length;
      cnt.textContent = `${n}개`;
    };
    paintCount();
    const reset = document.createElement('button');
    reset.className = 'rb-edit-reset';
    reset.type = 'button';
    reset.textContent = '기본값';
    reset.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hidden[tab.id] = [...(DEFAULT_OFF[tab.id] ?? [])];
      saveHidden(this.hidden);
      this.closeOverflow();
      this.renderRibbon();
    });
    head.append(ht, cnt, reset);
    panel.appendChild(head);

    const list = document.createElement('div');
    list.className = 'rb-edit-list';
    for (const it of all) {
      const row = document.createElement('button');
      row.className = 'rb-edit-item';
      row.type = 'button';
      row.appendChild(this.icon(it.icon, 17));
      const label = document.createElement('span');
      label.className = 'rb-over-label';
      label.textContent = it.label;
      row.appendChild(label);
      const sw = document.createElement('span');
      sw.className = 'rb-edit-switch';
      sw.classList.toggle('is-on', !off.has(it.label));
      sw.appendChild(document.createElement('i'));
      row.appendChild(sw);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = new Set(this.hidden[tab.id] ?? []);
        if (cur.has(it.label)) cur.delete(it.label); else cur.add(it.label);
        this.hidden[tab.id] = [...cur];
        saveHidden(this.hidden);
        sw.classList.toggle('is-on', !cur.has(it.label));
        paintCount();
        // 패널은 열어 둔 채 리본만 다시 그린다 — 여러 개를 연달아 켜고 끌 수 있게.
        const keep = this.overflowPanel;
        this.overflowPanel = null;
        this.renderRibbon();
        this.overflowPanel = keep;
      });
      list.appendChild(row);
    }
    panel.appendChild(list);

    const r = anchor.getBoundingClientRect();
    panel.style.top = `${r.bottom + 4}px`;
    panel.style.left = `${Math.max(8, r.right - 300)}px`;
    document.body.appendChild(panel);
    this.overflowPanel = panel;
    const offClick = (ev: MouseEvent) => {
      if (!panel.contains(ev.target as Node)) {
        this.closeOverflow();
        document.removeEventListener('mousedown', offClick, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', offClick, true), 0);
  }

}
