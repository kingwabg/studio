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
      .then((face) => { document.fonts.add(face); inkCache.clear(); after(); })
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
  /** 3자 이름 뒤에 붙일 글자 — 한자 印 / 한글 인 / 안 붙임 */
  sealMark: 'hanja' | 'hangul' | 'none';
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
  /** 수제 윤곽이 흔들리는 세기 0~1 */
  wobble: number;
  /** 타원 방향 — 세로(기본) / 가로 */
  portrait: boolean;
  /** 전각(篆刻) 채움 — 글자를 제 칸에 꽉 채워 늘린다 */
  carve: boolean;
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
  target: 'personal', preset: 'circle', sealMark: 'hanja', face: 'batang', order: 'modern',
  texture: 0.35, color: '#c0392b', border: 10, ratio: 1, scale: 1, wobble: 0.4, portrait: true, carve: true,
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

/**
 * 글자 하나를 그려 **실제 잉크가 차지한 사각형을 픽셀로 잰다.**
 *
 * ⚠ measureText 의 actualBoundingBox* 로 기준선을 계산해 맞추던 것을 버렸다
 *   (2026-08-04). 수식은 맞는데 결과가 세로로 31px 씩 떴다 — 부호를 뒤집어 가며
 *   맞추는 것은 확신에 찬 오답이 되기 쉽다. 픽셀을 세면 글꼴·글자와 무관하게 정확하다.
 *
 * 결과는 캐시한다(글자·글꼴당 한 번). 글꼴이 늦게 오면 모양이 바뀌므로 그때 비운다.
 */
const inkCache = new Map<string, { cv: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null>();

function glyphInk(char: string, font: string) {
  const key = `${char}|${font}`;
  if (inkCache.has(key)) return inkCache.get(key);
  const S = 160;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `bold ${Math.round(S * 0.62)}px ${font}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#000';
  c.fillText(char, S / 2, S / 2);
  const d = c.getImageData(0, 0, S, S).data;
  let x0 = S, x1 = -1, y0 = S, y1 = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (d[(y * S + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const box = x1 < 0 ? null : { cv, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (inkCache.size > 400) inkCache.clear();
  inkCache.set(key, box);
  return box;
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
      kind: p.kind, handmade: p.handmade, wobble: style.wobble, portrait: style.portrait,
      width: style.border, ratio: style.ratio, color: style.color, seed,
    });

    // 글자는 테두리가 만든 안쪽 영역에 앉힌다 — 테두리를 줄이면 글자도 따라 줄어야
    // 도장 비율이 유지된다. 배치 좌표(0~1)를 그 박스로 옮기는 것이 여기서 하는 일 전부다.
    const box = sealInnerBox({ kind: p.kind, width: style.border, ratio: style.ratio, portrait: style.portrait }, SIZE);
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fam = familyOf(style.face);
    const fs = faceScale(style.face);
    let glyphs = layoutSealChars(name, layoutShapeOf(p.kind), style.order,
      style.sealMark !== 'none', style.sealMark === 'hangul' ? '인' : '印');
    /**
     * 타원은 한 줄로 세운다(가로 타원이면 눕힌다) — 참고 화면의 타원형이 그 모양이고,
     * 좁고 긴 칸에 2×2 를 넣으면 글자가 서로 먹는다. 印 붙임 여부는 배치가 이미 정했다.
     */
    /**
     * 3자인데 印 을 껐다 — 2×2 의 오른쪽 아래가 비어 무게중심이 왼쪽 위로 쏠린다
     * (사용자 지적 2026-08-04). 마지막 글자를 아랫줄 **가운데**로 내려 두 칸을 걸치게 한다.
     */
    if (glyphs.length === 3 && p.kind !== 'ellipse') {
      glyphs = glyphs.map((g, i) => (i === 2 ? { ...g, x: 0.5 } : g));
    }
    if (p.kind === 'ellipse' && glyphs.length > 1) {
      const n = glyphs.length;
      const step = 1 / n;
      glyphs = glyphs.map((g, i) => style.portrait
        ? { ...g, x: 0.5, y: step * (i + 0.5), size: g.size }
        : { ...g, x: step * (i + 0.5), y: 0.5, size: g.size });
    }

    /**
     * 전각(篆刻) 채움 — 글자를 제 칸에 **꽉 차게 늘린다**.
     *
     * 왜: 도장 서체(고인체·인전체·전서체…)의 인상은 획 모양보다 **글자가 칸을 남김없이
     * 채워 테두리에 닿는 것**에서 나온다. 그 폰트들은 전부 도장 제작소 상용이라 번들할
     * 수 없지만(2026-08-04 라이선스 조사), 채움은 폰트 없이 흉내 낼 수 있다 —
     * 글자마다 실제 잉크 상자를 재서 칸 크기로 비균일 확대하면 된다.
     *
     * 칸 크기는 배치가 정하는 모양을 그대로 따른다: 1자=칸 전체, 2자=위아래 반, 3·4자=2×2.
     */
    const n = glyphs.length;
    const line = p.kind === 'ellipse' && n > 1; // 타원은 한 줄
    const cols = line ? (style.portrait ? 1 : n) : n >= 3 ? 2 : 1;
    const rows = line ? (style.portrait ? n : 1) : n === 1 ? 1 : 2;
    const GAP = 0.9; // 칸끼리 딱 붙으면 글자가 서로 먹는다 — 한 줌만 띄운다
    const cellW = (box.w / cols) * GAP * SIZE;
    const cellH = (box.h / rows) * GAP * SIZE;
    /** 아랫줄 가운데로 내려온 3번째 글자는 두 칸을 걸친다 — 폭도 그만큼 준다. */
    const wideIndex = glyphs.length === 3 && p.kind !== 'ellipse' ? 2 : -1;

    /**
     * 블록 전체를 도형 한가운데로 옮긴다.
     * 배치 좌표는 칸 격자 기준이라, 글자 수·모양에 따라 덩어리가 한쪽으로 치우칠 수 있다
     * — 실제로 그려질 자리들의 외곽을 재서 그 중심을 도형 중심에 맞춘다(모든 모양 공통).
     */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    glyphs.forEach((g, i) => {
      const w = (i === wideIndex ? cellW * 2 : cellW) * style.scale;
      const h = cellH * style.scale;
      const cx = (box.x + g.x * box.w) * SIZE;
      const cy = (box.y + g.y * box.h) * SIZE;
      minX = Math.min(minX, cx - w / 2); maxX = Math.max(maxX, cx + w / 2);
      minY = Math.min(minY, cy - h / 2); maxY = Math.max(maxY, cy + h / 2);
    });
    const dx = SIZE / 2 - (minX + maxX) / 2;
    const dy = SIZE / 2 - (minY + maxY) / 2;

    glyphs.forEach((g, gi) => {
      const px = (box.x + g.x * box.w) * SIZE + dx;
      const py = (box.y + g.y * box.h) * SIZE + dy;
      const ink = style.carve ? glyphInk(g.char, fam) : null;
      if (ink) {
        // 잰 잉크 상자를 칸에 그대로 눌러 넣는다 — 위치·크기 둘 다 계산이 필요 없다.
        const w = (gi === wideIndex ? cellW * 2 : cellW) * style.scale;
        const h = cellH * style.scale;
        const tint = document.createElement('canvas');
        tint.width = Math.max(1, Math.round(w));
        tint.height = Math.max(1, Math.round(h));
        const tc = tint.getContext('2d')!;
        tc.drawImage(ink.cv, ink.x, ink.y, ink.w, ink.h, 0, 0, tint.width, tint.height);
        // 검은 실루엣에 도장 색을 입힌다(색이 조절값이라 미리 칠해 둘 수 없다).
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = style.color;
        tc.fillRect(0, 0, tint.width, tint.height);
        ctx.drawImage(tint, px - w / 2, py - h / 2, w, h);
      } else {
        const size = Math.round(SIZE * g.size * style.scale * fs * Math.min(box.w, box.h) / 0.9);
        ctx.font = `bold ${size}px ${fam}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(g.char, px, py);
      }
    });
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
      kind: p.kind, handmade: p.handmade, wobble: DEFAULT_STYLE.wobble,
      width: 4, ratio: 0.88, color: '#c0392b', seed: 7,
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
  /**
   * 수치 조절 한 칸 — [−] [ 42 ] [+] 와 단위.
   *
   * ⚠ 슬라이더에서 바꿨다(2026-08-04 사용자 요청). 슬라이더는 **지금 값이 얼마인지
   *   안 보이고** 같은 값을 다시 맞추기도 어렵다. 도장은 "저번과 같은 크기"가 자주
   *   필요하므로 눈에 보이는 수치와 한 칸씩 밟는 버튼이 맞다.
   *
   * 내부 값은 0.6 같은 배율인데 화면에는 60% 처럼 보여야 읽기 쉽다 — scale 로 환산한다.
   */
  const numField = (
    label: string,
    opt: { min: number; max: number; step: number; unit?: string; scale?: number },
    value: number,
    onChange: (v: number) => void,
  ) => {
    const k = opt.scale ?? 1;
    const wrap = document.createElement('label');
    wrap.className = 'sgn-num';
    const nm = document.createElement('span');
    nm.className = 'sgn-num-name';
    nm.textContent = label;
    const dec = document.createElement('button');
    dec.type = 'button'; dec.className = 'sgn-num-btn'; dec.textContent = '−';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'sgn-num-input';
    input.min = String(Math.round(opt.min * k));
    input.max = String(Math.round(opt.max * k));
    input.step = String(Math.max(1, Math.round(opt.step * k)));
    input.value = String(Math.round(value * k));
    const inc = document.createElement('button');
    inc.type = 'button'; inc.className = 'sgn-num-btn'; inc.textContent = '+';
    const unit = document.createElement('span');
    unit.className = 'sgn-num-unit';
    unit.textContent = opt.unit ?? '';

    const commit = (shown: number) => {
      const lo = opt.min * k, hi = opt.max * k;
      const v = Math.min(hi, Math.max(lo, shown));
      input.value = String(Math.round(v));
      onChange(v / k);
    };
    const bump = (dir: number) => commit(Number(input.value) + dir * Math.max(1, Math.round(opt.step * k)));
    dec.addEventListener('click', () => bump(-1));
    inc.addEventListener('click', () => bump(1));
    input.addEventListener('input', () => { if (input.value !== '') commit(Number(input.value)); });
    // 빈 칸으로 뒀다가 포커스를 잃으면 마지막 값으로 되돌린다 — 빈 값이 남으면 NaN 이 된다.
    input.addEventListener('blur', () => { if (input.value === '') commit(value * k); });

    wrap.append(nm, dec, input, inc, unit);
    return wrap;
  };

  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'sgn-color';
  color.value = style.color;
  color.title = '인주 색';
  color.addEventListener('input', () => { style.color = color.value; repaint(); });

  // 3자 이름 뒤에 붙일 글자 — 한자를 안 쓰는 사람도 있어 한글 「인」과 「없음」을 함께 둔다.
  const markToggle = document.createElement('div');
  markToggle.className = 'sgn-seg';
  markToggle.title = '3자 이름 뒤에 붙일 글자';
  const markBtns = (['hanja', 'hangul', 'none'] as const).map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = { hanja: '印', hangul: '인', none: '없음' }[k];
    b.addEventListener('click', () => { style.sealMark = k; syncMark(); repaint(); });
    markToggle.appendChild(b);
    return b;
  });
  const syncMark = () => {
    const keys = ['hanja', 'hangul', 'none'];
    markBtns.forEach((b, i) => b.classList.toggle('is-on', keys[i] === style.sealMark));
  };

  const tune1 = document.createElement('div');
  tune1.className = 'sgn-row sgn-tune';
  tune1.append(
    color,
    numField('글씨', { min: 0.6, max: 1.4, step: 0.05, unit: '%', scale: 100 }, style.scale,
      (v) => { style.scale = v; repaint(); }),
    numField('테두리', { min: 0, max: 20, step: 1, unit: 'px' }, style.border,
      (v) => { style.border = v; repaint(); }),
  );
  const wobbleSlider = numField('수제', { min: 0, max: 1, step: 0.05, unit: '%', scale: 100 }, style.wobble,
    (v) => { style.wobble = v; repaint(); });
  wobbleSlider.title = '손으로 판 윤곽이 얼마나 울퉁불퉁한지';

  // 타원 방향 — 타원 프리셋일 때만 뜻이 있다.
  const portToggle = document.createElement('label');
  portToggle.className = 'sgn-check';
  portToggle.title = '끄면 가로로 긴 타원이 됩니다';
  const portBox = document.createElement('input');
  portBox.type = 'checkbox';
  portBox.checked = style.portrait;
  portBox.addEventListener('change', () => { style.portrait = portBox.checked; repaint(); });
  const portText = document.createElement('span');
  portText.textContent = '세로';
  portToggle.append(portBox, portText);

  // 전각 채움 — 도장 서체의 인상을 폰트 없이 내는 핵심 스위치라 늘 보이게 둔다.
  const carveToggle = document.createElement('label');
  carveToggle.className = 'sgn-check';
  carveToggle.title = '글자를 칸에 꽉 채워 도장 서체처럼 보이게 합니다';
  const carveBox = document.createElement('input');
  carveBox.type = 'checkbox';
  carveBox.checked = style.carve;
  carveBox.addEventListener('change', () => { style.carve = carveBox.checked; repaint(); });
  const carveText = document.createElement('span');
  carveText.textContent = '전각';
  carveToggle.append(carveBox, carveText);

  const tune2 = document.createElement('div');
  tune2.className = 'sgn-row sgn-tune';
  tune2.append(
    numField('크기', { min: 0.5, max: 1, step: 0.01, unit: '%', scale: 100 }, style.ratio,
      (v) => { style.ratio = v; repaint(); }),
    numField('질감', { min: 0, max: 1, step: 0.05, unit: '%', scale: 100 }, style.texture,
      (v) => { style.texture = v; repaint(); }),
    markToggle,
  );
  const tune3 = document.createElement('div');
  tune3.className = 'sgn-row sgn-tune';
  tune3.append(wobbleSlider, portToggle, carveToggle);

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
  corpTune.append(numField('중앙 크기', { min: 20, max: 90, step: 1 }, style.centerSize,
    (v) => { style.centerSize = v; repaint(); }));
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

  el.append(head, shapes, opts, tune1, tune2, tune3, corp, stage);

  function syncTarget() {
    segBtns[0].classList.toggle('is-on', style.target === 'personal');
    segBtns[1].classList.toggle('is-on', style.target === 'corporate');
    // 법인은 원형 이중 원이 정본이라 모양 카드·배치·印 이 의미가 없다.
    const isCorp = style.target === 'corporate';
    shapes.hidden = isCorp;
    orderSel.hidden = isCorp;
    markToggle.hidden = isCorp;
    corp.hidden = !isCorp;
    // 수제 세기는 수제 프리셋일 때만 뜻이 있다 — 매끈한 모양에서 보이면 눌러도 안 변한다.
    syncTune3();
    input.placeholder = isCorp ? '회사·기관명' : '이름 (1~4자)';
  }
  function syncShape() {
    shapeCards.forEach((c, i) => c.classList.toggle('is-on', PRESETS[i].key === style.preset));
    syncTune3();
  }
  /** 세 번째 조절 줄은 해당 모양에서만 뜻이 있는 것들만 담는다 — 안 먹는 조절이 보이면 헷갈린다. */
  function syncTune3() {
    const p = presetOf(style.preset);
    const corp = style.target === 'corporate';
    wobbleSlider.hidden = corp || !p.handmade;
    portToggle.hidden = corp || p.kind !== 'ellipse';
    carveToggle.hidden = corp;
    tune3.hidden = wobbleSlider.hidden && portToggle.hidden && carveToggle.hidden;
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

  syncTarget(); syncShape(); syncMarker(); syncMark(); syncTune3();

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
