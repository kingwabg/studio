import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
runTest('리본 글꼴 콤보 — 실제 컨트롤 입양·상태 동기·탭 왕복 유지', async ({ page }) => {
  await createNewDocument(page);
  const r = await page.evaluate(() => {
    const fn = document.getElementById('font-name');
    const fs = document.getElementById('font-size');
    return {
      fnInRibbon: !!fn?.closest('.rb-slot'),
      fsInRibbon: !!fs?.closest('.rb-slot'),
      fnOptions: fn ? fn.options.length : 0,
      fnValue: fn?.value ?? null,
    };
  });
  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.fnInRibbon && r.fsInRibbon, '글꼴·크기 컨트롤이 리본 슬롯 안에 있어야 함');
  assert.ok(r.fnOptions > 1, `글꼴 목록이 채워져 있어야 함 (실측 ${r.fnOptions})`);

  // 탭을 옮겼다 돌아와도 유지되는가(렌더 재생성 시 재배치)
  const after = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.rb-tab')];
    tabs.find(b => b.textContent === '삽입')?.click();
    const goneWhileAway = !document.getElementById('font-name')?.closest('.rb-slot');
    tabs.find(b => b.textContent === '홈')?.click();
    return { goneWhileAway, backInRibbon: !!document.getElementById('font-name')?.closest('.rb-slot') };
  });
  console.log('  탭 왕복:', JSON.stringify(after));
  assert.ok(after.backInRibbon, '홈으로 돌아오면 다시 슬롯에 꽂혀야 함');

  // Toolbar 상태 동기가 살아있는가 — 커서 서식 반영
  const synced = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    window.__wasm.doc.insertText(0, 0, 0, '가나다');
    window.__eventBus.emit('document-changed');
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 1 });
    ih.updateCaret?.();
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById('font-name')?.value ?? null;
  });
  console.log('  동기값:', JSON.stringify(synced));
  assert.ok(synced && synced.length > 0, '글꼴명이 커서 서식으로 채워져야 함');
  await screenshot(page, 'ribbon-combo');
});
