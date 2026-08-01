/**
 * 우측 패널이 클릭마다 다시 그려지지 않는가.
 * (사용자 지적 2026-08-01: "마우스 클릭 할 때마다 로딩되듯이 보여지는데")
 *
 * 실측한 원인 둘 — 둘 다 "값이 같은데 다시 쓰기":
 *  ① 클릭 순간 길이 0 짜리 선택이 잡혀 견본이 **비었다가 다시 찼다**(깜빡임의 본체.
 *     다시 그리는 찰나에 한글이 자모로 풀려 보이기도 했다)
 *  ② 「함초롬바탕 10pt」 줄을 같은 글자로 매번 새로 써 텍스트 노드가 갈렸다
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('패널 안정성', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));

  await page.evaluate(async () => {
    const w = window.__wasm;
    w.insertText(0, 0, 0, '패널이 클릭할 때마다 다시 그려지는지 재는 문장입니다. 충분히 길게 씁니다.');
    await new Promise((x) => setTimeout(x, 600));
    const pane = document.querySelector('.canva-rail-content');
    const by = {};
    let mutations = 0;
    const obs = new MutationObserver((ms) => {
      mutations += ms.length;
      for (const m of ms) {
        const t = m.target;
        const k = (t.className && typeof t.className === 'string' ? t.className.split(' ')[0] : t.nodeName);
        by[k] = (by[k] ?? 0) + 1;
      }
    });
    obs.observe(pane, { childList: true, subtree: true });
    window.__obs = obs;
    window.__cnt = () => ({ mutations, by });
  });

  for (let i = 0; i < 6; i++) {
    await page.mouse.click(300 + i * 20, 250);
    await new Promise((r) => setTimeout(r, 220));
  }
  await new Promise((r) => setTimeout(r, 500));

  const c = await page.evaluate(() => { window.__obs.disconnect(); return window.__cnt(); });
  console.log('  클릭 6회 → DOM 변경', c.mutations, '건:', JSON.stringify(c.by));

  const spec = c.by['canva-specimen-text'] ?? 0;
  const sub = c.by['canva-specimen-sub'] ?? 0;
  // 클릭당 1회를 넘으면 눈에 깜빡임으로 보인다(수리 전: 견본 11 · 부제 24)
  assert.ok(spec <= 6, `견본이 클릭마다 다시 그려진다 (${spec}회)`);
  assert.strictEqual(sub, 0, `「글꼴 10pt」 줄은 값이 같으면 안 건드려야 한다 (${sub}회)`);
  assert.ok(c.mutations <= 12, `패널 전체가 과하게 다시 그려진다 (${c.mutations}건)`);

  // 견본이 중간에 비지 않는가 — 비었다 차는 것이 깜빡임의 본체였다
  const empty = await page.evaluate(() =>
    (document.querySelector('.canva-specimen-text')?.textContent ?? '').trim().length === 0);
  console.log('  견본 비었나:', empty);
  assert.ok(!empty, '클릭 뒤 견본이 비어 있으면 안 된다');
});
