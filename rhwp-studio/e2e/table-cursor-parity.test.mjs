/**
 * 회귀: 표 앵커·TAC 커서 한컴 패리티 — 사용자 신고 3건 수리(2026-07-30).
 * 오라클 = 웹한글 실측(hancom-format-parity.md 부록):
 *  ① 자리차지 표를 아래로 이동해도 앵커 캐럿은 본문 흐름 위치에 남는다
 *  ② TAC(글자취급) 표는 문단 논리 길이에 1칸으로 잡히고, 표 뒤 캐럿·타이핑이 성립한다
 *  ③ 표를 덮는 선택 rect 가 표 전체 폭·높이를 포함한다
 *  ④ 표 뒤 Backspace = "[표] 를 지울까요?" 확인 대화상자 (즉시 삭제 아님)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('표 앵커·TAC 커서 패리티', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 400));

  // ── ① 자리차지 이동 후 앵커 캐럿이 흐름에 남는다 ──
  const anchor = await page.evaluate(async () => {
    const w = window.__wasm;
    const t = w.createTableEx({
      sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 2, colCount: 2,
      treatAsChar: false, colWidths: [6000, 6000],
    });
    w.setTableProperties(0, t.paraIdx, t.controlIdx, {
      treatAsChar: false, textWrap: 'TopAndBottom', vertRelTo: 'Para', horzRelTo: 'Column', vertOffset: 0,
    });
    const before = JSON.parse(w.doc.getCursorRect(0, t.paraIdx, 0));
    w.moveTableOffset(0, t.paraIdx, t.controlIdx, 0, 6000);
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 500));
    const after = JSON.parse(w.doc.getCursorRect(0, t.paraIdx, 0));
    const bbox = w.getTableBBox(0, t.paraIdx, t.controlIdx);
    return { beforeY: before.y, afterY: after.y, tableTop: bbox.y, pi: t.paraIdx, ci: t.controlIdx };
  });
  console.log('  ①앵커:', JSON.stringify(anchor));
  assert.ok(Math.abs(anchor.afterY - anchor.beforeY) <= 2,
    `이동 후 앵커 캐럿 y 가 흐름을 떠남: ${anchor.beforeY} → ${anchor.afterY}`);
  assert.ok(anchor.afterY < anchor.tableTop - 2,
    `앵커 캐럿(y=${anchor.afterY})이 표 상자(top=${anchor.tableTop}) 위에 있지 않음`);

  // ── ② TAC 논리 좌표계: 새 문서에서 '가나'+글자취급 표 ──
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '가나');
  await new Promise((r) => setTimeout(r, 400));
  const tac = await page.evaluate(async () => {
    const w = window.__wasm;
    const t = w.createTableEx({
      sectionIdx: 0, paraIdx: 0, charOffset: 2, rowCount: 1, colCount: 1,
      treatAsChar: true, colWidths: [3000],
    });
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 500));
    const ih = window.__inputHandler;
    // 표 뒤(논리 3)로 이동 — moveTo 클램프가 깎지 않아야 한다
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 3 });
    const kept = ih.cursor.getPosition().charOffset;
    return { logicalLen: w.getLogicalLength(0, 0), textLen: w.getParagraphLength(0, 0), kept, ci: t.controlIdx };
  });
  console.log('  ②TAC:', JSON.stringify(tac));
  assert.strictEqual(tac.logicalLen, 3, '논리 길이 = 텍스트 2 + 표 1');
  assert.strictEqual(tac.kept, 3, `moveTo 클램프가 표 뒤 오프셋을 깎음: ${tac.kept}`);

  // 표 뒤 타이핑 → 표 뒤에 글자가 들어간다
  await typeText(page, 'X');
  await new Promise((r) => setTimeout(r, 400));
  const typed = await page.evaluate(() => {
    const w = window.__wasm;
    const p = window.__inputHandler.cursor.getPosition();
    return { text: w.getTextRange(0, 0, 0, 3), logicalLen: w.getLogicalLength(0, 0), caret: p.charOffset };
  });
  console.log('  ②타이핑:', JSON.stringify(typed));
  assert.strictEqual(typed.text, '가나X', `표 뒤 타이핑이 표 앞에 꽂힘: '${typed.text}'`);
  assert.strictEqual(typed.logicalLen, 4, '타이핑 후 논리 길이 4');
  assert.strictEqual(typed.caret, 4, `타이핑 후 캐럿 논리 4 여야 함: ${typed.caret}`);

  // ── ③ 선택 rect 가 표를 덮는다 ──
  const rects = await page.evaluate((ci) => {
    const w = window.__wasm;
    const rs = w.getSelectionRects(0, 0, 0, 0, 4);
    const bbox = w.getTableBBox(0, 0, ci);
    const maxRight = Math.max(...rs.map((r) => r.x + r.width));
    const maxBottom = Math.max(...rs.map((r) => r.y + r.height));
    return { count: rs.length, maxRight, maxBottom,
      tableRight: bbox.x + bbox.width, tableBottom: bbox.y + bbox.height };
  }, tac.ci);
  console.log('  ③선택rect:', JSON.stringify(rects));
  assert.ok(rects.maxRight >= rects.tableRight - 2,
    `선택 rect 우단(${rects.maxRight})이 표 우단(${rects.tableRight})을 못 덮음`);

  // ── ④ 표 뒤 Backspace → 확인 대화상자 (한컴 O5) ──
  const pre = await page.evaluate(() => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 3 });
    return {
      pos: ih.cursor.getPosition(), sel: ih.cursor.hasSelection(),
      ctrlIdx: window.__wasm.getInlineControlIndexAtLogical(0, 0, 2),
      active: document.activeElement?.tagName,
    };
  });
  console.log('  ④pre:', JSON.stringify(pre));
  await page.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 700));
  const dialog = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('div')]
      .find((el) => el.children.length === 0 && el.textContent.includes('[표] 를 지울까요?'));
    return { shown: !!hit, pos: window.__inputHandler.cursor.getPosition(),
      logical: window.__wasm.getLogicalLength(0, 0) };
  });
  console.log('  ④지우기확인:', JSON.stringify(dialog));
  assert.ok(dialog.shown, 'Backspace 가 "[표] 를 지울까요?" 확인을 띄우지 않음');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  const afterCancel = await page.evaluate(() => window.__wasm.getLogicalLength(0, 0));
  assert.strictEqual(afterCancel, 4, '취소 후 표가 남아 있어야 함');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
