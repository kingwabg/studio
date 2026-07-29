/**
 * 회귀: 「텍스트」 탭 (디자인 2c 갱신 2026-07-30) — 문단 모양 대화상자를 패널로.
 *
 * 판정: ①본문에선 보이는 탭이 [속성, 텍스트] ②표 안이면 [속성, 텍스트, 표, 셀]
 * ③섹션 6종 + 미리보기 ④정렬/줄간격/문단 종류가 실제 문단 속성에 반영 ⑤Ctrl+Z 복원.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

const visibleTabs = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.canva-rail--right .canva-tab')].filter((b) => !b.hidden)
    .map((b) => b.textContent.trim()));

runTest('텍스트 탭 — 탭 노출·섹션·문단 속성 반영', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '문단 하나');
  await new Promise((r) => setTimeout(r, 600));

  // ① 본문 = 속성·텍스트만
  assert.deepStrictEqual(await visibleTabs(page), ['속성', '텍스트'], '본문에선 두 탭만');

  // ③ 텍스트 탭 → 섹션 6종 + 미리보기
  const txt = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-tab')].find((b) => b.textContent.trim() === '텍스트').click();
    await new Promise((r) => setTimeout(r, 500));
    const host = document.querySelector('.canva-props-host');
    return {
      secs: [...document.querySelectorAll('.canva-sec-btn')].map((b) => b.title),
      active: document.querySelector('.canva-sec-btn.is-on')?.title,
      preview: !!host?.querySelector('.tps-para-prev'),
    };
  });
  assert.deepStrictEqual(txt.secs, ['정렬', '여백·첫 줄', '간격', '문단 종류', '줄 나눔', '탭'], '섹션 6종');
  assert.strictEqual(txt.active, '정렬', '기본 섹션');
  assert.ok(txt.preview, '문단 미리보기');

  // ④ 정렬 적용
  const align = await page.evaluate(async () => {
    [...document.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent === '가운데').click();
    await new Promise((r) => setTimeout(r, 500));
    return window.__inputHandler.getParaProperties().alignment;
  });
  assert.strictEqual(align, 'center', '정렬이 문단에 반영');

  // ④' 간격 섹션 — 줄 간격 + 자간 스테퍼
  const spacing = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.title === '간격')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const ls = [...document.querySelectorAll('.tps-row')].find((r) => r.textContent.includes('줄 간격') && r.querySelector('input'));
    const input = ls.querySelector('input');
    input.value = '200';
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 500));
    return {
      lineSpacing: window.__inputHandler.getParaProperties().lineSpacing,
      steppers: document.querySelectorAll('.tps-pill-stepper').length,
    };
  });
  assert.strictEqual(spacing.lineSpacing, 200, '줄 간격 반영');
  assert.strictEqual(spacing.steppers, 2, '자간·장평 스테퍼 2개');

  // ⑤ 되돌리기
  const undone = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.performUndo();
    await new Promise((r) => setTimeout(r, 400));
    return ih.getParaProperties().lineSpacing;
  });
  assert.notStrictEqual(undone, 200, 'Ctrl+Z 로 줄 간격 복원');

  // ② 표 안이면 네 탭
  await page.evaluate(async () => {
    const w = window.__wasm;
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: w.getParagraphLength(0, 0),
      rowCount: 2, colCount: 2, treatAsChar: true, colWidths: [6000, 6000],
    })));
    window.__tbl = t;
    window.__eventBus?.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 900));
  const pt = await page.evaluate((/* click into first cell */) => {
    const ih = window.__inputHandler, w = window.__wasm, t = window.__tbl;
    const bb = w.getTableCellBboxes(0, t.paraIdx, t.controlIdx).find((b) => b.cellIdx === 0);
    const z = ih.viewportManager.getZoom();
    const cv = document.querySelector('#scroll-container canvas').getBoundingClientRect();
    return { x: cv.x + (bb.x + bb.w / 2) * z, y: cv.y + (bb.y + bb.h / 2) * z };
  });
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 700));
  assert.deepStrictEqual(await visibleTabs(page), ['속성', '텍스트', '표', '셀'], '표 안에선 네 탭');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
