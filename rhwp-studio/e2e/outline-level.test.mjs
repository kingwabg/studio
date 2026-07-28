/**
 * 회귀: 한컴식 다단계 번호 — 번호 문단 첫 칸에서 Tab/Shift+Tab 이 수준을 증감한다.
 *
 * 배경(2026-07-28 조사): 엔진은 개요 7수준을 전부 조판하는데(expand_numbering_format),
 * studio 가 applyNumbering/applyBullet/toggleNumbering 에서 paraLevel 을 0 으로
 * 하드코딩하고 Tab 배선도 없어 **다단계 번호 기능이 통째로 사장**돼 있었다.
 *
 * 판정: Tab 2회 → para_level 2, Shift+Tab 1회 → 1, 저장·재로드 후에도 유지.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

const level = (page) => page.evaluate(() =>
  window.__wasm.getParaPropertiesAt(0, 0).paraLevel ?? 0);

runTest('번호 문단 Tab = 수준 증가, Shift+Tab = 감소', async ({ page }) => {
  await createNewDocument(page);

  // 본문 첫 문단에 텍스트 + 번호 매기기
  await page.evaluate(() => {
    const ih = window.__inputHandler;
    window.__wasm.doc.insertText(0, 0, 0, '항목');
    window.__eventBus.emit('document-changed');
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    ih.textarea?.focus();
    ih.toggleNumbering();
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));

  const props0 = await page.evaluate(() => window.__wasm.getParaPropertiesAt(0, 0));
  assert.ok(props0.headType && props0.headType !== 'None',
    `번호 적용 실패(headType=${props0.headType})`);
  assert.strictEqual(await level(page), 0, '초기 수준은 0');

  // 첫 칸으로 커서 → Tab 2회
  const toStart = () => page.evaluate(() => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    ih.updateCaret?.();
  });
  await toStart();
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
  await toStart();
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
  const afterTabs = await level(page);
  assert.strictEqual(afterTabs, 2, `Tab 2회 후 수준 2 기대 (실측 ${afterTabs})`);

  // Shift+Tab 1회
  await toStart();
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
  const afterShift = await level(page);
  assert.strictEqual(afterShift, 1, `Shift+Tab 후 수준 1 기대 (실측 ${afterShift})`);

  // 저장 → 재로드 후 유지
  const kept = await page.evaluate(async () => {
    const bytes = window.__wasm.exportHwp();
    window.__wasm.loadDocument(bytes, 'lvl.hwp');
    window.__canvasView.loadDocument();
    await new Promise((r) => setTimeout(r, 600));
    return window.__wasm.getParaPropertiesAt(0, 0).paraLevel ?? 0;
  });
  assert.strictEqual(kept, 1, `저장·재로드 후 수준 1 유지 기대 (실측 ${kept})`);
});
