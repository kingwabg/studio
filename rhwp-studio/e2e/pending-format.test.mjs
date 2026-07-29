/**
 * 회귀: 빈 문단에서 서식을 **먼저 고르고** 치면 그대로 나온다 (대기 서식).
 *
 * 배경(사용자 신고 2026-07-30): 선택이 없으면 applyToggleFormat 이 조기 반환하고
 * format-char 도 무시돼, 빈 문단에서 B·크기를 눌러도 아무 일도 없었다.
 * 워드·한컴은 "다음에 칠 글자"에 걸어 둔다 — 그 수명(커서를 옮기면 무효)까지 판정한다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('대기 서식 — 빈 문단에서 먼저 고르고 치기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 500));

  // 굵게 + 18pt 를 먼저 고른다 (선택 없음)
  const ui = await page.evaluate(async () => {
    document.querySelector('.canva-tog-btn[title="굵게"]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    window.__eventBus.emit('format-char', { fontSize: 1800 });
    await new Promise((r) => setTimeout(r, 250));
    return {
      btnActive: document.querySelector('.canva-tog-btn[title="굵게"]').classList.contains('is-active'),
      sizeShown: document.querySelector('.canva-stepper input')?.value,
    };
  });
  assert.ok(ui.btnActive, '고른 즉시 패널이 눌린 상태로 보여야 함');
  assert.strictEqual(ui.sizeShown, '18', '크기도 즉시 반영');

  await typeText(page, '굵은글자');
  await new Promise((r) => setTimeout(r, 700));
  const typed = await page.evaluate(() => {
    const w = window.__wasm;
    const cp = w.getCharPropertiesAt(0, 0, 0);
    return { bold: cp.bold, fontSize: cp.fontSize, len: w.getParagraphLength(0, 0) };
  });
  console.log('  입력 결과:', JSON.stringify(typed));
  assert.strictEqual(typed.len, 4, '글자가 들어가야 함');
  assert.strictEqual(typed.bold, true, '대기 굵게가 입력 글자에 적용');
  assert.strictEqual(typed.fontSize, 1800, '대기 크기가 입력 글자에 적용');

  // 수명: 커서를 옮기면 대기 서식은 버려진다 — 새 문단은 평범해야 한다
  const after = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    await new Promise((r) => setTimeout(r, 250));
    return ih.getPendingCharFormat();
  });
  assert.strictEqual(after, null, '커서를 옮기면 대기 서식은 무효');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
