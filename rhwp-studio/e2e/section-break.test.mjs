/**
 * 회귀: 구역 나누기 (Alt+Shift+Enter) — 판정식 ④ (mydocs/eng/plans/section-break.md)
 *
 * ①명령 실행 → 구역 1→2, 커서가 (구역1, 문단0, 0) ②새 구역만 가로 전환 → 구역 독립
 * ③Ctrl+Z → 구역 1개 복귀 ④레이아웃 리본에 버튼 존재.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('구역 나누기 — 분리·독립·되돌리기', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '첫 구역 본문');
  await new Promise((r) => setTimeout(r, 500));

  const r = await page.evaluate(async () => {
    const ih = window.__inputHandler, w = window.__wasm, d = ih.dispatcher;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = {};

    out.dispatched = d.dispatch('page:section-break');
    await wait(700);
    out.sections = w.doc.getSectionCount();
    const pos = ih.getPosition();
    out.cursor = { sec: pos.sectionIndex, para: pos.paragraphIndex, off: pos.charOffset };

    // 구역 독립성: 새 구역만 가로
    const pd1 = w.getPageDef(1);
    w.setPageDef(1, { ...pd1, landscape: true });
    await wait(300);
    out.landscape = [w.getPageDef(0).landscape, w.getPageDef(1).landscape];

    // 리본 버튼
    [...document.querySelectorAll('.rb-tab')].find((b) => b.textContent === '레이아웃')?.click();
    await wait(300);
    out.ribbonBtn = !!document.querySelector('.rb-btn[data-cmd="page:section-break"]');

    // 되돌리기 (setPageDef 는 스냅샷 경로가 아니므로 section-break 1회만 되돌리면 된다)
    ih.performUndo();
    await wait(500);
    out.afterUndo = w.doc.getSectionCount();
    return out;
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.dispatched, '명령 실행');
  assert.strictEqual(r.sections, 2, '구역 1→2');
  assert.deepStrictEqual(r.cursor, { sec: 1, para: 0, off: 0 }, '커서가 새 구역 머리로');
  assert.deepStrictEqual(r.landscape, [false, true], '구역별 가로/세로 독립');
  assert.ok(r.ribbonBtn, '레이아웃 리본에 구역 나누기 버튼');
  assert.strictEqual(r.afterUndo, 1, 'Ctrl+Z 로 구역 복귀');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
