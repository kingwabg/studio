/**
 * 회귀: 표/셀 속성 진입점이 **대화상자를 열지 않고 오른쪽 패널로 간다** (2026-07-29 은퇴).
 *
 * 판정식: `table:cell-props` 를 실행하면 ①모달이 뜨지 않고 ②오른쪽 레일의 셀(또는 표) 탭이
 * 활성화되며 ③그 탭의 섹션 내용이 실제로 그려진다. 진입점만 바꾸고 패널을 안 여는 회귀,
 * 또는 대화상자가 되살아나는 회귀를 둘 다 잡는다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('표/셀 속성 진입점 — 대화상자 대신 패널', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);

  // 표를 만들고 커서를 셀 안에 둔다
  await page.evaluate(() => {
    const w = window.__wasm;
    const ih = window.__inputHandler;
    const len = w.doc.getParagraphLength(0, 0);
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: len,
      rowCount: 3, colCount: 3, treatAsChar: true, colWidths: [6000, 6000, 6000],
    })));
    void ih;
    window.__tbl = t;
    window.__eventBus?.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 900));

  // 커서는 실제 클릭으로 셀 안에 둔다 — setPosition 만으로는 편집 컨텍스트가 안 바뀐다.
  // 좌표는 엔진이 알려주는 셀 bbox 를 화면 좌표로 옮겨 쓴다(하드코딩 픽셀은 잘 깨진다).
  const pt = await page.evaluate(() => {
    const ih = window.__inputHandler;
    const w = window.__wasm;
    const t = window.__tbl;
    const bb = w.getTableCellBboxes(0, t.paraIdx, t.controlIdx).find((b) => b.cellIdx === 0);
    const zoom = ih.viewportManager.getZoom();
    const cv = document.querySelector('#scroll-container canvas').getBoundingClientRect();
    return { x: cv.x + (bb.x + bb.w / 2) * zoom, y: cv.y + (bb.y + bb.h / 2) * zoom };
  });
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 500));
  const inTable = await page.evaluate(() => !!window.__inputHandler?.isInTable?.());
  assert.ok(inTable, '사전 조건 — 커서가 표 안에 있어야 함');

  const r = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const dispatched = ih.dispatcher.dispatch('table:cell-props');
    await new Promise((res) => setTimeout(res, 500));
    const activeTab = [...document.querySelectorAll('.canva-tab')].find((b) => b.classList.contains('is-active'));
    const host = document.querySelector('.canva-props-host');
    return {
      dispatched,
      // 은퇴한 대화상자는 어떤 형태로도 뜨면 안 된다
      modals: document.querySelectorAll('.modal-overlay').length,
      activeTab: activeTab?.textContent?.trim() ?? null,
      collapsed: document.querySelector('.canva-rail.is-collapsed:last-of-type') !== null,
      section: document.querySelector('.canva-sec-btn.is-on')?.title ?? null,
      drawn: host?.firstElementChild?.className ?? null,
      controls: host?.querySelectorAll('input, select, button').length ?? 0,
    };
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.dispatched, '명령이 실행되어야 함');
  assert.strictEqual(r.modals, 0, '표/셀 속성 대화상자는 더 이상 뜨지 않는다');
  assert.strictEqual(r.activeTab, '셀', '셀 안에서는 셀 탭이 열린다');
  assert.strictEqual(r.section, '크기', '셀 탭의 기본 섹션은 크기');
  assert.strictEqual(r.drawn, 'tps', '섹션 내용이 실제로 그려져야 함');
  assert.ok(r.controls > 0, '컨트롤이 있어야 함');
  assert.deepStrictEqual(errors, [], `페이지 오류 발생: ${JSON.stringify(errors)}`);
});
