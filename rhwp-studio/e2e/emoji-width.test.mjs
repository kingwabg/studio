/**
 * 이모지 폭 회귀 — **브라우저(wasm) 경로**를 잠근다.
 *
 * 폴백 폭 사다리가 엔진에 **네 벌** 복사돼 있었고, 브라우저가 실제로 타는 것은 그중
 * wasm measurer 사본이었다. native 쪽만 고치면 단위 테스트는 통과하는데 화면은 그대로다
 * — 실제로 그렇게 두 번 헛짚었다(2026-07-31). 그래서 이 검사는 반드시 브라우저에서 한다.
 *
 * 판정: 이모지 전진폭이 전각 한글과 같아야 한다(반각이면 서로 겹치고 뒤 글자를 덮는다).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('이모지 전진폭 = 전각 (브라우저 경로)', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  const out = await page.evaluate(() => {
    const w = window.__wasm, ih = window.__inputHandler;
    // 글꼴이 있든 없든(미등록 폰트 폴백 경로) 같은 답이어야 한다
    const fonts = ['함초롬바탕', 'NoSuchFontXYZ'];
    fonts.forEach((f, k) => {
      if (k > 0) w.doc.splitParagraph(0, k - 1, w.getParagraphLength(0, k - 1));
      w.doc.insertText(0, k, 0, '가😀나');
      ih.applyCharPropsToRange(
        { sectionIndex: 0, paragraphIndex: k, charOffset: 0 },
        { sectionIndex: 0, paragraphIndex: k, charOffset: 3 }, { fontFamily: f });
    });
    const res = {};
    fonts.forEach((f, k) => {
      const xs = [0, 1, 2, 3].map((i) => w.getCursorRect(0, k, i).x);
      res[f] = [1, 2, 3].map((i) => +(xs[i] - xs[i - 1]).toFixed(1));
    });
    return res;
  });

  console.log('  전진폭(가 😀 나):', JSON.stringify(out));
  for (const [font, steps] of Object.entries(out)) {
    const [ga, emoji, na] = steps;
    assert.ok(emoji > 0, `${font}: 이모지 폭이 0이다`);
    assert.ok(
      Math.abs(emoji - ga) < 1.0 && Math.abs(emoji - na) < 1.0,
      `${font}: 이모지가 전각이 아니다 — 가 ${ga}px, 😀 ${emoji}px, 나 ${na}px`,
    );
  }
});
