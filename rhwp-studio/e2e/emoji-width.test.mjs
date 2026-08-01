/**
 * 이모지 폭 — 엔진이 잰 전진폭이 **브라우저가 실제로 그리는 폭**과 같은가.
 * (사용자 지적 2026-08-01: "한컴은 이모지가 괜찮게 나오는데 우리는 너비가 작아 보여")
 *
 * 오라클 = 같은 글자·같은 크기에서의 canvas measureText. 엔진이 좁게 잡으면 이모지가
 * 뒤 글자를 덮고, 넓게 잡으면 글자 사이가 벌어진다 — 양쪽 다 이 검사에 걸린다.
 *
 * ⚠ 오라클은 **문서 크기(10pt≈13.3px)** 에서 재야 한다. Chrome 은 50px 이상에서
 *   컬러 이모지 글꼴을 못 쓰고 1em(.notdef)을 돌려준다 — 실측 2026-08-01.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';
runTest('이모지 폭 실측', async ({ page }) => {
  await createNewDocument(page); await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));
  const o = await page.evaluate(async () => {
    const w = window.__wasm;
    const T = '가😀🎉🧑👍★☆✓✅☀✈▶◆♥가';
    w.insertText(0, 0, 0, T);
    await new Promise((r) => setTimeout(r, 600));
    // 엔진이 잰 글자 위치
    const pos = [];
    for (let i = 0; i <= [...T].length; i++) {
      try { const r = w.getCursorRect(0, 0, i); pos.push(Math.round(r.x * 10) / 10); } catch { pos.push(null); }
    }
    const adv = [];
    for (let i = 1; i < pos.length; i++) adv.push(Math.round((pos[i] - pos[i - 1]) * 10) / 10);
    // 브라우저(컬러 이모지 폰트)가 같은 크기에서 재는 폭 = 오라클
    // ⚠ 웹폰트를 기다리지 않고 부팅하도록 바꾼 뒤(2026-08-01 perf) 이 오라클이
    //   글꼴 도착 **전에** 재서 흔들렸다(✓ 12.9 → 7.9px). 엔진과 같은 글꼴로
    //   재야 비교가 성립한다 — 도착을 기다린다.
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 300));
    const cv = document.createElement('canvas').getContext('2d');
    const px = 10 * (96 / 72) * (w.getZoom?.() ?? 1);
    cv.font = `${px}px "함초롬바탕", serif`;
    const oracle = [...T].map((c) => Math.round(cv.measureText(c).width * 10) / 10);
    return { T: [...T], adv, oracle, px: Math.round(px * 10) / 10 };
  });
  console.log('  글자   :', o.T.join('    '));
  console.log('  엔진 폭:', o.adv.join('  '));
  console.log('  브라우저:', o.oracle.join('  '), `(글자크기 ${o.px}px)`);
  const bad = o.T.map((c, i) => ({ c, e: o.adv[i], b: o.oracle[i] }))
    .filter((x) => x.e !== undefined && Math.abs(x.e - x.b) > 0.6);
  console.log('  어긋남:', bad.length ? JSON.stringify(bad) : '없음');
  assert.strictEqual(bad.length, 0,
    `엔진 폭이 브라우저와 어긋난다: ${JSON.stringify(bad)}`);
  // 컬러 이모지와 흑백 기호가 실제로 갈렸는가(둘 다 같은 값이면 판정이 죽은 것)
  const colorW = o.adv[o.T.indexOf('😀')];
  const symW = o.adv[o.T.indexOf('★')];
  console.log('  컬러', colorW, '/ 기호', symW);
  assert.ok(colorW > symW + 2, '컬러 이모지가 흑백 기호보다 넓어야 한다');
  const box = await page.evaluate(() => {
    const c = document.querySelector('#scroll-content canvas').getBoundingClientRect();
    return { x: Math.round(c.x) + 100, y: Math.round(c.y) + 130, width: 380, height: 44 };
  });
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 3 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'e2e/screenshots/emoji-after.png', clip: box });
  await page.screenshot({ path: 'e2e/screenshots/emoji-now.png', clip: { x: 200, y: 230, width: 400, height: 60 } });
});
