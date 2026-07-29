import assert from 'node:assert';
import { runTest, loadHwpFile, screenshot } from './helpers.mjs';
runTest('우측 속성 패널 2c — 284px·컨텍스트 헤더·표 조작 섹션', async ({ page }) => {
  await loadHwpFile(page, 'tac-case-001.hwp');
  const base = await page.evaluate(() => {
    const rail = document.querySelector('.canva-rail--right');
    const banner = document.querySelector('.canva-context-banner');
    return {
      width: rail ? Math.round(rail.getBoundingClientRect().width) : null,
      hasTile: !!banner?.querySelector('.canva-ctx-tile'),
      label: banner?.querySelector('.canva-ctx-label')?.textContent ?? null,
      sub: banner?.querySelector('.canva-ctx-sub')?.textContent ?? null,
      bannerBorder: banner ? getComputedStyle(banner).borderTopWidth : null,
    };
  });
  console.log('  기본:', JSON.stringify(base));
  assert.strictEqual(base.width, 284, `패널 284px 기대 (실측 ${base.width})`);
  assert.ok(base.hasTile, '컨텍스트 아이콘 타일');
  assert.strictEqual(base.bannerBorder, '0px', '파란 강조 박스(테두리) 제거');

  // 표 셀 컨텍스트로 전환 → 표 조작 섹션이 나오는가
  const cell = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    // 표를 새로 만들고 그 첫 셀로 진입 — 명령이 돌려주는 위치를 그대로 쓴다(실제 경로)
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'createTable',
      operation: (wasm) => {
        const r = wasm.createTable(0, 0, 0, 3, 3);
        return r.ok ? {
          sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
          parentParaIndex: r.paraIdx, controlIndex: r.controlIdx,
          cellIndex: 0, cellParaIndex: 0,
        } : ih.cursor.getPosition();
      },
    });
    // ⚠ cursor-cell-changed 를 payload 없이 직접 쏘면 눈금자(ruler)가 넘어진다 —
    //   실제 경로(updateCaret)가 올바른 payload 를 실어 보낸다.
    ih.updateCaret?.();
    await new Promise(r => setTimeout(r, 600));
    const chips = [...document.querySelectorAll('.canva-chip')].map(c => c.dataset.cmd);
    const banner = document.querySelector('.canva-context-banner');
    return {
      label: banner?.querySelector('.canva-ctx-label')?.textContent ?? null,
      sub: banner?.querySelector('.canva-ctx-sub')?.textContent ?? null,
      chips,
    };
  });
  console.log('  셀 컨텍스트:', JSON.stringify(cell));
  await screenshot(page, 'right-panel');
});
