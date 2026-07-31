import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';
runTest('이모지 크기 정밀', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    window.__wasm.doc.insertText(0, 0, 0, '가😀나😀다 라마바');
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 900));
  // 캐럿 x 로 각 글자의 실제 전진폭을 잰다(눈대중 대신 수치)
  const xs = await page.evaluate(() => {
    const w = window.__wasm;
    const len = w.getParagraphLength(0, 0);
    return Array.from({ length: len + 1 }, (_, i) => +w.getCursorRect(0, 0, i).x.toFixed(1));
  });
  const steps = xs.slice(1).map((v, i) => +(v - xs[i]).toFixed(1));
  console.log('  전진폭:', JSON.stringify(steps), ' (가 😀 나 😀 다 공백 라 마 바)');
  // 400% 확대해서 눈으로도 확인
  await page.evaluate(() => window.__canvasView.getViewportManager().setZoom(4));
  await new Promise((r) => setTimeout(r, 1500));
  const box = await page.evaluate(() => {
    const c = document.querySelector('#scroll-content canvas');
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y + 120), w: 520, h: 120 };
  });
  await page.screenshot({ path: 'e2e/screenshots/emoji-size.png', clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  console.log('  shot ok');
});
