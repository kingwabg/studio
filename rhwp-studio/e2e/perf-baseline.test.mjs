/**
 * 성능 기준선 실측 (진단 스윕 2026-07-28 — docs/specs/studio-audit.md 판정식 ①)
 * 수치 5종: 대형 로드 · 중형 로드 · 페이지 렌더 · 타이핑 레이턴시 · 드래그 프레임 간격.
 * ⚠ 판정(assert) 없음 — 기준선 박제용. 수치는 stdout 으로.
 */
import { runTest, createNewDocument, loadHwpFile } from './helpers.mjs';

const t = () => performance.now();

runTest('성능 기준선', async ({ page }) => {
  // ① 대형 문서 로드 (10MB, 행정업무운영 편람)
  let t0 = Date.now();
  const big = await loadHwpFile(page, '2025 행정업무운영 편람(최종).hwp');
  const bigLoadMs = Date.now() - t0 - 1500; // helpers 의 고정 1.5s 대기 제외
  console.log(`  [1] 대형 로드(10MB, ${big.pageCount}쪽): ${bigLoadMs}ms`);

  // ② 페이지 렌더 시간 — 중간 페이지로 점프해 새 페이지 렌더 유발
  const renderMs = await page.evaluate(async () => {
    const view = window.__canvasView;
    const target = Math.floor(view.virtualScroll.pageCount / 2);
    const off = view.virtualScroll.getPageOffset(target);
    const t0 = performance.now();
    document.querySelector('#scroll-container').scrollTop = off;
    await new Promise((r) => setTimeout(r, 50));
    // 렌더 완료 = 해당 페이지 캔버스 존재까지 폴링
    for (let i = 0; i < 100; i++) {
      if (view.canvasPool?.has?.(target)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    return Math.round(performance.now() - t0);
  });
  console.log(`  [2] 중간 페이지 점프→렌더: ${renderMs}ms`);

  // ③ 중형 문서 로드 (5.6MB)
  t0 = Date.now();
  const mid = await loadHwpFile(page, '3-09월_교육_통합_2024-격자기준종이.hwp');
  console.log(`  [3] 중형 로드(5.6MB, ${mid.pageCount}쪽): ${Date.now() - t0 - 1500}ms`);

  // ④ 타이핑 레이턴시 — insertText → document-changed 처리 완료까지
  await createNewDocument(page);
  const typing = await page.evaluate(async () => {
    const w = window.__wasm;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      w.doc.insertText(0, 0, i, '가');
      window.__eventBus.emit('document-changed');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return {
      p50: Math.round(times[10] * 10) / 10,
      p95: Math.round(times[18] * 10) / 10,
    };
  });
  console.log(`  [4] 타이핑 레이턴시(빈 문서, 20타): p50=${typing.p50}ms p95=${typing.p95}ms`);

  // ⑤ 표 이동 드래그 프레임 간격 — updateMoveDrag 1회 비용
  const drag = await page.evaluate(async () => {
    const w = window.__wasm;
    const ih = window.__inputHandler;
    const tr = JSON.parse(w.doc.createTable(0, 0, 0, 3, 5));
    window.__eventBus.emit('document-changed');
    await new Promise((r) => setTimeout(r, 500));
    // Square 어울림으로 — 실사용 드래그와 같은 조건
    w.setTableProperties(0, tr.paraIdx, tr.controlIdx, { treatAsChar: false, textWrap: 'Square' });
    await new Promise((r) => setTimeout(r, 300));
    const times = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      w.moveTableOffset?.(0, tr.paraIdx, tr.controlIdx, 2, 1)
        ?? w.doc.moveTableOffset?.(0, tr.paraIdx, tr.controlIdx, 2, 1);
      window.__eventBus.emit('document-changed');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { p50: Math.round(times[7] * 10) / 10, p95: Math.round(times[13] * 10) / 10, api: !!(w.moveTableOffset || w.doc.moveTableOffset) };
  });
  console.log(`  [5] 표 이동 1스텝(Square, 3x5): p50=${drag.p50}ms p95=${drag.p95}ms (api=${drag.api})`);
});
