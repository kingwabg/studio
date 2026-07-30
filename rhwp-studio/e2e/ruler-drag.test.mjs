/**
 * 회귀: 자(ruler) 마커 드래그 — 한컴 패리티 확정 갭 수리(2026-07-30).
 * ruler.ts 에 pointer 리스너가 0개여서 마커를 끌 수 없었다.
 *  ① 마커 스냅샷이 렌더에서 노출된다 (히트테스트 좌표원)
 *  ② 첫 줄 마커 드래그 → indent 변경, 나머지 줄 유지
 *  ③ 오른쪽 마커 드래그 → marginRight 변경
 *  ④ hover 시 ew-resize 커서(어포던스)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('자 마커 드래그 — 여백·들여쓰기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '자 드래그 대상 문단');
  await new Promise((r) => setTimeout(r, 700));

  // ① 마커 스냅샷
  const snap = await page.evaluate(() => {
    const m = window.__ruler?.getMarkers?.();
    return m ? { firstX: Math.round(m.firstX), remainX: Math.round(m.remainX),
      rightX: Math.round(m.rightX), refLeft: Math.round(m.refLeft), zoom: m.zoom } : null;
  });
  console.log('  마커:', JSON.stringify(snap));
  assert.ok(snap, '자 마커 스냅샷이 노출된다(window.__ruler.getMarkers)');
  assert.ok(snap.rightX > snap.firstX, '오른쪽 마커가 첫 줄 마커보다 오른쪽');

  const rulerBox = await page.evaluate(() => {
    const c = document.getElementById('h-ruler');
    const r = c.getBoundingClientRect();
    return { top: r.top, left: r.left, h: r.height };
  });

  // ② 첫 줄 마커를 오른쪽으로 60px 끌기 → indent 증가
  const before = await page.evaluate(() => window.__inputHandler.getParaProperties());
  const y = rulerBox.top + rulerBox.h / 2;
  await page.mouse.move(rulerBox.left + snap.firstX, y);
  await page.mouse.down();
  await page.mouse.move(rulerBox.left + snap.firstX + 60, y, { steps: 5 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const afterFirst = await page.evaluate(() => window.__inputHandler.getParaProperties());
  console.log('  첫줄드래그:', JSON.stringify({
    beforeIndent: before.indent ?? 0, afterIndent: afterFirst.indent ?? 0,
    beforeMl: before.marginLeft ?? 0, afterMl: afterFirst.marginLeft ?? 0,
  }));
  assert.ok((afterFirst.indent ?? 0) > (before.indent ?? 0),
    `첫 줄 마커 드래그가 들여쓰기를 늘린다: ${before.indent ?? 0} → ${afterFirst.indent ?? 0}`);

  // ③ 오른쪽 마커를 왼쪽으로 50px 끌기 → marginRight 증가
  const snap2 = await page.evaluate(() => {
    const m = window.__ruler.getMarkers();
    return { rightX: Math.round(m.rightX) };
  });
  await page.mouse.move(rulerBox.left + snap2.rightX, y);
  await page.mouse.down();
  await page.mouse.move(rulerBox.left + snap2.rightX - 50, y, { steps: 5 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const afterRight = await page.evaluate(() => window.__inputHandler.getParaProperties());
  console.log('  오른쪽드래그:', JSON.stringify({
    beforeMr: afterFirst.marginRight ?? 0, afterMr: afterRight.marginRight ?? 0,
  }));
  assert.ok((afterRight.marginRight ?? 0) > (afterFirst.marginRight ?? 0),
    `오른쪽 마커 드래그가 오른쪽 여백을 늘린다: ${afterFirst.marginRight ?? 0} → ${afterRight.marginRight ?? 0}`);

  // ④ hover 어포던스
  const cursorStyle = await page.evaluate(async () => {
    const m = window.__ruler.getMarkers();
    const c = document.getElementById('h-ruler');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: r.left + m.remainX, clientY: r.top + r.height / 2, bubbles: true,
    }));
    await new Promise((res) => setTimeout(res, 100));
    return c.style.cursor;
  });
  console.log('  어포던스:', cursorStyle);
  assert.strictEqual(cursorStyle, 'ew-resize', '마커 위에서 커서가 ew-resize');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
