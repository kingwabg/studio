/**
 * 회귀: 표 셀 단위 클립보드 조작 — 한컴 실조작 오라클(2026-07-30) 대조
 *  ① 셀 블록 Ctrl+C → TSV + 표 HTML (기존 기능 보호)
 *  ② 셀 블록 Ctrl+X → 표 구조 유지·내용만 잘라내기 (실사고: 조용히 무동작이었다)
 *  ③ 셀 안에 표 붙여넣기 → 셀별 덮어쓰기 (실사고: 한 셀에 탭 문자열로 뭉개졌다)
 * 한컴 「셀 붙이기」의 나머지 6종(밀어내기 4·내용만 덮어쓰기·셀 안에 표로 넣기)은 미구현 —
 * 대화상자 작업과 함께 별도(사용자 결정 대기).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

const CELLS = 4;

runTest('표 셀 클립보드 — 블록 복사·잘라내기·셀 채움 붙여넣기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '본문');
  await new Promise((r) => setTimeout(r, 400));

  const t = await page.evaluate(async () => {
    const w = window.__wasm;
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: 2, rowCount: 2, colCount: 2,
      treatAsChar: true, colWidths: [6000, 6000],
    })));
    ['A1', 'B1', 'A2', 'B2'].forEach((v, i) => w.insertTextInCell(0, t.paraIdx, t.controlIdx, i, 0, 0, v));
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 500));
    return t;
  });

  // ① 셀 블록 전체 선택 → 복사 페이로드
  const copyRes = await page.evaluate(async (t) => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
      parentParaIndex: t.paraIdx, controlIndex: t.controlIdx, cellIndex: 0, cellParaIndex: 0 });
    ih.cursor.enterCellSelectionMode('manual');
    let guard = 0;
    while (ih.cursor.getCellSelectionPhase() < 3 && guard++ < 5) ih.cursor.advanceCellSelectionPhase();
    const dt = new DataTransfer();
    ih.onCopy(new ClipboardEvent('copy', { clipboardData: dt, cancelable: true }));
    return { plain: dt.getData('text/plain'), hasTable: dt.getData('text/html').includes('<table') };
  }, t);
  console.log('  ①복사:', JSON.stringify(copyRes));
  assert.strictEqual(copyRes.plain, 'A1\tB1\nA2\tB2', '셀 블록 복사 = TSV');
  assert.ok(copyRes.hasTable, '셀 블록 복사 = 표 HTML');

  // ② 셀 블록 잘라내기 — 내용만 비고 표는 남는다
  const cutRes = await page.evaluate(async (t) => {
    const ih = window.__inputHandler, w = window.__wasm;
    const dt = new DataTransfer();
    ih.onCut(new ClipboardEvent('cut', { clipboardData: dt, cancelable: true }));
    await new Promise((r) => setTimeout(r, 600));
    const read = (i) => w.getTextInCell(0, t.paraIdx, t.controlIdx, i, 0, 0,
      w.getCellParagraphLength(0, t.paraIdx, t.controlIdx, i, 0));
    return {
      cells: [0, 1, 2, 3].map(read),
      clip: dt.getData('text/plain'),
      cellCount: w.getTableCellBboxes(0, t.paraIdx, t.controlIdx).length,
    };
  }, t);
  console.log('  ②잘라내기:', JSON.stringify(cutRes));
  assert.deepStrictEqual(cutRes.cells, ['', '', '', ''], '셀 내용만 비워진다');
  assert.strictEqual(cutRes.clip, 'A1\tB1\nA2\tB2', '잘라낸 내용이 클립보드에 실린다');
  assert.strictEqual(cutRes.cellCount, CELLS, '표 구조(셀 4개)는 유지된다');

  // ③ 셀 안에 표 붙여넣기 = 셀별 덮어쓰기
  const pasteRes = await page.evaluate(async (t) => {
    const ih = window.__inputHandler, w = window.__wasm;
    ih.cursor.exitCellSelectionMode();
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
      parentParaIndex: t.paraIdx, controlIndex: t.controlIdx, cellIndex: 0, cellParaIndex: 0 });
    const dt = new DataTransfer();
    dt.setData('text/html', '<table><tr><td>X1</td><td>Y1</td></tr><tr><td>X2</td><td>Y2</td></tr></table>');
    dt.setData('text/plain', 'X1\tY1\nX2\tY2');
    ih.onPaste(new ClipboardEvent('paste', { clipboardData: dt, cancelable: true }));
    await new Promise((r) => setTimeout(r, 900));
    const read = (i) => w.getTextInCell(0, t.paraIdx, t.controlIdx, i, 0, 0,
      w.getCellParagraphLength(0, t.paraIdx, t.controlIdx, i, 0));
    return {
      cells: [0, 1, 2, 3].map(read),
      cellCount: w.getTableCellBboxes(0, t.paraIdx, t.controlIdx).length,
    };
  }, t);
  console.log('  ③붙여넣기:', JSON.stringify(pasteRes));
  assert.deepStrictEqual(pasteRes.cells, ['X1', 'Y1', 'X2', 'Y2'], '셀별로 덮어쓴다(탭 뭉개짐 금지)');
  assert.strictEqual(pasteRes.cellCount, CELLS, '붙여넣기가 표 구조를 늘리지 않는다');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
