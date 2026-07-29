/**
 * 회귀: 모드 세그먼트 + AI/녹음 패널 진입 (디자인 갱신 2026-07-30).
 *
 * ①캔버스/문서가 알약 세그먼트(선택 쪽만 fill 아이콘 + 흰 알약)
 * ②속성 탭 하단 '도구' 칩으로 AI 패널이 열린다 — 2c 에서 탭이 빠지며 **진입점이 아예
 *   없어 열리지 않던 상태**의 회귀 방지 ③머리말(뒤로·스파클·제목·모델 칩) + 모드 카드 3종
 * ④뒤로가기 → 속성 탭 복귀.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('모드 세그먼트 · AI 패널 진입/복귀', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // ① 모드 세그먼트
  const mode = await page.evaluate(() => {
    const wrap = document.querySelector('.canva-mode-toggle');
    const segs = [...document.querySelectorAll('.canva-mode-seg')];
    return {
      count: segs.length,
      active: segs.find((s) => s.classList.contains('is-active'))?.textContent.trim(),
      icons: segs.map((s) => s.querySelector('i')?.className ?? ''),
      radius: wrap ? getComputedStyle(wrap).borderRadius : null,
      labels: segs.map((s) => s.textContent.trim()),
    };
  });
  assert.strictEqual(mode.count, 2, '세그먼트 2개');
  assert.deepStrictEqual(mode.labels, ['캔버스', '문서'], '라벨');
  assert.strictEqual(mode.radius, '100px', '알약 트랙');
  assert.ok(mode.icons[0].includes('ph-fill'), '선택된 쪽만 fill 아이콘');
  assert.ok(mode.icons[1].includes('ph-duotone'), '비선택은 duotone');

  // 문서 모드로 전환 → 아이콘이 뒤바뀐다
  const swapped = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-mode-seg')].find((s) => s.textContent.trim() === '문서').click();
    await new Promise((r) => setTimeout(r, 250));
    return [...document.querySelectorAll('.canva-mode-seg')].map((s) => s.querySelector('i').className);
  });
  assert.ok(swapped[1].includes('ph-fill'), '전환 후 문서가 fill');

  // ② 속성 탭 하단 도구 칩 → AI 패널
  const ai = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-chip')].find((c) => c.title === 'AI 도우미')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return {
      shown: !document.querySelector('.canva-ai-pane-wrap')?.hidden,
      back: !!document.querySelector('.canva-ai-back'),
      model: document.querySelector('.canva-ai-model')?.textContent,
      cards: [...document.querySelectorAll('.canva-ai-modebtn')].map((b) => b.textContent.trim()),
    };
  });
  assert.ok(ai.shown, 'AI 패널이 열린다 (진입점 회귀 방지)');
  assert.ok(ai.back, '뒤로가기 버튼');
  assert.strictEqual(ai.model, 'MiniMax M3', '모델 칩');
  assert.deepStrictEqual(ai.cards, ['문서 생성', '일반 글쓰기', '문서 검토'], '모드 카드 3종');

  // ④ 뒤로가기 → 속성
  const back = await page.evaluate(async () => {
    document.querySelector('.canva-ai-back').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      hidden: !!document.querySelector('.canva-ai-pane-wrap')?.hidden,
      tab: document.querySelector('.canva-tab.is-active')?.textContent?.trim(),
    };
  });
  assert.ok(back.hidden, '뒤로가기 → AI 패널 닫힘');
  assert.strictEqual(back.tab, '속성', '속성 탭 복귀');

  // 녹음 패널도 같은 규약
  const rec = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-chip')].find((c) => c.title === '녹음·받아쓰기')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return !document.querySelector('.canva-record-pane-wrap')?.hidden;
  });
  assert.ok(rec, '녹음 패널도 열린다');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
