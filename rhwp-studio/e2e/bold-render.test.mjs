/**
 * 회귀: 굵게가 **화면에 실제로 굵게** 그려지는가.
 *
 * 배경(실사고 2026-07-30): 함초롬바탕이 레귤러 한 굵기로만 등록돼 있었고, 캔버스는
 * 웹폰트에 가짜 볼드를 합성하지 않는다 — 그래서 bold:true 가 모델엔 저장되는데 화면은
 * 레귤러 그대로였다(사용자: "굵게 하면 연해져"). 값 검사만으로는 못 잡는 부류라
 * **픽셀로** 판정한다: 굵게 후 어두운 픽셀 수가 유의미하게 늘어야 한다(실측 +24%).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { runTest, createNewDocument, clickEditArea, typeText, captureCanvasScreenshot } from './helpers.mjs';

function darkPixels(path) {
  const png = PNG.sync.read(fs.readFileSync(path));
  let dark = 0;
  for (let y = 240; y < 320; y++) for (let x = 200; x < 900; x++) {
    const i = (y * png.width + x) * 4;
    const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
    if (l < 160) dark++;
  }
  return dark;
}

runTest('굵게 픽셀 실측 — 볼드 얼굴이 실제로 그려진다', async ({ page }) => {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '일반 텍스트 검사');
  // CDN 볼드 얼굴 로드 대기 — document.fonts 로 확정한다
  await page.evaluate(() => document.fonts.load('bold 13px 함초롬바탕'));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
  await captureCanvasScreenshot(page, 'e2e/screenshots/bold-before.png', 'before');

  await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const w = window.__wasm;
    const len = w.getParagraphLength(0, 0);
    ih.applyCharPropsToRange(
      { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      { sectionIndex: 0, paragraphIndex: 0, charOffset: len },
      { bold: true });
    await new Promise((r) => setTimeout(r, 800));
  });
  await captureCanvasScreenshot(page, 'e2e/screenshots/bold-after.png', 'after');

  const before = darkPixels('e2e/screenshots/bold-before.png');
  const after = darkPixels('e2e/screenshots/bold-after.png');
  console.log('  실측:', JSON.stringify({ before, after, ratio: Math.round(after / before * 100) / 100 }));
  assert.ok(before > 300, `사전 조건 — 텍스트가 그려져 있어야 함 (${before})`);
  assert.ok(after > before * 1.12, `굵게 후 어두운 픽셀이 12% 이상 늘어야 함 (${before} → ${after})`);
});
