/**
 * 진짜 사용자 경로 재현: 표 셀에 색 → 표속성 다이얼로그에서 '글자처럼 취급' 해제 → 확인
 * 실행: node e2e/officex-dialog-repro.test.mjs --mode=headless
 */
import { runTest, createNewDocument, clickEditArea, captureCanvasScreenshot } from './helpers.mjs';
const OUT = 'e2e/screenshots';

runTest('officex 실다이얼로그 색손실 재현', async ({ page }) => {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await createNewDocument(page);
  await clickEditArea(page);

  const c = await page.evaluate(() => {
    const w = window.__wasm;
    const sec = 0, para = 0;
    const textLen = w.doc.getParagraphLength(sec, para);
    const r = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: sec, paraIdx: para, charOffset: textLen,
      rowCount: 2, colCount: 2, treatAsChar: true, colWidths: [8000, 8000],
    })));
    const colors = ['#ff0000', '#ffff00', '#0000ff', '#00cc00'];
    for (let i = 0; i < 4; i++) {
      w.setCellProperties(sec, r.paraIdx, r.controlIdx, i, { fillType: 'solid', fillColor: colors[i], patternColor: '#000000', patternType: 0 });
      w.doc.insertTextInCell(sec, r.paraIdx, r.controlIdx, i, 0, 0, `C${i}`);
    }
    return { sec, paraIdx: r.paraIdx, controlIdx: r.controlIdx };
  });
  await page.evaluate(() => window.__eventBus?.emit?.('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 900)));
  await captureCanvasScreenshot(page, `${OUT}/officex-dlg-BEFORE.png`, 'dlg BEFORE');

  // 셀 안 클릭해서 커서를 표 내부로
  const canvas = await page.$('#scroll-container canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + 150, box.y + 138);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const ctxInfo = await page.evaluate(() => {
    const ih = window.__inputHandler;
    const pos = ih?.cursor?.getPosition?.() || ih?.getCursorPosition?.();
    const hasDisp = !!(ih && ih.dispatcher);
    return { pos, hasDisp, inTable: !!ih?.isInTable?.() };
  });
  console.log('  커서/디스패처:', JSON.stringify(ctxInfo));

  // wasm 호출 인터셉트 (다이얼로그가 실제로 무엇을 보내는지)
  await page.evaluate(() => {
    const w = window.__wasm;
    window.__calls = [];
    for (const m of ['setCellProperties', 'setTableProperties']) {
      const orig = w[m].bind(w);
      w[m] = (...args) => { window.__calls.push({ m, args }); return orig(...args); };
    }
  });

  // 진짜 다이얼로그 열기
  const opened = await page.evaluate(() => {
    const ih = window.__inputHandler;
    const disp = ih?.dispatcher;
    if (!disp) return { ok: false, why: 'no dispatcher' };
    const r = disp.dispatch('table:cell-props');
    const dlg = document.querySelector('.tcp-dialog') || document.querySelector('.dialog-wrap');
    return { ok: r, hasDlg: !!dlg };
  });
  console.log('  다이얼로그 open:', JSON.stringify(opened));
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

  // '글자처럼 취급' 체크박스 해제 후 확인
  const applied = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.dialog-wrap label, .tcp-dialog label')];
    const tac = labels.find(l => l.textContent && l.textContent.includes('글자처럼'));
    const input = tac?.querySelector('input[type=checkbox]');
    const before = input?.checked;
    if (input && input.checked) {
      input.click(); // change 이벤트 포함
    }
    const wraps = [...document.querySelectorAll('.dialog-wrap button')].map(b => b.textContent);
    const ok = document.querySelector('.dialog-btn-primary');
    const okText = ok?.textContent;
    if (ok) ok.click();
    return { tacFound: !!input, tacBefore: before, tacAfter: input?.checked, okText, wraps };
  });
  console.log('  적용:', JSON.stringify(applied));
  await page.evaluate(() => new Promise(r => setTimeout(r, 1200)));
  const calls = await page.evaluate(() => window.__calls);
  console.log('  wasm 호출 =', JSON.stringify(calls, null, 1));

  const after = await page.evaluate((cc) => {
    const w = window.__wasm;
    const tp = JSON.parse(w.getTableProperties ? JSON.stringify(w.getTableProperties(cc.sec, cc.paraIdx, cc.controlIdx)) : (w.doc.getTableProperties(cc.sec, cc.paraIdx, cc.controlIdx)));
    const canvases = [...document.querySelectorAll('#scroll-container canvas')].map(cv => ({ overlay: cv.dataset.rhwpOverlay || null, kind: cv.dataset.rhwpLayerKind || null }));
    return { textWrap: tp.textWrap, treatAsChar: tp.treatAsChar, vertRelTo: tp.vertRelTo, canvases };
  }, c);
  console.log('  AFTER props:', JSON.stringify(after));
  await captureCanvasScreenshot(page, `${OUT}/officex-dlg-AFTER.png`, 'dlg AFTER (selected)');

  // 선택 해제: 표에서 먼 빈 곳 클릭
  await page.mouse.click(box.x + 500, box.y + 500);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  // ESC로 오브젝트 선택 확실히 해제
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)));
  const sel = await page.evaluate(() => {
    const ih = window.__inputHandler;
    return { inObjSel: !!ih?.isInTableObjectSelection?.(), inTable: !!ih?.isInTable?.() };
  });
  console.log('  deselect 후:', JSON.stringify(sel));
  await captureCanvasScreenshot(page, `${OUT}/officex-dlg-DESELECT.png`, 'dlg DESELECT');
});
