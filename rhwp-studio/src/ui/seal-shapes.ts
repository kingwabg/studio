/**
 * 도장 테두리 모양 — 원·타원·사각·둥근사각, 그리고 "손으로 판" 울퉁불퉁한 윤곽.
 *
 * 왜 따로 있는가: seal-maker.ts 의 drawSeal 은 테두리를 arc() 또는 strokeRect() 로만 그린다.
 * ①모양이 원·사각 둘뿐이라 1~3자용 세로 타원인(印)·둥근 방인을 못 만들고
 * ②선이 수학적으로 매끈해 "동그라미 안의 글자"로 보인다. 실물 인장은 인재(印材)를
 * 칼로 판 물건이라 **윤곽선 자체가** 미세하게 굽고 획 굵기도 자리마다 다르다.
 *
 * ⚠ seal-texture.ts 와 역할이 다르다 — 겹치지 말 것.
 *   - 이 파일: **판각(彫刻)** = 도장 원판의 윤곽이 반듯하지 않다. 벡터를 그리는 단계.
 *   - seal-texture: **날인(捺印)** = 찍힌 뒤 인주가 번지고 갉이고 끊긴다. 픽셀 후처리 단계.
 *   둘은 순서대로 함께 쓰인다(판각 → 날인). 여기서 픽셀을 만지지 않는 이유이기도 하다.
 *
 * 설계 원칙:
 *  - **난수는 시드 기반 자체 구현** — 미리보기는 타이핑마다 다시 그려진다. Math.random 을
 *    쓰면 글자 한 자 칠 때마다 테두리 모양이 춤춘다. 같은 입력 = 같은 도장이어야 한다.
 *  - **흔들림은 저주파 + 고주파 2겹** — 한 겹만 쓰면 톱니(고주파만) 또는 찌그러진 달걀
 *    (저주파만)이 된다. 칼자국은 큰 휨 위에 작은 결이 얹힌 모양이다.
 *  - 배치(글자 놓기)는 여기서 하지 않는다 — sealInnerBox 로 "안쪽 영역"만 알려주고
 *    실제 배치는 seal-layout.ts 가 맡는다(관심사 분리).
 */

export type SealShapeKind = 'circle' | 'ellipse' | 'square' | 'roundSquare';

export type SealShapeOptions = {
  kind: SealShapeKind;
  /** 손으로 판 느낌 — 윤곽선이 불규칙해진다 */
  handmade: boolean;
  /**
   * 수제 흔들림 세기 0~1 (기본 0.5). 1 이 옛 고정값이다.
   * ⚠ 조절값으로 연 이유(2026-08-04): 고정 진폭이 "너무 뒤틀린다"는 지적을 받았다.
   *   손으로 판 느낌은 사람마다 원하는 정도가 다르므로 판단을 사용자에게 넘긴다.
   */
  wobble?: number;
  /**
   * 타원 방향 — true(기본)면 세로로 긴 타원, false 면 가로로 긴 타원.
   * 다른 모양에는 영향이 없다. (2026-08-04 사용자 요청: 세로 토글)
   */
  portrait?: boolean;
  /** 테두리 굵기(px). 0 이면 그리지 않는다 */
  width: number;
  /** 캔버스 대비 테두리 크기 비율 0.5~1.0 (사용자 UI 의 "테두리 크기 %") */
  ratio: number;
  color: string;
  /** 같은 입력이면 같은 울퉁불퉁함 — 타이핑마다 모양이 튀면 안 된다 */
  seed: number;
};

/**
 * 세로로 긴 타원의 가로 비율. 참고 이미지의 타원인은 1~3자용이라 세로가 길다
 * (한 줄 세로쓰기가 들어가는 폭). 0.68 = 가로가 세로의 약 2/3.
 */
const ELLIPSE_RX = 0.68;
/** 둥근사각 모서리 반경 = 반지름 대비 비율. 크기에 비례해야 작은 도장에서 안 뭉개진다. */
const CORNER_RATIO = 0.22;
/** 캔버스 가장자리 여백(px). seal-maker 의 inset(=획 절반 + 3)과 같은 값이라 회귀가 없다. */
const PAD = 3;
/** 수제 윤곽을 몇 조각으로 쪼갤지. 300px 기준 한 조각 ≈ 4px — 눈에 각이 안 보이는 선. */
const SEGMENTS = 240;
/** 한 번의 stroke 로 잇는 조각 수. 이 단위로 획 굵기를 바꾼다(= 칼이 눌린 정도). */
const CHUNK = 10;
/** 저주파(큰 휨) 제어점 수 — 둘레를 이만큼 나눠 흔든다. */
const WOBBLE_NODES = 22;

/**
 * xorshift32 — 상태 32bit 하나짜리 결정적 PRNG.
 * 왜 이것인가: 윤곽 흔들림에 통계적 품질은 필요 없다. 의존성 없이 세 줄이면 되고,
 * 시드가 1만 달라도 몇 스텝 안에 수열이 완전히 갈라진다(다른 seed → 다른 도장).
 * (seal-texture 는 mulberry32 를 쓴다 — 서로 독립이라 한쪽을 고쳐도 다른 쪽이 안 변한다.)
 */
function makeRng(seed: number): () => number {
  // 시드를 한 번 섞는다: 0 과 작은 정수는 xorshift 초반 출력이 한쪽으로 쏠린다.
  let s = (Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  if (s === 0) s = 0x2545f491;
  const next = (): number => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 4; i++) next(); // 예열 — 시드의 흔적을 지운다
  return next;
}

/**
 * 둘레를 도는 매끈한 잡음. t(0~1)를 넣으면 -1~1 을 준다.
 * 제어점을 고리 모양으로 두고 smoothstep 보간 — t=0 과 t=1 이 이어져야 시작점에
 * 이음매(각진 자국)가 남지 않는다.
 */
function makeRing(rng: () => number, nodes: number): (t: number) => number {
  const v = new Float64Array(nodes);
  for (let i = 0; i < nodes; i++) v[i] = rng() * 2 - 1;
  return (t: number): number => {
    const f = (t - Math.floor(t)) * nodes;
    const i = Math.floor(f);
    const k = f - i;
    const s = k * k * (3 - 2 * k); // smoothstep — 선형 보간은 제어점마다 꺾인다
    return v[i % nodes] + (v[(i + 1) % nodes] - v[i % nodes]) * s;
  };
}

/** 중심에서 각도 theta 방향으로 테두리까지의 거리. 모양별 기하가 여기 한 곳에 모인다. */
function boundaryRadius(kind: SealShapeKind, theta: number, hx: number, hy: number, corner: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  if (kind === 'circle' || kind === 'ellipse') {
    // 타원 극좌표식. hx=hy 면 그대로 원이다.
    return (hx * hy) / Math.hypot(hy * c, hx * s);
  }
  const a = Math.abs(c) || 1e-9;
  const b = Math.abs(s) || 1e-9;
  const tx = hx / a; // 세로변(x=±hx)에 닿는 거리
  const ty = hy / b; // 가로변(y=±hy)에 닿는 거리
  if (kind === 'square') return Math.min(tx, ty);
  // 둥근사각: 변에 닿는 지점이 모서리 반경 밖이면 모서리 원호에 닿는다.
  if (tx <= ty && tx * b <= hy - corner) return tx;
  if (ty < tx && ty * a <= hx - corner) return ty;
  // 모서리 원(중심 C, 반경 corner)과 원점에서 나간 반직선의 교점 — 이차방정식.
  const cxq = hx - corner;
  const cyq = hy - corner;
  const dot = a * cxq + b * cyq;
  const disc = dot * dot - (cxq * cxq + cyq * cyq - corner * corner);
  return dot + Math.sqrt(Math.max(0, disc));
}

/**
 * 그릴 반지름 두 개(hx, hy)와 모서리 반경을 정한다.
 * ratio 는 캔버스 대비 크기지만, 획이 캔버스 밖으로 새면 안 되므로 상한을 둔다
 * (ratio=1.0 일 때 정확히 seal-maker 의 종전 inset = width/2 + 3 이 되도록 맞췄다).
 */
function metrics(size: number, o: Pick<SealShapeOptions, 'kind' | 'width' | 'ratio' | 'portrait'>) {
  const ratio = Math.min(1, Math.max(0.5, o.ratio));
  const width = Math.max(0, o.width);
  const limit = size / 2 - width / 2 - PAD;
  const h = Math.max(1, Math.min((size * ratio) / 2, limit));
  // 타원은 한 축만 줄인다. 세로 타원이면 가로를, 가로 타원이면 세로를 줄인다.
  const flat = o.kind === 'ellipse';
  const portrait = o.portrait !== false;
  const hx = flat && portrait ? h * ELLIPSE_RX : h;
  const hy = flat && !portrait ? h * ELLIPSE_RX : h;
  return { hx, hy, corner: o.kind === 'roundSquare' ? h * CORNER_RATIO : 0, width };
}

/**
 * 수제 윤곽이 반지름 방향으로 흔들리는 폭(px).
 * 도장이 커지면 같이 커지되(비율), 획이 굵을수록 칼자국도 굵게 남는다.
 */
function wobbleAmp(hy: number, width: number, wobble = 0.5): number {
  const k = Math.max(0, Math.min(1, wobble));
  return (hy * 0.014 + width * 0.16) * k;
}

/** 테두리를 그린다 */
export function drawSealBorder(ctx: CanvasRenderingContext2D, size: number, o: SealShapeOptions): void {
  const { hx, hy, corner, width } = metrics(size, o);
  if (width <= 0) return; // 글자만 찍는 도장도 실재한다 — 아무것도 그리지 않는다
  const cx = size / 2;
  const cy = size / 2;

  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (!o.handmade) {
    // 매끈한 모양은 네이티브 경로가 정확하고 빠르다(안티에일리어싱도 곡선 쪽이 곱다).
    ctx.lineWidth = width;
    ctx.beginPath();
    if (o.kind === 'circle') ctx.arc(cx, cy, hy, 0, Math.PI * 2);
    else if (o.kind === 'ellipse') ctx.ellipse(cx, cy, hx, hy, 0, 0, Math.PI * 2);
    else if (o.kind === 'square') ctx.rect(cx - hx, cy - hy, hx * 2, hy * 2);
    else ctx.roundRect(cx - hx, cy - hy, hx * 2, hy * 2, corner);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // ── 수제 윤곽 ────────────────────────────────────────────────
  // 큰 휨(저주파) + 잔 결(고주파 3배) 2겹. 잔 결은 진폭을 1/3 로 — 같은 크기로 겹치면
  // 톱니가 되어 "판" 게 아니라 "떨린" 것으로 보인다.
  const rng = makeRng(o.seed);
  const slow = makeRing(rng, WOBBLE_NODES);
  const fast = makeRing(rng, WOBBLE_NODES * 3);
  const inkRing = makeRing(rng, WOBBLE_NODES); // 획 굵기용 — 윤곽과 다른 수열이어야 상관이 안 생긴다
  const amp = wobbleAmp(hy, width, o.wobble);

  const px = new Float64Array(SEGMENTS);
  const py = new Float64Array(SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const th = t * Math.PI * 2;
    // 반지름 방향으로 민다 — 곧은 변에서도 자연스러운 휨이 되고, 모양 종류를 안 가린다.
    const r = boundaryRadius(o.kind, th, hx, hy, corner) + amp * (slow(t) + fast(t) / 3);
    px[i] = cx + r * Math.cos(th);
    py[i] = cy + r * Math.sin(th);
  }

  // 조각 단위로 나눠 그린다 — 굵기는 stroke 당 하나뿐이라 이 방법 말고는 획 굵기를 못 바꾼다.
  // 각 조각은 다음 조각의 첫 점까지 이어 그려 이음매에 틈이 생기지 않게 한다.
  for (let i = 0; i < SEGMENTS; i += CHUNK) {
    ctx.lineWidth = Math.max(0.4, width * (1 + inkRing(i / SEGMENTS) * 0.28));
    ctx.beginPath();
    ctx.moveTo(px[i], py[i]);
    for (let j = 1; j <= CHUNK; j++) {
      const k = (i + j) % SEGMENTS;
      ctx.lineTo(px[k], py[k]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 글자가 들어갈 수 있는 안쪽 영역 — 배치 모듈이 쓴다. 0~1 정규화 */
export function sealInnerBox(o: Pick<SealShapeOptions, 'kind' | 'width' | 'ratio' | 'portrait'>, size: number):
{ x: number; y: number; w: number; h: number } {
  const { hx, hy, corner, width } = metrics(size, o);
  // 획의 안쪽 가장자리까지가 실제로 비어 있는 공간이다.
  // ⚠ handmade 를 인자로 받지 않는다(배치가 모양 옵션마다 흔들리면 안 된다) — 그래서
  //   **수제 흔들림이 안쪽으로 밀고 들어오는 최대치를 항상 빼 둔다**. 매끈한 도장에서
  //   여백이 몇 px 더 생기는 손해보다, 수제에서 글자가 테두리에 닿는 쪽이 훨씬 나쁘다.
  //   1.5 = 저·고주파 2겹의 최대 진폭(1 + 1/3)에 여유 한 줌, 0.15·width = 수제에서 획이
  //   최대 1.28배까지 굵어질 때 안쪽으로 더 번지는 절반(0.64-0.5=0.14)의 몫.
  //   wobble 세기는 여기서 알 수 없으므로 **최대(1)** 를 기준으로 뺀다 — 약하게 준
  //   도장에서 여백이 조금 넉넉해질 뿐이고, 반대로 모자라면 글자가 테두리에 닿는다.
  const bite = wobbleAmp(hy, width, 1) * 1.5 + width * 0.15;
  const ix = Math.max(0, hx - width / 2 - bite);
  const iy = Math.max(0, hy - width / 2 - bite);
  let bw: number;
  let bh: number;
  if (o.kind === 'circle' || o.kind === 'ellipse') {
    // 원/타원의 내접 직사각형 — 모서리가 곡선에 닿으므로 √2 로 줄인다.
    bw = ix * Math.SQRT2;
    bh = iy * Math.SQRT2;
  } else if (o.kind === 'square') {
    bw = ix * 2; // 사각은 안쪽이 그대로 다 쓸 수 있다
    bh = iy * 2;
  } else {
    // 둥근사각은 모서리가 잘린 만큼만 뺀다. 모서리 원의 내접 여유 = corner*(1-1/√2).
    const cut = corner * (1 - Math.SQRT1_2);
    bw = Math.max(0, ix - cut) * 2;
    bh = Math.max(0, iy - cut) * 2;
  }
  return {
    x: (size / 2 - bw / 2) / size,
    y: (size / 2 - bh / 2) / size,
    w: bw / size,
    h: bh / size,
  };
}

/**
 * 자기검증 — 브라우저 콘솔에서 `import('./seal-shapes').then(m => m.__selfCheck())`.
 * 테두리 회귀는 전부 "도장이 좀 이상한데"라는 눈으로만 잡히는 증상이라 수치로 못 박는다.
 */
export function __selfCheck(): boolean {
  const SIZE = 300;
  const KINDS: SealShapeKind[] = ['circle', 'ellipse', 'square', 'roundSquare'];
  let fails = 0;
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails++;
    console.assert(cond, msg);
  };

  const base = (kind: SealShapeKind, handmade: boolean, seed: number, width = 10, ratio = 1): SealShapeOptions =>
    ({ kind, handmade, width, ratio, color: '#c0392b', seed });

  const paint = (o: SealShapeOptions): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    drawSealBorder(c.getContext('2d')!, SIZE, o);
    return c;
  };
  const dump = (c: HTMLCanvasElement): Uint8ClampedArray =>
    c.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  /** 잉크가 있는 픽셀의 경계 상자 + 개수 */
  const inked = (d: Uint8ClampedArray) => {
    let x0 = SIZE; let y0 = SIZE; let x1 = -1; let y1 = -1; let n = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (d[(y * SIZE + x) * 4 + 3] <= 8) continue;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1, n };
  };

  // ① 4종 × handmade 2종 = 8조합이 예외 없이 그려지고, 실제로 잉크가 남는다.
  for (const kind of KINDS) {
    for (const handmade of [false, true]) {
      let n = -1;
      try {
        n = inked(dump(paint(base(kind, handmade, 42)))).n;
      } catch (e) {
        ok(false, `${kind}/handmade=${handmade}: 예외 ${String(e)}`);
        continue;
      }
      ok(n > 200, `${kind}/handmade=${handmade}: 그려진 픽셀 ${n}개 — 너무 적다`);
    }
  }

  // ② 같은 seed 두 번 → 동일 / 다른 seed → 다름 (handmade 일 때)
  for (const kind of KINDS) {
    const a = dump(paint(base(kind, true, 7)));
    const b = dump(paint(base(kind, true, 7)));
    const c = dump(paint(base(kind, true, 8)));
    ok(same(a, b), `${kind}: 같은 seed 인데 모양이 다르다(타이핑마다 튄다)`);
    ok(!same(a, c), `${kind}: 다른 seed 인데 모양이 같다(seed 가 안 먹는다)`);
  }

  // ③ handmade=false 는 seed 와 무관하게 항상 동일
  for (const kind of KINDS) {
    ok(same(dump(paint(base(kind, false, 1))), dump(paint(base(kind, false, 99999)))),
      `${kind}: handmade=false 인데 seed 가 모양을 바꾼다`);
  }

  // ④ width 0 → 캔버스가 완전히 비어 있다
  for (const kind of KINDS) {
    for (const handmade of [false, true]) {
      const n = inked(dump(paint(base(kind, handmade, 3, 0)))).n;
      ok(n === 0, `${kind}/handmade=${handmade}: width 0 인데 ${n}px 가 그려졌다`);
    }
  }

  // ⑤ sealInnerBox 가 캔버스 안이고, 그 안쪽으로 테두리가 침범하지 않는다.
  //    (원형에서 네 모서리가 원 안에 든다는 요구를 "안쪽에 잉크 없음"으로 실측한다 —
  //     기하식을 두 번 쓰면 같은 실수를 두 번 하게 되므로 픽셀로 확인한다.)
  for (const kind of KINDS) {
    const box = sealInnerBox(base(kind, false, 5), SIZE);
    ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1 && box.y + box.h <= 1 && box.w > 0 && box.h > 0,
      `${kind}: innerBox 가 캔버스를 벗어난다 ${JSON.stringify(box)}`);
    const px0 = Math.ceil(box.x * SIZE);
    const py0 = Math.ceil(box.y * SIZE);
    const px1 = Math.floor((box.x + box.w) * SIZE);
    const py1 = Math.floor((box.y + box.h) * SIZE);
    // 매끈 1회 + 수제 여러 시드 — 수제는 시드마다 흔들리는 자리가 달라 한 번으로는 못 믿는다.
    const trials: SealShapeOptions[] = [base(kind, false, 5)];
    for (let s = 1; s <= 12; s++) trials.push(base(kind, true, s));
    for (const opt of trials) {
      const d = dump(paint(opt));
      let hit = 0;
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) if (d[(y * SIZE + x) * 4 + 3] > 8) hit++;
      }
      ok(hit === 0, `${kind}/handmade=${opt.handmade}/seed=${opt.seed}: innerBox 안으로 테두리가 ${hit}px 침범했다`);
    }
    // 원형 요구의 직접 확인: 네 모서리가 그려진 원 안쪽에 든다.
    if (kind === 'circle') {
      const r = Math.hypot(box.x * SIZE - SIZE / 2, box.y * SIZE - SIZE / 2);
      ok(r < SIZE / 2, `circle: innerBox 모서리 거리 ${r.toFixed(1)} ≥ 반지름 ${SIZE / 2}`);
    }
  }

  // ⑥ 타원은 세로가 길다 / 사각은 원보다 넓게 찬다 — 모양이 실제로 구분되는지
  const eb = inked(dump(paint(base('ellipse', false, 1))));
  ok(eb.x1 - eb.x0 < eb.y1 - eb.y0, `ellipse: 가로 ${eb.x1 - eb.x0} 가 세로 ${eb.y1 - eb.y0} 보다 작지 않다`);

  // ⑦ ratio 0.5 와 1.0 의 그려진 픽셀 범위가 실제로 다르다
  for (const kind of KINDS) {
    const small = inked(dump(paint({ ...base(kind, false, 1), ratio: 0.5 })));
    const big = inked(dump(paint({ ...base(kind, false, 1), ratio: 1 })));
    ok(small.x1 - small.x0 < big.x1 - big.x0 && small.y1 - small.y0 < big.y1 - big.y0,
      `${kind}: ratio 0.5(${small.x1 - small.x0}×${small.y1 - small.y0}) 가 1.0(${big.x1 - big.x0}×${big.y1 - big.y0}) 과 구분되지 않는다`);
  }

  console.log(fails === 0 ? 'seal-shapes __selfCheck: PASS' : `seal-shapes __selfCheck: FAIL ${fails}건`);
  return fails === 0;
}
