/**
 * 「수정본」 — 견본 자리에 지금 문단의 맞춤법 수정본이 보이고, [고치기]로 한 번에 고친다.
 * (사용자 요청 2026-07-31)
 *
 * ① 틀린 곳이 있으면 수정본 줄이 뜨고, before→after 가 짝으로 보인다
 * ② [고치기] → 문단이 실제로 고쳐지고 수정본 줄이 사라진다
 * ③ 되돌리기 한 번으로 통째로 복구된다
 * ④ 맞는 문장에는 수정본 줄이 안 뜬다(오탐 0)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const BAD = '오늘 활동은 잘 되요. 교사의 역활이 중요합니다.';
const FIXED = '오늘 활동은 잘 돼요. 교사의 역할이 중요합니다.';

runTest('수정본 — 미리보기·고치기·되돌리기', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  const paraText = () => page.evaluate(() => {
    const w = window.__wasm;
    return w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
  });
  const fixRow = () => page.evaluate(() => {
    const el = document.querySelector('.canva-specimen-fix');
    if (!el || el.hidden) return null;
    return {
      from: [...el.querySelectorAll('.canva-specimen-fixfrom')].map((x) => x.textContent),
      to: [...el.querySelectorAll('.canva-specimen-fixto')].map((x) => x.textContent),
    };
  });

  // ① 수정본이 보인다
  await page.evaluate((t) => {
    window.__wasm.doc.insertText(0, 0, 0, t);
    window.__eventBus.emit('document-changed');
  }, BAD);
  await new Promise((r) => setTimeout(r, 1200));
  const shown = await fixRow();
  console.log('  ① 수정본:', JSON.stringify(shown));
  assert.ok(shown, '수정본 줄이 떠야 한다');
  assert.deepStrictEqual(shown.from, ['되요', '역활'], '틀린 곳');
  assert.deepStrictEqual(shown.to, ['돼요', '역할'], '고친 곳');

  // ② [고치기] 한 번에
  await page.evaluate(() => {
    document.querySelector('.canva-specimen-fixbtn')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('  ② 고친 뒤:', JSON.stringify(await paraText()));
  assert.strictEqual(await paraText(), FIXED, '문단이 고쳐져야 한다');
  assert.strictEqual(await fixRow(), null, '고칠 게 없으면 수정본 줄이 사라진다');

  // ③ 되돌리기 한 번
  await clickEditArea(page);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 1000));
  console.log('  ③ 되돌린 뒤:', JSON.stringify(await paraText()));
  assert.strictEqual(await paraText(), BAD, '되돌리기 한 번으로 복구');

  // ④ 맞는 문장은 조용하다
  await page.evaluate(() => {
    const w = window.__wasm;
    w.doc.deleteText(0, 0, 0, w.getParagraphLength(0, 0));
    w.doc.insertText(0, 0, 0, '오늘 활동은 잘 됐습니다.');
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('  ④ 맞는 문장 수정본:', await fixRow());
  assert.strictEqual(await fixRow(), null, '맞는 문장엔 수정본 줄 없음');
});
