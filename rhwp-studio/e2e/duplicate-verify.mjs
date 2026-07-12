/**
 * P0-2 슬라이스3 실구동 검증: 개체 복제(Ctrl+D).
 * (1) 단일: 글상자 1개 선택 → 키보드 Ctrl+D → 개체 2개, 복제본이 원본+오프셋에 선택됨.
 * (2) 다중: 글상자 2개 선택 → 복제 호출 → 개체 4개.
 * 실행: node e2e/duplicate-verify.mjs --mode=headless  (dev 서버 7700)
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
const MM = 7200 / 25.4;

runTest('개체 복제 실구동', async ({ page }) => {
  await createNewDocument(page);

  // 글상자 2개 생성 (A, B)
  const made = await page.evaluate((MM) => {
    const wasm = window.__wasm, ih = window.__inputHandler;
    if (!ih.canvasMode) ih.setCanvasMode(true);
    const mk = (x, y, label) => {
      const r = wasm.createShapeControl({
        sectionIdx: 0, paraIdx: 0, charOffset: 0,
        width: Math.round(35 * MM), height: Math.round(18 * MM),
        horzOffset: Math.round(x * MM), vertOffset: Math.round(y * MM),
        shapeType: 'textbox', treatAsChar: false, textWrap: 'InFrontOfText',
      });
      if (r.ok) wasm.insertTextInCell(0, r.paraIdx, r.controlIdx, 0, 0, 0, label);
      return { ppi: r.paraIdx, ci: r.controlIdx };
    };
    const A = mk(25, 35, '원본 A');
    const B = mk(120, 60, '원본 B');
    ih.eventBus.emit('document-changed');
    return { A, B };
  }, MM);
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const countObjects = () => page.evaluate(() =>
    (window.__wasm.getPageControlLayout(0).controls || []).filter(c => c.type === 'shape').length);

  const n0 = await countObjects();
  await screenshot(page, 'dup-01-before');

  // (1) 단일: A 선택 → 키보드 Ctrl+D
  const single = await page.evaluate((A) => {
    const ih = window.__inputHandler, wasm = window.__wasm;
    ih.cursor.enterPictureObjectSelectionDirect(0, A.ppi, A.ci, 'shape');
    ih.renderPictureObjectSelection();
    ih.eventBus.emit('picture-object-selection-changed', true);
    const origX = Math.round(wasm.getShapeProperties(0, A.ppi, A.ci).horzOffset / (7200 / 25.4));
    ih.textarea.focus();
    ih.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
    return { origX };
  }, made.A);
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  const n1 = await countObjects();
  await screenshot(page, 'dup-02-after-single');

  const afterSingle = await page.evaluate((origX) => {
    const ih = window.__inputHandler, wasm = window.__wasm;
    const refs = ih.cursor.getSelectedPictureRefs();
    const sel = refs.map(r => Math.round(wasm.getShapeProperties(0, r.ppi, r.ci).horzOffset / (7200 / 25.4)));
    return { count: refs.length, selX: sel, origX };
  }, single.origX);

  // (2) 다중: A·B 선택 → 복제 호출 (엔진 직접)
  const multi = await page.evaluate((made) => {
    const ih = window.__inputHandler;
    ih.cursor.enterPictureObjectSelectionDirect(0, made.A.ppi, made.A.ci, 'shape');
    ih.cursor.togglePictureObjectSelection({ sec: 0, ppi: made.B.ppi, ci: made.B.ci, type: 'shape' });
    const before = ih.cursor.getSelectedPictureRefs().length;
    ih.duplicateSelectedObjects();
    return { before, afterSel: ih.cursor.getSelectedPictureRefs().length };
  }, made);
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  const n2 = await countObjects();
  await screenshot(page, 'dup-03-after-multi');

  console.log('\n=== 개체 복제 실측 ===');
  console.log(`[단일 Ctrl+D] 개체 수 ${n0} → ${n1} (기대 +1)`);
  console.log(`  복제본 선택: ${afterSingle.count}개, x좌표(mm)=[${afterSingle.selX.join(',')}] (원본 ${afterSingle.origX}mm에서 오프셋)`);
  console.log(`[다중 복제] 선택 ${multi.before}개 복제 → 개체 수 ${n1} → ${n2} (기대 +${multi.before}), 복제본 선택 ${multi.afterSel}개`);

  if (n1 !== n0 + 1) throw new Error(`단일 복제 실패: ${n0}→${n1}`);
  if (afterSingle.count !== 1) throw new Error('복제 후 복제본 1개가 선택돼야 함');
  if (afterSingle.selX[0] <= afterSingle.origX) throw new Error('복제본이 원본보다 오른쪽(오프셋)이어야 함');
  if (n2 !== n1 + multi.before) throw new Error(`다중 복제 실패: ${n1}→${n2}`);
  if (multi.afterSel !== multi.before) throw new Error('다중 복제본 선택 수 불일치');
  console.log('✅ 개체 복제 실구동 검증 통과 (단일 Ctrl+D + 다중, 복제본 선택·오프셋 확인)');
});
