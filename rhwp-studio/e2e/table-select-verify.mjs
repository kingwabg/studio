/**
 * P0-2 슬라이스4-B 검증: 마우스로 표를 개체 다중 선택에 넣기.
 * 그림 클릭(개체 선택) → 표 셀 Shift+클릭 → 표가 selectedPictureRefs에 합류(type:'table').
 * 실행: node e2e/table-select-verify.mjs --mode=headless  (dev 서버 7700)
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
const MM = 7200 / 25.4;

runTest('마우스 표 선택 진입점', async ({ page }) => {
  await createNewDocument(page);

  const setup = await page.evaluate((MM) => {
    const wasm = window.__wasm, ih = window.__inputHandler;
    if (!ih.canvasMode) ih.setCanvasMode(true);
    const s = wasm.createShapeControl({
      sectionIdx: 0, paraIdx: 0, charOffset: 0,
      width: Math.round(40 * MM), height: Math.round(22 * MM),
      horzOffset: Math.round(30 * MM), vertOffset: Math.round(35 * MM),
      shapeType: 'textbox', treatAsChar: false, textWrap: 'InFrontOfText',
    });
    wasm.insertTextInCell(0, s.paraIdx, s.controlIdx, 0, 0, 0, '그림');
    const t = wasm.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 2, colCount: 2, treatAsChar: false });
    wasm.setTableProperties(0, t.paraIdx, t.controlIdx, { horzRelTo: 'Paper', vertRelTo: 'Paper', horzOffset: Math.round(110 * MM), vertOffset: Math.round(95 * MM), treatAsChar: false });
    ih.eventBus.emit('document-changed');
    return { shape: { ppi: s.paraIdx, ci: s.controlIdx }, table: { ppi: t.paraIdx, ci: t.controlIdx } };
  }, MM);
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  // 좌표 변환기 + 클릭 헬퍼를 페이지에 심는다
  const clickAt = async (mmX, mmY, shift) => page.evaluate(({ mmX, mmY, shift }) => {
    const ih = window.__inputHandler;
    const sc = document.querySelector('#scroll-content');
    const cr = sc.getBoundingClientRect();
    const zoom = ih.viewportManager.getZoom();
    const pl = ih.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
    const po = ih.virtualScroll.getPageOffset(0);
    const cx = cr.left + pl + (mmX * 96 / 25.4) * zoom;
    const cy = cr.top + po + (mmY * 96 / 25.4) * zoom;
    const canvas = sc.querySelector('canvas') || sc;
    const opt = { clientX: cx, clientY: cy, bubbles: true, button: 0, shiftKey: !!shift };
    canvas.dispatchEvent(new MouseEvent('mousedown', opt));
    document.dispatchEvent(new MouseEvent('mouseup', opt));
  }, { mmX, mmY, shift });

  // 1) 그림 클릭 → 개체 선택
  await clickAt(50, 46, false); // 그림 중심 근처 (30~70, 35~57)
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  const afterPic = await page.evaluate(() => ({
    inPic: window.__inputHandler.cursor.isInPictureObjectSelection(),
    count: window.__inputHandler.cursor.getSelectedPictureRefs().length,
  }));
  await screenshot(page, 'tbl-sel-01-picture');

  // 2) 표 셀 Shift+클릭 → 표를 개체 선택에 추가
  await clickAt(120, 100, true); // 표 내부 (110~, 95~)
  await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
  const afterTable = await page.evaluate(() => {
    const ih = window.__inputHandler;
    const refs = ih.cursor.getSelectedPictureRefs();
    return { multi: ih.cursor.isMultiPictureSelection(), count: refs.length, types: refs.map(r => r.type) };
  });
  await screenshot(page, 'tbl-sel-02-picture-plus-table');

  console.log('\n=== 마우스 표 선택 진입점 실측 ===');
  console.log(`1) 그림 클릭 후: inPicture=${afterPic.inPic}, 선택 ${afterPic.count}개`);
  console.log(`2) 표 Shift+클릭 후: multi=${afterTable.multi}, 선택 ${afterTable.count}개, 타입=[${afterTable.types.join(',')}]`);

  if (!afterPic.inPic) throw new Error('그림 클릭이 개체 선택으로 안 됨');
  if (!afterTable.multi || afterTable.count !== 2) throw new Error(`혼합 선택 실패: ${afterTable.count}개`);
  if (!afterTable.types.includes('table')) throw new Error('표가 개체 선택에 안 들어감');
  console.log('✅ 마우스 진입점 검증 통과 (그림 클릭 → 표 Shift+클릭 = 그림+표 혼합 선택)');
});
