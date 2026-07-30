import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';
runTest('probe backspace', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '가나');
  await new Promise((r) => setTimeout(r, 300));
  const out = await page.evaluate(async () => {
    const w = window.__wasm;
    const t = w.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 2, rowCount: 1, colCount: 1, treatAsChar: true, colWidths: [3000] });
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 400));
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 3 });
    let probe = {};
    try { probe.ctrlIdx = w.getInlineControlIndexAtLogical(0, 0, 2); } catch (e) { probe.ctrlErr = String(e); }
    try { probe.tblProps = !!w.getTableProperties(0, 0, probe.ctrlIdx); } catch (e) { probe.tblErr = String(e); }
    return { ci: t.controlIdx, probe, pos: ih.cursor.getPosition() };
  });
  console.log('PROBE1:', JSON.stringify(out));
  await page.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 500));
  const out2 = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll('div')].filter((el) => el.children.length === 0 && el.textContent.includes('지울'));
    const titles = [...document.querySelectorAll('div,span,h1,h2')].map((el) => el.textContent).filter((tx) => tx && tx.length < 30 && tx.includes('지우'));
    return { txt: window.__wasm.getTextRange(0, 0, 0, 3), logical: window.__wasm.getLogicalLength(0, 0), overlays: overlays.map((o) => o.textContent), titles: titles.slice(0, 5), pos: window.__inputHandler.cursor.getPosition() };
  });
  console.log('PROBE2:', JSON.stringify(out2));
});
