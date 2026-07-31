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
import { mkEl } from './canva-dom';
import type { CharProperties, ParaProperties } from '@/core/types';

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

  private paintSub(): void {
    if (!this.sub) return;
    this.sub.textContent = this.mixed
      ? `${this.fontName} ${this.fontPt}pt · 서식 섞임`
      : `${this.fontName} ${this.fontPt}pt`;
  }
}
