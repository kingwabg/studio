/**
 * 도장 탭 — 이름을 넣으면 개인·법인 도장을 만든다 (2026-08-04 개편).
 *
 * 왜 seal-maker.ts 에서 떼어냈나: 참고 화면(모양 프리셋 8종 · 개인/법인 · 법인 전용
 * 조절 6종)을 담자 탭 하나가 모달 전체보다 커졌다. 모달 껍데기(탭 전환·내려받기·문서
 * 삽입)와 도장 만드는 일은 바뀌는 이유가 달라 같이 두면 둘 다 읽기 어려워진다.
 *
 * 그리는 일은 셋으로 나뉘어 있고 여기서는 **조립만** 한다:
 *   seal-shapes.ts     테두리 모양 4종 × 매끈/수제
 *   seal-layout.ts     개인 도장 글자 배치(현대/전통)
 *   seal-corporate.ts  법인 도장(이중 원·호 텍스트·중앙 글자·마커)
 *   seal-texture.ts    찍힌 뒤 인주가 번진 자국(위 셋 공통 후처리)
 *
 * 전부 브라우저 안에서 끝난다 — 아무 데도 보내지 않는다.
 */
import type { SignTab } from './sign-tab';
import { keepCanvasFontFamily } from '@/core/canvas-font-substitution';
import { layoutSealChars, type SealOrder, type SealShape } from './seal-layout';
import { applySealTexture } from './seal-texture';
import { drawSealBorder, sealInnerBox, type SealShapeKind } from './seal-shapes';
import { drawCorporateSeal, type CenterMarker } from './seal-corporate';

const SIZE = 300; // 도장 렌더 해상도(px)

/**
 * 도장 글꼴 — **이미 번들에 있는 것만** 쓴다(public/fonts, 라이선스는 LICENSES/ 에 정리됨).
 *
 * ⚠ 전서체(篆書)는 넣지 않았다(2026-08-04 조사). 한글 전서체는 라이선스가 깨끗한 것이
 *   없고(유통되는 HJ한전서 계열은 저작권자 실체 미확인), 애초에 2011년 행정안전부가
 *   관인 서체를 전서체 → 한글로 바꿔 현행 기준과도 어긋난다. 한자 전용 전서 폰트
 *   (全字庫 등)는 OFL 로 깨끗하지만 한글 이름을 못 찍어 쓸모가 없다.
 *   도장 인상은 폰트보다 **프레임·인주색·꽉 찬 배치**에서 나온다 — 그쪽에 힘을 줬다.
 */
type SealFace = { key: string; label: string; family: string; file?: string; scale: number };

const SEAL_FACES: SealFace[] = [
  { key: 'batang', label: '굵은 명조', family: 'seal 명조', file: 'fonts/KoPubWorld-Batang-Bold.woff2', scale: 1 },
  { key: 'square', label: '각진 고딕', family: 'seal 각진', file: 'fonts/NanumSquareEB.woff2', scale: 0.96 },
  { key: 'round', label: '둥근 고딕', family: 'seal 둥근', file: 'fonts/NanumSquareRoundEB.woff2', scale: 0.96 },
  { key: 'brush', label: '붓글씨', family: 'seal 붓', file: 'fonts/NanumBrushScript.woff2', scale: 1.1 },
  { key: 'pen', label: '펜글씨', family: 'seal 펜', file: 'fonts/NanumPenScript.woff2', scale: 1.1 },
  { key: 'hcr', label: '함초롬바탕', family: 'HCR Batang", "함초롬바탕', scale: 1 },
];

// ⚠ 없으면 캔버스 글꼴 치환이 이 글꼴들을 시스템 글꼴로 바꿔 전부 똑같이 그린다
//   (sign-fonts.ts 의 같은 주석 참조).
for (const f of SEAL_FACES) keepCanvasFontFamily(f.family);

const fontLoaded = new Map<string, Promise<void>>();
/** 한 번만 내려받는다. 실패해도 던지지 않는다 — 대체 글꼴로 그려도 도장은 나온다. */
function loadFace(key: string, after: () => void): void {
  const f = SEAL_FACES.find((x) => x.key === key);
  if (!f?.file || fontLoaded.has(f.key)) return;
  fontLoaded.set(
    f.key,
    new FontFace(f.family, `url(${f.file}) format('woff2')`)
      .load()
      .then((face) => { document.fonts.add(face); after(); })
      .catch((e) => { console.warn(`[도장] 글꼴 ${f.label} 로드 실패`, e); }),
  );
}

function familyOf(key: string): string {
  const f = SEAL_FACES.find((x) => x.key === key) ?? SEAL_FACES[0];
  return `"${f.family}", serif`;
}
function faceScale(key: string): number {
  return (SEAL_FACES.find((x) => x.key === key) ?? SEAL_FACES[0]).scale;
}

/** 참고 화면의 프리셋 8종 = 모양 4종 × (매끈 / 수제) */
type Preset = { key: string; label: string; kind: SealShapeKind; handmade: boolean; chars: string };
const PRESETS: Preset[] = [
  { key: 'ellipse', label: '타원형', kind: 'ellipse', handmade: false, chars: '1~3자' },
  { key: 'circle', label: '원형', kind: 'circle', handmade: false, chars: '2~4자' },
  { key: 'square', label: '정사각형', kind: 'square', handmade: false, chars: '2~4자' },
  { key: 'round', label: '둥근사각형', kind: 'roundSquare', handmade: false, chars: '2~4자' },
  { key: 'h-ellipse', label: '수제타원형', kind: 'ellipse', handmade: true, chars: '1~3자' },
  { key: 'h-circle', label: '수제원형', kind: 'circle', handmade: true, chars: '2~4자' },
  { key: 'h-square', label: '수제정사각형', kind: 'square', handmade: true, chars: '2~4자' },
  { key: 'h-round', label: '수제둥근사각형', kind: 'roundSquare', handmade: true, chars: '2~4자' },
];

/** 법인 도장 가운데 글자 — 직함이라 몇 개 안 된다. 직접 입력도 받는다. */
const CENTER_PRESETS = ['代表理事', '代表', '理事長', '院長', '센터장', '대표'];

type SealStyle = {
  target: 'personal' | 'corporate';
  preset: string;
  sealMark: boolean;
  face: string;
  order: SealOrder;
  texture: number;
  color: string;
  /** 테두리 굵기(px) */
  border: number;
  /** 테두리 크기 — 캔버스 대비 0.5~1.0 */
  ratio: number;
  /** 글씨 크기 배율 */
  scale: number;
  centerText: string;
  centerFace: string;
  centerSize: number;
  marker: CenterMarker;
};

/**
 * ⚠ 기본값은 종전 도장과 같게 잡는다 — preset 'circle'(매끈 원형) · 현대 배치 ·
 *   테두리 10px · ratio 1.0. texture 만 0.35 로 켠다(매끈함이 이 작업의 출발점이었다).
 */
const DEFAULT_STYLE: SealStyle = {
  target: 'personal', preset: 'circle', sealMark: true, face: 'batang', order: 'modern',
  texture: 0.35, color: '#c0392b', border: 10, ratio: 1, scale: 1,
  centerText: '代表理事', centerFace: 'batang', centerSize: 50, marker: 'dot',
};

/** 이름이 같으면 얼룩·수제 윤곽도 같아야 한다 — 타이핑마다 모양이 튀면 미리보기를 못 믿는다. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 모양 4종 → 배치 모듈이 아는 2종. 타원은 원처럼, 둥근사각은 사각처럼 앉힌다. */
function layoutShapeOf(kind: SealShapeKind): SealShape {
  return kind === 'ellipse' || kind === 'circle' ? 'circle' : 'square';
}

function presetOf(key: string): Preset {
  return PRESETS.find((p) => p.key === key) ?? PRESETS[1];
}

export function drawSeal(canvas: HTMLCanvasElement, name: string, style: SealStyle): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const seed = seedOf(`${name}|${style.preset}|${style.order}|${style.target}`);

  if (style.target === 'corporate') {
    drawCorporateSeal(canvas, {
      outerText: name,
      centerText: style.centerText,
      outerFont: familyOf(style.face),
      centerFont: familyOf(style.centerFace),
      centerSize: style.centerSize,
      outerSize: Math.round(style.scale * 45),
      marker: style.marker,
      color: style.color,
      borderWidth: style.border,
      ratio: style.ratio,
    });
  } else {
    const p = presetOf(style.preset);
    drawSealBorder(ctx, SIZE, {
      kind: p.kind, handmade: p.handmade, width: style.border,
      ratio: style.ratio, color: style.color, seed,
    });

    // 글자는 테두리가 만든 안쪽 영역에 앉힌다 — 테두리를 줄이면 글자도 따라 줄어야
    // 도장 비율이 유지된다. 배치 좌표(0~1)를 그 박스로 옮기는 것이 여기서 하는 일 전부다.
    const box = sealInnerBox({ kind: p.kind, width: style.border, ratio: style.ratio }, SIZE);
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fam = familyOf(style.face);
    const fs = faceScale(style.face);
    for (const g of layoutSealChars(name, layoutShapeOf(p.kind), style.order, style.sealMark)) {
      const px = (box.x + g.x * box.w) * SIZE;
      const py = (box.y + g.y * box.h) * SIZE;
      const size = Math.round(SIZE * g.size * style.scale * fs * Math.min(box.w, box.h) / 0.9);
      ctx.font = `bold ${size}px ${fam}`;
      ctx.fillText(g.char, px, py);
    }
  }

  // 인주 자국 — 개인·법인 공통. 벡터로 그린 뒤 후처리한다.
  applySealTexture(canvas, { intensity: style.texture, seed });
}

export function createSealTab(onChange: () => void): SignTab {
  const el = document.createElement('div');
  el.className = 'sgn-panel sgn-seal';
  const style: SealStyle = { ...DEFAULT_STYLE };

  // ── 개인 / 법인 ─────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'sgn-row';
  const seg = document.createElement('div');
  seg.className = 'sgn-seg';
  const segBtns: HTMLButtonElement[] = (['personal', 'corporate'] as const).map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t === 'personal' ? '개인' : '법인';
    b.addEventListener('click', () => { style.target = t; syncTarget(); repaint(); });
    seg.appendChild(b);
    return b;
  });
  const input = document.createElement('input');
  input.className = 'sgn-input';
  input.placeholder = '이름 (1~4자)';
  input.maxLength = 12;
  head.append(seg, input);

  // ── 모양 프리셋 8종 ─────────────────────────────────────
  const shapes = document.createElement('div');
  shapes.className = 'sgn-shapes';
  const shapeCards = PRESETS.map((p) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sgn-shape';
    card.title = `${p.label} · ${p.chars}`;
    const thumb = document.createElement('canvas');
    thumb.width = 84; thumb.height = 84;
    // 카드 그림은 실제 그리는 함수로 만든다 — 그림과 결과가 어긋날 수 없다.
    drawSealBorder(thumb.getContext('2d')!, 84, {
      kind: p.kind, handmade: p.handmade, width: 4, ratio: 0.88, color: '#c0392b', seed: 7,
    });
    const nm = document.createElement('span');
    nm.className = 'sgn-shape-name';
    nm.textContent = p.label;
    card.append(thumb, nm);
    card.addEventListener('click', () => { style.preset = p.key; syncShape(); repaint(); });
    shapes.appendChild(card);
    return card;
  });

  // ── 글꼴·배치 ───────────────────────────────────────────
  const opts = document.createElement('div');
  opts.className = 'sgn-row';
  const faceSel = document.createElement('select');
  faceSel.className = 'sgn-select';
  faceSel.innerHTML = SEAL_FACES.map((f) => `<option value="${f.key}">${f.label}</option>`).join('');
  faceSel.title = '도장 글꼴';
  faceSel.addEventListener('change', () => { style.face = faceSel.value; loadFace(style.face, repaint); repaint(); });
  const orderSel = document.createElement('select');
  orderSel.className = 'sgn-select';
  orderSel.innerHTML = '<option value="modern">현대 배치</option><option value="traditional">전통 배치</option>';
  orderSel.title = '전통은 오른쪽→왼쪽, 위→아래로 읽습니다';
  orderSel.addEventListener('change', () => { style.order = orderSel.value as SealOrder; repaint(); });
  opts.append(faceSel, orderSel);

  // ── 조절 ────────────────────────────────────────────────
  const slider = (label: string, min: number, max: number, step: number, value: number,
                  onInput: (v: number) => void) => {
    const wrap = document.createElement('label');
    wrap.className = 'sgn-slider';
    const nm = document.createElement('span');
    nm.className = 'sgn-slider-name';
    nm.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min); range.max = String(max); range.step = String(step);
    range.value = String(value);
    range.addEventListener('input', () => onInput(Number(range.value)));
    wrap.append(nm, range);
    return wrap;
  };

  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'sgn-color';
  color.value = style.color;
  color.title = '인주 색';
  color.addEventListener('input', () => { style.color = color.value; repaint(); });

  const markToggle = document.createElement('label');
  markToggle.className = 'sgn-check';
  markToggle.title = '3자 이름 뒤에 印 을 붙입니다 (한자)';
  const markBox = document.createElement('input');
  markBox.type = 'checkbox';
  markBox.checked = style.sealMark;
  markBox.addEventListener('change', () => { style.sealMark = markBox.checked; repaint(); });
  const markText = document.createElement('span');
  markText.textContent = '印';
  markToggle.append(markBox, markText);

  const tune1 = document.createElement('div');
  tune1.className = 'sgn-row sgn-tune';
  tune1.append(
    color,
    slider('글씨', 0.6, 1.4, 0.05, style.scale, (v) => { style.scale = v; repaint(); }),
    slider('테두리', 0, 20, 1, style.border, (v) => { style.border = v; repaint(); }),
  );
  const tune2 = document.createElement('div');
  tune2.className = 'sgn-row sgn-tune';
  tune2.append(
    slider('크기', 0.5, 1, 0.01, style.ratio, (v) => { style.ratio = v; repaint(); }),
    slider('질감', 0, 1, 0.05, style.texture, (v) => { style.texture = v; repaint(); }),
    markToggle,
  );

  // ── 법인 전용 ───────────────────────────────────────────
  const corp = document.createElement('div');
  corp.className = 'sgn-corp';
  const corpRow = document.createElement('div');
  corpRow.className = 'sgn-row';
  const centerSel = document.createElement('select');
  centerSel.className = 'sgn-select';
  centerSel.innerHTML = CENTER_PRESETS.map((t) => `<option value="${t}">${t}</option>`).join('');
  centerSel.value = style.centerText;
  centerSel.title = '가운데 글자';
  centerSel.addEventListener('change', () => { style.centerText = centerSel.value; repaint(); });
  const centerFaceSel = document.createElement('select');
  centerFaceSel.className = 'sgn-select';
  centerFaceSel.innerHTML = SEAL_FACES.map((f) => `<option value="${f.key}">${f.label}</option>`).join('');
  centerFaceSel.title = '가운데 글꼴';
  centerFaceSel.addEventListener('change', () => {
    style.centerFace = centerFaceSel.value; loadFace(style.centerFace, repaint); repaint();
  });
  const markerSeg = document.createElement('div');
  markerSeg.className = 'sgn-seg';
  const markerBtns = (['dot', 'star', 'diamond', 'none'] as const).map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = { dot: '도트', star: '별', diamond: '다이아', none: '없음' }[m];
    b.addEventListener('click', () => { style.marker = m; syncMarker(); repaint(); });
    markerSeg.appendChild(b);
    return b;
  });
  corpRow.append(centerSel, centerFaceSel, markerSeg);
  const corpTune = document.createElement('div');
  corpTune.className = 'sgn-row sgn-tune';
  corpTune.append(slider('중앙 크기', 20, 90, 1, style.centerSize, (v) => { style.centerSize = v; repaint(); }));
  corp.append(corpRow, corpTune);

  // ── 견본판 ──────────────────────────────────────────────
  const stage = document.createElement('div');
  stage.className = 'sgn-stage sgn-stage-sm';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.className = 'sgn-canvas sgn-canvas-sq';
  const hint = document.createElement('div');
  hint.className = 'sgn-placeholder';
  hint.textContent = '이름을 넣으면 도장이 만들어집니다';
  stage.append(canvas, hint);

  el.append(head, shapes, opts, tune1, tune2, corp, stage);

  function syncTarget() {
    segBtns[0].classList.toggle('is-on', style.target === 'personal');
    segBtns[1].classList.toggle('is-on', style.target === 'corporate');
    // 법인은 원형 이중 원이 정본이라 모양 카드·배치·印 이 의미가 없다.
    const isCorp = style.target === 'corporate';
    shapes.hidden = isCorp;
    orderSel.hidden = isCorp;
    markToggle.hidden = isCorp;
    corp.hidden = !isCorp;
    input.placeholder = isCorp ? '회사·기관명' : '이름 (1~4자)';
  }
  function syncShape() {
    shapeCards.forEach((c, i) => c.classList.toggle('is-on', PRESETS[i].key === style.preset));
  }
  function syncMarker() {
    const keys = ['dot', 'star', 'diamond', 'none'];
    markerBtns.forEach((b, i) => b.classList.toggle('is-on', keys[i] === style.marker));
  }

  function repaint() {
    drawSeal(canvas, input.value, style);
    hint.hidden = !!input.value.trim();
    onChange();
  }
  input.addEventListener('input', repaint);

  syncTarget(); syncShape(); syncMarker();

  return {
    el,
    canvas,
    label: '도장',
    sub: '개인·법인 도장을 만듭니다',
    foot: '2자는 세로, 4자는 2×2. 3자는 印 을 켜면 2×2, 끄면 3자 그대로입니다.',
    resetLabel: '지우기',
    isEmpty: () => !input.value.trim(),
    clear: () => { input.value = ''; repaint(); input.focus(); },
    onShow: () => { loadFace(style.face, repaint); repaint(); input.focus(); },
  };
}
