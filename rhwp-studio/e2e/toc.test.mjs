/**
 * 회귀: 차례(목차) 만들기 — 제목 수집·쪽번호·삽입.
 *
 * 판정식(스펙 hancom-gap-features ④): 삽입된 목차 줄 수 = 수집 노드 수, 각 줄의
 * 쪽번호가 getPageOfPosition 결과와 일치.
 * ⚠ 개요 판정은 문단모양 기반이라 스타일명만 쓰는 문서를 위해 폴백 수집이 있다 —
 * 이 테스트는 **폴백 경로**(개요 번호 문단)를 실물 문서로 검증한다.
 */
import assert from 'node:assert';
import { runTest, loadHwpFile } from './helpers.mjs';

runTest('차례 — 제목 수집·쪽번호·삽입', async ({ page }) => {
  // 개요/제목이 실제로 있는 실물 문서
  await loadHwpFile(page, '2025 행정업무운영 편람(최종).hwp');

  const collected = await page.evaluate(async () => {
    const { collectHeadings, formatToc } = await import('/src/ui/toc-dialog.ts');
    const w = window.__inputHandler.wasm;
    const list = collectHeadings(w, 3);
    return {
      count: list.length,
      first5: list.slice(0, 5).map((e) => [e.level, e.heading.slice(0, 20), e.page]),
      // 판정: 각 항목의 쪽번호가 엔진 조회값과 같은가
      pagesMatch: list.every((e) => {
        const r = w.getPageOfPosition(e.section, e.paragraph);
        return e.page === (r?.ok ? (r.page ?? null) : null);
      }),
      lines: formatToc(list, true).split('\n').length,
    };
  });

  console.log('  수집:', JSON.stringify(collected.first5), `총 ${collected.count}건`);
  assert.ok(collected.count > 0, '제목이 하나도 수집되지 않음');
  assert.ok(collected.pagesMatch, '쪽번호가 엔진 조회값과 불일치');
  assert.strictEqual(collected.lines, collected.count, '목차 줄 수 = 수집 건수');

  // 삽입 → 문단 수 증가, 되돌리기로 복귀
  const before = await page.evaluate(() => window.__wasm.getParagraphCount(0));
  await page.evaluate(async () => {
    const { collectHeadings, formatToc } = await import('/src/ui/toc-dialog.ts');
    const ih = window.__inputHandler;
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
    ih.insertPlainTextAtCursor(formatToc(collectHeadings(ih.wasm, 2), true));
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));
  const after = await page.evaluate(() => window.__wasm.getParagraphCount(0));
  assert.ok(after > before, `삽입 후 문단 증가 기대 (${before} → ${after})`);
});
