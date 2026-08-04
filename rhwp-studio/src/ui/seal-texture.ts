/**
 * 도장 질감 — 깨끗하게 그린 도장을 "종이에 실제로 찍은 것"처럼 낡히는 후처리.
 *
 * 왜 필요한가: seal-maker 의 drawSeal 은 캔버스 벡터라 획이 수학적으로 매끈하다.
 * 실물 인감은 인주(印朱)를 묻혀 손힘으로 누르는 물건이라 ①테두리가 종이 결에 갉이고
 * ②인주가 고르게 안 묻어 진한 곳·연한 곳이 생기고 ③기포·마른 자리에 작은 구멍이 남는다.
 * 그 세 가지가 없으면 문서에 얹었을 때 스티커처럼 떠 보인다.
 *
 * 설계 원칙 두 가지:
 *  - **알파는 줄이거나 곱하기만 한다** — a=0(투명 배경)은 어떤 연산을 거쳐도 0으로 남는다.
 *    도장은 문서 위에 얹히는 그림이라 배경이 조금이라도 불투명해지면 흰 네모가 생긴다.
 *  - **난수는 시드 기반 자체 구현** — 미리보기는 타이핑마다 다시 그려지는데 Math.random 을
 *    쓰면 글자 하나 칠 때마다 얼룩이 춤춘다. 같은 입력 = 같은 결과여야 눈이 편하다.
 */

export type SealTextureOptions = {
  /** 0=효과 없음 … 1=많이 낡음. 기본 0.5 */
  intensity?: number;
  /** 같은 입력이면 같은 결과가 나오도록 하는 시드(미리보기가 타이핑마다 요동치면 안 된다) */
  seed?: number;
};

/**
 * mulberry32 — 상태가 32bit 정수 하나뿐인 결정적 PRNG.
 * 왜 이것인가: 얼룩·구멍 자리를 정하는 데 통계적 품질은 필요 없고, 의존성 없이 몇 줄로
 * 끝나면서 시드가 1만 달라도 수열이 완전히 갈라지는(= 다른 seed → 다른 그림) 성질이 필요하다.
 */
function makeRng(seed: number): () => number {
  // 시드 0 은 초반 출력이 한쪽으로 쏠린다 — 황금비 상수로 흩어 놓고 시작한다.
  let s = (seed >>> 0) === 0 ? 0x9e3779b9 : seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 얼룩 격자 한 변의 칸 수 — 도장 지름의 1/10 정도가 인주 뭉침의 실제 크기감이다. */
const MOTTLE_CELLS = 10;
/** 구멍 밀도: 픽셀 몇 개당 하나 — 300×300·intensity 0.5 기준 약 32개(눈에 띄되 벌레 먹지 않는 선). */
const PINHOLE_PER_PX = 1400;

/**
 * 투명 배경 위의 도장 그림을 제자리에서 낡힌다.
 * intensity 0 이면 캔버스를 아예 건드리지 않는다(픽셀 단위 동일 보장).
 */
export function applySealTexture(canvas: HTMLCanvasElement, options: SealTextureOptions = {}): void {
  const intensity = Math.min(1, Math.max(0, options.intensity ?? 0.5));
  if (intensity <= 0) return; // 읽고 쓰기만 해도 알파 반올림이 생길 수 있다 — 아예 만지지 않는다
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const rng = makeRng(options.seed ?? 0);

  // 알파 원본 스냅샷 — 침식은 "원래 이웃"을 봐야 한다. 제자리에서 고치면 이미 갉인 값이
  // 다음 픽셀의 이웃이 되어 침식이 한쪽 방향으로 번진다(빗질한 것처럼 쏠린다).
  const a0 = new Uint8Array(w * h);
  for (let i = 0, p = 3; i < a0.length; i++, p += 4) a0[i] = px[p];

  // ② 농담 얼룩용 저주파 잡음 — 격자 값을 만들고 픽셀마다 이중선형 보간한다.
  //    픽셀 단위 난수를 쓰면 모래알(고주파)이 되어 인주 얼룩이 아니라 노이즈로 보인다.
  const gw = MOTTLE_CELLS + 1;
  const grid = new Float32Array(gw * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();

  const erode = 0.9 * intensity;   // 경계 알파를 최대 이만큼 깎는다
  const mottle = 1.1 * intensity;  // 얼룩 진폭

  for (let y = 0; y < h; y++) {
    const fy = (y / h) * MOTTLE_CELLS;
    const gy = fy | 0;
    const ty = fy - gy;
    const rowA = gy * gw;
    const rowB = rowA + gw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = a0[i];
      if (a === 0) continue; // 투명 배경 불가침 — 여기서 걸러야 배경이 절대 살아나지 않는다

      let f = 1;

      // ① 가장자리 침식 — 4이웃 중 가장 옅은 값과의 낙차가 클수록 "획의 바깥 테두리"다.
      //    그 자리만 무작위로 깎으면 도장 안쪽은 그대로 두고 윤곽만 자잘하게 갉인다.
      const up = y > 0 ? a0[i - w] : 0;
      const dn = y < h - 1 ? a0[i + w] : 0;
      const lf = x > 0 ? a0[i - 1] : 0;
      const rt = x < w - 1 ? a0[i + 1] : 0;
      let nmin = up < dn ? up : dn;
      if (lf < nmin) nmin = lf;
      if (rt < nmin) nmin = rt;
      if (nmin < a) f -= rng() * ((a - nmin) / 255) * erode;

      // ② 농담 얼룩 — 저주파 잡음으로 알파를 변조. 중심을 0.55 로 잡아 평균이 1보다 살짝
      //    낮게(= 찍힌 도장은 원본보다 전체적으로 옅다) 떨어지게 했다.
      const fx = (x / w) * MOTTLE_CELLS;
      const gx = fx | 0;
      const tx = fx - gx;
      const t0 = grid[rowA + gx] + (grid[rowA + gx + 1] - grid[rowA + gx]) * tx;
      const t1 = grid[rowB + gx] + (grid[rowB + gx + 1] - grid[rowB + gx]) * tx;
      const n = t0 + (t1 - t0) * ty;
      f *= 1 + (n - 0.55) * mottle;

      const p = i * 4;
      const na = a * f;
      px[p + 3] = na <= 0 ? 0 : na >= 255 ? 255 : na | 0;
      // 인주는 두껍게 묻은 자리가 더 붉고 진하다 — 같은 잡음으로 색도 살짝 흔들어야
      // 알파만 변조했을 때 나오는 "반투명 필름" 느낌을 피한다.
      const tint = 0.9 + n * 0.18;
      px[p] = Math.min(255, px[p] * tint) | 0;
      px[p + 1] = Math.min(255, px[p + 1] * tint) | 0;
      px[p + 2] = Math.min(255, px[p + 2] * tint) | 0;
    }
  }

  // ③ 미세 결손 — 잉크가 안 묻은 자리. 획 위에만 반지름 1~2px 짜리 원을 뚫는다.
  //    ②의 얼룩만으로는 "연해질" 뿐 끊기지 않는데, 실물 도장은 아예 흰 점이 남는다.
  const holes = Math.round(((w * h) / PINHOLE_PER_PX) * intensity);
  for (let k = 0; k < holes; k++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = 0.6 + rng() * 1.4;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * w + x;
        if (a0[i] === 0) continue; // 배경엔 구멍을 뚫지 않는다(뚫을 것도 없다)
        px[i * 4 + 3] = 0;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * 자기검증 — 브라우저 콘솔에서 `import('./seal-texture').then(m => m.__selfCheck())`.
 * 회귀가 나면 전부 "미리보기가 이상하다"는 눈으로만 잡히는 증상이라 수치로 못 박는다.
 */
export function __selfCheck(): void {
  const SIZE = 300;
  const make = (): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, SIZE, SIZE);
    g.strokeStyle = '#c0392b';
    g.fillStyle = '#c0392b';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 8, 0, Math.PI * 2);
    g.stroke();
    g.font = `bold 90px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('印', SIZE / 2, SIZE / 2);
    return c;
  };
  const dump = (c: HTMLCanvasElement): Uint8ClampedArray =>
    c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const base = dump(make());

  // ① intensity 0 = 원본과 픽셀 단위 동일
  const c0 = make();
  applySealTexture(c0, { intensity: 0 });
  console.assert(same(base, dump(c0)), 'seal-texture: intensity 0 인데 픽셀이 변했다');

  // ② 같은 시드 두 번 → 동일 / 다른 시드 → 다름
  const cA = make();
  const cB = make();
  const cC = make();
  applySealTexture(cA, { intensity: 0.5, seed: 7 });
  applySealTexture(cB, { intensity: 0.5, seed: 7 });
  applySealTexture(cC, { intensity: 0.5, seed: 8 });
  const a = dump(cA);
  const b = dump(cB);
  const c = dump(cC);
  console.assert(same(a, b), 'seal-texture: 같은 시드인데 결과가 다르다(미리보기가 요동친다)');
  console.assert(!same(a, c), 'seal-texture: 다른 시드인데 결과가 같다(시드가 안 먹는다)');
  console.assert(!same(base, a), 'seal-texture: intensity 0.5 인데 아무 변화가 없다');

  // ③ 원래 투명했던 픽셀은 여전히 알파 0
  let leaked = 0;
  for (let i = 3; i < base.length; i += 4) if (base[i] === 0 && a[i] !== 0) leaked++;
  console.assert(leaked === 0, `seal-texture: 투명 배경이 ${leaked}px 살아났다`);

  // ④ 300×300 처리 시간 — 타이핑마다 다시 그리므로 한 프레임(16ms) 안에 끝나야 한다
  const cT = make();
  const t = performance.now();
  applySealTexture(cT, { intensity: 1, seed: 3 });
  const ms = performance.now() - t;
  console.assert(ms < 16, `seal-texture: 300×300 처리에 ${ms.toFixed(2)}ms — 16ms 초과`);

  console.log(`[seal-texture] selfCheck ok — ${SIZE}×${SIZE} ${ms.toFixed(2)}ms, 배경 누출 ${leaked}px`);
}
