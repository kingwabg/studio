/**
 * 「지금 서식」 견본 — 글자 탭 맨 위의 살아 있는 서식 표본.
 *
 * 디자인(claude.ai/design · `rhwp 본문 편집 패널.dc.html` 3a)의 결론:
 * 상태 이름만 적힌 배너 대신 **현재 서식이 그대로 적용된 한 문단**을 위에 둔다.
 * 아래 컨트롤(굵게·크기·색·정렬·줄 간격…)을 만지면 견본이 즉시 따라오므로,
 * 사용자가 "지금 무슨 서식인지"를 글자 모양 대화상자를 열지 않고 읽을 수 있다.
 *
 * 크기는 pt 를 그대로 쓰지 않는다 — 패널이 좁아 20pt 견본이 줄을 넘긴다.
 * 디자인이 정한 압축 스케일 `min(26, 11 + pt*0.55)px` 을 그대로 따른다.
 */
import { mkEl, mkButton } from './canva-dom';
import type { CharProperties, ParaProperties } from '@/core/types';
import type { FormatRun } from './selection-summary';

/** 정렬 값 → CSS. 배분·나눔은 CSS 로 표현할 수 없어 양쪽으로 근사한다(견본 한정). */
function cssAlign(a: string | undefined): string {
  if (a === 'distribute' || a === 'split') return 'justify';
  return a && ['left', 'right', 'center', 'justify'].includes(a) ? a : 'left';
}

export class FormatSpecimen {
  private root!: HTMLElement;
  private sub!: HTMLElement;
  private text!: HTMLElement;
  private mark!: HTMLElement;
  private fontName = '함초롬바탕';
  private fontPt = 10;
  /** 선택 안에 서로 다른 글자 서식이 섞였나 — 견본은 커서 값만 보여주므로 그 한계를 적는다 */
  private mixed = false;
  /** 스캔으로 센 서식 조각 수(0 = 안 셈) */
  private runCount = 0;
  /** 「서식 조각」 칩 줄 — 섞였을 때만 보인다 */
  private chips!: HTMLElement;
  /** 칩을 누르면 그 구간만 선택하도록 호출부가 꽂는 훅 */
  onPickRun: ((run: FormatRun) => void) | null = null;

  /** host 안에 견본 카드를 만들고 자기 루트를 돌려준다. */
  mount(host: HTMLElement): HTMLElement {
    this.root = mkEl('div', 'canva-specimen');

    const head = mkEl('div', 'canva-specimen-head');
    head.innerHTML =
      '<i class="ph ph-eye"></i><span class="canva-specimen-title">지금 서식</span>';
    this.sub = mkEl('span', 'canva-specimen-sub');
    head.appendChild(this.sub);
    this.root.appendChild(head);

    const body = mkEl('div', 'canva-specimen-body');
    this.text = mkEl('p', 'canva-specimen-text');
    this.mark = mkEl('span', 'canva-specimen-mark');
    this.mark.textContent = '문서의 첫 줄은 읽는 사람의 시간을 아껴야 한다.';
    this.text.appendChild(this.mark);
    this.text.appendChild(document.createTextNode(' 가나다라마바사 AaBbCc 0123'));
    body.appendChild(this.text);
    this.root.appendChild(body);

    this.chips = mkEl('div', 'canva-specimen-chips');
    this.chips.hidden = true;
    this.root.appendChild(this.chips);

    host.appendChild(this.root);
    this.paintSub();
    return this.root;
  }

  /** 글자 서식 반영 — 굵기·기울임·밑줄/취소선·크기·색·형광펜. */
  reflectChar(p: CharProperties): void {
    if (!this.text) return;
    const s = this.text.style;
    s.fontWeight = p.bold ? '700' : '400';
    s.fontStyle = p.italic ? 'italic' : 'normal';
    const dec = [p.underline && 'underline', p.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ');
    s.textDecoration = dec || 'none';

    if (p.fontSize !== undefined) {
      this.fontPt = p.fontSize / 100;
      s.fontSize = `${Math.min(26, 11 + this.fontPt * 0.55).toFixed(1)}px`;
    }
    // 흰 글자는 흰 카드 위에서 사라진다 — 견본에서만 회색으로 대신 보여준다.
    if (p.textColor) s.color = p.textColor.toLowerCase() === '#ffffff' ? '#c9c6c2' : p.textColor;

    const hl = (p as unknown as { shadeColor?: string }).shadeColor;
    this.mark.style.background = hl && hl.toLowerCase() !== '#ffffff' ? hl : 'transparent';

    const fam = (p as unknown as { fontFamily?: string; fontFamilies?: string[] }).fontFamily
      ?? (p as unknown as { fontFamilies?: string[] }).fontFamilies?.[0];
    if (fam) this.fontName = String(fam);
    this.paintSub();
  }

  /** 문단 서식 반영 — 정렬·줄 간격. */
  reflectPara(p: ParaProperties): void {
    if (!this.text) return;
    this.text.style.textAlign = cssAlign(p.alignment);
    const ls = (p as unknown as { lineSpacing?: number }).lineSpacing;
    if (ls !== undefined && ls > 0) this.text.style.lineHeight = String(ls / 100);
  }

  /**
   * 선택에 서식이 섞였음을 표시한다.
   * 견본은 **커서 위치의 서식**만 그린다 — 여러 문단·혼합 서식을 잡으면 마치 전체가
   * 그 서식인 것처럼 읽히므로, 부제에 한 마디를 붙여 거짓말을 막는다(사용자 결정
   * 2026-07-31: 섞인 항목만 중립으로 그리는 '정확' 안 대신 이 '간단' 안).
   */
  setMixed(mixed: boolean): void {
    if (this.mixed === mixed) return;
    this.mixed = mixed;
    this.root?.classList.toggle('is-mixed', mixed);
    this.paintSub();
  }

  /**
   * 「서식 조각」 칩을 그린다 — 각 칩을 **그 구간의 서식 그대로** 그려서, 색 같은
   * 임의 기호를 해독할 필요 없이 칩 자체가 범례가 되게 한다(사용자 결정 2026-07-31:
   * 본문에 색을 칠하면 선택 하이라이트·실제 글자색과 충돌한다).
   * 칩을 누르면 그 구간만 선택된다 — "굵은 데만 골라 고치기"가 된다.
   */
  setRuns(runs: FormatRun[], truncated: boolean): void {
    if (!this.chips) return;
    this.chips.textContent = '';
    // 조각이 하나뿐이면 섞이지 않은 것 — 칩을 감춘다(같은 정보의 중복 표시 금지).
    if (runs.length < 2) {
      this.chips.hidden = true;
      this.runCount = 0;
      this.paintSub();
      return;
    }
    this.runCount = runs.length;
    for (const r of runs) {
      const b = mkButton('canva-fmt-chip', { title: describeRun(r) });
      const glyph = mkEl('span', 'canva-fmt-chip-glyph', r.sample);
      const p = r.props;
      const st = glyph.style;
      st.fontWeight = p.bold ? '700' : '400';
      st.fontStyle = p.italic ? 'italic' : 'normal';
      const dec = [p.underline && 'underline', p.strikethrough && 'line-through']
        .filter(Boolean).join(' ');
      st.textDecoration = dec || 'none';
      if (p.fontSize !== undefined) {
        st.fontSize = `${Math.min(19, 9 + (p.fontSize / 100) * 0.42).toFixed(1)}px`;
      }
      if (p.textColor) {
        st.color = p.textColor.toLowerCase() === '#ffffff' ? '#c9c6c2' : p.textColor;
      }
      const hl = (p as unknown as { shadeColor?: string }).shadeColor;
      if (hl && hl.toLowerCase() !== '#ffffff') st.background = hl;
      b.appendChild(glyph);
      b.appendChild(mkEl('span', 'canva-fmt-chip-len', `${r.len}자`));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.onPickRun?.(r); });
      this.chips.appendChild(b);
    }
    if (truncated) this.chips.appendChild(mkEl('span', 'canva-fmt-chip-more', '···'));
    this.chips.hidden = false;
    this.paintSub();
  }

  private paintSub(): void {
    if (!this.sub) return;
    const base = `${this.fontName} ${this.fontPt}pt`;
    // 조각 수를 셌으면 "섞임"보다 정확한 "N종"으로 말한다.
    this.sub.textContent = this.runCount >= 2
      ? `${base} · 서식 ${this.runCount}종`
      : this.mixed ? `${base} · 서식 섞임` : base;
  }
}

/** 칩 툴팁 — 그 구간이 어떤 서식인지 말로도 적는다(아이콘만으론 모호하다). */
function describeRun(r: FormatRun): string {
  const p = r.props;
  const bits: string[] = [];
  if (p.fontSize !== undefined) bits.push(`${p.fontSize / 100}pt`);
  if (p.bold) bits.push('굵게');
  if (p.italic) bits.push('기울임');
  if (p.underline) bits.push('밑줄');
  if (p.strikethrough) bits.push('취소선');
  if (p.textColor && p.textColor.toLowerCase() !== '#000000') bits.push(p.textColor);
  return `${bits.join(' · ') || '기본'} — ${r.len}자 (누르면 이 구간만 선택)`;
}
