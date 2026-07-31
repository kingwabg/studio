/**
 * 「문장 다듬기」 — 문장이 외부로 나가는 유일한 경로라 **막는 쪽**을 잠근다.
 *
 * ① 일반 문서에서는 버튼이 보인다
 * ② 아동 기록(?docKind=child-record)에서는 **버튼이 DOM 에 아예 없다**
 *    (감추는 게 아니라 없어야 한다 — 있으면 언젠가 눌린다)
 * ③ 누르기 전에는 아무 요청도 나가지 않는다(자동 호출 금지)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('문장 다듬기 — 노출·차단·자동호출 금지', async ({ page }) => {
  const aiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/ai/')) aiCalls.push(r.url()); });

  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    window.__wasm.doc.insertText(0, 0, 0, '우울하다 박으로 나ㅆ다. 날파리 들어 틀어와서 최악의 날이다');
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 1200));

  // ① 일반 문서
  const shown = await page.evaluate(() => !!document.querySelector('.canva-specimen-polish'));
  console.log('  ① 일반 문서 버튼:', shown);
  assert.ok(shown, '일반 문서에서는 버튼이 보여야 한다');

  // ③ 아직 아무 요청도 없어야 한다
  console.log('  ③ 누르기 전 AI 요청:', aiCalls.length, '건');
  assert.strictEqual(aiCalls.length, 0, '누르기 전에는 요청이 나가면 안 된다');

  // ② 아동 기록 — 새로고침 없이 주소만 바꾼다(currentDocKind 는 매번 location 을 읽는다)
  await page.evaluate(() => {
    history.replaceState(null, '', '?docKind=child-record');
    window.__eventBus.emit('cursor-format-changed', window.__wasm.getCharPropertiesAt(0, 0, 0));
  });
  await new Promise((r) => setTimeout(r, 900));
  const hidden = await page.evaluate(() => !!document.querySelector('.canva-specimen-polish'));
  console.log('  ② 아동 기록 버튼:', hidden);
  assert.strictEqual(hidden, false, '아동 기록에서는 버튼이 없어야 한다');
});
