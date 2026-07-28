import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
runTest('리본 컨텍스트 행 — 머리말 편집 모드 진입/이탈', async ({ page }) => {
  await createNewDocument(page);
  const before = await page.evaluate(() => !!document.querySelector('.rb-row-context'));
  assert.strictEqual(before, false, '평상시엔 컨텍스트 행 없음');

  const on = await page.evaluate(async () => {
    window.__eventBus.emit('headerFooterModeChanged', 'header');
    await new Promise(r => setTimeout(r, 300));
    const row = document.querySelector('.rb-row-context');
    const normal = document.querySelector('.rb-row-ribbon:not(.rb-row-context)');
    return {
      badge: row?.querySelector('.rb-ctx-badge')?.textContent ?? null,
      cmds: [...(row?.querySelectorAll('[data-cmd]') ?? [])].map(b => b.dataset.cmd),
      normalHidden: normal ? getComputedStyle(normal).display === 'none' : null,
      headerHeight: Math.round(document.getElementById('ribbon-header').getBoundingClientRect().height),
    };
  });
  console.log('  진입:', JSON.stringify(on));
  assert.strictEqual(on.badge, '머리말 편집', '컨텍스트 배지');
  assert.ok(on.cmds.includes('page:headerfooter-close'), '닫기 명령 노출');
  assert.strictEqual(on.normalHidden, true, '일반 리본은 가려짐');
  assert.strictEqual(on.headerHeight, 88, `컨텍스트 중에도 88px 유지 (실측 ${on.headerHeight})`);
  await screenshot(page, 'ribbon-context');

  const off = await page.evaluate(async () => {
    window.__eventBus.emit('headerFooterModeChanged', 'none');
    await new Promise(r => setTimeout(r, 300));
    const normal = document.querySelector('.rb-row-ribbon:not(.rb-row-context)');
    return { ctx: !!document.querySelector('.rb-row-context'), normalShown: normal ? getComputedStyle(normal).display !== 'none' : null };
  });
  console.log('  이탈:', JSON.stringify(off));
  assert.strictEqual(off.ctx, false, '이탈 시 컨텍스트 행 제거');
  assert.strictEqual(off.normalShown, true, '일반 리본 복귀');
});
