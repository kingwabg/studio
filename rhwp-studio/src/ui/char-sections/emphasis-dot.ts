/**
 * 「글자」 탭 · 강조점 섹션 — 글자 위에 찍는 점(한/글 「글자 모양」 확장 탭의 강조점).
 *
 * 왜 패널로 꺼내는가: 지금은 대화상자 3단계(글자 모양 → 확장 → 콤보)를 들어가야 하나를 찍는다.
 * 실제로는 "한 곳 찍고 바로 끈다"에 가까운 서식이라 칩 한 줄이면 충분하다.
 *
 * 값은 엔진 CharProperties.emphasisDot 을 그대로 쓴다(0=없음, 1~6=기호). 매핑을 새로 만들지 않는다.
 */
import { mkEl, mkButton } from '../canva-dom';
import type { CharSectionDeps } from './types';

/**
 * [값, 기호, 이름]. 기호·이름은 char-shape-dialog.ts 의 강조점 콤보와 같은 것을 쓴다 —
 * 같은 서식을 두 자리에서 다르게 부르면 사용자가 다른 기능으로 오해한다.
 */
const DOTS: ReadonlyArray<readonly [value: number, mark: string, label: string]> = [
  [1, '●', '검정 동그라미'],
  [2, '○', '속빈 동그라미'],
  [3, 'ˇ', '갈매기'],
  [4, '˜', '물결'],
  [5, '･', '가운뎃점'],
  [6, '˸', '쌍점'],
];

/** 켜진 칩 표시 — 전역 CSS 를 건드리지 않으려고 인라인으로 칠한다(.canva-chip 에 is-on 규칙이 없다) */
function paintChip(b: HTMLButtonElement, on: boolean): void {
  b.style.borderColor = on ? 'var(--color-primary)' : '';
  b.style.background = on ? 'var(--color-accent-bg)' : '';
  b.style.color = on ? 'var(--color-primary)' : '';
  b.setAttribute('aria-pressed', String(on));
}

export function buildEmphasisSection(host: HTMLElement, deps: CharSectionDeps): void {
  const sec = deps.section('강조점');
  const row = mkEl('div', 'canva-chip-row');

  // 지금 값은 클릭으로도 바뀐다 — 재클릭 해제(토글) 판정과 즉시 표시 갱신에 둘 다 필요해 지역 변수로 든다
  let cur = deps.charProps?.emphasisDot ?? 0;
  const chips = new Map<number, HTMLButtonElement>();

  const add = (value: number, body: (b: HTMLButtonElement) => void, title: string): void => {
    const b = mkButton('canva-chip', { title });
    b.style.height = '38px'; // 기본 28px 은 '기호+글자' 2단 미리보기가 안 들어간다
    body(b);
    // ⚠ click 이 아니라 mousedown+preventDefault — 패널 클릭에 본문 선택이 풀리면
    //    서식이 선택 범위가 아니라 엉뚱한 대기 서식으로 걸린다(패널의 다른 버튼들과 같은 규약).
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const next = value === cur ? 0 : value; // 같은 걸 다시 누르면 해제
      deps.applyChar({ emphasisDot: next });
      cur = next;
      for (const [v, el] of chips) paintChip(el, v === cur);
      deps.redraw();
    });
    chips.set(value, b);
    paintChip(b, value === cur);
    row.appendChild(b);
  };

  add(0, (b) => { b.textContent = '없음'; }, '강조점 없음');

  for (const [value, mark, label] of DOTS) {
    add(value, (b) => {
      // 기호만 보여주면 6종이 서로 구분되지 않는다 — 실제 조판처럼 「가」 위에 얹어 보여준다
      const stack = mkEl('span');
      stack.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;line-height:1;gap:2px;';
      const dot = mkEl('span', '', mark);
      dot.style.cssText = 'font-size:10px;height:10px;line-height:10px;';
      const ch = mkEl('span', '', '가');
      ch.style.cssText = 'font-size:13px;line-height:13px;';
      stack.append(dot, ch);
      b.appendChild(stack);
    }, `강조점 ${mark} ${label}`);
  }

  sec.appendChild(row);
  host.appendChild(sec);
}
