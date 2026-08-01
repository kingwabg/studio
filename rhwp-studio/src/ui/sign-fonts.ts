/**
 * 「글씨체」 탭 — 이름을 치면 붓글씨·펜글씨로 서명을 만든다.
 * (사용자 요청 2026-08-01: "텍스트로 이름을 쓰면 붓글씨, 펜글씨 등 만들어지고")
 *
 * 글꼴 넷은 public/fonts 에 담았다(전부 OFL-1.1 — LICENSES/OFL-1.1.txt).
 * ⚠ **탭을 열 때 비로소** 내려받는다. 한글 글꼴은 하나가 300~600KB 라, 쓰지도 않을
 *   서명 글꼴 1.5MB 를 편집기 첫 화면에 얹을 이유가 없다.
 *   (같은 이유로 core/font-loader 의 목록에는 넣지 않았다 — 그건 **문서 본문** 글꼴 대장이다.)
 */
import type { SignTab } from './sign-tab';
import { keepCanvasFontFamily } from '@/core/canvas-font-substitution';

/** 렌더 해상도 — 인쇄에서 깨지지 않게 크게 그리고 문서에는 작게 넣는다 */
const W = 1200;
const H = 400;
const PAD = 60;

interface Face {
  key: string;
  /** 사용자에게 보이는 이름 */
  label: string;
  /** CSS/캔버스에서 쓸 글꼴 이름 — 본문 글꼴과 겹치지 않게 접두사를 붙인다 */
  family: string;
  file: string;
  /** 글꼴마다 글자가 차지하는 높이가 달라, 눈으로 맞춘 보정 배율 */
  scale: number;
}

const FACES: Face[] = [
  { key: 'brush', label: '붓글씨', family: 'sgn 붓', file: 'fonts/NanumBrushScript.woff2', scale: 1 },
  { key: 'pen', label: '펜글씨', family: 'sgn 펜', file: 'fonts/NanumPenScript.woff2', scale: 1 },
  { key: 'round', label: '또박또박', family: 'sgn 또박', file: 'fonts/Gaegu.woff2', scale: 0.92 },
  // 정자체는 이미 번들에 있는 글꼴이라 공짜다 — 새로 받지 않는다.
  { key: 'block', label: '정자체', family: 'sgn 정자', file: 'fonts/KoPubWorld-Batang-Bold.woff2', scale: 0.82 },
];

const loaded = new Map<string, Promise<void>>();

// ⚠ 이 등록이 없으면 캔버스 글꼴 치환이 붓글씨·펜글씨를 시스템 글꼴로 바꿔 버려
//   **네 글씨체가 전부 똑같이** 그려진다(wasm-bridge.ts 의 설명 참조).
//   첫 그림부터 제 글씨가 나오도록 내려받기와 무관하게 미리 못 박는다.
for (const f of FACES) keepCanvasFontFamily(f.family);

/** 글꼴 하나를 한 번만 내려받는다. 실패해도 던지지 않는다 — 대체 글꼴로 그려도 서명은 나온다. */
function loadFace(f: Face): Promise<void> {
  let p = loaded.get(f.key);
  if (!p) {
    p = new FontFace(f.family, `url(${f.file}) format('woff2')`)
      .load()
      .then((face) => { document.fonts.add(face); })
      .catch((e) => { console.warn(`[서명] 글꼴 ${f.label} 로드 실패`, e); });
    loaded.set(f.key, p);
  }
  return p;
}

/**
 * 이름을 캔버스 한가운데에 꽉 차게 그린다.
 * 글자 수가 2자든 5자든 같은 크기로 보이도록 **폭·높이 둘 다** 재서 맞춘다.
 */
function paint(canvas: HTMLCanvasElement, name: string, f: Face): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const text = name.trim();
  if (!text) return;

  const probe = 200;
  ctx.font = `${probe}px "${f.family}", serif`;
  const m = ctx.measureText(text);
  const inkH = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || probe;
  const size = Math.floor(probe * Math.min((W - PAD * 2) / m.width, (H - PAD * 2) / inkH) * f.scale);

  ctx.font = `${size}px "${f.family}", serif`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
}

export function createFontTab(onChange: () => void): SignTab {
  const el = document.createElement('div');
  el.className = 'sgn-panel sgn-font';

  const input = document.createElement('input');
  input.className = 'sgn-input';
  input.placeholder = '이름이나 법인명을 넣어 주세요';
  input.maxLength = 20;

  const chips = document.createElement('div');
  chips.className = 'sgn-chips';

  const stage = document.createElement('div');
  stage.className = 'sgn-stage';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'sgn-canvas';
  const hint = document.createElement('div');
  hint.className = 'sgn-placeholder';
  hint.textContent = '이름을 넣으면 서명이 만들어집니다';
  stage.append(canvas, hint);

  el.append(input, chips, stage);

  let face = FACES[0];

  const repaint = () => {
    paint(canvas, input.value, face);
    hint.hidden = !!input.value.trim();
    onChange();
  };

  /** 글꼴이 도착한 뒤 한 번 더 그린다 — 첫 그림은 대체 글꼴로 나오기 때문이다. */
  const useFace = (f: Face) => {
    face = f;
    for (const b of chips.children) {
      (b as HTMLElement).classList.toggle('is-on', (b as HTMLElement).dataset.key === f.key);
    }
    repaint();
    void loadFace(f).then(repaint);
  };

  for (const f of FACES) {
    const b = document.createElement('button');
    b.className = 'sgn-chip';
    b.dataset.key = f.key;
    b.textContent = f.label;
    // 견본 글자를 버튼에 바로 보여 준다 — 이름만으로는 무엇이 다른지 알 수 없다.
    b.style.fontFamily = `"${f.family}", serif`;
    b.addEventListener('click', () => useFace(f));
    chips.appendChild(b);
  }

  input.addEventListener('input', repaint);

  return {
    el,
    canvas,
    label: '글씨체',
    sub: '이름으로 서명을 만듭니다',
    foot: '글씨체를 고르고 이름을 넣으면 바로 만들어집니다. 도장과 함께 써도 됩니다.',
    resetLabel: '지우기',
    isEmpty: () => !input.value.trim(),
    clear: () => { input.value = ''; repaint(); input.focus(); },
    onShow: () => {
      // 견본 버튼이 제 글씨로 보이도록 전부 받아 둔다(탭을 연 뒤라 첫 화면은 이미 떴다).
      for (const f of FACES) void loadFace(f).then(() => { if (f.key === face.key) repaint(); });
      useFace(face);
      input.focus();
    },
  };
}
