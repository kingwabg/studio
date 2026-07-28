/**
 * 회귀: 리본 아이콘이 **실제로 그려지는가**.
 *
 * 2026-07-29 실사고: CSS 에 절대경로(/vendor/phosphor/...)를 써서 배포 base(/rhwp-studio/)
 * 아래에서 폰트가 404 → 버튼은 있는데 글리프가 빈칸이었다. 로컬 dev 는 루트라 멀쩡히 보여
 * 놓쳤다. 폰트 로드 여부(document.fonts)와 글리프 실측 폭으로 판정한다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('리본 아이콘 폰트 로드·글리프 렌더', async ({ page }) => {
  const failed = [];
  page.on('requestfailed', (r) => { if (/Phosphor|phosphor/.test(r.url())) failed.push(r.url()); });
  page.on('response', (r) => { if (/Phosphor|phosphor/.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  await createNewDocument(page);
  const r = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => /Phosphor/.test(f.family)).map((f) => `${f.family}:${f.status}`);
    const i = document.querySelector('.rb-btn i');
    const cs = i ? getComputedStyle(i) : null;
    // 글리프가 실제로 그려지면 폭이 폰트 크기에 가깝다. 빈칸이면 0에 가깝다.
    const w = i ? i.getBoundingClientRect().width : 0;
    return { loaded, family: cs?.fontFamily ?? null, glyphWidth: Math.round(w) };
  });
  console.log('  실측:', JSON.stringify(r));
  assert.deepStrictEqual(failed, [], `폰트 요청 실패: ${JSON.stringify(failed)}`);
  assert.ok(r.loaded.some((f) => f.includes('loaded')), `Phosphor 폰트 미로드: ${JSON.stringify(r.loaded)}`);
  assert.ok(r.glyphWidth >= 12, `아이콘 글리프가 안 그려짐 (폭 ${r.glyphWidth}px)`);
});
