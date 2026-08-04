/**
 * 도장 글자 배치 계산 — 순수 함수만(캔버스·DOM 없음).
 *
 * 왜 따로 두는가: seal-maker.ts 의 drawSeal() 은 그리기와 배치 계산이 한 덩어리라
 * 배치 규칙을 바꾸면 눈으로만 확인할 수 있었다. 배치를 0~1 정규화 좌표를 내는
 * 순수 함수로 떼어내면 캔버스 없이 수치로 검증(=회귀 방지)할 수 있다.
 *
 * ── 전통 배치(order='traditional') 근거 ──────────────────────────────
 * ① 읽는 순서: 인장은 **우→좌, 위→아래**. 4자 방인(方印)은 우상→우하→좌상→좌하.
 *    - https://www.vincentpoon.com/the-seal.html
 *      "In a seal impression, the order of reading the characters is generally
 *       from right to left and top to bottom"
 *    - 한국 도장 업체 안내도 같은 취지: "보통 우측에서 좌측, 상단에서 하단으로 많이
 *      만드는데 요즘에는 좌측에서 우측으로도 많이 만들고 있습니다"
 *      https://bebeplus.kr/article/%EC%83%81%ED%92%88%EB%8F%84%EC%9E%A5-qa/6/1090/
 *      → 즉 우→좌가 전통, 좌→우는 현대 관행. 그래서 두 축(order)을 다 남긴다.
 * ② 3자 이름 뒤 '印' 붙이기: **글자수 균형을 맞추려고 '印'·'之印'을 더하는 관행**이
 *    실재한다(낙관인·실인 안내).
 *    - https://takeda-inten.com/hanko/rakkan/
 *      "バランスをとるために「～印」「～之印」の字を加えることもあります。"
 *    ⚠ 미확인: 위 근거는 **일본** 인장 문화 자료다. 동일 관행을 명시한 한국 측 1차
 *      자료는 찾지 못했다(국립/학술 자료 미확인). 다만 현행 drawSeal 이 이미 그렇게
 *      동작하므로 두 order 모두 유지한다 — 근거가 아니라 현행 동작 보존이 이유다.
 * ③ 미확인이라 넣지 않은 규칙:
 *    - 3자를 '印' 없이 2단(우측 2자 + 좌측 1자)으로 앉히는 배치의 표준 여부 — 미확인.
 *    - 회문(回文) 배치(우상→좌상→좌하→우하)의 적용 조건 — 미확인이라 구현하지 않음.
 *    - 원형인의 원주 방향 곡선 배치(테두리를 따라 도는 배열) — 미확인.
 */

export type SealShape = 'circle' | 'square';
export type SealOrder = 'modern' | 'traditional';

/** 0~1 정규화 좌표(캔버스 크기와 무관). x·y 는 글자 중심, size 는 캔버스 변 대비 글자 크기. */
export type SealGlyph = { char: string; x: number; y: number; size: number };

/**
 * 테두리 안쪽까지의 여유(정규화). drawSeal 의 테두리와 같은 값에서 뽑았다:
 * 원 = arc(r = SIZE/2 - 8) + lineWidth 10 → 안쪽 가장자리 SIZE/2 - 13,
 * 사각 = strokeRect(8, …) + lineWidth 10 → 안쪽 가장자리 13.
 * 300px 기준 (150 - 13) / 300 = 0.4567.
 */
const INNER = (150 - 13) / 300;

/**
 * 왜 원형이 더 좁은가: 사각형은 축별로 |x-0.5| + size/2 만 보면 되지만, 원은 대각선
 * 방향이 제일 먼저 잘린다 — 글자 상자의 모서리까지 거리가 √2/2·size ≈ 0.707·size 라
 * 같은 크기여도 원에서는 훨씬 빨리 테두리를 넘는다. 그래서 원형은 간격·크기를 줄인다.
 */
const CORNER = Math.SQRT1_2; // 글자 상자 중심→모서리 = size * 0.707

/** 전통 배치의 치수표(모양별). d = 중심에서의 간격, s = 글자 크기. */
const TRAD: Record<SealShape, { one: number; two: { d: number; s: number }; quad: { d: number; s: number } }> = {
  // 사각: 축별 여유만 보면 되므로 현행보다 크게 앉힐 수 있다.
  square: { one: 0.62, two: { d: 0.22, s: 0.40 }, quad: { d: 0.21, s: 0.34 } },
  // 원형: 대각선이 먼저 걸려 4자는 간격·크기를 모두 줄여야 모서리가 안 잘린다.
  circle: { one: 0.60, two: { d: 0.21, s: 0.34 }, quad: { d: 0.18, s: 0.28 } },
};

/**
 * 이름을 도장 글자 배치로 바꾼다.
 * - 4자 초과는 4자로 자른다(현행 drawSeal 동작 유지).
 * - 3자는 뒤에 '印'을 붙여 4자로 만든다(위 근거 ②).
 * - order='modern' 은 drawSeal 의 좌표 계산을 **식 그대로** 옮긴 것이다. 기존 사용자의
 *   도장 모양이 바뀌면 안 되므로 여기 수식은 손대지 말 것(회귀).
 */
export function layoutSealChars(name: string, shape: SealShape, order: SealOrder): SealGlyph[] {
  const chars = [...name.trim()].slice(0, 4);
  if (chars.length === 3) chars.push('印');
  if (chars.length === 0) return [];

  if (order === 'modern') {
    // ⚠ drawSeal() 원본 식 그대로. shape 를 안 쓰는 것도 원본 그대로다(원형에서 4자가
    //   살짝 잘리는 현행 동작까지 보존해야 회귀가 아니다).
    return chars.length <= 2
      ? chars.map((c, i) => ({
        char: c,
        x: 0.5,
        y: chars.length === 1 ? 0.5 : 0.30 + i * 0.40,
        size: 0.34,
      }))
      : chars.map((c, i) => ({
        char: c,
        x: 0.30 + (i % 2) * 0.40,
        y: 0.30 + Math.floor(i / 2) * 0.40,
        size: 0.30,
      }));
  }

  const t = TRAD[shape];
  if (chars.length === 1) return [{ char: chars[0], x: 0.5, y: 0.5, size: t.one }];
  if (chars.length === 2) {
    // 2자는 한 줄 세로쓰기 — 위→아래. 열이 하나라 좌우 순서는 영향이 없다.
    return chars.map((c, i) => ({ char: c, x: 0.5, y: 0.5 + (i === 0 ? -t.two.d : t.two.d), size: t.two.s }));
  }
  // 4자 = 오른쪽 열부터 위→아래, 그다음 왼쪽 열(우상→우하→좌상→좌하, 근거 ①).
  return chars.map((c, i) => ({
    char: c,
    x: 0.5 + (i < 2 ? t.quad.d : -t.quad.d),
    y: 0.5 + (i % 2 === 0 ? -t.quad.d : t.quad.d),
    size: t.quad.s,
  }));
}

/**
 * 자기검증 — 캔버스 없이 수치만으로 회귀를 잡는다. 통과면 true.
 * (배치가 순수 함수라서 가능한 검사다. 실패해도 던지지 않고 콘솔에 남긴다.)
 */
export function __selfCheck(): boolean {
  let fails = 0;
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails++;
    console.assert(cond, msg);
  };
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

  // ① modern = 기존 drawSeal 좌표와 일치(수치 하드코딩). 1·2·3·4자 각각.
  type Exp = [x: number, y: number, s: number];
  const cases: Array<[name: string, chars: string, exp: Exp[]]> = [
    ['김', '김', [[0.5, 0.5, 0.34]]],
    ['김유', '김유', [[0.5, 0.30, 0.34], [0.5, 0.70, 0.34]]],
    ['김유신', '김유신印', [[0.30, 0.30, 0.30], [0.70, 0.30, 0.30], [0.30, 0.70, 0.30], [0.70, 0.70, 0.30]]],
    ['김유신전', '김유신전', [[0.30, 0.30, 0.30], [0.70, 0.30, 0.30], [0.30, 0.70, 0.30], [0.70, 0.70, 0.30]]],
  ];
  for (const shape of ['circle', 'square'] as const) {
    for (const [name, expChars, exp] of cases) {
      const g = layoutSealChars(name, shape, 'modern');
      ok(g.map((x) => x.char).join('') === expChars, `modern ${shape} ${name}: 글자 ${g.map((x) => x.char).join('')}`);
      ok(g.length === exp.length, `modern ${shape} ${name}: 개수 ${g.length}`);
      exp.forEach((e, i) => {
        ok(near(g[i].x, e[0]) && near(g[i].y, e[1]) && near(g[i].size, e[2]),
          `modern ${shape} ${name}[${i}]: (${g[i]?.x}, ${g[i]?.y}, ${g[i]?.size}) ≠ (${e[0]}, ${e[1]}, ${e[2]})`);
      });
    }
  }

  // ② 3자 입력 → 4글자('印' 보충)
  for (const order of ['modern', 'traditional'] as const) {
    const g = layoutSealChars('홍길동', 'circle', order);
    ok(g.length === 4 && g[3].char === '印', `${order} 3자→4자: ${g.map((x) => x.char).join('')}`);
  }
  // 4자 초과는 자른다
  ok(layoutSealChars('가나다라마', 'square', 'traditional').length === 4, '5자는 4자로 잘려야 한다');
  ok(layoutSealChars('   ', 'square', 'modern').length === 0, '공백만이면 빈 배열');

  // ③ 모든 글자가 0~1 안 + 원형이면 글자 중심이 테두리 안쪽 반지름 안.
  for (const shape of ['circle', 'square'] as const) {
    for (const order of ['modern', 'traditional'] as const) {
      for (const name of ['김', '김유', '김유신', '김유신전']) {
        for (const g of layoutSealChars(name, shape, order)) {
          ok(g.x > 0 && g.x < 1 && g.y > 0 && g.y < 1, `${order}/${shape}/${name}: 좌표 범위 이탈 (${g.x}, ${g.y})`);
          ok(g.size > 0 && g.size < 1, `${order}/${shape}/${name}: 크기 범위 이탈 ${g.size}`);
          const dist = Math.hypot(g.x - 0.5, g.y - 0.5);
          if (shape === 'circle') ok(dist <= INNER, `${order}/circle/${name}: 중심거리 ${dist} > ${INNER}`);
          // 글자 상자 모서리까지 테두리 안이라는 보장은 **traditional 만** 한다.
          // modern 은 현행 동작 보존이 우선이라 원형 4자가 살짝 잘린다(알고 남기는 것).
          if (order === 'traditional') {
            const bound = shape === 'circle' ? dist + g.size * CORNER : Math.max(Math.abs(g.x - 0.5), Math.abs(g.y - 0.5)) + g.size / 2;
            ok(bound <= INNER, `traditional/${shape}/${name}: 여백 초과 ${bound} > ${INNER}`);
          }
        }
      }
    }
  }

  // ④ 전통 4자 = 우상→우하→좌상→좌하
  const t4 = layoutSealChars('가나다라', 'square', 'traditional');
  ok(t4[0].x > 0.5 && t4[0].y < 0.5, '전통 1번째 = 우상');
  ok(t4[1].x > 0.5 && t4[1].y > 0.5, '전통 2번째 = 우하');
  ok(t4[2].x < 0.5 && t4[2].y < 0.5, '전통 3번째 = 좌상');
  ok(t4[3].x < 0.5 && t4[3].y > 0.5, '전통 4번째 = 좌하');
  // modern 은 반대(좌→우) — 두 배치가 실제로 달라야 의미가 있다.
  const m4 = layoutSealChars('가나다라', 'square', 'modern');
  ok(m4[0].x < 0.5, 'modern 1번째 = 좌상(전통과 달라야 한다)');

  console.log(fails === 0 ? 'seal-layout __selfCheck: PASS' : `seal-layout __selfCheck: FAIL ${fails}건`);
  return fails === 0;
}
