/**
 * 전서(篆書)화 — 글자를 **직각 격자로 다시 짜** 도장 서체 느낌을 낸다 (2026-08-04).
 *
 * 왜 이런 방식인가: 도장 서체(고인체·인전체·전서체…)는 전부 제작소 상용 폰트라
 * 번들할 수 없다(라이선스 조사 결론). 폰트 없이 그 인상을 내려면 글자 모양 자체를
 * 바꿔야 하는데, 캔버스는 글리프 외곽선을 내주지 않는다 — 폰트 파서를 새로 들이는
 * 것은 의존성이 크다. 그래서 **그려 놓고 픽셀을 다시 짜는** 길을 택했다.
 *
 * 하는 일(전부 순수 계산):
 *   ① 글자를 정사각에 꽉 차게 그린다
 *   ② 굵은 격자(G×G)로 면적 비율을 내어 임계값으로 켜고 끈다  → 곡선이 직각 계단이 된다
 *   ③ 격자 위에서 팽창(dilate)한다                            → 획 굵기가 균일해진다
 *   ④ 격자를 그대로 사각형으로 되그린다                        → 미로 같은 짜임
 *
 * ⚠ 한계를 분명히 해 둔다: 이것은 **흉내**지 서체가 아니다. 진짜 전서체는 획을 줄이고
 *   자형을 재해석하지만, 여기서는 원래 자형의 픽셀을 격자에 맞출 뿐이다. 획이 가늘거나
 *   복잡한 글자(ㅄ·ㄻ 같은 겹받침)는 격자가 거칠수록 뭉개진다 — 세기를 낮춰 쓸 것.
 *   사용자에게 이 점을 말한 뒤 만든 기능이다.
 */

/** 글자를 그려 재는 작업 캔버스 크기 — 격자보다 충분히 커야 면적 비율이 안정된다. */
const WORK = 192;

export type SealScriptOptions = {
  /** 0~1. 0 이면 원래 자형에 가깝고(고운 격자), 1 이면 굵고 각지다. */
  strength: number;
};

const cache = new Map<string, HTMLCanvasElement>();

/** 세기 → 격자 수·임계값·팽창. 눈으로 맞춘 값이다(수식에 근거는 없다). */
function paramsOf(strength: number) {
  const t = Math.max(0, Math.min(1, strength));
  return {
    grid: Math.round(30 - t * 16),   // 30칸(고움) → 14칸(거침)
    threshold: 0.42 - t * 0.16,      // 거칠수록 더 잘 켜야 획이 안 끊긴다
    dilate: t > 0.55 ? 1 : 0,        // 아주 거칠 때만 한 칸 불린다
  };
}

/**
 * 글자 하나를 전서풍 마스크로 만든다.
 * 반환 캔버스는 **검은 실루엣**이다 — 색은 부르는 쪽에서 입힌다(도장 색이 조절값이라).
 */
export function carveGlyph(char: string, font: string, o: SealScriptOptions): HTMLCanvasElement {
  const key = `${char}|${font}|${o.strength.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { grid, threshold, dilate } = paramsOf(o.strength);

  // ① 글자를 작업 캔버스에 꽉 차게 그린다.
  const work = document.createElement('canvas');
  work.width = WORK; work.height = WORK;
  const wc = work.getContext('2d', { willReadFrequently: true })!;
  const probe = 140;
  wc.font = `bold ${probe}px ${font}`;
  const m = wc.measureText(char);
  const iw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || probe * 0.7;
  const ih = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || probe * 0.7;
  wc.save();
  wc.translate(WORK / 2, WORK / 2);
  wc.scale((WORK * 0.94) / iw, (WORK * 0.94) / ih);
  wc.textAlign = 'center';
  wc.textBaseline = 'alphabetic';
  wc.fillStyle = '#000';
  wc.fillText(char, -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
    (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  wc.restore();

  // ② 격자 칸마다 잉크가 덮은 비율을 재서 켜고 끈다 — 여기서 곡선이 계단이 된다.
  const src = wc.getImageData(0, 0, WORK, WORK).data;
  const cell = WORK / grid;
  let on = new Uint8Array(grid * grid);
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor(gx * cell), x1 = Math.floor((gx + 1) * cell);
      const y0 = Math.floor(gy * cell), y1 = Math.floor((gy + 1) * cell);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { sum += src[(y * WORK + x) * 4 + 3]; n++; }
      }
      if (n > 0 && sum / n / 255 >= threshold) on[gy * grid + gx] = 1;
    }
  }

  // ③ 팽창 — 획 굵기를 고르게 만들고 격자화로 끊긴 곳을 잇는다.
  for (let d = 0; d < dilate; d++) {
    const next = new Uint8Array(on);
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        if (on[gy * grid + gx]) continue;
        const l = gx > 0 && on[gy * grid + gx - 1];
        const r = gx < grid - 1 && on[gy * grid + gx + 1];
        const u = gy > 0 && on[(gy - 1) * grid + gx];
        const dn = gy < grid - 1 && on[(gy + 1) * grid + gx];
        // 상하 또는 좌우 **양쪽**이 켜져 있을 때만 채운다 — 아무 데나 불리면 뭉갠다.
        if ((l && r) || (u && dn)) next[gy * grid + gx] = 1;
      }
    }
    on = next;
  }

  // ④ 격자를 사각형으로 되그린다. 칸을 0.5px 겹쳐 그려 이음매에 흰 실선이 안 생기게 한다.
  const out = document.createElement('canvas');
  out.width = WORK; out.height = WORK;
  const oc = out.getContext('2d')!;
  oc.fillStyle = '#000';
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      if (!on[gy * grid + gx]) continue;
      oc.fillRect(gx * cell - 0.5, gy * cell - 0.5, cell + 1, cell + 1);
    }
  }

  // 글꼴이 늦게 도착하면 모양이 달라진다 — 캐시가 무한히 늘지 않게만 막는다.
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/** 글꼴이 새로 로드되면 이전 결과가 낡는다 — 그때 부른다. */
export function clearGlyphCache(): void {
  cache.clear();
}
