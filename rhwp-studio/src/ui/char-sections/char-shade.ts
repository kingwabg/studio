/**
 * 「글자」 탭 · 글자 음영 섹션 — 글자 뒤에 깔리는 배경색(한/글 「글자 모양」의 '음영 색(G)').
 *
 * 왜 패널로 꺼내는가: 엔진 필드(CharProperties.shadeColor)는 예전부터 있는데 꺼내는 자리가
 * 「글자 모양」 대화상자 안쪽 color picker 하나뿐이었다. 표 안 강조처럼 자주 쓰는 서식이라
 * 문서에서 실제로 쓰는 연한 톤만 골라 한 줄로 깔아둔다(picker 로 아무 색이나 고르게 하면
 * 진한 색을 골라 글자가 안 보이는 사고가 난다).
 *
 * ⚠ 값 규약 — 「없음」은 undefined 가 아니라 **흰색 '#ffffff'** 이다. 추측이 아니라 코드 근거:
 *   - char-shape-dialog.ts: 읽을 때 `p.shadeColor || '#ffffff'`, 되돌릴 때도 '#ffffff' 기준으로 diff
 *   - toolbar.ts 의 '색 없음' 버튼도 `{ shadeColor: '#ffffff' }` 를 emit
 *   - canvaskit-renderer.ts: `shadeColor.toLowerCase() !== '#ffffff'` 일 때만 음영으로 취급
 *   즉 흰색이 이 필드의 "안 칠함" 표현이다. undefined 를 보내면 patch 병합에서 무시돼
 *   기존 음영이 안 지워진다 — 반드시 '#ffffff' 를 명시해서 지운다.
 */
import { mkEl, mkButton } from '../canva-dom';
import type { CharSectionDeps } from './types';

/** 이 필드에서 "음영 없음"을 뜻하는 값(위 주석의 근거 참고) */
const NONE = '#ffffff';

/**
 * [색, 이름]. 전부 밝은 톤만 둔다 — 글자 **뒤**에 깔리는 색이라 어두우면 본문이 안 읽힌다.
 * 형광펜 팔레트(toolbar.ts)의 원색 계열을 그대로 베끼지 않은 이유이기도 하다.
 */
const SHADES: ReadonlyArray<readonly [color: string, label: string]> = [
  ['#e8e8e8', '연한 회색'],
  ['#d4d4d4', '회색'],
  ['#fff2b2', '연한 노랑'],
  ['#ffe0b3', '연한 주황'],
  ['#d9f2d0', '연두'],
  ['#cfe8ff', '하늘'],
  ['#e2d9f5', '연보라'],
  ['#ffd9e2', '분홍'],
  ['#f0e4d4', '베이지'],
];

/** 비교는 소문자로 — 문서에서 들어온 값은 '#FFFFFF' 처럼 대문자일 수 있다(렌더러도 같게 처리한다) */
function norm(v: string | undefined): string {
  return (v || NONE).toLowerCase();
}

export function buildCharShadeSection(host: HTMLElement, deps: CharSectionDeps): void {
  const sec = deps.section('글자 음영');

  // 형광펜과 같은 필드를 쓴다 — 사용자가 "둘 중 뭘 눌렀더라"로 헤매지 않게 관계를 한 줄로 밝힌다.
  const hint = mkEl(
    'div',
    'canva-hint',
    '글자 뒤에 깔리는 배경색이다. 리본의 형광펜과 같은 서식이며, 여기에는 인쇄·표 강조에 쓰는 연한 톤만 모아 뒀다.',
  );
  sec.appendChild(hint);

  const row = mkEl('div', 'canva-swatches');

  // ⚠ 지금 값을 지역 변수에 담아 두면 안 된다 — 섹션은 한 번만 그려지고 커서를 따라오지 않는다.
  //   낡은 값으로 토글을 판정하면 엉뚱하게 "해제"만 보낸다(강조점에서 실제로 터진 결함).
  const curValue = (): string => norm(deps.getCharProps()?.shadeColor);
  const swatches = new Map<string, HTMLButtonElement>();

  const repaint = (): void => {
    const cur = curValue();
    for (const [c, el] of swatches) {
      const on = c === cur;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', String(on));
    }
  };

  const add = (color: string, label: string): void => {
    const b = mkButton('canva-swatch', { title: label });
    b.style.background = color;
    if (color === NONE) {
      // 흰 견본은 배경과 구분이 안 된다 — 「없음」임을 사선 하나로 알린다(새 CSS 없이 그라디언트로)
      b.style.backgroundImage =
        'linear-gradient(to top right, transparent 45%, var(--color-danger, #d33) 45%, var(--color-danger, #d33) 55%, transparent 55%)';
    }
    // ⚠ click 이 아니라 mousedown+preventDefault — 패널을 클릭할 때 본문 선택이 풀리면
    //    서식이 선택 범위가 아니라 엉뚱한 대기 서식으로 걸린다(패널의 다른 버튼들과 같은 규약).
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // 같은 색을 다시 누르면 해제 — 없음으로 되돌린다(끄려고 대화상자를 여는 일이 없게)
      const next = color === curValue() ? NONE : color;
      deps.applyChar({ shadeColor: next });
      repaint();
    });
    swatches.set(color, b);
    row.appendChild(b);
  };

  add(NONE, '음영 없음');
  for (const [color, label] of SHADES) add(color, `음영 ${label}`);

  repaint();
  sec.appendChild(row);
  host.appendChild(sec);
  deps.onCharChange(() => repaint());
}
