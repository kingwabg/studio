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

  // 흐려진 컨트롤은 **왜 못 누르는지** 말해야 한다(2026-08-01 지적).
  // 그냥 회색으로 두면 고장으로 읽힌다. 조건이 풀리면 문구도 사라져야 한다.
  const why = await page.evaluate(async () => {
    const w = window.__wasm;
    w.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, treatAsChar: true });
    await new Promise((r) => setTimeout(r, 900));
    return { made: w.getTables(0).length };
  });
  void why;
  await page.mouse.click(400, 300);
  await new Promise((r) => setTimeout(r, 900));

  const hints = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-rail--right *')]
      .filter((e) => e.textContent.trim() === '표' && e.children.length === 0)[0]?.click();
    await new Promise((r) => setTimeout(r, 700));
    const shown = () => [...document.querySelectorAll('.tps-hint')]
      .filter((e) => !e.hidden && e.textContent.trim()).map((e) => e.textContent.trim());
    const on = shown();
    const sw = [...document.querySelectorAll('.tps-switch-row')]
      .find((r) => r.textContent.includes('글자처럼 취급'));
    sw?.querySelector('input')?.click();
    await new Promise((r) => setTimeout(r, 700));
    return { on, off: shown(), stillDim: !!document.querySelector('.tps-dep.is-off') };
  });
  console.log('  흐린 이유 — 켰을 때', hints.on.length, '줄 / 껐을 때', hints.off.length, '줄');
  assert.ok(hints.on.some((t) => t.includes('글자처럼')),
    '「글자처럼 취급」이 켜져 배치를 못 쓴다는 설명이 있어야 한다');
  assert.ok(!hints.off.some((t) => t.includes('글자처럼')),
    '끄면 그 설명은 사라져야 한다 — 조건이 풀렸는데 남으면 거짓말이다');
  assert.ok(!hints.stillDim, '끄면 배치 컨트롤이 살아나야 한다');
  assert.ok(hints.off.some((t) => t.includes('어울림')),
    '「본문 위치」가 왜 흐린지도 말해야 한다');
});
