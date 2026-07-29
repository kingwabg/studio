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
  // [디자인 2c] 본문 패널 구성 요소 전수
  const parts = await page.evaluate(() => ({
    fontName: document.querySelector('.canva-font-name span')?.textContent ?? null,
    sameRow: (() => {
      const r = document.querySelector('.canva-font-row');
      return !!(r?.querySelector('.canva-font-name') && r?.querySelector('.canva-stepper'));
    })(),
    // [2c 마무리 2026-07-29] 줄 간격은 −/+ 스테퍼, 팔레트는 섹션 머리 링크
    lineSpacing: document.querySelector('.canva-stepper--wide .canva-step-value span')?.textContent ?? null,
    lineStepper: document.querySelectorAll('.canva-stepper--wide button').length,
    palette: [...document.querySelectorAll('.canva-section-link')].some(a => a.textContent.includes('팔레트')),
    togBtns: document.querySelectorAll('.canva-tog-btn').length,
    highlights: document.querySelectorAll('.canva-swatch--hl').length,
    paraShape: [...document.querySelectorAll('.canva-full-btn')].some(b => b.textContent.includes('문단 모양')),
  }));
  console.log('  본문 패널:', JSON.stringify(parts));
  assert.ok(parts.sameRow, '글꼴 이름과 크기 스테퍼가 한 줄');
  assert.ok(parts.lineSpacing, '줄 간격 표시');
  assert.strictEqual(parts.lineStepper, 3, '줄 간격은 −/값/+ 스테퍼');
  assert.ok(parts.palette, '팔레트는 섹션 머리 링크');
  assert.strictEqual(parts.togBtns, 4, '굵게·기울임·밑줄·취소선 4등분 버튼');
  assert.strictEqual(parts.highlights, 4, '형광펜 4색');
  assert.ok(parts.paraShape, '문단 모양 자세히');
  assert.strictEqual(base.width, 284, `기본 폭 284px 기대 (실측 ${base.width})`);
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

  // [디자인 2c 갱신] 패널 탭 = 속성·표·셀, 가변 폭
  const tabsAndResize = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('.canva-rail--right .canva-tab')].map(t => t.textContent.trim());
    // 표 탭으로 전환 → 섹션 스트립
    const tblTab = [...document.querySelectorAll('.canva-rail--right .canva-tab')].find(t => t.textContent.trim() === '표');
    tblTab?.click();
    await new Promise(r => setTimeout(r, 300));
    const secs = [...document.querySelectorAll('.canva-sec-btn')].map(b => b.title);
    // 가변 폭: 손잡이를 40px 왼쪽으로 끌기
    const rail = document.querySelector('.canva-rail--right');
    const grip = document.querySelector('.canva-rail-grip');
    const before = Math.round(rail.getBoundingClientRect().width);
    const r0 = grip.getBoundingClientRect();
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r0.left + 4 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r0.left - 40 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return { tabs, secs, before, after: Math.round(rail.getBoundingClientRect().width) };
  });
  console.log('  탭·가변폭:', JSON.stringify(tabsAndResize));
  assert.deepStrictEqual(tabsAndResize.tabs, ['속성', '표', '셀'], '패널 탭 3종');
  assert.deepStrictEqual(tabsAndResize.secs,
    ['위치', '크기', '여백', '쪽 넘김', '테두리·배경', '캡션'], '표 탭 섹션 스트립');
  assert.ok(tabsAndResize.after > tabsAndResize.before + 30,
    `왼쪽으로 끌면 넓어져야 함 (${tabsAndResize.before} → ${tabsAndResize.after})`);
  await screenshot(page, 'right-panel');
});
