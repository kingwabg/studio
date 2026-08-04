/**
 * 「지금 서식」 견본 — 글자 탭 맨 위의 살아 있는 서식 표본.
 *
 * 디자인(claude.ai/design · `rhwp 본문 편집 패널.dc.html` 3a)의 결론:
 * 상태 이름만 적힌 배너 대신 **현재 서식이 그대로 적용된 한 문단**을 위에 둔다.
 * 아래 컨트롤(굵게·크기·색·정렬·줄 간격…)을 만지면 견본이 즉시 따라오므로,
 * 사용자가 "지금 무슨 서식인지"를 글자 모양 대화상자를 열지 않고 읽을 수 있다.
 *
 * [2026-07-31 사용자 제안] 고정 예문 대신 **실제 문단**(선택이 있으면 선택분)을 그린다.
 * 단 한 가지 서식으로 뭉뚱그리면 굵은 제목이 평범하게 보여 새 거짓말이 되므로 구간마다
 * 자기 서식으로 그린다(구간 분해는 selection-summary.ts). 글자가 없으면 예문으로 복귀.
 *
 * 크기는 pt 를 그대로 쓰지 않는다 — 패널이 좁아 20pt 견본이 줄을 넘긴다.
 * 디자인이 정한 압축 스케일 `min(26, 11 + pt*0.55)px` 을 그대로 따른다.
 */
import { mkEl, mkButton } from './canva-dom';
import type { CharProperties, ParaProperties } from '@/core/types';
import type { FormatRun } from './selection-summary';

/** 견본 아래 「수정본」 한 줄에 그릴 조각 — 고칠 곳은 before→after 를 같이 보여준다. */
export interface FixPart {
  text: string;
  /** 이 조각을 무엇으로 고치나 (없으면 그대로 두는 글자) */
  to?: string;
}

/** 정렬 값 → CSS. 배분·나눔은 CSS 로 표현할 수 없어 양쪽으로 근사한다(견본 한정). */
function cssAlign(a: string | undefined): string {
  if (a === 'distribute' || a === 'split') return 'justify';
  return a && ['left', 'right', 'center', 'justify'].includes(a) ? a : 'left';
}

/**
 * 글자 서식 한 벌을 style 에 입힌다 — 견본 문단·구간 span·칩 글리프가 공유한다.
 * 흰 글자는 흰 카드 위에서 사라지므로 견본에서만 회색으로 대신 보여준다.
 */
export function applyCharStyle(st: CSSStyleDeclaration, p: CharProperties, sizePx?: string): void {
  st.fontWeight = p.bold ? '700' : '400';
  st.fontStyle = p.italic ? 'italic' : 'normal';
  const dec = [p.underline && 'underline', p.strikethrough && 'line-through']
    .filter(Boolean)
    .join(' ');
  st.textDecoration = dec || 'none';
  if (sizePx) st.fontSize = sizePx;
  else if (p.fontSize !== undefined) {
    st.fontSize = `${Math.min(26, 11 + (p.fontSize / 100) * 0.55).toFixed(1)}px`;
  }
  if (p.textColor) st.color = p.textColor.toLowerCase() === '#ffffff' ? '#c9c6c2' : p.textColor;
  const hl = (p as unknown as { shadeColor?: string }).shadeColor;
  st.background = hl && hl.toLowerCase() !== '#ffffff' ? hl : 'transparent';
}

export class FormatSpecimen {
  private root!: HTMLElement;
  private headEl!: HTMLElement;
  private sub!: HTMLElement;
  private text!: HTMLElement;
  /** 마지막으로 그린 내용 — 같으면 다시 그리지 않는다(깜빡임 방지) */
  private lastContentKey = '';
  private fontName = '함초롬바탕';
  private fontPt = 10;
  /** 선택 안에 서로 다른 글자 서식이 섞였나 — 견본은 커서 값만 보여주므로 그 한계를 적는다 */
  private mixed = false;
  /** 스캔으로 센 서식 조각 수(0 = 안 셈) */
  private runCount = 0;
  /** 실제 글자를 그리는 중인가 — 그럴 땐 문단 전체에 커서 서식을 덧칠하지 않는다 */
  private live = false;
  /** 마지막으로 받은 커서 글자 서식 — 예문으로 되돌아갈 때 다시 입힌다 */
  private lastChar: CharProperties | null = null;
  /** 「서식 조각」 칩 줄 — 섞였을 때만 보인다 */
  private chips!: HTMLElement;
  /** 「수정본」 줄 — 고칠 곳이 있을 때만 보인다 */
  private fixRow!: HTMLElement;
  /** [고치기] 를 누르면 호출부가 이 문단의 고침을 한 번에 적용한다 */
  onFixAll: (() => void) | null = null;
  /** 「확인할 낱말」 줄 — 사전이 모르는 말이 있을 때만 보인다 */
  private wordRow!: HTMLElement;
  /** 낱말을 누르면 호출부가 후보를 뽑아 준다 */
  onWordPick: ((word: string, anchor: HTMLElement) => void) | null = null;
  /** [문장 다듬기] — 아동 기록 문서에서는 아예 안 만든다 */
  onPolish: ((anchor: HTMLElement) => void) | null = null;
  private polishBtn: HTMLButtonElement | null = null;
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
    this.headEl = head;

    const body = mkEl('div', 'canva-specimen-body');
    this.text = mkEl('p', 'canva-specimen-text');
    body.appendChild(this.text);
    this.root.appendChild(body);

    this.chips = mkEl('div', 'canva-specimen-chips');
    this.chips.hidden = true;
    this.root.appendChild(this.chips);

    this.fixRow = mkEl('div', 'canva-specimen-fix');
    this.fixRow.hidden = true;
    this.root.appendChild(this.fixRow);

    this.wordRow = mkEl('div', 'canva-specimen-words');
    this.wordRow.hidden = true;
    this.root.appendChild(this.wordRow);

    host.appendChild(this.root);
    this.paintSub();
    return this.root;
  }

  /**
   * 견본 내용을 **실제 글자**로 바꾼다 — 구간마다 자기 서식으로.
   * 글자가 없으면 **비운다**(사용자 결정 2026-07-31: 예문은 내가 쓰지도 않은 문장이라
   * 혼란만 준다 — 빈 문서에선 빈 견본, 치는 대로 채워지는 게 맞다).
   */
  setContent(runs: FormatRun[], truncated: boolean): void {
    if (!this.text) return;
    const usable = runs.filter((r) => (r.text ?? '').length > 0);
    // ⚠ 내용이 같은데도 매번 다 지우고 새로 그리고 있었다 — 클릭 한 번에 견본이
    //   4번씩 다시 쓰여 **깜빡였고**, 다시 그리는 찰나에 한글이 자모로 풀려 보였다
    //   (사용자 지적 2026-08-01 "클릭할 때마다 로딩되듯이"). 같으면 손대지 않는다.
    const key = JSON.stringify([usable.map((r) => [r.text, r.props]), truncated]);
    if (key === this.lastContentKey) return;
    this.lastContentKey = key;
    if (usable.length === 0) {
      this.live = false;
      this.text.textContent = '';
      if (this.lastChar) applyCharStyle(this.text.style, this.lastChar);
      return;
    }
    this.live = true;
    this.text.textContent = '';
    for (const r of usable) {
      const sp = mkEl('span', 'canva-specimen-run', r.text ?? '');
      applyCharStyle(sp.style, r.props);
      this.text.appendChild(sp);
    }
    if (truncated) this.text.appendChild(mkEl('span', 'canva-specimen-more', ' …'));
    // 구간 서식이 정본 — 문단 전체에 커서 서식을 덧칠하면 이중 적용이 된다.
    const st = this.text.style;
    st.fontWeight = '';
    st.fontStyle = '';
    st.textDecoration = '';
    st.fontSize = '';
    st.color = '';
    st.background = '';
  }

  /** 글자 서식 반영 — 굵기·기울임·밑줄/취소선·크기·색·형광펜. */
  reflectChar(p: CharProperties): void {
    if (!this.text) return;
    this.lastChar = p;
    // 실제 글자를 그리는 중이면 구간 서식이 이미 정확하다 — 덧칠하지 않는다.
    if (!this.live) applyCharStyle(this.text.style, p);

    if (p.fontSize !== undefined) this.fontPt = p.fontSize / 100;
    const fam = (p as unknown as { fontFamily?: string; fontFamilies?: string[] }).fontFamily
      ?? (p as unknown as { fontFamilies?: string[] }).fontFamilies?.[0];
    if (fam) this.fontName = String(fam);
    this.paintSub();
  }

  /** 문단 서식 반영 — 정렬·줄 간격(문단 전체 속성이라 실제 글자일 때도 p 에 건다). */
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
      const pt = r.props.fontSize !== undefined ? r.props.fontSize / 100 : 10;
      applyCharStyle(glyph.style, r.props, `${Math.min(19, 9 + pt * 0.42).toFixed(1)}px`);
      b.appendChild(glyph);
      b.appendChild(mkEl('span', 'canva-fmt-chip-len', `${r.len}자`));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.onPickRun?.(r); });
      this.chips.appendChild(b);
    }
    if (truncated) this.chips.appendChild(mkEl('span', 'canva-fmt-chip-more', '···'));
    this.chips.hidden = false;
    this.paintSub();
  }

  /**
   * 「수정본」 — 지금 문단을 맞춤법대로 고치면 어떻게 되는지 그 자리에서 보여준다
   * (사용자 요청 2026-07-31: "여기 부분에 문장 수정·맞춤법 수정본이 나오는 것").
   *
   * 밑줄을 하나씩 눌러 확인하는 것과 달리, **문장 전체가 어떻게 바뀌는지**를 먼저 읽고
   * 한 번에 고칠 수 있다. 틀린 글자는 흐리게 그어 두고 고친 글자를 옆에 붙인다.
   */
  setCorrections(parts: FixPart[]): void {
    if (!this.fixRow) return;
    this.fixRow.textContent = '';
    if (parts.length === 0 || !parts.some((p) => p.to !== undefined)) {
      this.fixRow.hidden = true;
      return;
    }
    const head = mkEl('div', 'canva-specimen-fixhead');
    head.innerHTML = '<i class="ph ph-check-circle"></i><span>수정본</span>';
    const btn = mkButton('canva-specimen-fixbtn', { title: '이 문단의 맞춤법을 한 번에 고칩니다' });
    btn.textContent = '고치기';
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); this.onFixAll?.(); });
    head.appendChild(btn);
    this.fixRow.appendChild(head);

    const line = mkEl('p', 'canva-specimen-fixtext');
    for (const p of parts) {
      if (p.to === undefined) {
        line.appendChild(document.createTextNode(p.text));
        continue;
      }
      line.appendChild(mkEl('span', 'canva-specimen-fixfrom', p.text));
      line.appendChild(mkEl('span', 'canva-specimen-fixto', p.to));
    }
    this.fixRow.appendChild(line);
    this.fixRow.hidden = false;
  }

  /**
   * 「확인할 낱말」 — 사전이 모르는 말을 **이 문단에서만** 모아 보여준다.
   * 캔버스에 밑줄을 긋지 않는 이유: 복합명사 오탐이 섞이는데, 본문에 흩어지면
   * 무시하기 어렵고 한곳에 모이면 한눈에 넘길 수 있다(사용자 결정 2026-07-31).
   */
  setWordChecks(words: readonly string[]): void {
    if (!this.wordRow) return;
    this.wordRow.textContent = '';
    if (words.length === 0) { this.wordRow.hidden = true; return; }
    const head = mkEl('div', 'canva-specimen-fixhead');
    head.innerHTML = '<i class="ph ph-book-open-text"></i><span>확인할 낱말</span>';
    this.wordRow.appendChild(head);
    const box = mkEl('div', 'canva-specimen-wordbox');
    for (const w of words) {
      const b = mkButton('canva-specimen-word', { title: `"${w}" — 사전에 없는 말입니다. 눌러서 후보를 봅니다.` });
      b.textContent = w;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.onWordPick?.(w, b); });
      box.appendChild(b);
    }
    this.wordRow.appendChild(box);
    this.wordRow.hidden = false;
  }

  /**
   * [문장 다듬기] 버튼을 보이거나 감춘다.
   * ⚠ 아동 관찰기록에서는 **만들지 않는다** — 감추는 게 아니라 없어야 한다.
   *   버튼이 DOM 에 있으면 언젠가 눌린다.
   */
  setPolishAvailable(on: boolean): void {
    if (!this.headEl) return;
    if (!on) { this.polishBtn?.remove(); this.polishBtn = null; return; }
    if (this.polishBtn) return;
    const b = mkButton('canva-specimen-polish', { title: '이 문단을 AI 로 3가지로 다듬습니다 (문장이 외부 서버로 전송됩니다)' });
    b.textContent = '문장 다듬기';
    b.addEventListener('mousedown', (e) => { e.preventDefault(); this.onPolish?.(b); });
    this.headEl.appendChild(b);
    this.polishBtn = b;
  }

  private paintSub(): void {
    if (!this.sub) return;
    const base = `${this.fontName} ${this.fontPt}pt`;
    // 조각 수를 셌으면 "섞임"보다 정확한 "N종"으로 말한다.
    const next = this.runCount >= 2
      ? `${base} · 서식 ${this.runCount}종`
      : this.mixed ? `${base} · 서식 섞임` : base;
    // 같은 글자를 다시 넣으면 그때마다 텍스트 노드가 갈린다(클릭당 4회 — 실측)
    if (this.sub.textContent === next) return;
    this.sub.textContent = next;
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
