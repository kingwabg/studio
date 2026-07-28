/**
 * 회귀: 메모 — 엔진 조회(getMemos) + 여백 말풍선 표시(읽기 전용 v1).
 *
 * ⚠ 코퍼스에 메모 보유 표본이 없어(2026-07-28 전수 스캔) 엔진 왕복 보존은 Rust 테스트
 * (tests/memo_hwp5_roundtrip.rs)가 담당한다. 여기서는 **표시 계층**만 판정한다:
 * 메모가 0건인 문서에서 오버레이가 조용히 비어 있고 오류가 없어야 한다(무해성),
 * 그리고 getMemos 계약(배열 반환)이 유지되어야 한다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('메모 — getMemos 계약과 오버레이 무해성', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);

  const r = await page.evaluate(() => {
    const ih = window.__inputHandler;
    const memos = ih.wasm.getMemos();
    ih.refreshMemoOverlay?.();
    const layer = document.querySelector('.memo-overlay-layer');
    return {
      isArray: Array.isArray(memos),
      count: memos.length,
      layerExists: !!layer,
      bubbles: layer ? layer.querySelectorAll('.memo-bubble').length : -1,
    };
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.isArray, 'getMemos 는 배열을 반환해야 함');
  assert.strictEqual(r.count, 0, '새 문서엔 메모가 없어야 함');
  assert.strictEqual(r.bubbles, 0, '메모 0건이면 말풍선도 0개');
  assert.deepStrictEqual(errors, [], `페이지 오류 발생: ${JSON.stringify(errors)}`);

  // 합성 메모로 말풍선 렌더 자체를 검증(엔진 삽입 API 부재 — 표시 계층 단독 시험)
  const drawn = await page.evaluate(async () => {
    const { MemoOverlay } = await import('/src/engine/memo-overlay.ts');
    const ih = window.__inputHandler;
    const ov = new MemoOverlay(ih.container, ih.virtualScroll);
    ov.render(
      [{ sectionIndex: 0, paragraphIndex: 0, charOffset: 0, memoIndex: 0, text: '검토 요망' }],
      ih.viewportManager.getZoom(),
      () => ({ pageIndex: 0, x: 100, y: 200, height: 20 }),
    );
    const layers = document.querySelectorAll('.memo-overlay-layer');
    const last = layers[layers.length - 1];
    const b = last.querySelector('.memo-bubble');
    return { text: b?.textContent ?? null, left: b?.style.left ?? null, top: b?.style.top ?? null };
  });
  console.log('  말풍선:', JSON.stringify(drawn));
  assert.strictEqual(drawn.text, '검토 요망', '말풍선 본문 표시');
  assert.ok(drawn.left && parseFloat(drawn.left) > 0, '말풍선이 쪽 오른쪽에 배치되어야 함');
});
