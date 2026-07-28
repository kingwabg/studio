/**
 * 회귀: 새로고침(부팅) 직후 캐럿이 용지 안(본문 시작점)에 있는가.
 *
 * 증상(사용자 보고 2026-07-28, 스크린샷): 새로고침하면 캐럿이 용지 **왼쪽 바깥**에서
 * 깜빡인다. 원인 = 용지 가로 위치가 확정되기 전에 캐럿이 배치되고, 확정 후 아무도
 * 다시 그리지 않음. 판정은 캐럿의 화면 x 가 용지 좌우 안쪽인지.
 */
import assert from 'node:assert';
import { runTest, loadApp, waitForCanvas } from './helpers.mjs';

runTest('부팅 직후 캐럿이 용지 안에 있다', async ({ page }) => {
  await loadApp(page);
  await waitForCanvas(page);
  // 캐럿은 편집기가 활성일 때만 DOM 에 존재한다 — 클릭(=커서 이동) 없이 포커스만 준다.
  // 실사용에선 새로고침 후 자동 포커스 상태이므로 이것이 사용자 화면과 같은 조건.
  await page.bringToFront();
  // 캐럿은 커서 rect 가 있어야 표시된다 — 클릭(좌표 이동) 없이 문서 시작으로만 보낸다.
  // 실사용의 "새로고침 후 자동 포커스" 와 같은 상태.
  await page.evaluate(() => {
    const ih = window.__inputHandler;
    ih?.textarea?.focus();
    ih?.moveCursorTo?.(0, 0, 0);
    ih?.updateCaret?.();
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

  const r = await page.evaluate(() => {
    const view = window.__canvasView;
    const sc = document.querySelector('#scroll-content');
    const caret = document.querySelector('.caret');
    if (!caret) return { caret: null };
    const scr = sc.getBoundingClientRect();
    const cs = caret.getBoundingClientRect();
    const zoom = view.viewportManager.getZoom();
    const pageLeft = view.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
    const pageW = view.virtualScroll.getPageWidth(0);
    return {
      caretScreenX: Math.round(cs.left * 10) / 10,
      pageScreenLeft: Math.round((scr.left + pageLeft) * 10) / 10,
      pageScreenRight: Math.round((scr.left + pageLeft + pageW) * 10) / 10,
      zoom,
      caretPageX: Math.round(((cs.left - scr.left - pageLeft) / zoom) * 10) / 10,
    };
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.caret !== null, '캐럿 엘리먼트 없음');
  assert.ok(r.caretScreenX >= r.pageScreenLeft && r.caretScreenX <= r.pageScreenRight,
    `캐럿이 용지 밖: caretX=${r.caretScreenX}, 용지=${r.pageScreenLeft}~${r.pageScreenRight}`);
  // 빈 문서의 캐럿은 본문 시작(왼쪽 여백 113.4px @96dpi) 근처여야 한다
  assert.ok(Math.abs(r.caretPageX - 113.4) < 12,
    `캐럿이 본문 시작이 아님: 용지기준 x=${r.caretPageX} (기대 ≈113.4)`);
});
