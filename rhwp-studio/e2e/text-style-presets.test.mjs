/**
 * 회귀: 텍스트 스타일 프리셋(캔바식 '제목 추가') — 카드를 누르면 커서 문단 전체가 바뀐다.
 * 판정: ①카드 5종 렌더 ②제목 카드 → 문단 글자 크기 20pt·굵게 ③번호 카드 → headType
 * Number + paraLevel ④Ctrl+Z 로 복원(커맨드 경로 증명).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('텍스트 스타일 프리셋 — 문단 단위 적용·복원', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '회의 안건');
  await new Promise((r) => setTimeout(r, 500));

  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.canva-style-card')].map((b) => b.className.match(/canva-style--(\w+)/)[1]));
  assert.deepStrictEqual(cards, ['h1', 'h2', 'body', 'num1', 'num2'], '프리셋 카드 5종');

  const applied = await page.evaluate(async () => {
    const w = window.__wasm;
    document.querySelector('.canva-style--h1').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const cp = w.getCharPropertiesAt(0, 0, 0);
    return { fontSize: cp.fontSize, bold: cp.bold };
  });
  assert.strictEqual(applied.fontSize, 2000, '제목 카드 → 20pt');
  assert.strictEqual(applied.bold, true, '제목 카드 → 굵게');

  const numbered = await page.evaluate(async () => {
    document.querySelector('.canva-style--num1').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const ih = window.__inputHandler;
    const pp = ih.getParaProperties();
    return { headType: pp.headType, level: pp.paraLevel ?? 0 };
  });
  assert.strictEqual(numbered.headType, 'Number', '번호 카드 → 개요 번호');
  assert.strictEqual(numbered.level, 0, '번호 카드 → 1수준');

  // Ctrl+Z 두 번(번호=char+para 2커맨드) + 두 번(제목) → 원상 복구
  const restored = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    for (let i = 0; i < 4; i++) { ih.performUndo(); await new Promise((r) => setTimeout(r, 120)); }
    const w = window.__wasm;
    const cp = w.getCharPropertiesAt(0, 0, 0);
    const pp = ih.getParaProperties();
    return { fontSize: cp.fontSize, bold: cp.bold, headType: pp.headType };
  });
  console.log('  실측:', JSON.stringify({ applied, numbered, restored }));
  assert.strictEqual(restored.fontSize, 1000, '되돌리기 → 10pt 복원');
  assert.ok(!restored.bold, '되돌리기 → 굵게 해제');
  assert.notStrictEqual(restored.headType, 'Number', '되돌리기 → 번호 해제');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
