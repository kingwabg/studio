/** 커서만 움직일 때 사전이 다시 도는가 — 도는 횟수를 센다 */
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';
runTest('커서 이동 시 재검사', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(async () => { await window.__dict.ensureDictionary(); });
  await page.evaluate(() => {
    window.__wasm.doc.insertText(0, 0, 0, '뭐 잘 되는대 어차피 죽으면 모드게 끝이라 정말로 그렇다');
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 1200));
  const r = await page.evaluate(async () => {
    const props = window.__wasm.getCharPropertiesAt(0, 0, 0);
    const move = (n) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        window.__inputHandler.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: i % 15 });
        window.__eventBus.emit('cursor-format-changed', props);
      }
      return +(performance.now() - t0).toFixed(1);
    };
    const 커서만 = move(20);
    // 내용을 바꾸면 반드시 다시 돌아야 한다(가드가 과하지 않은지 확인)
    window.__wasm.doc.insertText(0, 0, 0, '모드게 ');
    const t0 = performance.now();
    window.__eventBus.emit('cursor-format-changed', props);
    const 내용변경1회 = +(performance.now() - t0).toFixed(1);
    const chips = [...document.querySelectorAll('.canva-specimen-word')].map((x) => x.textContent);
    return { 커서만_20회_ms: 커서만, 내용변경_1회_ms: 내용변경1회, 칩: chips };
  });
  console.log(' ', JSON.stringify(r));
});
