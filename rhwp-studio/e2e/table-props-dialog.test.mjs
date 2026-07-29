/**
 * 회귀: 표/셀 속성 대화상자 3a — 탭 아이콘 칩 · 선택 대상 표기 · 셸 적용.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';

runTest('표/셀 속성 3a — 탭 아이콘·선택 대상·셸', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);

  await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    let ref = null;
    ih.executeOperation({
      kind: 'snapshot', operationType: 'createTable',
      operation: (wasm) => {
        const r = wasm.createTable(0, 0, 0, 3, 4);
        if (r.ok) ref = { sec: 0, ppi: r.paraIdx, ci: r.controlIdx };
        return ih.cursor.getPosition();
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    const { TableCellPropsDialog } = await import('/src/ui/table-cell-props-dialog.ts');
    new TableCellPropsDialog(ih.wasm, ih.eventBus, ref, 5, 'cell').show();
    await new Promise((r) => setTimeout(r, 500));
  });

  const r = await page.evaluate(() => {
    const w = document.querySelector('.dialog-wrap');
    const tabs = [...(w?.querySelectorAll('.dialog-tab') ?? [])];
    const first = tabs[0] ? getComputedStyle(tabs[0]) : null;
    return {
      subject: w?.querySelector('.dialog-subject')?.textContent ?? null,
      tabCount: tabs.length,
      tabsWithIcon: tabs.filter((t) => t.querySelector('i[class*="ph-"]')).length,
      tabRadius: first?.borderRadius ?? null,
      titleIcon: !!w?.querySelector('.dialog-title > i[class*="ph-"]'),
      keyhint: !!w?.querySelector('.dialog-keyhint'),
    };
  });
  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.tabCount >= 4, `탭이 생성돼야 함 (실측 ${r.tabCount})`);
  assert.strictEqual(r.tabsWithIcon, r.tabCount, '모든 탭에 아이콘');
  assert.ok(r.tabRadius?.startsWith('100px'), `탭은 칩(둥근) 이어야 함 (실측 ${r.tabRadius})`);
  assert.ok(r.titleIcon, '타이틀 아이콘 타일');
  assert.ok(r.keyhint, '푸터 키 힌트');
  assert.ok(r.subject && r.subject.includes('표 블록'), `선택 대상 표기 (실측 ${r.subject})`);
  await screenshot(page, 'table-props-dialog');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
