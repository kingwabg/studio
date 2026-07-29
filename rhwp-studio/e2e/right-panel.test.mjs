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

  // [2026-07-30] 배너 위치 설명은 커서를 따라간다 — 같은 컨텍스트 안 이동에서도
  const follow = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 1, charOffset: 0 });
    window.__eventBus?.emit('cursor-rect-updated');
    await new Promise(r => setTimeout(r, 300));
    const at2 = document.querySelector('.canva-ctx-sub')?.textContent ?? null;
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    window.__eventBus?.emit('cursor-rect-updated');
    await new Promise(r => setTimeout(r, 300));
    return { at2, at1: document.querySelector('.canva-ctx-sub')?.textContent ?? null };
  });
  console.log('  배너 추적:', JSON.stringify(follow));
  assert.ok(follow.at2?.includes('2번째'), `2번째 문단 표시 (실측 ${follow.at2})`);
  assert.ok(follow.at1?.includes('1번째'), `1번째 문단 복귀 (실측 ${follow.at1})`);
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
  // [컨텍스트 탭 2026-07-30 갱신] 탭 4종이 있고 보이는 집합이 선택을 따라간다
  assert.deepStrictEqual(tabsAndResize.tabs, ['속성', '텍스트', '표', '셀'], '패널 탭 4종');
  assert.deepStrictEqual(tabsAndResize.secs,
    ['위치', '크기', '여백', '쪽 넘김', '테두리·배경', '캡션'], '표 탭 섹션 스트립');
  assert.ok(tabsAndResize.after > tabsAndResize.before + 30,
    `왼쪽으로 끌면 넓어져야 함 (${tabsAndResize.before} → ${tabsAndResize.after})`);

  // [디자인 2c] 손잡이 하나가 둘을 다 한다 — 끌면 폭, 그냥 누르면 접기/펼치기.
  // 옛 접기 버튼(.canva-rail-handle)은 우측에서 사라져야 한다.
  const grip = await page.evaluate(() => {
    const rail = document.querySelector('.canva-rail--right');
    const g = rail.querySelector('.canva-rail-grip');
    const r = g.getBoundingClientRect();
    return {
      line: !!g.querySelector('.canva-grip-line'), dots: !!g.querySelector('.canva-grip-dots'),
      oldHandle: !!rail.querySelector('.canva-rail-handle'),
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
    };
  });
  assert.ok(grip.line && grip.dots, '손잡이가 눈에 보여야 함(선 + 점 3개)');
  assert.ok(!grip.oldHandle, '우측 레일의 옛 접기 버튼은 사라짐');

  await page.mouse.click(grip.x, grip.y);
  await new Promise(r => setTimeout(r, 350));
  const folded = await page.evaluate(() => ({
    on: document.querySelector('.canva-rail--right').classList.contains('is-collapsed'),
    gripDisplay: getComputedStyle(document.querySelector('.canva-rail--right .canva-rail-grip')).display,
  }));
  assert.ok(folded.on, '끌지 않고 누르면 접힌다');
  assert.notStrictEqual(folded.gripDisplay, 'none', '접혀도 손잡이는 남는다(유일한 펼치기 수단)');

  const p2 = await page.evaluate(() => {
    const r = document.querySelector('.canva-rail--right .canva-rail-grip').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await page.mouse.click(p2.x, p2.y);
  await new Promise(r => setTimeout(r, 350));
  const reopened = await page.evaluate(() => !document.querySelector('.canva-rail--right').classList.contains('is-collapsed'));
  assert.ok(reopened, '다시 누르면 펼쳐진다');

  await screenshot(page, 'right-panel');
});
