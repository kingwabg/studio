/**
 * 표·셀 패널이 표 조작 명령에 닿는가 (디자인 2c: 표 조작은 우측 패널이 집).
 *
 * 실측 전(2026-08-01): 표 명령 25개 중 패널에서 닿는 것 17개.
 * 못 닿던 것 중 **진짜 구멍 2개**:
 *  · table:delete — 표 자체를 지울 길이 없었다(줄·칸만 지울 수 있었다)
 *  · table:decimal-remove — 자릿점은 늘리기만 있고 줄이기가 없었다
 * (나머지 6개는 구멍이 아니다: create=삽입 리본, cell-props/insert-row-col/delete-row-col
 *  =패널이 대체한 대화상자, border-one/caption-toggle=패널 섹션이 UI로 직접 다룬다)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('표 패널 조작', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));

  await page.evaluate(async () => {
    const w = window.__wasm;
    w.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, treatAsChar: true });
    await new Promise((r) => setTimeout(r, 900));
  });
  await page.mouse.click(400, 300);
  await new Promise((r) => setTimeout(r, 900));

  const cmds = await page.evaluate(async () => {
    const pick = async (tab) => {
      [...document.querySelectorAll('.canva-rail--right *')]
        .filter((e) => e.textContent.trim() === tab && e.children.length === 0)[0]?.click();
      await new Promise((r) => setTimeout(r, 600));
      return [...document.querySelectorAll('.canva-rail--right [data-cmd]')]
        .map((e) => e.dataset.cmd).filter((c) => c.startsWith('table:'));
    };
    return { table: await pick('표'), cell: await pick('셀') };
  });
  const all = [...new Set([...cmds.table, ...cmds.cell])].sort();
  console.log('  표 탭:', cmds.table.length, '개 / 셀 탭:', cmds.cell.length, '개 / 합계', all.length, '개');
  for (const need of ['table:delete', 'table:decimal-remove', 'table:decimal-add']) {
    console.log(`   ${all.includes(need) ? '✓' : '✗'} ${need}`);
    assert.ok(all.includes(need), `${need} 이 패널에 있어야 한다`);
  }

  // 표 지우기가 실제로 표를 지우는가
  const del = await page.evaluate(async () => {
    const before = window.__wasm.getTables(0).length;
    // ⚠ 앞 단계가 셀 탭에 있었다 — 표 탭으로 먼저 옮겨야 버튼이 존재한다
    [...document.querySelectorAll('.canva-rail--right *')]
      .filter((e) => e.textContent.trim() === '표' && e.children.length === 0)[0]?.click();
    await new Promise((r) => setTimeout(r, 700));
    const b2 = document.querySelector('.canva-rail--right [data-cmd="table:delete"]');
    if (!b2) return { err: '표 탭에도 표 지우기 버튼이 없다' };
    b2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    b2.click();
    await new Promise((r) => setTimeout(r, 900));
    return { before, after: window.__wasm.getTables(0).length };
  });
  console.log('  표 지우기:', del.err ?? `${del.before}개 → ${del.after}개`);
  assert.ok(!del.err, del.err ?? '');
  assert.strictEqual(del.after, del.before - 1, '표 지우기가 실제로 표를 지워야 한다');
});
