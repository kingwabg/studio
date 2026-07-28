/**
 * 회귀: 표 이동 드래그 중 경계선 hover 마커(파란 줄)가 누른 자리에 얼어붙는 문제.
 *
 * 원인: onMouseMove의 드래그 분기들이 hover 경로 **앞에서** return 하므로,
 * 드래그 시작 직전에 그려진 .table-resize-layer 마커를 아무도 걷지 않는다.
 *
 * 판정: 경계선 hover로 마커를 띄운 뒤 표 이동 드래그를 시작하면 마커가 사라져야 한다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

const markerCount = (page) =>
  page.evaluate(() => document.querySelectorAll('.table-resize-layer > *').length);

runTest('표 이동 드래그 시작 시 경계선 hover 마커가 사라진다', async ({ page }) => {
  await createNewDocument(page);

  // 표 삽입 + 선택(이동 드래그는 선택된 표에서만 시작된다)
  const geom = await page.evaluate(() => {
    const w = window.__wasm;
    const tr = JSON.parse(w.doc.createTable(0, 0, 0, 3, 5));
    window.__eventBus?.emit('document-changed');
    const bbox = w.getTableBBox(0, tr.paraIdx, tr.controlIdx);
    // 이동 드래그는 "이미 선택된 표"에서만 시작된다 — 표 전체 선택 경로를 직접 태운다.
    window.__inputHandler.onTableHoverHandleGrab(
      { sec: 0, ppi: tr.paraIdx, ci: tr.controlIdx }, 'nw', bbox.x, bbox.y, 0,
    );
    return { bbox, ref: { sec: 0, ppi: tr.paraIdx, ci: tr.controlIdx } };
  });
  assert.ok(geom.bbox && geom.bbox.width > 0, '표 bbox를 얻지 못함');

  // 페이지 좌표 → 클라이언트 좌표 변환기
  const toClient = async (pageX, pageY) =>
    page.evaluate(({ px, py }) => {
      const view = window.__canvasView;
      const sc = document.querySelector('#scroll-content');
      const rect = sc.getBoundingClientRect();
      const zoom = view.viewportManager.getZoom();
      const left = view.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
      const top = view.virtualScroll.getPageOffset(0);
      return { x: rect.left + left + px * zoom, y: rect.top + top + py * zoom };
    }, { px: pageX, py: pageY });

  const b = geom.bbox;
  // 내부 가로 경계선(1행/2행 사이) 위로 hover
  const rowLineY = b.y + b.height / 3;
  const hover = await toClient(b.x + b.width / 2, rowLineY);
  await page.mouse.move(hover.x, hover.y);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  // ① 개체 선택 상태에서는 경계선 hover 마커가 **아예 뜨면 안 된다** —
  //    이 상태의 mousedown은 무조건 이동 드래그라 리사이즈는 불가능(거짓 어포던스 금지).
  const onHover = await markerCount(page);
  const cursorOnBorder = await page.evaluate(() =>
    document.querySelector('#scroll-container')?.style.cursor
    ?? window.__inputHandler?.container?.style?.cursor ?? '');
  assert.strictEqual(onHover, 0, `개체 선택 중 경계선 마커가 떴다 — count=${onHover}`);
  assert.strictEqual(cursorOnBorder, 'move',
    `개체 선택 중 경계선 커서는 move여야 한다 — cursor=${cursorOnBorder}`);

  // ② 같은 자리에서 눌러 이동 드래그 → 드래그 중에도 마커가 없어야 한다
  await page.mouse.down();
  const to = await toClient(b.x + b.width / 2 + 40, rowLineY + 30);
  await page.mouse.move(to.x, to.y);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  const during = await markerCount(page);
  const state = await page.evaluate(() => {
    const ih = window.__inputHandler;
    return {
      isMoveDragging: !!ih?.isMoveDragging,
      isResizeDragging: !!ih?.isResizeDragging,
      isTableHandleResizing: !!ih?.isTableHandleResizing,
      isDragging: !!ih?.isDragging,
      selected: !!ih?.cursor?.getSelectedTableRef?.() || !!ih?.selectedTableObject,
    };
  });
  await page.mouse.up();

  console.log('  드래그 상태:', JSON.stringify(state));
  assert.strictEqual(during, 0, `드래그 중 hover 마커 잔상 — count=${during} state=${JSON.stringify(state)}`);
});
