/**
 * 회귀: 변경 내용 추적 — 판정식 ⑤ (rhwp mydocs/eng/plans/track-changes.md)
 *
 * ①토글 ON 후 타이핑 → 변경 1건 + 오버레이 표시 ②백스페이스 → 글자 남고 Delete 마크
 * ③적용 후 다음 → 변경 해소·오버레이 소멸 ④Ctrl+Z → 복원(스냅샷 승격 증명)
 * ⑤리본 검토 탭에 명령 배선.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('변경 추적 — 기록·표시·검토·되돌리기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '원본내용');
  await new Promise((r) => setTimeout(r, 500));

  // ① 토글 ON → 타이핑
  await page.evaluate(() => window.__inputHandler.dispatcher.dispatch('review:track-toggle'));
  await new Promise((r) => setTimeout(r, 300));
  await typeText(page, '추가');
  await new Promise((r) => setTimeout(r, 700));

  const afterInsert = await page.evaluate(() => {
    const w = window.__wasm;
    return {
      enabled: w.isTrackChangesEnabled(),
      changes: JSON.parse(w.getTrackChanges()),
      overlay: document.querySelectorAll('.track-mark--insert').length,
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
    };
  });
  console.log('  삽입:', JSON.stringify(afterInsert));
  assert.ok(afterInsert.enabled, '추적 ON');
  assert.strictEqual(afterInsert.changes.length, 1, '삽입 변경 1건');
  assert.strictEqual(afterInsert.changes[0].kind, 'insert');
  assert.strictEqual(afterInsert.changes[0].text, '추가', '변경 본문');
  assert.ok(afterInsert.overlay >= 1, '삽입 오버레이 표시');
  assert.ok(afterInsert.text.includes('추가'), '글자는 실제로 들어감');

  // ② 백스페이스 — 원본 글자를 지우면 남고 Delete 마크
  await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 });
    ih.updateCaret?.();
  });
  await page.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 700));
  const afterDelete = await page.evaluate(() => {
    const w = window.__wasm;
    return {
      changes: JSON.parse(w.getTrackChanges()),
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
      overlayDel: document.querySelectorAll('.track-mark--delete').length,
    };
  });
  console.log('  삭제:', JSON.stringify(afterDelete));
  assert.ok(afterDelete.text.startsWith('원본'), '추적 삭제는 글자를 지우지 않는다');
  assert.ok(afterDelete.changes.some((c) => c.kind === 'delete'), 'Delete 변경 기록');
  assert.ok(afterDelete.overlayDel >= 1, '삭제 오버레이(취소선) 표시');

  // ③ 모두 적용 → 삭제 확정·삽입 확정, 변경 소진, 오버레이 소멸
  await page.evaluate(() => window.__inputHandler.dispatcher.dispatch('review:accept-all'));
  await new Promise((r) => setTimeout(r, 700));
  const afterAccept = await page.evaluate(() => {
    const w = window.__wasm;
    return {
      changes: JSON.parse(w.getTrackChanges()).length,
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
      overlay: document.querySelectorAll('.track-mark').length,
    };
  });
  console.log('  적용:', JSON.stringify(afterAccept));
  assert.strictEqual(afterAccept.changes, 0, '변경 목록 소진');
  assert.ok(!afterAccept.text.includes('본'), '삭제 확정 — 지운 글자 소멸');
  assert.ok(afterAccept.text.includes('추가'), '삽입 확정 — 글자 유지');
  assert.strictEqual(afterAccept.overlay, 0, '오버레이 소멸');

  // ④ Ctrl+Z → 검토 이전 상태 복원 (스냅샷 승격 증명)
  await page.evaluate(async () => {
    window.__inputHandler.performUndo();
    await new Promise((r) => setTimeout(r, 300));
  });
  const afterUndo = await page.evaluate(() => {
    const w = window.__wasm;
    return {
      changes: JSON.parse(w.getTrackChanges()).length,
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
    };
  });
  console.log('  되돌리기:', JSON.stringify(afterUndo));
  assert.ok(afterUndo.text.startsWith('원본'), 'undo → 삭제 표시 글자 복원');
  assert.strictEqual(afterUndo.changes, 2, 'undo → 변경 목록 복원');

  // ⑥ [v2] 선택 삭제 — 지워지지 않고 마크 (실사고: delete_range 훅 밖이라 진짜 지워졌었다)
  const range = await page.evaluate(async () => {
    const ih = window.__inputHandler, w = window.__wasm;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 200));
    return { before: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)) };
  });
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 700));
  const afterRange = await page.evaluate(() => {
    const w = window.__wasm;
    return {
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
      changes: JSON.parse(w.getTrackChanges()).filter((c) => c.kind === 'delete').length,
    };
  });
  console.log('  선택삭제:', JSON.stringify(afterRange));
  assert.strictEqual(afterRange.text, range.before, '선택 삭제도 글자를 지우지 않는다');
  assert.ok(afterRange.changes >= 1, '선택 삭제가 Delete 변경으로 기록');

  // ⑦ [v2] 셀 안 추적 + 셀 오버레이 + 여백 변경 막대 + 한컴 빨강
  const cellRes = await page.evaluate(async () => {
    const w = window.__wasm, ih = window.__inputHandler;
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: w.getParagraphLength(0, 0),
      rowCount: 2, colCount: 2, treatAsChar: true, colWidths: [6000, 6000],
    })));
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 500));
    w.insertTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, '셀추가');
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 600));
    ih.refreshTrackOverlay();
    await new Promise((r) => setTimeout(r, 300));
    const cellChange = JSON.parse(w.getTrackChanges()).find((c) => c.cell);
    const mark = document.querySelector('.track-mark--insert');
    return {
      cellChange: cellChange ? { kind: cellChange.kind, text: cellChange.text } : null,
      bars: document.querySelectorAll('.track-change-bar').length,
      insertColor: mark ? getComputedStyle(mark).borderBottomColor : null,
    };
  });
  console.log('  셀·표시:', JSON.stringify(cellRes));
  assert.deepStrictEqual(cellRes.cellChange, { kind: 'insert', text: '셀추가' }, '셀 삽입이 추적됨');
  assert.ok(cellRes.bars >= 1, '왼쪽 여백 변경 막대(한컴식)');
  assert.strictEqual(cellRes.insertColor, 'rgb(224, 49, 49)', '삽입 표시는 한컴 빨강');

  // ⑧ [v2] 본 최종 미리보기 — 적용본 표시·편집 잠금·복귀
  const finalView = await page.evaluate(async () => {
    const ih = window.__inputHandler, w = window.__wasm;
    const beforeChanges = JSON.parse(w.getTrackChanges()).length;
    ih.dispatcher.dispatch('review:view-final');
    await new Promise((r) => setTimeout(r, 600));
    const inFinal = {
      changes: JSON.parse(w.getTrackChanges()).length,
      locked: !ih.active,
    };
    ih.dispatcher.dispatch('review:view-final');
    await new Promise((r) => setTimeout(r, 600));
    return {
      beforeChanges,
      inFinal,
      restored: JSON.parse(w.getTrackChanges()).length,
      unlocked: ih.active,
    };
  });
  console.log('  본최종:', JSON.stringify(finalView));
  assert.strictEqual(finalView.inFinal.changes, 0, '본 최종 = 변경이 전부 적용된 모습');
  assert.ok(finalView.inFinal.locked, '본 최종 중 편집 잠금');
  assert.strictEqual(finalView.restored, finalView.beforeChanges, '복귀 시 변경 목록 복원');
  assert.ok(finalView.unlocked, '복귀 시 편집 잠금 해제');

  // ⑤ 리본 검토 탭 배선
  const ribbon = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find((b) => b.textContent === '검토')?.click();
    return [...document.querySelectorAll('.rb-btn[data-cmd^="review:"]')].map((b) => b.dataset.cmd);
  });
  for (const c of ['review:track-toggle', 'review:accept-change', 'review:reject-change', 'review:prev-change', 'review:next-change', 'review:view-final']) {
    assert.ok(ribbon.includes(c), `검토 리본에 ${c}`);
  }
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
