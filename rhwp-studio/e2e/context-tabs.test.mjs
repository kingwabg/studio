/**
 * 회귀: 컨텍스트 탭(2026-07-30) — 선택이 곧 탭이다.
 *
 * 판정식: ①본문 편집 중엔 탭 스트립이 숨고 글자 서식 패널만 ②셀을 클릭하면 [표|셀]이
 * 나타나며 셀 탭 자동 ③표 탭으로 손 전환하면 줄·칸 조작이 보임 ④본문으로 나가면 다시 숨음
 * ⑤조작 칩이 실제로 명령을 디스패치(줄 지우기 → rowCount 감소 — 칩이 dataset.cmd 만 갖고
 * 리스너가 없어 '눌러도 무동작'이던 실결함의 회귀 방지).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('컨텍스트 탭 — 셀 클릭=셀, 표 개체=표, 본문=서식', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  const headHidden = () => page.evaluate(() =>
    document.querySelector('.canva-rail--right .canva-rail-head').classList.contains('canva-tabs-hidden'));

  // ① 본문: 탭 숨김 + 글자 서식
  assert.ok(await headHidden(), '본문 편집 중엔 탭 스트립이 숨는다');

  // 표 생성 + 셀 클릭
  const t = await page.evaluate(() => {
    const w = window.__wasm;
    const len = w.doc.getParagraphLength(0, 0);
    const r = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: len,
      rowCount: 3, colCount: 3, treatAsChar: true, colWidths: [6000, 6000, 6000],
    })));
    window.__eventBus?.emit('document-changed');
    return r;
  });
  await new Promise((r) => setTimeout(r, 900));
  const pt = await page.evaluate((t) => {
    const ih = window.__inputHandler, w = window.__wasm;
    const bb = w.getTableCellBboxes(0, t.paraIdx, t.controlIdx).find((b) => b.cellIdx === 0);
    const z = ih.viewportManager.getZoom();
    const cv = document.querySelector('#scroll-container canvas').getBoundingClientRect();
    return { x: cv.x + (bb.x + bb.w / 2) * z, y: cv.y + (bb.y + bb.h / 2) * z };
  }, t);
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 700));

  // ② 셀 컨텍스트: 탭 보임 + 셀 자동 + 셀 조작 칩
  const cell = await page.evaluate(() => ({
    active: document.querySelector('.canva-rail--right .canva-tab.is-active')?.textContent?.trim() ?? null,
    section: document.querySelector('.canva-sec-btn.is-on')?.title ?? null,
    ops: [...document.querySelectorAll('.canva-tab-ops .canva-section-label')].map((e) => e.textContent),
  }));
  assert.ok(!(await headHidden()), '표 안에서는 탭이 보인다');
  assert.strictEqual(cell.active, '셀', '셀 클릭 → 셀 탭 자동');
  assert.strictEqual(cell.section, '크기', '셀 탭 기본 섹션');
  assert.deepStrictEqual(cell.ops, ['셀 조작', '블록 계산'], '셀 탭 하단 조작');

  // ③ 표 탭 손 전환 → 줄·칸 조작
  await page.evaluate(() => [...document.querySelectorAll('.canva-tab')].find((x) => x.textContent.trim() === '표')?.click());
  await new Promise((r) => setTimeout(r, 400));
  const tbl = await page.evaluate(() => ({
    active: document.querySelector('.canva-rail--right .canva-tab.is-active')?.textContent?.trim() ?? null,
    ops: [...document.querySelectorAll('.canva-tab-ops .canva-section-label')].map((e) => e.textContent),
  }));
  assert.strictEqual(tbl.active, '표', '표 탭 손 전환');
  assert.deepStrictEqual(tbl.ops, ['줄·칸'], '표 탭 하단 조작');

  // ⑤ 조작 칩 실디스패치 — 줄 지우기 (위임 경로)
  const chip = await page.evaluate((t) => {
    const w = window.__wasm;
    const rows0 = w.getTableDimensions(0, t.paraIdx, t.controlIdx).rowCount;
    const c = [...document.querySelectorAll('.canva-chip')].find((x) => x.title === '줄 지우기');
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return new Promise((res) => setTimeout(() =>
      res({ rows0, rows1: w.getTableDimensions(0, t.paraIdx, t.controlIdx).rowCount }), 700));
  }, t);
  assert.strictEqual(chip.rows1, chip.rows0 - 1, `줄 지우기 칩이 실제 동작 (${chip.rows0}→${chip.rows1})`);

  // ④ 본문 복귀 → 탭 숨김
  const out = await page.evaluate(() => {
    const cv = document.querySelector('#scroll-container canvas').getBoundingClientRect();
    return { x: cv.x + 420, y: cv.y + 420 };
  });
  await page.mouse.click(out.x, out.y);
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(await headHidden(), '본문으로 나가면 탭이 다시 숨는다');

  console.log('  실측:', JSON.stringify({ cell, tbl, chip }));
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
