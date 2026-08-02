/**
 * 줄자 모양 3안 (디자인 "rhwp 줄자 재설계" — 2026-08-03).
 *
 * 한글 줄자는 눈금이 빽빽한데 정작 알고 싶은 건 셋뿐이다 — 글이 어디서 시작하고,
 * 어디서 끝나고, 커서가 어느 칸인가. 아래 셋은 그 셋을 먼저 말하고 눈금을 뒤로 물린다.
 *
 *  map   (1a 여백 지도) : 본문 폭을 청록 띠로, 여백은 빈 종이. 숫자는 커서 자리만.
 *  cross (1b 십자 조준) : 인쇄 돔보 — 두 줄자에서 뻗은 자홍 선이 커서에서 만난다.
 *  quiet (1c 부를 때만) : 평소엔 실 한 줄, 줄자에 가까이 가면 눈금이 피어난다.
 *
 * classic(지금까지 쓰던 회색 눈금자)은 ruler.ts 가 그대로 그린다 — 여기 없다.
 *
 * ponytail: 세 안이 배경·눈금·마커만 다르고 좌표 계산은 같다 — 좌표는 호출자(ruler.ts)가
 *   넘겨준 Geometry 하나로 받는다. 계산을 두 번 쓰면 어긋난다(줄자 드래그가 그 교훈).
 */

/** 디자인 문서의 색 — 세 안이 공유한다 */
export const RULER_INK = {
  /** 본문 폭·강조 (청록) */
  body: '#0088b0',
  /** 커서·들여쓰기 (자홍) */
  cursor: '#d6006c',
  /** 여백 바탕 */
  paper: '#f3f2f2',
  /** 테두리·연한 눈금 */
  line: '#e2ded9',
  tickFaint: '#c9c4bf',
  tick: '#8a8683',
  text: '#8a8683',
} as const;

/** 그리기에 필요한 좌표 — ruler.ts 가 조판과 같은 식으로 계산해서 넘긴다 */
export interface RulerGeometry {
  /** 캔버스 논리 크기 (px) */
  canvasW: number;
  canvasH: number;
  /** 본문(또는 셀·단) 시작·끝 화면 좌표 */
  bodyStart: number;
  bodyEnd: number;
  /** 페이지 시작 화면 좌표 */
  pageStart: number;
  /** mm 당 화면 px */
  mmPx: number;
  /** 페이지 길이 (mm) */
  lengthMm: number;
  /** 커서 화면 좌표 — 없으면 null */
  cursor: number | null;
  /** 커서 자리 값 표시용 문구 (예: "10 pt") — 없으면 안 그린다 */
  cursorLabel?: string | null;
  /** 첫 줄 들여쓰기 화면 좌표 (가로 줄자만) */
  indent?: number | null;
}

type Axis = 'h' | 'v';

/** 축에 맞춰 (주축, 교차축) → (x, y) 로 바꾼다 — 한 벌 코드로 가로·세로를 다 그린다 */
function xy(axis: Axis, main: number, cross: number): [number, number] {
  return axis === 'h' ? [main, cross] : [cross, main];
}

function rect(
  ctx: CanvasRenderingContext2D, axis: Axis,
  mainStart: number, mainLen: number, crossStart: number, crossLen: number,
): void {
  const [x, y] = xy(axis, mainStart, crossStart);
  const [w, h] = axis === 'h' ? [mainLen, crossLen] : [crossLen, mainLen];
  ctx.fillRect(x, y, w, h);
}

/** 1a 여백 지도 — 영역을 본다. 눈금은 안 센다. */
function drawMap(ctx: CanvasRenderingContext2D, axis: Axis, g: RulerGeometry): void {
  const cross = axis === 'h' ? g.canvasH : g.canvasW;
  // 바탕: 여백은 빈 종이
  ctx.fillStyle = RULER_INK.paper;
  rect(ctx, axis, 0, axis === 'h' ? g.canvasW : g.canvasH, 0, cross);

  // 본문 폭 = 청록 띠 (가운데에 얇게)
  const bandThick = Math.max(6, Math.round(cross * 0.34));
  const bandOffset = Math.round((cross - bandThick) / 2);
  ctx.fillStyle = RULER_INK.body;
  rect(ctx, axis, g.bodyStart, Math.max(0, g.bodyEnd - g.bodyStart), bandOffset, bandThick);

  // 본문 경계 = 전체 높이 실선 (여기서 글이 시작하고 끝난다)
  ctx.fillStyle = RULER_INK.body;
  for (const edge of [g.bodyStart, g.bodyEnd]) {
    rect(ctx, axis, Math.round(edge), 1, 0, cross);
  }

  // 커서 — 삼각 표식 + 값. 숫자는 여기에만 뜬다.
  if (g.cursor !== null) {
    ctx.fillStyle = RULER_INK.cursor;
    const c = Math.round(g.cursor);
    const s = 5;
    ctx.beginPath();
    if (axis === 'h') {
      ctx.moveTo(c - s, 2); ctx.lineTo(c + s, 2); ctx.lineTo(c, 2 + 7);
    } else {
      ctx.moveTo(2, c - s); ctx.lineTo(2, c + s); ctx.lineTo(2 + 7, c);
    }
    ctx.closePath();
    ctx.fill();
    if (axis === 'h' && g.cursorLabel) {
      ctx.fillStyle = RULER_INK.cursor;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(g.cursorLabel, c + 8, 1);
    }
  }
}

/** 1b 십자 조준 — 눈금은 남기되 커서를 돔보로 짚는다. */
function drawCross(ctx: CanvasRenderingContext2D, axis: Axis, g: RulerGeometry): void {
  const cross = axis === 'h' ? g.canvasH : g.canvasW;
  ctx.fillStyle = '#ffffff';
  rect(ctx, axis, 0, axis === 'h' ? g.canvasW : g.canvasH, 0, cross);

  // 본문 구간만 살짝 밝게 — 어디까지가 글자리인지
  ctx.fillStyle = RULER_INK.paper;
  rect(ctx, axis, g.bodyStart, Math.max(0, g.bodyEnd - g.bodyStart), 0, cross);

  // 눈금: 1mm 잔금 + 10mm 큰금(숫자)
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = axis === 'h' ? 'top' : 'middle';
  ctx.textAlign = axis === 'h' ? 'center' : 'left';
  for (let mm = 0; mm <= g.lengthMm; mm++) {
    const p = g.pageStart + mm * g.mmPx;
    if (p < -10 || p > (axis === 'h' ? g.canvasW : g.canvasH) + 10) continue;
    const big = mm % 10 === 0;
    if (!big && mm % 5 !== 0 && g.mmPx < 3) continue; // 좁으면 잔금 생략
    const len = big ? 12 : mm % 5 === 0 ? 7 : 4;
    ctx.strokeStyle = big ? RULER_INK.tick : RULER_INK.tickFaint;
    ctx.beginPath();
    const [x1, y1] = xy(axis, p, cross);
    const [x2, y2] = xy(axis, p, cross - len);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    if (big && mm > 0) {
      ctx.fillStyle = RULER_INK.text;
      const [tx, ty] = xy(axis, p, 1);
      ctx.fillText(`${mm / 10}`, tx, ty);
    }
  }

  // 돔보: 커서에서 선 + 겹동그라미
  if (g.cursor !== null) {
    const c = Math.round(g.cursor);
    ctx.strokeStyle = RULER_INK.cursor;
    ctx.fillStyle = RULER_INK.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [x1, y1] = xy(axis, c, 0);
    const [x2, y2] = xy(axis, c, cross);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    const [cx, cy] = xy(axis, c, Math.round(cross / 2));
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = RULER_INK.cursor; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = RULER_INK.cursor; ctx.fill();
  }
}

/** 1c 부를 때만 — 쉴 때는 실 한 줄, 잡을 때만 눈금이 핀다. */
function drawQuiet(ctx: CanvasRenderingContext2D, axis: Axis, g: RulerGeometry, awake: boolean): void {
  const cross = axis === 'h' ? g.canvasH : g.canvasW;
  const len = axis === 'h' ? g.canvasW : g.canvasH;
  ctx.fillStyle = '#ffffff';
  rect(ctx, axis, 0, len, 0, cross);

  if (!awake) {
    // 쉴 때: 전체를 가로지르는 얇은 실 + 본문 구간만 조금 진하게
    ctx.fillStyle = RULER_INK.line;
    rect(ctx, axis, 0, len, cross - 5, 1);
    ctx.fillStyle = RULER_INK.tickFaint;
    rect(ctx, axis, g.bodyStart, Math.max(0, g.bodyEnd - g.bodyStart), cross - 5, 1);
    return;
  }

  // 잡을 때: 눈금이 피어나고 여백 손잡이가 나온다
  ctx.strokeStyle = '#bcd9e2';
  ctx.lineWidth = 1;
  for (let mm = 0; mm <= g.lengthMm; mm++) {
    const p = g.pageStart + mm * g.mmPx;
    if (p < -10 || p > len + 10) continue;
    if (mm % 5 !== 0 && g.mmPx < 3) continue;
    const h = mm % 10 === 0 ? cross : Math.round(cross * 0.55);
    ctx.beginPath();
    const [x1, y1] = xy(axis, p, cross);
    const [x2, y2] = xy(axis, p, cross - h);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // 본문 띠 + 양끝 손잡이(▼)
  ctx.fillStyle = RULER_INK.body;
  rect(ctx, axis, g.bodyStart, Math.max(0, g.bodyEnd - g.bodyStart), cross - 4, 2);
  for (const edge of [g.bodyStart, g.bodyEnd]) {
    const e = Math.round(edge);
    ctx.beginPath();
    if (axis === 'h') {
      ctx.moveTo(e - 5, 0); ctx.lineTo(e + 5, 0); ctx.lineTo(e, 9);
    } else {
      ctx.moveTo(0, e - 5); ctx.lineTo(0, e + 5); ctx.lineTo(9, e);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (g.cursor !== null) {
    ctx.fillStyle = RULER_INK.cursor;
    rect(ctx, axis, Math.round(g.cursor), 1, 0, cross);
  }
}

/**
 * 세 안 중 하나를 그린다. classic 은 여기 오지 않는다(ruler.ts 가 직접 그린다).
 * @param awake quiet 안에서 "손이 가까이 왔나" — 다른 안은 무시한다.
 */
export function drawRulerStyle(
  ctx: CanvasRenderingContext2D,
  style: 'map' | 'cross' | 'quiet',
  axis: Axis,
  g: RulerGeometry,
  awake: boolean,
): void {
  if (style === 'map') drawMap(ctx, axis, g);
  else if (style === 'cross') drawCross(ctx, axis, g);
  else drawQuiet(ctx, axis, g, awake);
}
