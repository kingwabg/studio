/**
 * 실측: 빈 문서에 표를 만든 직후 캐럿 위치가 용지 여백(본문 영역) 안에 있는가.
 * 증상(사용자 보고 2026-07-28): 캐럿이 여백 밖(용지 왼쪽 바깥)에서 깜빡인다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('표 생성 직후 캐럿이 본문 영역 안', async ({ page }) => {
  await createNewDocument(page);
  await page.evaluate((v) => { window.__VARIANT_EXIT_TO_BODY = v; }, process.env.EXIT_TO_BODY === '1');
  if (process.env.ZOOM) {
    await page.evaluate((z) => { window.__canvasView.viewportManager.setZoom(Number(z)); }, process.env.ZOOM);
    await new Promise((r) => setTimeout(r, 400));
  }

  const r = await page.evaluate(async () => {
    const w = window.__wasm;
    const ih = window.__inputHandler;
    // UI "표 만들기" 대화상자와 **같은 순서**로 재현 (command/commands/table.ts):
    // createTable → 기본 테두리 → 가로기준 종이+여백 오프셋 → 커서를 첫 셀로
    let tr = null;
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'createTable',
      operation: (wasm) => {
        const result = wasm.createTable(0, 0, 0, 3, 3);
        if (!result.ok) return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
        tr = result;
        wasm.applyDefaultTableBorders(0, result.paraIdx, result.controlIdx);
        const pd = wasm.getPageDef(0);
        wasm.setTableProperties(0, result.paraIdx, result.controlIdx, {
          horzRelTo: 'Paper', horzAlign: 'Left', horzOffset: pd.marginLeft ?? 0,
        });
        return {
          sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
          parentParaIndex: result.paraIdx, controlIndex: result.controlIdx,
          cellIndex: 0, cellParaIndex: 0,
        };
      },
    });
    await new Promise((res) => setTimeout(res, 800));
    // 변형: 표 밖(본문 문단)으로 커서를 뺐을 때 — 사용자 화면과 같은 상태 재현 시도
    if (window.__VARIANT_EXIT_TO_BODY) {
      ih.exitTableToBody();
      // 캐럿 재도색 강제 — 실사용에선 이벤트가 돌지만 headless에선 안 돌 수 있다
      try { ih.updateCaret?.(); } catch {}
      try { window.__eventBus?.emit('cursor-changed'); } catch {}
      try { window.__eventBus?.emit('document-changed'); } catch {}
      await new Promise((res) => setTimeout(res, 600));
    }

    const bbox = w.getTableBBox(0, tr.paraIdx, tr.controlIdx);
    const props = w.getTableProperties(0, tr.paraIdx, tr.controlIdx);
    const view = window.__canvasView;
    const zoom = view.viewportManager.getZoom();
    const sc = document.querySelector('#scroll-content');
    const pageLeft = view.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
    const pageTop = view.virtualScroll.getPageOffset(0);

    const caretEl = document.querySelector('.caret');
    const cs = caretEl ? caretEl.getBoundingClientRect() : null;
    const scr = sc.getBoundingClientRect();
    // 캐럿의 페이지 좌표
    const caretPageX = cs ? (cs.left - scr.left - pageLeft) / zoom : null;
    const caretPageY = cs ? (cs.top - scr.top - pageTop) / zoom : null;

    return {
      caretPageX, caretPageY,
      caretStyle: caretEl ? { left: caretEl.style.left, top: caretEl.style.top } : null,
      tableX: bbox.x, tableY: bbox.y,
      horzRelTo: props?.horzRelTo, horzOffset: props?.horzOffset,
      cursor: ih.getCursorPosition(),
      pageWidth: view.virtualScroll.getPageWidth(0) / zoom,
    };
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.caretPageX !== null, '캐럿 엘리먼트를 찾지 못함');
  // 본문 왼쪽 여백 = 표 왼쪽 변(표는 여백에 붙어 생성된다). 캐럿이 그보다 왼쪽이면 여백 밖.
  assert.ok(r.caretPageX >= r.tableX - 1,
    `캐럿이 여백 밖: caretX=${r.caretPageX.toFixed(1)} < 본문좌측=${r.tableX.toFixed(1)}`);
});
