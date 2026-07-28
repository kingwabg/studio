/**
 * 회귀: 맞춤법 검사(규칙 기반) — 검출 → 교정 → 되돌리기.
 * ⚠ 전량 로컬 판정: 검사 중 어떤 네트워크 요청도 나가지 않아야 한다(아동 데이터 원칙).
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

const BAD = '이렇게 하면 안되요.  역활을 정하고  며칠전에 갯수를 세요';

const paraText = (page, para = 0) => page.evaluate((p) => {
  const w = window.__wasm;
  return w.getTextRange(0, p, 0, w.getParagraphLength(0, p));
}, para);

runTest('맞춤법 검사 — 검출·교정·되돌리기·로컬 전용', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('data:') && !u.includes('localhost') && !u.startsWith('blob:')) requests.push(u);
  });

  await createNewDocument(page);
  await page.evaluate((text) => {
    const ih = window.__inputHandler;
    window.__wasm.doc.insertText(0, 0, 0, text);
    window.__eventBus.emit('document-changed');
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
  }, BAD);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));

  // 스캐너 직접 호출 — 규칙 검출 판정
  const hits = await page.evaluate(async () => {
    const { scanDocument } = await import('/src/ui/spell-dialog.ts');
    return scanDocument(window.__inputHandler.wasm).map((h) => [h.text, h.suggestion]);
  });
  const found = hits.map((h) => h[0]);
  console.log('  검출:', JSON.stringify(hits));
  // '안되요'는 '되요→돼요' 규칙이 잡는다(더 구체적인 규칙이 이김) — 이것이 올바른 동작
  for (const expect of ['되요', '역활', '며칠전', '갯수']) {
    assert.ok(found.some((f) => f.includes(expect)),
      `'${expect}' 검출 기대 — 실제: ${JSON.stringify(found)}`);
  }
  assert.ok(found.some((f) => /^ {2,}$/.test(f)), `연속 공백 검출 기대 — 실제: ${JSON.stringify(found)}`);

  // 교정 1건 적용 → 본문 반영, 되돌리기로 원복
  const before = await paraText(page);
  await page.evaluate(async () => {
    const { scanDocument } = await import('/src/ui/spell-dialog.ts');
    const ih = window.__inputHandler;
    const h = scanDocument(ih.wasm).find((x) => x.text === '역활');
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'spellFix',
      operation: (wasm) => {
        wasm.replaceText(h.sectionIndex, h.paragraphIndex, h.charOffset, h.length, h.suggestion);
        return ih.cursor.getPosition();
      },
    });
    window.__eventBus.emit('document-changed');
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  const fixed = await paraText(page);
  assert.ok(fixed.includes('역할') && !fixed.includes('역활'),
    `교정 반영 기대 (실측 "${fixed}")`);

  await page.evaluate(() => window.__inputHandler.performUndo?.());
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  const undone = await paraText(page);
  assert.strictEqual(undone, before, `되돌리기 원복 기대 (실측 "${undone}")`);

  // 외부 전송 0건
  assert.deepStrictEqual(requests, [], `검사 중 외부 요청 발생: ${JSON.stringify(requests)}`);
});
