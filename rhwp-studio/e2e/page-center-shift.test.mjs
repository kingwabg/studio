/**
 * 실측: 새로고침 직후 용지(page)의 가로 위치가 시간에 따라 이동하는가.
 * 사용자 보고(2026-07-28): "새로고침하면 용지가 오른쪽에 있다가 중앙으로 온다" —
 * 그 사이에 계산된 오버레이(캐럿 등)가 옛 좌표에 남아 여백 밖으로 보인다.
 *
 * ⚠ loadApp 이후에 재면 이미 안정된 뒤라 못 잡는다 → **네비게이션 전에** 샘플러를 심는다.
 */
import assert from 'node:assert';
import { runTest, loadApp, waitForCanvas } from './helpers.mjs';

runTest('부팅 중 용지 가로 위치가 흔들리지 않는다', async ({ page }) => {
  // 페이지 로드 전에 주입 — rAF 마다 용지 위치를 기록한다
  await page.evaluateOnNewDocument(() => {
    window.__shiftLog = [];
    const t0 = performance.now();
    const tick = () => {
      const sc = document.querySelector('#scroll-content');
      const view = window.__canvasView;
      if (sc && view?.virtualScroll) {
        const cw = sc.clientWidth;
        const pl = view.virtualScroll.getPageLeftResolved(0, cw);
        const rect = sc.getBoundingClientRect();
        const caret = document.querySelector('.caret');
        window.__shiftLog.push({
          t: Math.round(performance.now() - t0),
          cw,
          scLeft: Math.round(rect.left * 10) / 10,
          pageLeft: Math.round(pl * 10) / 10,
          pageScreen: Math.round((rect.left + pl) * 10) / 10,
          caret: caret ? caret.style.left : null,
        });
      }
      if (performance.now() - t0 < 12000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await loadApp(page);
  await waitForCanvas(page);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));

  const log = await page.evaluate(() => {
    // 값이 바뀌는 순간만 추린다
    const out = [];
    let prev = '';
    for (const s of window.__shiftLog) {
      const key = `${s.cw}|${s.pageScreen}|${s.caret}`;
      if (key !== prev) { out.push(s); prev = key; }
    }
    return out;
  });

  console.log('  변화 지점:', JSON.stringify(log, null, 0));
  const screens = log.map((s) => s.pageScreen);
  const min = Math.min(...screens), max = Math.max(...screens);
  // 스크롤바 출현/소멸(±20px)은 브라우저 몫이라 없앨 수 없다 — 대신 그때 캐럿이
  // 따라가는지가 판정(caret-follows-page-recenter.test.mjs). 여기선 큰 점프만 막는다.
  assert.ok(max - min < 30,
    `부팅 중 용지가 가로로 ${(max - min).toFixed(1)}px 이동함 (${min} → ${max})`);
});
