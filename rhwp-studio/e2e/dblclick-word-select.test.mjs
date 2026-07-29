/**
 * 회귀: 2026-07-30 한컴 대조 실측에서 발견한 결함 3종 수리 판정식
 *  ① 더블클릭 = 단어 선택 → 곧바로 Ctrl+B 가 그 단어에 적용
 *  ② 선택이 남은 상태의 Ctrl+A 가 옛 anchor 를 승계하지 않는다 (문서 처음부터)
 *  ③ 전체선택 복사 HTML 에 범위 안 표 + 셀 테두리 CSS 포함 (엔진 export_selection_html)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('더블클릭 단어선택·Ctrl+A anchor·표 포함 복사', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '가나다 테스트 문장입니다.');
  await new Promise((r) => setTimeout(r, 500));

  // 표 삽입 (본문 끝 앵커)
  await page.evaluate(async () => {
    const w = window.__wasm;
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: 14, rowCount: 2, colCount: 2,
      treatAsChar: true, colWidths: [6000, 6000],
    })));
    w.insertTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, '셀하나');
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 400));
  });

  // ① 더블클릭 단어 선택 → Ctrl+B
  const word = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 5 }); // '테스트' 안
    const ok = ih.cursor.selectWordAtCursor();
    const sel = ih.cursor.getSelectionOrdered();
    return { ok, start: sel?.start.charOffset, end: sel?.end.charOffset };
  });
  console.log('  단어선택:', JSON.stringify(word));
  assert.ok(word.ok, '단어 선택 성공');
  assert.deepStrictEqual([word.start, word.end], [4, 7], "'테스트' 범위 [4,7]");

  await page.keyboard.down('Control');
  await page.keyboard.press('b');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 400));
  const bolded = await page.evaluate(() => {
    const w = window.__wasm;
    return w.exportSelectionHtml(0, 0, 0, 0, w.getParagraphLength(0, 0)).includes('font-weight:bold');
  });
  assert.ok(bolded, '더블클릭 선택에 Ctrl+B 적용');

  // ② 선택이 남은 상태(anchor=4)에서 Ctrl+A → 문서 처음부터 선택
  const selAll = await page.evaluate(() => {
    const ih = window.__inputHandler;
    ih.performSelectAll();
    const sel = ih.cursor.getSelectionOrdered();
    return { startPara: sel.start.paragraphIndex, startOff: sel.start.charOffset };
  });
  console.log('  전체선택:', JSON.stringify(selAll));
  assert.deepStrictEqual([selAll.startPara, selAll.startOff], [0, 0], 'Ctrl+A 는 문서 처음부터 (옛 anchor 승계 금지)');

  // ③ 전체 범위 HTML 에 표·테두리·굵게·본문 모두 포함
  const html = await page.evaluate(() => {
    const w = window.__wasm, ih = window.__inputHandler;
    const sel = ih.cursor.getSelectionOrdered();
    return w.exportSelectionHtml(0, sel.start.paragraphIndex, sel.start.charOffset,
      sel.end.paragraphIndex, sel.end.charOffset);
  });
  for (const [needle, why] of [
    ['가나다', '본문 앞부분'], ['<table', '범위 안 표'], ['셀하나', '셀 텍스트'],
    ['border-top:', '셀 테두리 CSS'], ['font-weight:bold', '굵게 서식'],
  ]) {
    assert.ok(html.includes(needle), `복사 HTML에 ${why} 포함`);
  }
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
