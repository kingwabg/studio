/**
 * 이모지 넣기 — 피커에서 고른 이모지가 커서 자리에 들어가고, 연달아 넣어도 안 깨진다.
 * (라이브러리: emoji-picker-element, 한국어 데이터는 public/emoji/ko.json 벤더링)
 *
 * ① 피커가 뜨고 **한국어 데이터**를 읽는다(웃음으로 검색되어야 하므로)
 * ② 고른 이모지가 커서 자리에 들어간다
 * ③ 연달아 셋을 넣어도 뒤 글자가 살아 있다(2026-07-31 엔진 수리 회귀 방지)
 * ④ 되돌리기 한 번에 한 글자씩 빠진다
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('이모지 넣기 — 피커·연속 삽입·되돌리기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  const text = () => page.evaluate(() => {
    const w = window.__wasm;
    return w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
  });

  await page.evaluate(() => {
    window.__wasm.doc.insertText(0, 0, 0, '앞 뒤');
    window.__inputHandler.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 });
    window.__eventBus.emit('document-changed');
  });

  // ① 피커 열기 + 한국어 데이터
  await page.evaluate(() => window.__dispatcher.dispatch('insert:emoji'));
  await new Promise((r) => setTimeout(r, 2500));
  const picker = await page.evaluate(() => {
    const el = document.querySelector('emoji-picker');
    return el ? { src: el.getAttribute('data-source'), locale: el.getAttribute('locale') } : null;
  });
  console.log('  ① 피커:', JSON.stringify(picker));
  assert.ok(picker, '피커가 떠야 한다');
  assert.match(picker.src, /emoji\/ko\.json$/, '벤더링한 한국어 데이터를 읽어야 한다');
  assert.strictEqual(picker.locale, 'ko');

  // 한국어 주석이 실제로 들어 있는지 — 영어 데이터면 "웃음" 검색이 안 된다
  const ko = await page.evaluate(async () => {
    const r = await fetch(document.querySelector('emoji-picker').getAttribute('data-source'));
    const j = await r.json();
    const hit = j.find((e) => e.emoji === '😀');
    return { annotation: hit?.annotation, tags: hit?.tags?.slice(0, 3) };
  });
  console.log('  ① 한국어 데이터:', JSON.stringify(ko));
  assert.ok(/[가-힣]/.test(ko.annotation ?? ''), '한국어 주석이 있어야 한다');

  // ②③ 이모지 셋을 연달아 넣는다
  for (const ch of ['😀', '🎉', '✅']) {
    await page.evaluate((c) => {
      document.querySelector('emoji-picker')
        .dispatchEvent(new CustomEvent('emoji-click', { detail: { unicode: c } }));
    }, ch);
    await new Promise((r) => setTimeout(r, 400));
  }
  const after = await text();
  console.log('  ②③ 넣은 뒤:', JSON.stringify(after));
  assert.strictEqual(after, '앞 😀🎉✅뒤', '커서 자리에 순서대로 들어가고 뒤 글자가 살아 있어야 한다');

  // ④ 되돌리기 한 번 = 한 글자
  await clickEditArea(page);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 600));
  console.log('  ④ 되돌린 뒤:', JSON.stringify(await text()));
  assert.strictEqual(await text(), '앞 😀🎉뒤', '되돌리기 한 번에 이모지 하나');

  assert.deepStrictEqual(errors, [], '페이지 오류 없음');
});
