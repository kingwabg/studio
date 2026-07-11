/**
 * [캔버스 한컴 포크] 우측 캔바식 속성 인스펙터.
 * 선택 컨텍스트(본문·표 셀·표 개체·그림)를 배너로 보여주고, 글자 서식을 편집한다.
 * 원칙: 새 엔진 로직 없음 — 적용은 기존 커맨드 dispatch / format-char emit,
 *       상태 반영은 Toolbar와 같은 cursor-format-changed·cursor-para-changed 미러.
 */
import type { CanvaServices } from './canva-services';
import type { CharProperties, ParaProperties } from '@/core/types';

type Ctx = 'none' | 'body' | 'cell' | 'table' | 'picture';

const ALIGN_ICONS: Record<string, string> = {
  left: '<path d="M3 5h18M3 10h12M3 15h18M3 20h12"/>',
  center: '<path d="M3 5h18M6 10h12M3 15h18M6 20h12"/>',
  right: '<path d="M3 5h18M9 10h12M3 15h18M9 20h12"/>',
  justify: '<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/>',
};
const COLORS = ['#000000', '#dc3545', '#f59e0b', '#16a34a', '#256ef4', '#7c3aed', '#6b7280', '#ffffff'];

function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export class CanvaRightInspector {
  private ctx: Ctx = 'none';
  private painted = false;

  private banner!: HTMLElement;
  private fmtPane!: HTMLElement;
  private emptyEl!: HTMLElement;
  private extrasHost!: HTMLElement;
  private biu: Record<'bold' | 'italic' | 'underline', HTMLButtonElement> = {} as any;
  private aligns: Record<string, HTMLButtonElement> = {};
  private sizeInput!: HTMLInputElement;
  private swatches: HTMLButtonElement[] = [];

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
    this.wire();
    this.refreshContext();
  }

  private render(): void {
    const pane = document.createElement('div');
    pane.className = 'canva-pane';

    this.banner = document.createElement('div');
    this.banner.className = 'canva-context-banner';
    pane.appendChild(this.banner);

    // 빈 상태 (문서 없음)
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'canva-ins-empty';
    this.emptyEl.textContent = '문서를 열면 선택한 개체의 속성이 여기 표시됩니다.';
    this.emptyEl.hidden = true;
    pane.appendChild(this.emptyEl);

    // 글자 서식
    this.fmtPane = document.createElement('div');
    this.fmtPane.className = 'canva-pane';

    // B / I / U
    const biuSec = this.section('글자');
    const biuRow = document.createElement('div');
    biuRow.className = 'canva-btn-row';
    const mkTog = (key: 'bold' | 'italic' | 'underline', label: string, cmd: string, style: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canva-icon-btn';
      b.innerHTML = `<i style="${style}">${label}</i>`;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.dispatcher.dispatch(cmd); });
      this.biu[key] = b;
      return b;
    };
    biuRow.appendChild(mkTog('bold', '가', 'format:bold', 'font-weight:800'));
    biuRow.appendChild(mkTog('italic', '가', 'format:italic', 'font-style:italic'));
    biuRow.appendChild(mkTog('underline', '가', 'format:underline', 'text-decoration:underline'));
    biuSec.appendChild(biuRow);

    // 크기 스테퍼
    const sizeRow = document.createElement('div');
    sizeRow.className = 'canva-btn-row';
    const stepper = document.createElement('div');
    stepper.className = 'canva-stepper';
    const dec = document.createElement('button'); dec.type = 'button'; dec.textContent = '−';
    const inp = document.createElement('input'); inp.type = 'number'; inp.value = '10'; inp.min = '1'; inp.step = '0.5';
    const inc = document.createElement('button'); inc.type = 'button'; inc.textContent = '+';
    dec.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.dispatcher.dispatch('format:font-size-decrease'); });
    inc.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.dispatcher.dispatch('format:font-size-increase'); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const pt = parseFloat(inp.value);
        if (pt > 0) this.services.eventBus.emit('format-char', { fontSize: Math.round(pt * 100) } as CharProperties);
      }
    });
    stepper.append(dec, inp, inc);
    this.sizeInput = inp;
    sizeRow.appendChild(stepper);
    biuSec.appendChild(sizeRow);
    this.fmtPane.appendChild(biuSec);

    // 정렬
    const alignSec = this.section('문단 정렬');
    const alignRow = document.createElement('div');
    alignRow.className = 'canva-btn-row';
    for (const key of ['left', 'center', 'right', 'justify']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canva-icon-btn';
      b.innerHTML = svg(ALIGN_ICONS[key]);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.dispatcher.dispatch(`format:align-${key}`); });
      this.aligns[key] = b;
      alignRow.appendChild(b);
    }
    alignSec.appendChild(alignRow);
    this.fmtPane.appendChild(alignSec);

    // 글자색
    const colorSec = this.section('글자색');
    const sw = document.createElement('div');
    sw.className = 'canva-swatches';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canva-swatch';
      b.style.background = c;
      b.title = c;
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.services.eventBus.emit('format-char', { textColor: c } as CharProperties);
        this.swatches.forEach((s) => s.classList.toggle('is-active', s === b));
      });
      this.swatches.push(b);
      sw.appendChild(b);
    }
    colorSec.appendChild(sw);
    this.fmtPane.appendChild(colorSec);

    // 전체 글자 모양 다이얼로그
    const full = document.createElement('button');
    full.type = 'button';
    full.className = 'canva-full-btn';
    full.innerHTML = svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>') + '<span>글자 모양 자세히…</span>';
    full.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.dispatcher.dispatch('format:char-shape'); });
    this.fmtPane.appendChild(full);

    // 컨텍스트 추가(표/그림) 영역
    this.extrasHost = document.createElement('div');
    this.extrasHost.className = 'canva-pane';
    this.fmtPane.appendChild(this.extrasHost);

    pane.appendChild(this.fmtPane);
    this.root.appendChild(pane);
  }

  private section(label: string): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'canva-ins-section';
    const l = document.createElement('div');
    l.className = 'canva-section-label';
    l.textContent = label;
    sec.appendChild(l);
    return sec;
  }

  private wire(): void {
    const bus = this.services.eventBus;
    bus.on('cursor-format-changed', (p) => this.reflectChar(p as CharProperties));
    bus.on('cursor-para-changed', (p) => this.reflectPara(p as ParaProperties));
    bus.on('cursor-cell-changed', () => this.refreshContext());
    bus.on('cursor-rect-updated', () => this.refreshContext());
    bus.on('table-object-selection-changed', () => this.refreshContext());
    bus.on('picture-object-selection-changed', () => this.refreshContext());
    bus.on('document-changed', () => this.refreshContext());
    // 새 문서 생성/로드 완료는 command-state-changed로 온다 (initializeDocument)
    bus.on('command-state-changed', () => this.refreshContext());
  }

  private reflectChar(p: CharProperties): void {
    this.biu.bold?.classList.toggle('is-active', !!p.bold);
    this.biu.italic?.classList.toggle('is-active', !!p.italic);
    this.biu.underline?.classList.toggle('is-active', !!p.underline);
    if (p.fontSize !== undefined) this.sizeInput.value = String(p.fontSize / 100);
    if (p.textColor) {
      const hex = p.textColor.toLowerCase();
      this.swatches.forEach((s) => s.classList.toggle('is-active', (s.style.background || '').length > 0 && rgbToHex(s.style.background) === hex));
    }
  }

  private reflectPara(p: ParaProperties): void {
    const a = p.alignment;
    for (const key of Object.keys(this.aligns)) this.aligns[key].classList.toggle('is-active', a === key);
  }

  private refreshContext(): void {
    const ih = this.services.getInputHandler() as any;
    const hasDoc = this.services.wasm.pageCount > 0;
    let ctx: Ctx;
    if (!ih || !hasDoc) ctx = 'none';
    else if (ih.isInPictureObjectSelection?.()) ctx = 'picture';
    else if (ih.isInTableObjectSelection?.()) ctx = 'table';
    else if (ih.isInTable?.()) ctx = 'cell';
    else ctx = 'body';
    if (ctx === this.ctx && this.painted) return;
    this.painted = true;
    this.ctx = ctx;
    this.applyContext();
  }

  private applyContext(): void {
    const c = this.ctx;
    const meta: Record<Ctx, { icon: string; label: string }> = {
      none: { icon: '<circle cx="12" cy="12" r="9"/>', label: '선택 없음' },
      body: { icon: '<path d="M4 6h16M4 12h16M4 18h10"/>', label: '본문 편집' },
      cell: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M3 12h18"/>', label: '표 셀 편집' },
      table: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16"/>', label: '표 개체 선택됨' },
      picture: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M4 17l5-5 4 4 3-3 4 4"/>', label: '그림 선택됨' },
    };
    this.banner.innerHTML = svg(meta[c].icon) + `<span>${meta[c].label}</span>`;

    const showFmt = c === 'body' || c === 'cell';
    this.emptyEl.hidden = c !== 'none';
    this.fmtPane.hidden = c === 'none';
    // 글자 서식은 텍스트 편집(본문/셀)일 때만; 개체 선택 시엔 개체 속성만
    for (const el of Array.from(this.fmtPane.children)) {
      if (el !== this.extrasHost) (el as HTMLElement).hidden = !showFmt && c !== 'none';
    }
    this.renderExtras();
  }

  private renderExtras(): void {
    const host = this.extrasHost;
    host.innerHTML = '';
    const disp = (cmd: string) => (e: Event) => { e.preventDefault(); this.services.dispatcher.dispatch(cmd); };
    const fullBtn = (label: string, cmd: string, icon: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canva-full-btn';
      b.innerHTML = svg(icon) + `<span>${label}</span>`;
      b.addEventListener('mousedown', disp(cmd));
      return b;
    };

    if (this.ctx === 'cell') {
      const sec = this.section('표 편집');
      const row1 = document.createElement('div'); row1.className = 'canva-btn-row';
      const mk = (title: string, cmd: string, inner: string) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'canva-icon-btn'; b.title = title;
        b.innerHTML = svg(inner);
        b.addEventListener('mousedown', disp(cmd));
        return b;
      };
      row1.appendChild(mk('위에 줄 추가', 'table:insert-row-above', '<path d="M12 20V8M6 14l6-6 6 6"/>'));
      row1.appendChild(mk('아래에 줄 추가', 'table:insert-row-below', '<path d="M12 4v12M6 10l6 6 6-6"/>'));
      row1.appendChild(mk('왼쪽에 칸 추가', 'table:insert-col-left', '<path d="M20 12H8M14 6l-6 6 6 6"/>'));
      row1.appendChild(mk('오른쪽에 칸 추가', 'table:insert-col-right', '<path d="M4 12h12M10 6l6 6-6 6"/>'));
      sec.appendChild(row1);
      sec.appendChild(fullBtn('표/셀 속성…', 'table:cell-props', '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18"/>'));
      host.appendChild(sec);
    } else if (this.ctx === 'table') {
      const sec = this.section('표 개체');
      sec.appendChild(fullBtn('개체 속성…', 'format:object-properties', '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9 9h6v6H9z"/>'));
      const hint = document.createElement('div'); hint.className = 'canva-hint';
      hint.textContent = '셀을 클릭하면 글자 서식과 행·열 편집이 열립니다.';
      sec.appendChild(hint);
      host.appendChild(sec);
    } else if (this.ctx === 'picture') {
      const sec = this.section('그림');
      sec.appendChild(fullBtn('그림 속성…', 'format:object-properties', '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M4 17l5-5 4 4 3-3 4 4"/>'));
      host.appendChild(sec);
    }
  }
}

function rgbToHex(v: string): string {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return v.toLowerCase();
  const h = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}
