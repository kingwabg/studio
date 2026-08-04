/**
 * 법인(회사) 도장 그리기 — 순수 Canvas 2D.
 *
 * 왜 개인 도장(seal-maker.ts 의 drawSeal)과 따로 두는가:
 * 개인 인장은 "네모난 판에 글자 2~4자를 격자로 앉히는" 문제라 seal-layout.ts 의 정규화
 * 좌표 하나면 끝난다. 법인 인장은 그림이 아예 다르다 — **이중 원 + 원주를 도는 호(arc)
 * 텍스트 + 12시 마커**가 필수고, 이 셋의 반지름이 서로를 밀어낸다(바깥 글자가 커지면
 * 안쪽 원이 작아지고, 안쪽 원이 작아지면 가운데 글자를 줄여야 한다). 격자 배치 코드에
 * 이 반지름 연쇄를 끼워 넣으면 양쪽 다 망가지므로 모듈을 분리했다.
 *
 * 이 파일의 심장은 arcText() 의 각도 계산이다 — 아래 주석에 유도 과정을 남겼다.
 */

export type CenterMarker = 'dot' | 'star' | 'diamond' | 'none';

export type CorporateSealOptions = {
  /** 원주를 따라 도는 바깥 글자 — 회사명 등 */
  outerText: string;
  /** 안쪽 원 가운데 글자 — 보통 '代表理事'(2×2) */
  centerText: string;
  outerFont: string;   // CSS font-family 문자열
  centerFont: string;
  /** 0~100 UI 값 — 안쪽 글자 크기 */
  centerSize: number;
  /** 0~100 UI 값 — 바깥 글자 크기 */
  outerSize: number;
  marker: CenterMarker;
  color: string;
  /** 테두리 굵기 px */
  borderWidth: number;
  /** 캔버스 대비 바깥 원 비율 0.5~1.0 */
  ratio: number;
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * 글자 하나가 차지하는 나눔각(32°)과 전체 최대 스팬(300°).
 * 왜 상수인가: "위쪽 절반에 놓되 글자가 많으면 아래까지 돈다"를 만족하려면 스팬이
 * 글자 수에 비례해야 한다(2자=64°, 4자=128° → 위쪽 절반 안, 8자=256° → 아래까지).
 * 300° 상한은 아래 6시 부근이 완전히 닫혀 시작·끝 글자가 맞붙는 걸 막는다 —
 * 상한에 걸려도 **각도는 여전히 균등 분배**라 간격만 촘촘해질 뿐이다.
 */
const PER_CHAR = (32 * Math.PI) / 180;
const MAX_SPAN = (300 * Math.PI) / 180;

/** UI 0~100 → 캔버스 변 대비 글자 크기. 0 이어도 안 보이면 안 되므로 하한이 있다. */
const outerPx = (S: number, ui: number): number => S * (0.045 + clamp(ui, 0, 100) / 100 * 0.085);
const centerPx = (S: number, ui: number): number => S * (0.07 + clamp(ui, 0, 100) / 100 * 0.15);

type Radii = { rOuter: number; rText: number; rInner: number; bandIn: number; bandOut: number };

/**
 * 반지름 연쇄 — 바깥에서 안으로 한 번에 정한다(순환 참조를 만들지 않으려고 순서가 중요).
 * ① rOuter: 캔버스 반지름 × ratio 에서 획 절반을 뺀 **선 중심** 반지름.
 * ② rText : 호 글자의 중심이 놓일 반지름. 글자 상자 대각 절반이 of·0.707 이라
 *    of·0.75 를 빼면 어떤 회전각에서도 글자가 바깥 원을 넘지 않는다(자기검증 ①).
 * ③ 마커 띠: 글자 안쪽 가장자리와 안쪽 원 사이. 띠를 **먼저 떼어 놓아야** 마커가
 *    항상 보인다(안 그러면 안쪽 원이 커질 때 마커 자리가 0 이 된다).
 * ④ rInner: 남은 것. 가운데 글자는 여기에 맞춰 줄인다(반대로 원을 키우지 않는다 —
 *    원 크기가 글자 길이에 따라 출렁이면 도장으로 안 보인다).
 */
function radii(S: number, bw: number, ratio: number, of: number, hasOuter: boolean): Radii {
  const rOuter = S / 2 * clamp(ratio, 0.5, 1) - bw / 2 - 1;
  const rText = hasOuter ? rOuter - bw / 2 - of * 0.75 : rOuter - bw / 2;
  const bandOut = hasOuter ? rText - of * 0.75 : rText;
  const band = Math.max(of * 0.9, bw + 4); // 마커가 들어갈 최소 폭
  const rInner = Math.max(bandOut - band, S * 0.08);
  return { rOuter, rText, rInner, bandIn: rInner + bw / 2, bandOut };
}

/**
 * 호 텍스트 — 이 모듈의 심장.
 *
 * ── 각도 유도 ───────────────────────────────────────────────
 * 글자 i 의 위치각 a = -π/2 + θ  (θ = 12시 기준 시계방향 오프셋. 캔버스는 y 가 아래로
 * 자라므로 각이 커지는 방향이 곧 시계방향이고, -π/2 가 12시다.)
 * 위치는 (c + r·cos a, c + r·sin a).
 *
 * 회전각 φ 는 "글자의 위쪽(로컬 (0,-1))이 어디를 향하게 할 것인가"로 정한다.
 * rotate(φ) 는 (x,y) → (x cosφ − y sinφ, x sinφ + y cosφ) 이므로
 *   (0,-1) → (sinφ, −cosφ).
 * ① 위쪽 호: 글자 위가 **바깥**(cos a, sin a)을 향해야 한다.
 *      sinφ = cos a, −cosφ = sin a  →  φ = a + π/2.
 * ② 아래쪽 호: 그대로 두면 φ 가 π 근처가 되어 글자가 거꾸로 선다. 글자 위를
 *    **안쪽**(−cos a, −sin a)으로 돌리면 똑바로 읽힌다.
 *      sinφ = −cos a, −cosφ = −sin a  →  φ = a − π/2.
 * 두 경우 모두 글자 기준선은 φ 의 정의상 그 지점의 접선과 나란하다(위 식이 접선 방향
 * (−sin a, cos a) 을 로컬 x축으로 보내기 때문). 아래쪽 판정은 sin a > 0 = 6시 쪽 절반.
 */
function arcText(ctx: CanvasRenderingContext2D, chars: string[], c: number, r: number): void {
  const span = Math.min(chars.length * PER_CHAR, MAX_SPAN);
  // 균등 분배: n 글자를 span 에 고르게 → 간격 span/n, 첫 글자는 반 칸 안쪽에서 시작해
  // 전체가 12시를 기준으로 좌우 대칭이 된다.
  const step = span / chars.length;
  const start = -span / 2 + step / 2;
  for (let i = 0; i < chars.length; i += 1) {
    const a = -Math.PI / 2 + start + step * i;
    const flip = Math.sin(a) > 0; // 아래쪽 절반 = 뒤집어야 읽힌다
    ctx.save();
    ctx.translate(c + r * Math.cos(a), c + r * Math.sin(a));
    ctx.rotate(flip ? a - Math.PI / 2 : a + Math.PI / 2);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
}

/** 안쪽 글자: 2자=가로, 4자=2×2, 그 외=한 줄. 반환은 행 배열. */
function centerRows(chars: string[]): string[][] {
  if (chars.length === 4) return [[chars[0], chars[1]], [chars[2], chars[3]]];
  return [chars];
}

/** 12시 마커. r = 중심에서의 거리, s = 반지름 격. 'none' 은 부르지 않는다. */
function drawMarker(ctx: CanvasRenderingContext2D, kind: CenterMarker, c: number, r: number, s: number): void {
  const cy = c - r;
  ctx.beginPath();
  if (kind === 'dot') {
    ctx.arc(c, cy, s, 0, Math.PI * 2);
  } else if (kind === 'diamond') {
    ctx.moveTo(c, cy - s); ctx.lineTo(c + s, cy); ctx.lineTo(c, cy + s); ctx.lineTo(c - s, cy);
  } else {
    // 오각별: 꼭짓점 5개를 72°씩, 안쪽 점은 그 사이 36° 지점. 안쪽/바깥 반지름 비
    // 0.382 = 정오각별의 황금비(1/φ²)라 별처럼 뾰족하다.
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? s : s * 0.382;
      const x = c + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
}

export function drawCorporateSeal(canvas: HTMLCanvasElement, o: CorporateSealOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const S = canvas.width; // 정사각 가정 — 도장은 원이라 짧은 변에 맞출 이유가 없다
  const c = S / 2;
  ctx.clearRect(0, 0, S, canvas.height); // 투명 배경 유지: 도장은 문서 위에 얹힌다
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.strokeStyle = o.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const bw = Math.max(0, o.borderWidth);
  const outer = [...o.outerText.trim()];
  const center = [...o.centerText.trim()];
  const of = outerPx(S, o.outerSize);
  const g = radii(S, bw, o.ratio, of, outer.length > 0);

  // ① 이중 원
  if (bw > 0) {
    ctx.lineWidth = bw;
    for (const r of [g.rOuter, g.rInner]) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ② 바깥 호 글자
  if (outer.length > 0) {
    ctx.font = `bold ${Math.round(of)}px ${o.outerFont}`;
    arcText(ctx, outer, c, g.rText);
  }

  // ③ 가운데 글자 — 안쪽 원 안에 반드시 들어가야 하므로 넘치면 글자를 줄인다.
  if (center.length > 0) {
    const rows = centerRows(center);
    let px = centerPx(S, o.centerSize);
    ctx.font = `bold ${Math.round(px)}px ${o.centerFont}`;
    const widthAt = (size: number): number => {
      ctx.font = `bold ${Math.round(size)}px ${o.centerFont}`;
      return Math.max(...rows.map((r) => ctx.measureText(r.join('')).width));
    };
    // 글자 폭은 크기에 선형이라 한 번의 비율 보정이면 충분하다(반복 탐색 불필요).
    const limit = Math.max(4, g.rInner - bw / 2 - S * 0.02); // 안쪽 원 선 안쪽 + 여백
    const half = (w: number, h: number): number => Math.hypot(w / 2, h / 2);
    const w0 = widthAt(px);
    const h0 = rows.length * px * 1.02;
    const d0 = half(w0, h0);
    if (d0 > limit) px *= limit / d0;
    const w = widthAt(px);
    const rowH = px * 1.02;
    rows.forEach((row, ri) => {
      const y = c + (ri - (rows.length - 1) / 2) * rowH;
      if (row.length === 1) {
        ctx.fillText(row[0], c, y);
      } else {
        // 행 안에서는 측정 폭을 등분해 좌우 대칭으로 놓는다.
        const cell = w / row.length;
        row.forEach((ch, ci) => ctx.fillText(ch, c + (ci - (row.length - 1) / 2) * cell, y));
      }
    });
  }

  // ④ 12시 마커 — 바깥 원과 안쪽 원 사이의 빈 띠(호 글자 안쪽)에 앉힌다.
  if (o.marker !== 'none') {
    const s = Math.max(2, Math.min((g.bandOut - g.bandIn) * 0.45, of * 0.45));
    drawMarker(ctx, o.marker, c, (g.bandIn + g.bandOut) / 2, s);
  }

  ctx.restore();
}

// ─── 자기검증 ───────────────────────────────────────────────
// 브라우저에서만 돈다(캔버스가 필요하다). 실패해도 던지지 않고 건수를 센다.

const BASE: CorporateSealOptions = {
  outerText: '주식회사가나다', centerText: '代表理事',
  outerFont: 'sans-serif', centerFont: 'sans-serif',
  centerSize: 50, outerSize: 50, marker: 'star',
  color: '#c0392b', borderWidth: 6, ratio: 0.94,
};

function render(o: Partial<CorporateSealOptions>, size = 300): ImageData {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  drawCorporateSeal(cv, { ...BASE, ...o });
  return cv.getContext('2d')!.getImageData(0, 0, size, size);
}

/** 잉크 픽셀 수와 중심에서 가장 먼 잉크 거리. 잉크 판정은 안티에일리어싱 여유 8. */
function ink(img: ImageData): { count: number; maxR: number } {
  const S = img.width; const c = S / 2;
  let count = 0; let maxR = 0;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      if (img.data[(y * S + x) * 4 + 3] > 8) {
        count += 1;
        maxR = Math.max(maxR, Math.hypot(x + 0.5 - c, y + 0.5 - c));
      }
    }
  }
  return { count, maxR };
}

export function __selfCheck(): boolean {
  let fails = 0;
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails += 1;
    console.assert(cond, msg);
  };
  const S = 300;

  // ① 호 글자 2·4·8·12 — 예외 없이 그려지고, 글자가 바깥 원을 넘지 않는다.
  //    비교 기준은 "글자 없이 원만 그린 그림"의 최대 잉크 반경 = 바깥 원 바깥 가장자리.
  //    글자가 새면 이 값을 넘는다(공식을 여기 베껴 쓰지 않아도 되는 이유).
  const ringOnly = ink(render({ outerText: '', centerText: '', marker: 'none' }));
  for (const n of [2, 4, 8, 12]) {
    const text = '가나다라마바사아자차카타'.slice(0, n);
    let m = { count: 0, maxR: 0 };
    try {
      m = ink(render({ outerText: text }));
    } catch (e) {
      ok(false, `호 글자 ${n}자에서 예외: ${String(e)}`);
      continue;
    }
    ok(m.count > ringOnly.count, `호 글자 ${n}자가 그려지지 않았다`);
    ok(m.maxR <= ringOnly.maxR + 1.5, `호 글자 ${n}자가 바깥 원을 넘었다 ${m.maxR.toFixed(1)} > ${ringOnly.maxR.toFixed(1)}`);
  }

  // ② 마커 4종이 서로 다른 잉크량. none 이 가장 적다.
  const counts = new Map<CenterMarker, number>();
  for (const k of ['dot', 'star', 'diamond', 'none'] as const) {
    counts.set(k, ink(render({ outerText: '', centerText: '', marker: k })).count);
  }
  const none = counts.get('none')!;
  for (const k of ['dot', 'star', 'diamond'] as const) {
    ok(counts.get(k)! > none, `marker ${k} 가 none 보다 잉크가 많아야 한다 (${counts.get(k)} vs ${none})`);
  }
  ok(new Set(counts.values()).size === 4, `마커 4종 잉크량이 서로 달라야 한다: ${JSON.stringify([...counts])}`);

  // ③ 가운데 글자 2자·4자가 안쪽 원 안. 안쪽 원 반지름은 "원만 그린 그림"에서
  //    12시 방향으로 스캔해 첫 잉크(=안쪽 원 바깥 가장자리)를 찾아 실측한다.
  const ringImg = render({ outerText: '', centerText: '', marker: 'none' });
  let rInnerEdge = 0;
  for (let y = Math.floor(S / 2); y >= 0; y -= 1) {
    if (ringImg.data[(y * S + Math.floor(S / 2)) * 4 + 3] > 8) { rInnerEdge = S / 2 - y; break; }
  }
  ok(rInnerEdge > 0, '안쪽 원을 못 찾았다');
  for (const t of ['理事', '代表理事']) {
    const img = render({ outerText: '', centerText: t, marker: 'none' });
    let maxR = 0; let n = 0;
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = (y * S + x) * 4 + 3;
        if (img.data[i] > 8 && ringImg.data[i] <= 8) { // 원에는 없고 글자에만 있는 픽셀
          n += 1;
          maxR = Math.max(maxR, Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2));
        }
      }
    }
    ok(n > 0, `가운데 글자 '${t}' 가 안 그려졌다`);
    ok(maxR <= rInnerEdge, `가운데 글자 '${t}' 가 안쪽 원을 넘었다 ${maxR.toFixed(1)} > ${rInnerEdge.toFixed(1)}`);
  }

  // ④ 투명 배경 — 네 모서리 alpha 0
  const full = render({});
  for (const [x, y] of [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]]) {
    ok(full.data[(y * S + x) * 4 + 3] === 0, `모서리(${x},${y}) 가 투명하지 않다`);
  }

  // ⑤ ratio 는 실제로 반경을 바꾼다
  const r06 = ink(render({ ratio: 0.6 }));
  const r10 = ink(render({ ratio: 1.0 }));
  ok(r10.maxR > r06.maxR * 1.3, `ratio 0.6/1.0 반경 차이 부족: ${r06.maxR.toFixed(1)} → ${r10.maxR.toFixed(1)}`);

  console.log(fails === 0 ? 'seal-corporate __selfCheck: PASS' : `seal-corporate __selfCheck: FAIL ${fails}건`);
  return fails === 0;
}
