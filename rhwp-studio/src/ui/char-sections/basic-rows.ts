/**
 * 글자 탭 「기본」 — 라벨-값 40px 행 목록 (2026-08-12, claude.ai/design 「Studio 인스펙터」 이식).
 *
 * 디자인이 요구하는 것: 섹션 두 개(글자 모양 / 채우기)를 각각 40px 행으로. 라벨은 왼쪽,
 * 값·조작기는 오른쪽 끝. 값이 한눈에 읽히고, 만질 것은 그 자리에 있다.
 *
 * ⚠ 이 파일은 종전 방침을 **뒤집는다**. types.ts 는 "리본에 이미 있는 것(굵게·글자색·
 *   형광펜…)은 패널에 다시 넣지 않는다"고 적었고 2026-08-01 에 실제로 걷어냈다.
 *   이번 디자인은 그것들을 **행 형태로** 되살린다 — 옛 섹션형(칩·팔레트가 세로로 쌓이던
 *   것)과 달리 한 행 40px 이라 자리를 거의 안 먹고, 리본이 안 보이는 좁은 화면에서
 *   값을 읽는 창구가 된다. 되돌린 것이 아니라 형태를 바꿔 다시 넣은 것이다.
 *
 * ⚠ 「음영」과 「형광펜」은 **엔진에서 같은 필드**(CharProperties.shadeColor)다.
 *   디자인은 두 행으로 그렸지만 값은 하나다 — 음영 행이 현재 값을 보여 주고,
 *   형광펜 행은 자주 쓰는 색 바로가기다. 둘을 독립 값처럼 만들면 서로 덮어쓴다.
 *   '#ffffff' 가 "없음" 규약(char-shape-dialog·toolbar 와 동일).
 */
import { getLocalFonts } from '@/core/local-fonts';
import { mkEl, mkButton } from '../canva-dom';
import type { CharSectionDeps } from './types';

const BASE_FONTS = ['함초롬바탕', '함초롬돋움', '맑은 고딕', '나눔고딕', '바탕', '돋움', '궁서'];
/** 형광펜 바로가기 — 한컴 팔레트에서 가장 많이 쓰는 셋 + 없음 */
const HILITE = ['#FFB114', '#228738', '#B1CEFB'];
const NONE = '#ffffff';

const norm = (c?: string): string => (c ?? NONE).toLowerCase();

/** 라벨-값 40px 행 한 줄. 오른쪽 조작기는 호출자가 채운다. */
function row(host: HTMLElement, label: string): HTMLElement {
  const el = mkEl('div', 'canva-row');
  el.appendChild(mkEl('span', 'canva-row-label', label));
  const right = mkEl('div', 'canva-row-value');
  el.appendChild(right);
  host.appendChild(el);
  return right;
}

/** 섹션 머리 — 34px 회색 띠 + 오른쪽 링크(선택) */
function head(host: HTMLElement, title: string, link?: { text: string; onClick: () => void }): void {
  const el = mkEl('div', 'canva-rowsec-head');
  el.appendChild(mkEl('h3', 'canva-rowsec-title', title));
  if (link) {
    const b = mkButton('canva-rowsec-link', { text: link.text });
    b.addEventListener('click', link.onClick);
    el.appendChild(b);
  }
  host.appendChild(el);
}

function swatch(color: string, ring = false): HTMLElement {
  const s = mkEl('span', 'canva-row-swatch');
  s.style.background = color;
  if (ring) s.classList.add('is-on');
  return s;
}

/** 색 고르기 — 네이티브 색 입력을 스와치에 겹쳐 둔다(별도 팔레트를 새로 만들지 않는다). */
function colorPicker(current: string, onPick: (c: string) => void): HTMLElement {
  const wrap = mkEl('label', 'canva-row-color');
  const hex = mkEl('span', 'canva-row-hex', norm(current) === NONE ? '없음' : current.toUpperCase());
  const sw = swatch(current, true);
  const input = document.createElement('input');
  input.type = 'color';
  input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
  input.className = 'canva-row-colorinput';
  input.addEventListener('input', () => onPick(input.value));
  wrap.append(hex, sw, input);
  return wrap;
}

/** 글자 모양 — 글꼴 · 크기 · 스타일 · 글자색 */
export function buildCharShapeRows(host: HTMLElement, deps: CharSectionDeps): void {
  head(host, '글자 모양', {
    text: '초기화',
    onClick: () => {
      // 리본 기본값으로 되돌린다. 색·음영은 규약값('#000000'·'#ffffff')이 곧 "기본".
      deps.applyChar({
        bold: false, italic: false, underline: false,
        textColor: '#000000', shadeColor: NONE,
      });
      deps.redraw();
    },
  });

  // ── 글꼴 ──
  {
    const right = row(host, '글꼴');
    const cur = deps.charProps?.fontFamily ?? '함초롬바탕';
    const sel = document.createElement('select');
    sel.className = 'canva-row-select';
    const names = [...new Set([...BASE_FONTS, ...getLocalFonts()])];
    if (!names.includes(cur)) names.unshift(cur);
    sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
    sel.value = cur;
    sel.addEventListener('change', () => deps.applyChar({ fontFamily: sel.value }));
    right.appendChild(sel);
  }

  // ── 크기 (− [10] +) ──
  {
    const right = row(host, '크기');
    // fontSize 는 HWPUNIT — 1pt = 100. 화면에는 pt 로 보인다.
    const pt = Math.round((deps.charProps?.fontSize ?? 1000) / 100);
    const box = mkEl('div', 'canva-row-step');
    const dec = mkButton('canva-row-stepbtn', { text: '−' });
    const input = document.createElement('input');
    input.className = 'canva-row-stepinput';
    input.value = String(pt);
    const inc = mkButton('canva-row-stepbtn', { text: '+' });
    const commit = (v: number) => {
      const p = Math.max(4, Math.min(300, Math.round(v)));
      input.value = String(p);
      deps.applyChar({ fontSize: p * 100 });
    };
    dec.addEventListener('click', () => commit(Number(input.value) - 1));
    inc.addEventListener('click', () => commit(Number(input.value) + 1));
    input.addEventListener('change', () => commit(Number(input.value) || pt));
    box.append(dec, input, inc);
    right.appendChild(box);
  }

  // ── 스타일 (가 가 가) ──
  {
    const right = row(host, '스타일');
    const g = mkEl('div', 'canva-row-btns');
    const STYLES: Array<['bold' | 'italic' | 'underline', string, string]> = [
      ['bold', '굵게', 'b'],
      ['italic', '기울임', 'i'],
      ['underline', '밑줄', 'u'],
    ];
    STYLES.forEach(([key, title, kind]) => {
      const b = mkButton(`canva-row-style is-${kind}`, { title });
      b.textContent = '가';
      const sync = () => b.classList.toggle('is-on', deps.getCharProps()?.[key] === true);
      sync();
      b.addEventListener('click', () => {
        // ⚠ 누를 때 값을 **다시 읽는다** — 그릴 때의 스냅숏으로 토글하면 커서를 옮긴 뒤
        //   낡은 값으로 뒤집힌다(types.ts 가 경고한 2026-08-03 실결함).
        const on = deps.getCharProps()?.[key] === true;
        deps.applyChar({ [key]: !on });
        b.classList.toggle('is-on', !on);
      });
      deps.onCharChange(sync);
      g.appendChild(b);
    });
    right.appendChild(g);
  }
  // ── 글자색 ──
  {
    const right = row(host, '글자색');
    right.appendChild(colorPicker(deps.charProps?.textColor ?? '#000000',
      (c) => deps.applyChar({ textColor: c })));
  }
}

/** 채우기 — 음영 · 형광펜 · 테두리 · 문단 전체 적용 */
export function buildFillRows(host: HTMLElement, deps: CharSectionDeps): void {
  head(host, '채우기');

  // ── 음영 (= shadeColor 본체) ──
  {
    const right = row(host, '음영');
    right.appendChild(colorPicker(deps.charProps?.shadeColor ?? NONE,
      (c) => { deps.applyChar({ shadeColor: c }); deps.redraw(); }));
  }

  // ── 형광펜 (같은 shadeColor 의 바로가기) ──
  {
    const right = row(host, '형광펜');
    right.title = '형광펜과 음영은 같은 값입니다 — 자주 쓰는 색 바로가기';
    const g = mkEl('div', 'canva-row-btns');
    const cur = norm(deps.charProps?.shadeColor);
    for (const c of HILITE) {
      const s = swatch(c, norm(c) === cur);
      s.addEventListener('click', () => { deps.applyChar({ shadeColor: c }); deps.redraw(); });
      g.appendChild(s);
    }
    const off = mkEl('span', 'canva-row-swatch is-none', '없음');
    off.addEventListener('click', () => { deps.applyChar({ shadeColor: NONE }); deps.redraw(); });
    g.appendChild(off);
    right.appendChild(g);
  }

  // ── 테두리(외곽선) ──
  {
    const right = row(host, '테두리');
    const sel = document.createElement('select');
    sel.className = 'canva-row-select';
    // outlineType 0~6 — 엔진 정의 순서 그대로. 0 이 없음.
    const LABELS = ['없음', '실선', '점선', '굵은 실선', '이중선', '파선', '일점쇄선'];
    sel.innerHTML = LABELS.map((l, i) => `<option value="${i}">${l}</option>`).join('');
    sel.value = String(deps.charProps?.outlineType ?? 0);
    sel.addEventListener('change', () => deps.applyChar({ outlineType: Number(sel.value) }));
    right.appendChild(sel);
  }

  // ── 문단 전체 적용 ──
  {
    const right = row(host, '문단 전체 적용');
    right.title = '켜면 이후 서식 변경이 선택 영역이 아니라 커서가 있는 문단 전체에 걸립니다';
    const sw = mkEl('span', 'canva-row-toggle');
    const knob = mkEl('span', 'canva-row-knob');
    sw.appendChild(knob);
    sw.classList.toggle('is-on', paraWide);
    sw.addEventListener('click', () => {
      paraWide = !paraWide;
      sw.classList.toggle('is-on', paraWide);
    });
    right.appendChild(sw);
  }
}

/**
 * 「문단 전체 적용」 상태 — 모듈 수준에 두는 이유: 패널은 탭을 옮길 때마다 다시 그려지는데
 * 이 스위치는 사용자의 **작업 방식**이라 그리기와 함께 초기화되면 안 된다.
 */
let paraWide = false;
export function isParaWideApply(): boolean { return paraWide; }
