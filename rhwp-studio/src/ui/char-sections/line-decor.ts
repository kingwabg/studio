/**
 * 「밑줄·취소선」 섹션 — 종류와 색을 패널에서 바로 고른다.
 *
 * 왜: 리본에는 밑줄/취소선 **켜기·끄기**만 있다. 빨간 취소선·이중 밑줄처럼 검토 문서에서
 * 매일 쓰는 조합을 하려면 그때마다 「글자 모양」 대화상자를 열어야 했다.
 *
 * 규칙(char-sections/types.ts 계약):
 *  - 적용은 `deps.applyChar` **한 경로만** — 선택/대기서식과 Ctrl+Z 가 기존과 똑같이 동작한다.
 *  - 새 CSS 없음. 패널이 이미 쓰는 클래스(canva-tog-row/canva-swatch/dialog-select) 재사용.
 */
import { mkEl, mkButton } from '../canva-dom';
import type { CharProperties } from '@/core/types';
import type { CharSectionDeps } from './types';

/** 오른쪽 패널 글자색 팔레트와 같은 8색 — 사용자가 이미 눈에 익힌 배열을 그대로 쓴다. */
const COLORS: [string, string][] = [
  ['#000000', '검정'], ['#dc3545', '빨강'], ['#f59e0b', '주황'], ['#16a34a', '초록'],
  ['#256ef4', '파랑'], ['#7c3aed', '보라'], ['#6b7280', '회색'], ['#ffffff', '흰색'],
];

/** 선 종류 — char-shape-dialog.ts 의 목록과 값이 같아야 대화상자와 왕복이 맞는다(표 27). */
const LINE_SHAPES: [string, string][] = [
  ['0', '실선'], ['1', '긴점선'], ['2', '점선'], ['3', '일점쇄선'], ['4', '이점쇄선'],
  ['5', '긴파선'], ['6', '원형점'], ['7', '이중선'], ['8', '가는+굵은'], ['9', '굵은+가는'],
  ['10', '삼중선'],
];

/** 외곽선 종류 — char-shape-dialog.ts 「기타」와 같은 순서(0=없음). */
const OUTLINE_TYPES = ['없음', '실선', '점선', '굵은 선', '파선', '일점쇄선', '이점쇄선'];

/** 작은 제목 줄 */
function subLabel(text: string): HTMLElement {
  const el = mkEl('div', 'canva-sub-label', text);
  el.style.marginTop = '4px';
  return el;
}

/**
 * 라디오처럼 동작하는 토글 줄. 누른 것만 is-active 로 남긴다.
 * (적용 뒤 패널이 다시 그려질 때까지 기다리지 않고 즉시 표시를 바꾼다 — 눌렀는데
 *  아무 반응 없어 보이는 게 제일 나쁘다.)
 */
function toggleRow(
  items: [value: string, label: string][],
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const row = mkEl('div', 'canva-tog-row');
  const btns: HTMLButtonElement[] = [];
  for (const [value, label] of items) {
    const b = mkButton('canva-tog-btn', { text: label, title: label });
    b.style.fontSize = '12px';               // 이 클래스 기본값(17px)은 아이콘용이라 글자엔 크다
    b.classList.toggle('is-active', value === current);
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();                    // 커서 선택을 잃으면 서식이 엉뚱한 데 걸린다
      btns.forEach((o) => o.classList.toggle('is-active', o === b));
      onPick(value);
    });
    btns.push(b);
    row.appendChild(b);
  }
  return row;
}

/** 색 견본 줄. 지금 색에 링을 둘러 「무슨 색이 걸려 있는지」 보이게 한다. */
function swatchRow(current: string | undefined, onPick: (hex: string) => void): HTMLElement {
  const row = mkEl('div', 'canva-swatches');
  const cur = (current || '').toLowerCase();
  const btns: HTMLButtonElement[] = [];
  for (const [hex, name] of COLORS) {
    const b = mkButton('canva-swatch', { title: name });
    b.style.background = hex;
    b.classList.toggle('is-active', hex === cur);
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btns.forEach((o) => o.classList.toggle('is-active', o === b));
      onPick(hex);
    });
    btns.push(b);
    row.appendChild(b);
  }
  return row;
}

/** 라벨 + 셀렉트 한 줄 */
function selectRow(
  label: string,
  options: [string, string][],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const row = mkEl('div', 'canva-line-row');
  row.appendChild(mkEl('span', 'canva-line-label', label));
  const sel = mkEl('select', 'dialog-select');
  sel.style.width = '108px';
  for (const [value, text] of options) {
    const o = mkEl('option', '', text);
    o.value = value;
    sel.appendChild(o);
  }
  sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(sel);
  return row;
}

export function buildLineDecorSection(host: HTMLElement, deps: CharSectionDeps): void {
  const sec = deps.section('밑줄·취소선');
  // 계약상 host 에 이미 붙어 있지만, 아니면 섹션이 통째로 안 보인다 — 방어 한 줄.
  if (!sec.parentElement) host.appendChild(sec);

  const p: CharProperties = deps.charProps ?? {};

  // 밑줄이 꺼져 있으면 위치는 '없음'으로 본다. underline(불리언)과 underlineType(위치)이
  // 따로 있어서, 둘이 어긋나면(켜짐+None) 화면엔 아무것도 안 그려진다.
  const ulPos = p.underline && p.underlineType && p.underlineType !== 'None' ? p.underlineType
    : p.underline ? 'Bottom' : 'None';

  /** 종류·색만 만졌을 때 밑줄을 자동으로 켠다 — 대화상자(char-shape-dialog)와 같은 규칙. */
  const ulOn = (patch: Partial<CharProperties>) =>
    deps.applyChar({ underline: true, underlineType: ulPos === 'None' ? 'Bottom' : ulPos, ...patch });

  sec.appendChild(subLabel('밑줄 위치'));
  sec.appendChild(toggleRow(
    [['None', '끄기'], ['Bottom', '아래'], ['Top', '위']],
    ulPos,
    (v) => deps.applyChar(v === 'None'
      ? { underline: false, underlineType: 'None' }
      : { underline: true, underlineType: v }),
  ));

  sec.appendChild(selectRow('밑줄 종류', LINE_SHAPES, String(p.underlineShape ?? 0),
    (v) => ulOn({ underlineShape: Number(v) })));

  sec.appendChild(subLabel('밑줄 색'));
  sec.appendChild(swatchRow(p.underlineColor, (hex) => ulOn({ underlineColor: hex })));

  // ── 취소선: 켜기/끄기 + 종류 + 색. (빨간 취소선이 이 섹션을 만든 이유다.)
  sec.appendChild(subLabel('취소선'));
  sec.appendChild(toggleRow(
    [['off', '끄기'], ['on', '켜기']],
    p.strikethrough ? 'on' : 'off',
    (v) => deps.applyChar({ strikethrough: v === 'on' }),
  ));

  sec.appendChild(selectRow('취소선 종류', LINE_SHAPES, String(p.strikeShape ?? 0),
    (v) => deps.applyChar({ strikethrough: true, strikeShape: Number(v) })));

  sec.appendChild(subLabel('취소선 색'));
  sec.appendChild(swatchRow(p.strikeColor, (hex) =>
    deps.applyChar({ strikethrough: true, strikeColor: hex })));

  // ── 외곽선: 0=없음이 곧 끄기라 토글이 따로 필요 없다.
  sec.appendChild(selectRow('외곽선',
    OUTLINE_TYPES.map((lbl, i) => [String(i), lbl] as [string, string]),
    String(p.outlineType ?? 0),
    (v) => deps.applyChar({ outlineType: Number(v) })));
}
