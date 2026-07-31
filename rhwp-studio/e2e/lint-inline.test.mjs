/**
 * 인라인 검사 1차 — 판정식 (스펙: docs/plans/format-linter.md)
 *
 * ① 위반이 있는 문서를 열면 1초 안에 밑줄이 뜬다
 * ② 밑줄 클릭 → 카드 → [적용] → 문서가 바뀌고 그 밑줄이 사라진다
 * ③ Ctrl+Z 한 번으로 되돌아간다 (되돌리기가 안 되면 아무도 [전부 적용]을 안 누른다)
 * ④ [전부 적용] 후 재검사하면 위반 0건
 * ⑤ 오탐 0건 — 규칙에 맞는 문장에는 밑줄이 하나도 안 뜬다
 * ⑥ 100문단 검사 50ms 이내
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const BAD = '이 문장은 되요 그리고 역활이 있습니다';
const GOOD = '이 문장은 맞춤법에 어긋나지 않습니다.';

runTest('인라인 검사 — 밑줄·적용·되돌리기·전부 적용', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  const marks = () => page.evaluate(() => document.querySelectorAll('.lint-mark').length);
  const paraText = () => page.evaluate(() => {
    const w = window.__wasm;
    return w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
  });

  // ① 위반 문장 입력 → 1초 안에 밑줄
  await page.evaluate((t) => {
    window.__wasm.doc.insertText(0, 0, 0, t);
    window.__eventBus.emit('document-changed');
  }, BAD);
  await new Promise((r) => setTimeout(r, 1000));
  const n0 = await marks();
  console.log('  ① 밑줄:', n0, '건 /', JSON.stringify(await paraText()));
  assert.ok(n0 >= 2, `1초 안에 밑줄 2건 이상 (실측 ${n0})`);

  // ② 첫 밑줄 클릭 → 카드 → [적용]
  await page.evaluate(() => {
    document.querySelector('.lint-mark').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  const cardMsg = await page.evaluate(() => document.querySelector('.lint-card-msg')?.textContent);
  console.log('  ② 카드:', JSON.stringify(cardMsg));
  assert.ok(cardMsg, '카드가 떠야 한다');
  await page.evaluate(() => {
    [...document.querySelectorAll('.lint-card-btn')].find((b) => b.textContent === '적용')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 700));
  const afterFix = await paraText();
  console.log('  ② 적용 후:', JSON.stringify(afterFix));
  assert.notStrictEqual(afterFix, BAD, '문서가 실제로 바뀌어야 한다');
  const n1 = await marks();
  assert.ok(n1 < n0, `밑줄이 줄어야 한다 (${n0} → ${n1})`);

  // ③ Ctrl+Z 한 번 → 원상복구
  await clickEditArea(page); // 카드에 갔던 포커스를 본문으로 돌려놓는다
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 700));
  const afterUndo = await paraText();
  console.log('  ③ 되돌린 뒤:', JSON.stringify(afterUndo));
  assert.strictEqual(afterUndo, BAD, 'Ctrl+Z 한 번으로 되돌아가야 한다');

  // ④ 전부 적용 → 재검사 0건
  await page.evaluate(() => window.__lint.applyAll());
  await new Promise((r) => setTimeout(r, 900));
  const left = await page.evaluate(() => window.__lint.scan() >= 0 && window.__lint.count());
  console.log('  ④ 전부 적용 후:', JSON.stringify(await paraText()), '남은 지적', left);
  assert.strictEqual(left, 0, '전부 적용 후 위반 0건');

  // ⑤ 오탐 0건 — 멀쩡한 문장만 남기고 검사
  await page.evaluate((t) => {
    const w = window.__wasm;
    w.doc.deleteText(0, 0, 0, w.getParagraphLength(0, 0));
    w.doc.insertText(0, 0, 0, t);
    window.__eventBus.emit('document-changed');
  }, GOOD);
  await new Promise((r) => setTimeout(r, 900));
  const falsePos = await page.evaluate(() => { window.__lint.scan(); return window.__lint.count(); });
  console.log('  ⑤ 정상 문장 지적:', falsePos, '건');
  assert.strictEqual(falsePos, 0, '오탐 0건');

  // ⑥ 100문단 검사 시간
  const ms = await page.evaluate(() => {
    const w = window.__wasm;
    for (let i = 1; i < 100; i++) {
      w.doc.splitParagraph(0, i - 1, w.getParagraphLength(0, i - 1));
      w.doc.insertText(0, i, 0, '보통 길이의 본문 문장을 한 줄 적어 둡니다. 검사 비용 측정용입니다.');
    }
    return window.__lint.scan();
  });
  console.log('  ⑥ 100문단 검사:', ms.toFixed(1), 'ms');
  assert.ok(ms < 50, `100문단 검사 50ms 이내 (실측 ${ms.toFixed(1)}ms)`);

  assert.deepStrictEqual(errors, [], '페이지 오류 없음');
});
