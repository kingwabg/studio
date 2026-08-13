/**
 * 그림 개체 속성 패널 — 옛 「개체 속성」 대화상자를 우측 인스펙터로 옮긴 것.
 *
 * 왜 패널인가: 대화상자는 열고 닫아야 하고 문서를 가려서, 값을 바꿔 보며 결과를 확인하는
 * 흐름이 끊겼다. 패널은 늘 보이므로 **바꾼 즉시 문서에서 확인**할 수 있다.
 *
 * ## 규약 셋 (어기면 회귀한다)
 *
 * 1. **ref 를 캐시하지 않는다.** `treatAsChar` 를 뒤집으면 컨트롤이 문단 사이를 옮겨 다녀
 *    ppi/ci 가 바뀐다. 캐시한 ref 로 다음 속성을 쓰면 **다른 개체를 조용히 편집**한다.
 *    그래서 `commit()` 이 매번 `getSelectedPictureRef()` 를 다시 묻는다.
 * 2. **숫자칸은 `change` 에만 커밋한다**(blur/Enter). 타이핑마다 보내면 되돌리기 이력이
 *    한 글자씩 쌓인다. 스위치·세그처럼 클릭이 곧 확정인 것만 즉시 커밋.
 * 3. **안 만진 키는 보내지 않는다.** 예컨대 배치가 우리 5종에 없는 값(Through 등)이면
 *    세그를 전부 끈 채 두고, 사용자가 누르기 전엔 그 키를 patch 에 넣지 않는다 —
 *    "보존"이 곧 "미전송"이다.
 */

import { mkEl, mkButton } from './canva-dom';
import type { CanvaServices } from './canva-services';

const HWPUNIT_PER_MM = 7200 / 25.4;
const toMm = (hu: number | undefined): string => ((hu ?? 0) * 25.4 / 7200).toFixed(2);
const fromMm = (v: string): number => Math.round((parseFloat(v) || 0) * HWPUNIT_PER_MM);

type Opt<T> = [T, string];

const WRAP: Opt<string>[] = [
  ['Square', '어울림'],
  ['TopAndBottom', '자리 차지'],
  ['BehindText', '글 뒤로'],
  ['InFrontOfText', '글 앞으로'],
];
const H_REL: Opt<string>[] = [['Paper', '종이'], ['Page', '쪽'], ['Column', '단'], ['Para', '문단']];
const H_ALIGN: Opt<string>[] = [['Left', '왼쪽'], ['Center', '가운데'], ['Right', '오른쪽'], ['Inside', '안쪽'], ['Outside', '바깥쪽']];
const V_REL: Opt<string>[] = [['Paper', '종이'], ['Page', '쪽'], ['Para', '문단']];
const V_ALIGN: Opt<string>[] = [['Top', '위'], ['Center', '가운데'], ['Bottom', '아래']];
const EFFECT: Opt<string>[] = [['RealPic', '원래 그림'], ['GrayScale', '회색조'], ['BlackWhite', '흑백']];
const QUAD_SIDES: Array<['Top' | 'Bottom' | 'Left' | 'Right', string]> = [
  ['Top', '위'], ['Bottom', '아래'], ['Left', '왼쪽'], ['Right', '오른쪽'],
];

/** 섹션 이름 — 스트립 칩. 재렌더에도 선택이 유지되도록 모듈 스코프에 둔다. */
const SECTIONS = ['크기·회전', '위치', '여백·캡션', '그림'] as const;
type Section = (typeof SECTIONS)[number];
let curSection: Section = '크기·회전';

/** 명령(리본·우클릭)이 특정 섹션을 펴고 싶을 때 */
export function setPictureSection(name: string): void {
  if ((SECTIONS as readonly string[]).includes(name)) curSection = name as Section;
}

// ── 컨트롤 조각 ────────────────────────────────────────────────────

function switchRow(label: string, on: boolean, onChange: (v: boolean) => void, disabled = false): HTMLElement {
  const row = mkEl('label', 'tps-switch-row');
  const input = mkEl('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = on;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(input, mkEl('span', 'tps-switch-track'), mkEl('span', 'tps-switch-label', label));
  return row;
}

function segRow<T>(label: string, opts: Opt<T>[], cur: T | null, onChange: (v: T) => void): HTMLElement {
  const row = mkEl('div', 'tps-field');
  if (label) row.appendChild(mkEl('span', 'tps-label', label));
  const seg = mkEl('div', 'tps-seg');
  for (const [value, text] of opts) {
    const b = mkButton('tps-seg-btn', { text });
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

function numRow(
  label: string, value: string, unit: string,
  onChange: (v: string) => void,
  opts: { step?: string; disabled?: boolean } = {},
): HTMLElement {
  const row = mkEl('div', 'tps-row');
  row.appendChild(mkEl('span', 'tps-label', label));
  const input = mkEl('input', 'tps-input') as HTMLInputElement;
  input.type = 'number';
  input.step = opts.step ?? '0.1';
  input.value = value;
  input.disabled = !!opts.disabled;
  input.addEventListener('change', () => onChange(input.value));
  row.append(input, mkEl('span', 'tps-unit', unit));
  return row;
}

/** 한 줄에 숫자칸 둘(너비·높이 같은 짝) */
function pairRow(
  label: string, a: string, b: string, unit: string,
  onA: (v: string) => void, onB: (v: string) => void,
  disabled = false,
): HTMLElement {
  const row = mkEl('div', 'tps-row');
  row.appendChild(mkEl('span', 'tps-label', label));
  const mk = (val: string, on: (v: string) => void, title: string) => {
    const i = mkEl('input', 'tps-input tps-input-sm') as HTMLInputElement;
    i.type = 'number';
    i.step = '0.1';
    i.value = val;
    i.title = title;
    i.disabled = disabled;
    i.addEventListener('change', () => on(i.value));
    return i;
  };
  row.append(mk(a, onA, '가로'), mk(b, onB, '세로'), mkEl('span', 'tps-unit', unit));
  return row;
}

function select<T extends string>(opts: Opt<T>[], cur: T, onChange: (v: T) => void): HTMLSelectElement {
  const sel = mkEl('select', 'tps-select') as HTMLSelectElement;
  for (const [value, text] of opts) {
    const o = mkEl('option', '', text) as HTMLOptionElement;
    o.value = value;
    sel.appendChild(o);
  }
  sel.value = cur;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

/** "단 의 왼쪽 기준 0.00mm" 처럼 한 줄로 읽히는 위치 행 */
function composeRow(
  label: string, icon: string,
  relOpts: Opt<string>[], rel: string, onRel: (v: string) => void,
  alignOpts: Opt<string>[], align: string, onAlign: (v: string) => void,
  offset: string, onOffset: (v: string) => void,
): HTMLElement {
  const row = mkEl('div', 'tps-compose');
  const head = mkEl('span', 'tps-label');
  head.innerHTML = `<i class="ph-duotone ph-${icon}"></i>${label}`;
  const input = mkEl('input', 'tps-input tps-input-sm') as HTMLInputElement;
  input.type = 'number';
  input.step = '0.1';
  input.value = offset;
  input.addEventListener('change', () => onOffset(input.value));
  row.append(head,
    select(relOpts, rel, onRel), mkEl('span', 'tps-txt', '의'),
    select(alignOpts, align, onAlign), mkEl('span', 'tps-txt', '기준'),
    input, mkEl('span', 'tps-unit', 'mm'));
  return row;
}

/** 네 변 여백/자르기 — 값 넷을 나열하는 대신 어느 변인지 보이게 */
function quadRow(
  title: string,
  values: Record<'Top' | 'Bottom' | 'Left' | 'Right', string>,
  onChange: (side: 'Top' | 'Bottom' | 'Left' | 'Right', v: string) => void,
): HTMLElement {
  const card = mkEl('div', 'pps-quad');
  card.appendChild(mkEl('div', 'pps-quad-title', title));
  const grid = mkEl('div', 'pps-quad-grid');
  for (const [side, label] of QUAD_SIDES) {
    const cell = mkEl('div', 'pps-quad-cell');
    cell.appendChild(mkEl('span', 'pps-quad-label', label));
    const input = mkEl('input', 'tps-input tps-input-sm') as HTMLInputElement;
    input.type = 'number';
    input.step = '0.1';
    input.value = values[side];
    input.addEventListener('change', () => onChange(side, input.value));
    cell.appendChild(input);
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  return card;
}

// ── 본체 ───────────────────────────────────────────────────────────

/**
 * 그림 속성 패널을 host 에 그린다. 그림 선택이 아니거나 속성을 못 읽으면 false.
 * @param redraw 의존 컨트롤이 바뀌는 편집(배치·크기 고정·캡션 유무) 뒤에 호출된다.
 */
export function buildPicturePanel(
  host: HTMLElement,
  services: CanvaServices,
  redraw: () => void,
): boolean {
  const ih = services.getInputHandler() as any;
  if (!ih) return false;
  const ref0 = ih.cursor?.getSelectedPictureRef?.();
  if (!ref0) return false;
  let props: any = null;
  try { props = ih.getObjectProperties?.(ref0); } catch { props = null; }
  if (!props) return false;

  /** 되돌리기 한 칸으로 묶는 실행기 */
  const run = (fn: () => void): void => {
    try {
      ih.executeOperation?.({
        kind: 'snapshot',
        operationType: 'objectProps',
        operation: () => { fn(); return ih.getCursorPosition?.() ?? ih.getPosition?.(); },
      });
    } catch { fn(); }
  };

  /**
   * 유일한 쓰기 창구 — 상호 잠금과 no-op 차단을 여기 한 곳에서 한다.
   * ref 는 매번 다시 묻는다(위 규약 1).
   */
  const commit = (patch: Record<string, unknown>): void => {
    const ref = ih.cursor?.getSelectedPictureRef?.();
    if (!ref) return;
    const p: Record<string, unknown> = { ...patch };
    // 크기 고정이면 크기·회전·대칭을 못 바꾼다(대화상자와 같은 규칙)
    if (props.sizeProtect) {
      for (const k of ['width', 'height', 'rotationAngle', 'horzFlip', 'vertFlip']) delete p[k];
    }
    // 글자처럼 취급이면 위치 관련 키는 의미가 없다
    if (props.treatAsChar) {
      for (const k of ['textWrap', 'horzRelTo', 'horzAlign', 'horzOffset',
        'vertRelTo', 'vertAlign', 'vertOffset', 'restrictInPage', 'allowOverlap']) delete p[k];
    }
    // 쪽 영역 제한을 켜면 겹침 허용은 꺼진다
    if (p.restrictInPage === true) p.allowOverlap = false;
    // [정렬 이동 2026-08-13] 엔진은 기준/정렬을 **오프셋 없이** 바꾸면 rebase 로 개체를
    // 제자리에 붙든다("같은 자리를 다른 잣대로 다시 재라"). 그래서 정렬만 보내면
    // 「가운데」를 눌러도 안 움직였다(신고). 정렬을 바꿀 때는 현재 오프셋을 함께 실어
    // 그 opt-out(명시 오프셋 동봉)을 발동시킨다 — 개체가 새 정렬 기준으로 이동한다.
    // 기준(rel_to)만 바꿀 때는 일부러 안 싣는다: 잣대만 바꾸는 것이니 제자리가 맞다.
    if (p.horzAlign !== undefined && p.horzOffset === undefined) {
      p.horzOffset = props.horzOffset ?? 0;
    }
    if (p.vertAlign !== undefined && p.vertOffset === undefined) {
      p.vertOffset = props.vertOffset ?? 0;
    }
    // 값이 그대로면 스냅샷을 만들지 않는다(되돌리기 이력 낭비 차단)
    // 동봉한 오프셋은 "값이 같아도 보내야 하는" 키라 변경 판정에서 뺀다
    const meaningful = Object.keys(p).filter((k) =>
      !((k === 'horzOffset' && p.horzAlign !== undefined && patch.horzOffset === undefined)
        || (k === 'vertOffset' && p.vertAlign !== undefined && patch.vertOffset === undefined)));
    const changed = meaningful.some((k) => props[k] !== p[k]);
    if (!changed || Object.keys(p).length === 0) return;
    run(() => ih.setObjectProperties?.(ref, p));
    Object.assign(props, p);
  };

  // ── 섹션 스트립 ──
  const strip = mkEl('div', 'canva-sec-strip');
  for (const name of SECTIONS) {
    const b = mkButton('canva-sec-btn', { text: name });
    b.classList.toggle('is-on', name === curSection);
    b.dataset.section = name;
    b.addEventListener('click', () => { curSection = name; redraw(); });
    strip.appendChild(b);
  }
  host.appendChild(strip);

  const body = mkEl('div', 'pps-body');
  host.appendChild(body);

  if (curSection === '크기·회전') buildSize(body, props, commit, redraw);
  else if (curSection === '위치') buildPosition(body, props, commit, redraw);
  else if (curSection === '여백·캡션') buildMargin(body, props, commit, redraw);
  else buildImage(body, props, commit);

  return true;
}

type Commit = (patch: Record<string, unknown>) => void;

function buildSize(body: HTMLElement, props: any, commit: Commit, redraw: () => void): void {
  const locked = !!props.sizeProtect;
  body.appendChild(switchRow('크기 고정', locked, (v) => { commit({ sizeProtect: v }); redraw(); }));
  if (locked) {
    const note = mkEl('div', 'pps-note', '크기 고정이 켜져 있어 크기·회전·대칭을 바꿀 수 없습니다.');
    body.appendChild(note);
  }
  body.appendChild(pairRow('크기', toMm(props.width), toMm(props.height), 'mm',
    (v) => commit({ width: fromMm(v) }),
    (v) => commit({ height: fromMm(v) }), locked));

  // 배율 — 원본 대비 %. 원본 크기를 모르면 감춘다.
  const ow = Number(props.originalWidth) || 0;
  const oh = Number(props.originalHeight) || 0;
  if (ow > 0 && oh > 0) {
    const pct = (cur: number, org: number) => String(Math.round((cur / org) * 100));
    body.appendChild(pairRow('배율', pct(props.width, ow), pct(props.height, oh), '%',
      (v) => commit({ width: Math.round(ow * (parseFloat(v) || 100) / 100) }),
      (v) => commit({ height: Math.round(oh * (parseFloat(v) || 100) / 100) }), locked));
    const presets = mkEl('div', 'tps-field');
    presets.appendChild(mkEl('span', 'tps-label', '빠른 배율'));
    const seg = mkEl('div', 'tps-seg');
    for (const p of [50, 75, 100, 150, 200]) {
      const b = mkButton('tps-seg-btn', { text: `${p}%` });
      b.addEventListener('click', () => {
        commit({ width: Math.round(ow * p / 100), height: Math.round(oh * p / 100) });
        redraw();
      });
      seg.appendChild(b);
    }
    presets.appendChild(seg);
    if (!locked) body.appendChild(presets);
  }

  body.appendChild(numRow('회전각', String(props.rotationAngle ?? 0), '°',
    (v) => commit({ rotationAngle: Math.round(parseFloat(v) || 0) }), { step: '1', disabled: locked }));

  const flip = mkEl('div', 'tps-field');
  flip.appendChild(mkEl('span', 'tps-label', '대칭'));
  const fseg = mkEl('div', 'tps-seg');
  // 좌우·상하는 서로 배타가 아니라 **각각 켜고 끄는 토글**이라 segRow 대신 직접 만든다
  ([['좌우', 'horzFlip'], ['상하', 'vertFlip']] as Array<[string, string]>).forEach(([txt, key]) => {
    const b = mkButton('tps-seg-btn', { text: txt });
    b.classList.toggle('is-on', !!props[key]);
    if (locked) b.setAttribute('disabled', 'true');
    b.addEventListener('click', () => {
      if (locked) return;
      commit({ [key]: !props[key] });
      redraw();
    });
    fseg.appendChild(b);
  });
  flip.appendChild(fseg);
  body.appendChild(flip);
}

function buildPosition(body: HTMLElement, props: any, commit: Commit, redraw: () => void): void {
  const inline = !!props.treatAsChar;
  body.appendChild(switchRow('글자처럼 취급', inline, (v) => { commit({ treatAsChar: v }); redraw(); }));
  if (inline) {
    body.appendChild(mkEl('div', 'pps-note',
      '글자처럼 취급하면 본문 글자 흐름을 따라가므로 배치·위치를 정할 수 없습니다.'));
    return;
  }
  // 배치가 우리 목록에 없는 값이면 아무 칸도 켜지 않는다(누르기 전엔 그 키를 안 보낸다)
  const wrapCur = WRAP.some(([v]) => v === props.textWrap) ? props.textWrap : null;
  body.appendChild(segRow('본문과의 배치', WRAP, wrapCur, (v) => { commit({ textWrap: v }); redraw(); }));
  body.appendChild(composeRow('가로', 'arrows-horizontal',
    H_REL, props.horzRelTo ?? 'Column', (v) => commit({ horzRelTo: v }),
    H_ALIGN, props.horzAlign ?? 'Left', (v) => commit({ horzAlign: v }),
    toMm(props.horzOffset), (v) => commit({ horzOffset: fromMm(v) })));
  body.appendChild(composeRow('세로', 'arrows-vertical',
    V_REL, props.vertRelTo ?? 'Para', (v) => commit({ vertRelTo: v }),
    V_ALIGN, props.vertAlign ?? 'Top', (v) => commit({ vertAlign: v }),
    toMm(props.vertOffset), (v) => commit({ vertOffset: fromMm(v) })));
  body.appendChild(switchRow('쪽 영역 안으로 제한', !!props.restrictInPage,
    (v) => { commit({ restrictInPage: v }); redraw(); }));
  body.appendChild(switchRow('서로 겹침 허용', !!props.allowOverlap,
    (v) => commit({ allowOverlap: v }), !!props.restrictInPage));
}

function buildMargin(body: HTMLElement, props: any, commit: Commit, redraw: () => void): void {
  body.appendChild(quadRow('바깥 여백', {
    Top: toMm(props.outerMarginTop), Bottom: toMm(props.outerMarginBottom),
    Left: toMm(props.outerMarginLeft), Right: toMm(props.outerMarginRight),
  }, (side, v) => commit({ [`outerMargin${side}`]: fromMm(v) })));

  const hasCaption = !!props.hasCaption;
  body.appendChild(switchRow('캡션 넣기', hasCaption, (v) => { commit({ hasCaption: v }); redraw(); }));
  if (hasCaption) {
    body.appendChild(segRow('캡션 위치',
      [['Left', '왼쪽'], ['Right', '오른쪽'], ['Top', '위'], ['Bottom', '아래']] as Opt<string>[],
      props.captionDirection ?? 'Bottom',
      (v) => commit({ hasCaption: true, captionDirection: v })));
    body.appendChild(numRow('개체와의 간격', toMm(props.captionSpacing), 'mm',
      (v) => commit({ hasCaption: true, captionSpacing: fromMm(v) })));
  }
}

function buildImage(body: HTMLElement, props: any, commit: Commit): void {
  body.appendChild(quadRow('그림 자르기', {
    Top: toMm(props.cropTop), Bottom: toMm(props.cropBottom),
    Left: toMm(props.cropLeft), Right: toMm(props.cropRight),
  }, (side, v) => commit({ [`crop${side}`]: fromMm(v) })));

  const effCur = EFFECT.some(([v]) => v === props.effect) ? props.effect : null;
  body.appendChild(segRow('그림 효과', EFFECT, effCur, (v) => commit({ effect: v })));
  body.appendChild(numRow('밝기', String(props.brightness ?? 0), '',
    (v) => commit({ brightness: Math.round(parseFloat(v) || 0) }), { step: '1' }));
  body.appendChild(numRow('대비', String(props.contrast ?? 0), '',
    (v) => commit({ contrast: Math.round(parseFloat(v) || 0) }), { step: '1' }));
  if (props.transparency !== undefined) {
    body.appendChild(numRow('투명도', String(props.transparency ?? 0), '%',
      (v) => commit({ transparency: Math.round(parseFloat(v) || 0) }), { step: '1' }));
  }

  const desc = mkEl('div', 'tps-row');
  desc.appendChild(mkEl('span', 'tps-label', '설명문'));
  const ta = mkEl('textarea', 'pps-desc') as HTMLTextAreaElement;
  ta.rows = 2;
  ta.value = String(props.description ?? '');
  ta.addEventListener('change', () => commit({ description: ta.value }));
  desc.appendChild(ta);
  body.appendChild(desc);
}
