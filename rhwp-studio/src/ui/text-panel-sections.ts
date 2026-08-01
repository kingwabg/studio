/**
 * 「텍스트」 탭 — 문단 모양 대화상자(Alt+T)를 패널 섹션으로 재편 (디자인 2c 갱신 2026-07-30).
 *
 * 표/셀 탭과 같은 계약: 섹션 하나만 그리고, 값이 바뀌면 즉시 저장(확인 버튼 없음).
 * 저장은 전부 커맨드 경로(applyParaPropsToRange / format-char)라 Ctrl+Z 로 되돌아간다.
 *
 * 설명 문구는 text-panel-help.ts 가 정본이다 — 라벨만으로는 무엇이 달라지는지 알 수
 * 없다는 지적(2026-08-01)에 따라 행마다 한 줄 설명, 헷갈리는 옵션마다 툴팁을 붙인다.
 *
 * ⚠ 자간·장평은 **글자 모양** 속성이라 선택 글자에만 걸린다(디자인의 주석과 동일) —
 * 선택이 없으면 대기 서식(pending-format.ts)으로 흘러 다음 입력에 붙는다.
 */
import { mkEl, mkButton } from './canva-dom';
import {
  FIELD_HINT, OPTION_HINT, FLAG_HINT, SECTION_HINT, stripAccel,
} from './text-panel-help';
import { ALIGN_GLYPH, INDENT_GLYPH, KIND_ICON } from './text-panel-glyphs';
import type { CanvaServices } from './canva-services';
import type { ParaProperties, CharProperties } from '@/core/types';

const HWPUNIT_PER_PT = 100;
const toPt = (v: number | undefined): string => (((v ?? 0) as number) / HWPUNIT_PER_PT).toFixed(1);
const fromPt = (v: string): number => Math.round((parseFloat(v) || 0) * HWPUNIT_PER_PT);

type Opt<T> = [T, string];

const ALIGNS: Opt<string>[] = [
  ['justify', '양쪽'], ['left', '왼쪽'], ['right', '오른쪽'],
  ['center', '가운데'], ['distribute', '배분'], ['split', '나눔'],
];
const HEAD_TYPES: Opt<string>[] = [
  ['None', '없음'], ['Outline', '개요'], ['Number', '번호'], ['Bullet', '글머리표'],
];
const KOR_BREAK: Opt<number>[] = [[0, '어절'], [1, '글자']];
const ENG_BREAK: Opt<number>[] = [[0, '단어'], [1, '하이픈'], [2, '글자']];
const VALIGN: Opt<number>[] = [[0, '글꼴 기준'], [1, '위'], [2, '가운데'], [3, '아래']];
const LINE_SPACING_TYPES: Opt<string>[] = [
  ['Percent', '글자에 따라(%)'], ['Fixed', '고정값'], ['SpaceOnly', '여백만'], ['Minimum', '최소'],
];

/** 문단 종류 섹션의 체크 9종 — [필드, 라벨, 기본값] */
const FLAGS: Array<[keyof ParaProperties, string, boolean]> = [
  ['widowOrphan', '외톨이줄 보호(K)', false],
  ['keepWithNext', '다음 문단과 함께(N)', false],
  ['keepLines', '문단 보호(P)', false],
  ['pageBreakBefore', '문단 앞에서 항상 쪽 나눔(E)', false],
  ['fontLineHeight', '글꼴에 어울리는 줄 높이(H)', true],
  ['singleLine', '한 줄로 입력(W)', false],
  ['autoSpaceKrEn', '한글과 영어 간격 자동 조절(G)', true],
  ['autoSpaceKrNum', '한글과 숫자 간격 자동 조절(R)', true],
];

/**
 * 섹션 줄 — **「자주」 하나로 시작**한다(사용자 결정 2026-08-01).
 * 실측: 자주 쓰는 정렬·줄 간격·문단 간격·첫 줄이 서로 다른 섹션에 흩어져 있어
 * 한 문단을 손보는 데 섹션을 3번 오갔다. 나머지는 「자세히」 아래로 접는다.
 */
export const TEXT_SECTIONS: Array<[string, string]> = [
  ['자주', 'text-align-left'],
  ['문단 종류', 'list-bullets'], ['줄 나눔', 'text-t'], ['탭', 'arrow-elbow-down-right'],
];

/** 「자세히」에 접어 두는 섹션 — 섹션 줄에서는 감춘다 */
export const ADVANCED_SECTIONS = ['문단 종류', '줄 나눔', '탭'];

/** 설명 표시 여부 — [?] 토글, 기억한다 */
const HELP_KEY = 'rhwpParaHelp';
export function helpOn(): boolean {
  try { return localStorage.getItem(HELP_KEY) === '1'; } catch { return false; }
}
export function setHelpOn(v: boolean): void {
  try { localStorage.setItem(HELP_KEY, v ? '1' : '0'); } catch { /* 무시 */ }
}

export class TextPanelSections {
  private host!: HTMLElement;
  private services!: CanvaServices;
  private pp!: ParaProperties;
  private cp!: CharProperties;
  private preview: HTMLElement | null = null;

  /** @returns 그렸으면 true */
  mount(host: HTMLElement, services: CanvaServices, section: string): boolean {
    this.services = services;
    const ih = services.getInputHandler() as any;
    if (!ih) return false;
    try {
      this.pp = ih.getParaProperties();
      this.cp = ih.getPendingOrCurrentChar?.() ?? {};
    } catch {
      return false;
    }
    const build = this.sections()[section];
    if (!build) return false;
    host.innerHTML = '';
    this.preview = null;
    this.host = mkEl('div', 'tps');
    host.appendChild(this.host);
    const sh = SECTION_HINT[section];
    if (sh && helpOn()) this.host.appendChild(mkEl('div', 'tps-sec-hint', sh));
    build();
    return true;
  }

  private sections(): Record<string, () => void> {
    return {
      자주: () => this.buildCommon(),
      '문단 종류': () => this.buildKind(),
      '줄 나눔': () => this.buildBreak(),
      탭: () => this.buildTab(),
    };
  }

  // ── 섹션 ────────────────────────────────────────

  /**
   * 「자주」 — 한 문단을 손볼 때 실제로 쓰는 넷을 한 화면에.
   * 정렬(6) · 줄 간격 · 문단 간격(위/아래) · 첫 줄. 섹션 전환도 스크롤도 없다.
   */
  private buildCommon(): void {
    this.host.appendChild(this.segRow('정렬', ALIGNS, this.pp.alignment ?? 'justify', (v) => {
      this.para({ alignment: v });
      this.paintPreview();
    }));
    this.host.appendChild(this.stepper('줄 간격', this.pp.lineSpacing ?? 160, '%', 50, 500, (next) => {
      this.para({ lineSpacing: next });
    }, 10));
    const gap = mkEl('div', 'tps-row tps-row--pair');
    gap.appendChild(mkEl('span', 'tps-label', '문단 간격'));
    gap.appendChild(this.miniNum('위', toPt(this.pp.spacingBefore),
      (v) => this.para({ spacingBefore: fromPt(v) })));
    gap.appendChild(this.miniNum('아래', toPt(this.pp.spacingAfter),
      (v) => this.para({ spacingAfter: fromPt(v) })));
    this.host.appendChild(gap);
    this.appendHint(gap, '문단 간격');

    const cur = this.pp.indent ?? 0;
    const kind = cur > 0 ? 'indent' : cur < 0 ? 'hang' : 'normal';
    this.host.appendChild(this.segRow('첫 줄',
      [['normal', '보통'], ['indent', '들여쓰기'], ['hang', '내어쓰기']] as Opt<string>[], kind, (v) => {
        const mag = Math.abs(this.pp.indent ?? 0) || fromPt('10');
        this.para({ indent: v === 'normal' ? 0 : v === 'indent' ? mag : -mag });
        this.paintPreview();
      }));
    this.host.appendChild(this.buildPreview());
  }

  /** 라벨이 짧은 인라인 숫자칸 — 「위 0 아래 0」 처럼 한 줄에 둘 */
  private miniNum(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const wrap = mkEl('label', 'tps-mini');
    wrap.appendChild(mkEl('span', 'tps-mini-label', label));
    const input = mkEl('input', 'tps-input tps-input--mini') as HTMLInputElement;
    input.type = 'number';
    input.step = '0.5';
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    wrap.append(input, mkEl('span', 'tps-unit', 'pt'));
    return wrap;
  }

  private buildAlign(): void {
    this.host.appendChild(this.segRow('정렬 방식', ALIGNS, this.pp.alignment ?? 'justify', (v) => {
      this.para({ alignment: v });
      this.paintPreview();
    }));
    this.host.appendChild(this.buildPreview());
  }

  private buildIndent(): void {
    this.host.appendChild(this.numRow('왼쪽 여백', toPt(this.pp.marginLeft), 'pt',
      (v) => this.para({ marginLeft: fromPt(v) })));
    this.host.appendChild(this.numRow('오른쪽 여백', toPt(this.pp.marginRight), 'pt',
      (v) => this.para({ marginRight: fromPt(v) })));
    // 첫 줄: indent 부호가 곧 종류 — 양수=들여쓰기, 음수=내어쓰기, 0=보통
    const cur = this.pp.indent ?? 0;
    const kind = cur > 0 ? 'indent' : cur < 0 ? 'hang' : 'normal';
    const valRow = this.numRow('첫 줄 값', Math.abs(cur / HWPUNIT_PER_PT).toFixed(1), 'pt', (v) => {
      const sign = (this.pp.indent ?? 0) < 0 ? -1 : 1;
      this.para({ indent: sign * fromPt(v) });
    });
    valRow.classList.toggle('is-off', kind === 'normal');
    this.host.appendChild(this.segRow('첫 줄',
      [['normal', '보통'], ['indent', '들여쓰기'], ['hang', '내어쓰기']] as Opt<string>[], kind, (v) => {
        const mag = Math.abs(this.pp.indent ?? 0) || fromPt('10');
        const next = v === 'normal' ? 0 : v === 'indent' ? mag : -mag;
        this.para({ indent: next });
        valRow.classList.toggle('is-off', v === 'normal');
        this.paintPreview();
      }));
    this.host.appendChild(valRow);
    this.host.appendChild(this.buildPreview());
  }

  private buildSpacing(): void {
    this.host.appendChild(mkEl('div', 'tps-sub-title', '줄'));
    this.host.appendChild(this.selectRow('줄 간격 기준', LINE_SPACING_TYPES,
      this.pp.lineSpacingType ?? 'Percent', (v) => this.para({ lineSpacingType: v })));
    this.host.appendChild(this.numRow('줄 간격', String(this.pp.lineSpacing ?? 160), '%', (v) => {
      this.para({ lineSpacing: parseFloat(v) || 160 });
      this.paintPreview();
    }));

    this.host.appendChild(mkEl('div', 'tps-sub-title', '문단'));
    this.host.appendChild(this.numRow('위 간격', toPt(this.pp.spacingBefore), 'pt',
      (v) => this.para({ spacingBefore: fromPt(v) })));
    this.host.appendChild(this.numRow('아래 간격', toPt(this.pp.spacingAfter), 'pt',
      (v) => this.para({ spacingAfter: fromPt(v) })));

    this.host.appendChild(mkEl('div', 'tps-sub-title', '글자'));
    this.host.appendChild(this.stepper('자간', this.cp.spacings?.[0] ?? 0, '%', -50, 50, (next) => {
      this.char({ spacings: Array(7).fill(next) } as Partial<CharProperties>);
    }));
    this.host.appendChild(this.stepper('장평', this.cp.ratios?.[0] ?? 100, '%', 50, 200, (next) => {
      this.char({ ratios: Array(7).fill(next) } as Partial<CharProperties>);
    }));
    this.host.appendChild(mkEl('div', 'tps-note',
      '※ 자간·장평은 글자 모양 속성이라 선택한 글자에 적용됩니다. 선택이 없으면 다음에 칠 글자에 걸립니다.'));
    this.host.appendChild(this.buildPreview());
  }

  private buildKind(): void {
    const cur = this.pp.headType ?? 'None';
    const levelRow = this.selectRow('수준',
      [0, 1, 2, 3, 4, 5, 6].map((i) => [i, `${i + 1} 수준`] as Opt<number>),
      this.pp.paraLevel ?? 0, (v) => this.para({ paraLevel: v }));
    levelRow.classList.toggle('is-off', cur === 'None');
    this.host.appendChild(this.segRow('종류', HEAD_TYPES, cur, (v) => {
      // 번호·글머리표는 정의 id 가 필요하다 — 없으면 엔진 기본을 만들어 쓴다
      const patch: Partial<ParaProperties> = { headType: v };
      if (v === 'Number' || v === 'Outline') {
        try { patch.numberingId = this.services.wasm.ensureDefaultNumbering(); } catch { /* 기본 유지 */ }
      }
      this.para(patch);
      levelRow.classList.toggle('is-off', v === 'None');
    }));
    this.host.appendChild(levelRow);

    this.host.appendChild(mkEl('div', 'tps-sub-title', '기타'));
    for (const [key, label, dflt] of FLAGS) {
      const on = (this.pp[key] as boolean | undefined) ?? dflt;
      this.host.appendChild(this.switchRow(label, on, (v) => this.para({ [key]: v } as Partial<ParaProperties>)));
    }
    this.host.appendChild(this.selectRow('세로 정렬', VALIGN, this.pp.verticalAlign ?? 0,
      (v) => this.para({ verticalAlign: v })));
  }

  private buildBreak(): void {
    this.host.appendChild(this.segRow('한글(K)', KOR_BREAK, this.pp.koreanBreakUnit ?? 0,
      (v) => this.para({ koreanBreakUnit: v })));
    this.host.appendChild(this.segRow('영어(E)', ENG_BREAK, this.pp.englishBreakUnit ?? 0,
      (v) => this.para({ englishBreakUnit: v })));
    this.host.appendChild(mkEl('div', 'tps-note', '※ 줄 끝에서 무엇을 단위로 줄을 바꿀지 정합니다.'));
  }

  private buildTab(): void {
    // 탭 목록 편집은 대화상자(문단 모양 → 탭 설정)가 정본 — 패널은 진입만 제공한다.
    // 탭은 위치·채움·정렬 3속성의 표라 좁은 패널에 넣을 이득이 없다(v1 판단).
    this.host.appendChild(mkEl('div', 'tps-note',
      '탭 목록(위치·채움·정렬)은 문단 모양 대화상자에서 편집합니다.'));
    const b = mkButton('canva-full-btn');
    b.innerHTML = '<i class="ph-duotone ph-arrow-elbow-down-right"></i><span>탭 설정 열기</span>';
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.services.dispatcher.dispatch('format:para-shape');
    });
    this.host.appendChild(b);
  }

  // ── 저장 ────────────────────────────────────────

  private para(patch: Partial<ParaProperties>): void {
    const ih = this.services.getInputHandler() as any;
    if (!ih) return;
    try {
      const pos = ih.getCursorPosition();
      ih.applyParaPropsToRange(pos, pos, patch);
      Object.assign(this.pp, patch);
    } catch (err) {
      console.warn('[text-panel] 문단 속성 적용 실패:', err);
    }
  }

  /** 글자 속성 — 선택이 있으면 그 범위, 없으면 대기 서식(다음 입력) */
  private char(patch: Partial<CharProperties>): void {
    this.services.eventBus.emit('format-char', patch);
    Object.assign(this.cp, patch);
  }

  // ── 컨트롤 ──────────────────────────────────────

  /**
   * 옵션 값에 붙는 미리보기 그림. 없으면 글자만 — 억지 아이콘은 오히려 방해다.
   * (정렬·첫 줄·줄 나눔은 '줄이 어떻게 놓이나'라 막대 그림, 문단 종류는 Phosphor)
   */
  private glyphFor<T>(value: T, text: string): string {
    const k = String(value);
    if (k in ALIGN_GLYPH) return ALIGN_GLYPH[k];
    if (k in INDENT_GLYPH) return INDENT_GLYPH[k];
    if (k in KIND_ICON) return `<i class="ph-duotone ph-${KIND_ICON[k]} tps-glyph-ic"></i>`;
    // 줄 나눔은 그림을 두지 않는다 — 이유는 text-panel-glyphs.ts 주석 참조
    void text;
    return '';
  }

  private segRow<T>(label: string, opts: Opt<T>[], cur: T, onChange: (v: T) => void): HTMLElement {
    const row = mkEl('div', 'tps-field');
    if (label) {
      row.appendChild(mkEl('span', 'tps-label', stripAccel(label)));
      this.appendHint(row, stripAccel(label));
    }
    const seg = mkEl('div', 'tps-seg tps-seg--wrap');
    for (const [value, text] of opts) {
      // 툴팁 — 배분·나눔·내어쓰기처럼 이름만으론 못 고르는 것들에 붙는다
      const b = mkButton('tps-seg-btn', { title: OPTION_HINT[text] ?? text });
      const g = this.glyphFor(value, text);
      b.innerHTML = `${g}<span>${text}</span>`;
      if (g) b.classList.add('has-glyph');
      b.classList.toggle('is-on', value === cur);
      b.addEventListener('click', () => {
        seg.querySelectorAll('.tps-seg-btn').forEach((e) => e.classList.remove('is-on'));
        b.classList.add('is-on');
        onChange(value);
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }

  private selectRow<T extends string | number>(
    label: string, opts: Opt<T>[], cur: T, onChange: (v: T) => void,
  ): HTMLElement {
    const row = mkEl('div', 'tps-row tps-row--stack');
    row.appendChild(mkEl('span', 'tps-label', stripAccel(label)));
    const sel = mkEl('select', 'tps-select');
    for (const [value, text] of opts) {
      const o = mkEl('option', '', text) as HTMLOptionElement;
      o.value = String(value);
      if (OPTION_HINT[text]) o.title = OPTION_HINT[text];
      sel.appendChild(o);
    }
    sel.value = String(cur);
    sel.addEventListener('change', () =>
      onChange((typeof cur === 'number' ? Number(sel.value) : sel.value) as T));
    row.appendChild(sel);
    this.appendHint(row, stripAccel(label));
    return row;
  }

  private numRow(label: string, value: string, unit: string, onChange: (v: string) => void): HTMLElement {
    const row = mkEl('div', 'tps-row tps-row--stack');
    row.appendChild(mkEl('span', 'tps-label', stripAccel(label)));
    const input = mkEl('input', 'tps-input');
    input.type = 'number';
    input.step = '0.1';
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    row.append(input, mkEl('span', 'tps-unit', unit));
    this.appendHint(row, stripAccel(label));
    return row;
  }

  private switchRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = mkEl('label', 'tps-switch-row');
    const input = mkEl('input');
    input.type = 'checkbox';
    input.checked = on;
    input.addEventListener('change', () => onChange(input.checked));
    // 한컴 대화상자 단축키 (K)(N)… 은 패널에서 눌리지 않는다 — 잡음이라 뗀다
    const clean = stripAccel(label);
    const text = mkEl('div', 'tps-switch-text');
    text.appendChild(mkEl('span', 'tps-switch-label', clean));
    const hint = FLAG_HINT[clean];
    if (hint && helpOn()) text.appendChild(mkEl('span', 'tps-hint', hint));
    row.append(input, mkEl('span', 'tps-switch-track'), text);
    if (hint) row.title = hint;
    return row;
  }

  /** 라벨 아래 한 줄 설명 — 문구 정본은 text-panel-help.ts */
  private appendHint(row: HTMLElement, label: string): void {
    // ⚠ 꺼져 있어도 title 은 남는다 — 툴팁으로는 언제나 읽을 수 있어야 한다
    const h = FIELD_HINT[label];
    if (!h) return;
    if (!row.title) row.title = h;
    if (helpOn()) row.appendChild(mkEl('span', 'tps-hint', h));
  }

  /** −/값/+ 알약 스테퍼 (자간·장평) */
  private stepper(
    label: string, value: number, unit: string, min: number, max: number,
    onChange: (next: number) => void, stepBy = 1,
  ): HTMLElement {
    const row = mkEl('div', 'tps-row tps-row--stack');
    row.appendChild(mkEl('span', 'tps-label', label));
    const box = mkEl('div', 'tps-pill-stepper');
    let cur = value;
    const val = mkEl('span', 'tps-pill-num', `${cur}${unit}`);
    const step = (d: number) => () => {
      cur = Math.max(min, Math.min(max, cur + d * stepBy));
      val.textContent = `${cur}${unit}`;
      onChange(cur);
      this.paintPreview();
    };
    const dec = mkButton('tps-pill-btn', { html: '<i class="ph-bold ph-minus"></i>', title: `${label} 줄이기` });
    const inc = mkButton('tps-pill-btn', { html: '<i class="ph-bold ph-plus"></i>', title: `${label} 늘리기` });
    dec.addEventListener('click', step(-1));
    inc.addEventListener('click', step(1));
    box.append(dec, val, inc);
    this.appendHint(row, label);
    row.appendChild(box);
    return row;
  }

  /** 문단 미리보기 — 설정을 바꾸면 예문 두 줄이 그대로 변한다 */
  private buildPreview(): HTMLElement {
    const wrap = mkEl('div', 'tps-para-prev');
    wrap.appendChild(mkEl('div', 'tps-pos-head')).innerHTML = '<i class="ph-duotone ph-eye"></i>미리보기';
    this.preview = mkEl('div', 'tps-para-prev-body');
    this.preview.append(mkEl('p', '', '문단 모양은 글이 지면에 어떻게 앉는지를 정합니다.'),
      mkEl('p', '', '정렬·여백·간격을 바꾸면 이 예문이 그대로 따라 바뀝니다.'));
    wrap.appendChild(this.preview);
    this.paintPreview();
    return wrap;
  }

  private paintPreview(): void {
    if (!this.preview) return;
    const align = this.pp.alignment ?? 'justify';
    const cssAlign = align === 'distribute' || align === 'split' ? 'justify' : align;
    const indent = this.pp.indent ?? 0;
    for (const p of Array.from(this.preview.children) as HTMLElement[]) {
      p.style.textAlign = cssAlign;
      p.style.lineHeight = String((this.pp.lineSpacing ?? 160) / 100);
      p.style.textIndent = indent > 0 ? `${indent / HWPUNIT_PER_PT}pt` : '0';
      p.style.paddingLeft = indent < 0 ? `${-indent / HWPUNIT_PER_PT}pt` : '0';
      p.style.letterSpacing = `${(this.cp.spacings?.[0] ?? 0) / 100}em`;
      p.style.transform = `scaleX(${(this.cp.ratios?.[0] ?? 100) / 100})`;
      p.style.transformOrigin = 'left center';
    }
  }
}
