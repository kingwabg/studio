/**
 * 회귀: 상용구(한컴 [입력-상용구]) — 삽입·되돌리기, 준말 확장.
 *
 * ⚠ 테스트 설계 주의: userSettings 는 부팅 시 1회 localStorage 를 읽어 메모리에 들고 있는
 * 싱글턴이다. 테스트에서 동적 import 로 addSnippet 을 부르면 **앱과 다른 모듈 인스턴스**가
 * 만들어져 앱 쪽 명령이 못 본다(실측 2026-07-28). 그래서 실사용과 같게 — 설정을 먼저
 * 심어두고 앱을 띄운다.
 */
import assert from 'node:assert';
import { runTest, loadApp, waitForCanvas, createNewDocument } from './helpers.mjs';

const SNIPPETS = [
  { name: '기관명', abbrev: 'ㄱㄱ', text: '햇살지역아동센터' },
  { name: '인사말', abbrev: '', text: '안녕하세요.\n귀 가정에 평안이 있기를 바랍니다.' },
];

const paraText = (page, para = 0) => page.evaluate((p) => {
  const w = window.__wasm;
  return w.getTextRange(0, p, 0, w.getParagraphLength(0, p));
}, para);

runTest('상용구 삽입·되돌리기·준말 확장', async ({ page }) => {
  // 부팅 전에 설정 주입 = "이전에 등록해 둔 상용구"
  await page.evaluateOnNewDocument((snips) => {
    let parsed = {};
    try { parsed = JSON.parse(localStorage.getItem('rhwp-settings') ?? '{}'); } catch { parsed = {}; }
    parsed.snippets = snips;
    localStorage.setItem('rhwp-settings', JSON.stringify(parsed));
  }, SNIPPETS);
  await loadApp(page);
  await waitForCanvas(page);
  await createNewDocument(page);

  const prep = () => page.evaluate(() => {
    const ih = window.__inputHandler;
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    ih.textarea?.focus();
  });

  // ① 다행 조각 삽입 → 문단 2개
  await prep();
  await page.evaluate((text) => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    ih.insertPlainTextAtCursor(text);
  }, SNIPPETS[1].text);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  assert.strictEqual(await paraText(page, 0), '안녕하세요.', '1행 삽입');
  assert.strictEqual(await paraText(page, 1), '귀 가정에 평안이 있기를 바랍니다.', '2행 삽입');

  // ② 되돌리기 → 빈 문단 복귀
  await page.evaluate(() => {
    const ih = window.__inputHandler;
    for (let i = 0; i < 6; i++) ih.performUndo?.();
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  const afterUndo = await paraText(page, 0);
  assert.strictEqual(afterUndo, '', `되돌리기 후 빈 문단 기대 (실측 "${afterUndo}")`);

  // ③ 준말 확장 — 앱이 실제로 쓰는 단축키 경로로(Alt+I)
  await prep();
  await page.evaluate(() => {
    const ih = window.__inputHandler;
    window.__wasm.doc.insertText(0, 0, 0, 'ㄱㄱ');
    window.__eventBus.emit('document-changed');
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 });
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyI');
  await page.keyboard.up('Alt');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  const expanded = await paraText(page, 0);
  assert.strictEqual(expanded, '햇살지역아동센터',
    `준말 확장 기대 '햇살지역아동센터' (실측 "${expanded}")`);
});
