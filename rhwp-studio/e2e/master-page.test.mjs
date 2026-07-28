/**
 * 회귀: 바탕쪽 편집 — 조회·편집·저장 반영.
 *
 * ⚠ 엔진 왕복 보존(raw_list_header 무효화·SectionDef 이중 사본 동기)은 Rust 테스트
 * tests/master_page_edit.rs 가 담당한다. 여기서는 브리지 계약과 실물 문서 조회를 본다.
 */
import assert from 'node:assert';
import { runTest, loadHwpFile, createNewDocument } from './helpers.mjs';

runTest('바탕쪽 — 조회 계약과 실물 문서 편집 반영', async ({ page }) => {
  await createNewDocument(page);

  const empty = await page.evaluate(() => {
    const w = window.__inputHandler.wasm;
    const list = w.getMasterPages(0);
    return { isArray: Array.isArray(list), count: list.length };
  });
  assert.ok(empty.isArray, 'getMasterPages 는 배열을 반환해야 함');

  // 바탕쪽 3개를 가진 실물 문서(실측 2026-07-28 스캔)
  await loadHwpFile(page, 'exam_kor.hwp');
  const r = await page.evaluate(() => {
    const w = window.__inputHandler.wasm;
    const before = w.getMasterPages(0);
    if (before.length === 0) return { skipped: true, count: 0 };
    const res = w.setMasterPageText(0, 0, '기관 서식 바탕쪽\n두 번째 줄');
    const after = w.getMasterPages(0);
    return {
      skipped: false,
      count: before.length,
      ok: res?.ok === true,
      text: after[0]?.text ?? null,
    };
  });

  console.log('  실측:', JSON.stringify(r));
  assert.ok(!r.skipped, 'exam_kor.hwp 는 바탕쪽 3개를 가진다 — 표본이 바뀌었으면 갱신할 것');
  assert.strictEqual(r.count, 3, `바탕쪽 3개 기대 (실측 ${r.count})`);
  assert.ok(r.ok, '편집 API 가 ok 를 반환해야 함');
  assert.strictEqual(r.text, '기관 서식 바탕쪽\n두 번째 줄', '편집 결과가 조회에 반영');
});
