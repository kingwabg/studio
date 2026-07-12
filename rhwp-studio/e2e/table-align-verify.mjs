/**
 * P0-2 슬라이스4 검증: 그림+표 혼합 다중 선택 정렬.
 * 그림 1 + 표 1을 selectedPictureRefs에 함께 넣고 왼쪽 정렬 →
 * 두 개체의 "렌더 bbox x"가 실제로 맞는지 측정(offset이 아니라 화면 좌표 기준).
 * 실행: node e2e/table-align-verify.mjs --mode=headless  (dev 서버 7700)
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
const MM = 7200 / 25.4;

runTest('그림+표 혼합 정렬', async ({ page }) => {
  await createNewDocument(page);

  const setup = await page.evaluate((MM) => {
    const wasm = window.__wasm, ih = window.__inputHandler;
    if (!ih.canvasMode) ih.setCanvasMode(true);
    // 그림(글상자) — 왼쪽 x=30mm
    const s = wasm.createShapeControl({
      sectionIdx: 0, paraIdx: 0, charOffset: 0,
      width: Math.round(40 * MM), height: Math.round(20 * MM),
      horzOffset: Math.round(30 * MM), vertOffset: Math.round(30 * MM),
      shapeType: 'textbox', treatAsChar: false, textWrap: 'InFrontOfText',
    });
    wasm.insertTextInCell(0, s.paraIdx, s.controlIdx, 0, 0, 0, '그림');
    // 표 — floating, x=100mm(오른쪽)로 절대배치
    const t = wasm.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 2, colCount: 2, treatAsChar: false });
    wasm.setTableProperties(0, t.paraIdx, t.controlIdx, { horzRelTo: 'Paper', vertRelTo: 'Paper', horzOffset: Math.round(100 * MM), vertOffset: Math.round(90 * MM), treatAsChar: false });
    ih.eventBus.emit('document-changed');
    return { shape: { ppi: s.paraIdx, ci: s.controlIdx }, table: { ppi: t.paraIdx, ci: t.controlIdx } };
  }, MM);
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  const bboxes = () => page.evaluate((setup) => {
    const wasm = window.__wasm;
    const shapeCtrl = (wasm.getPageControlLayout(0).controls || []).find(c => c.type === 'shape');
    const cells = wasm.getTableCellBboxes(0, setup.table.ppi, setup.table.ci) || [];
    let minX = Infinity, minY = Infinity;
    for (const c of cells) { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); }
    return { shapeX: Math.round(shapeCtrl.x), tableX: Math.round(minX) };
  }, setup);

  const before = await bboxes();
  await screenshot(page, 'tbl-align-01-before');

  // 그림+표를 함께 선택 → 왼쪽 정렬
  const selInfo = await page.evaluate((setup) => {
    const ih = window.__inputHandler;
    ih.cursor.enterPictureObjectSelectionDirect(0, setup.shape.ppi, setup.shape.ci, 'shape');
    ih.cursor.togglePictureObjectSelection({ sec: 0, ppi: setup.table.ppi, ci: setup.table.ci, type: 'table' });
    ih.renderPictureObjectSelection();
    ih.eventBus.emit('picture-object-selection-changed', true);
    const multi = ih.cursor.isMultiPictureSelection();
    const types = ih.cursor.getSelectedPictureRefs().map(r => r.type);
    ih.alignSelectedObjects('left');
    return { multi, types };
  }, setup);
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const after = await bboxes();
  await screenshot(page, 'tbl-align-02-after-left');

  const px2mm = (px) => (px / (96 / 25.4)).toFixed(1);
  console.log('\n=== 그림+표 혼합 정렬(왼쪽) 실측 ===');
  console.log(`혼합 선택: multi=${selInfo.multi}, 타입=[${selInfo.types.join(',')}]`);
  console.log(`정렬 전  그림 bbox.x=${before.shapeX}px(${px2mm(before.shapeX)}mm) · 표 bbox.x=${before.tableX}px(${px2mm(before.tableX)}mm)`);
  console.log(`정렬 후  그림 bbox.x=${after.shapeX}px(${px2mm(after.shapeX)}mm) · 표 bbox.x=${after.tableX}px(${px2mm(after.tableX)}mm)`);
  const delta = Math.abs(after.shapeX - after.tableX);
  console.log(`정렬 후 두 개체 x 차이 = ${delta}px (${px2mm(delta)}mm) — 0에 가까울수록 정확`);

  if (!selInfo.multi || !selInfo.types.includes('table')) throw new Error('그림+표 혼합 다중 선택 실패');
  if (after.tableX >= before.tableX - 10) throw new Error('표가 왼쪽으로 이동하지 않음');
  if (delta > 20) throw new Error(`정렬 후 두 개체 x 차이 과다: ${delta}px (좌표기준 불일치 의심)`);
  console.log('✅ 그림+표 혼합 정렬 검증 통과 (표가 그림 왼쪽선에 정렬됨)');
});
