/**
 * 「글자」 탭 — 탭이 약속한 것만 담고, 모든 섹션이 스크롤 없이 보이는가.
 * (2026-08-01: 문단 정렬·줄 간격이 문단 탭과 중복돼 아래가 밀렸고,
 *  「도구」(AI·녹음) 진입점이 화면 밖 y=849 로 잘려 있었다)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('글자 탭', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));

  const o = await page.evaluate(() => {
    const pane = document.querySelector('.canva-rail-content');
    const pr = pane.getBoundingClientRect();
    const titled = (t) => [...pane.querySelectorAll('*')].find((e) =>
      [...e.childNodes].filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).join('') === t);
    const box = (t) => {
      const e = titled(t);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { y: Math.round(r.y - pr.y), visible: r.bottom <= pr.bottom + 1 };
    };
    // 카드 라벨이 잘리지 않는가(스크롤 폭 > 보이는 폭이면 …로 잘린 것)
    const cards = [...pane.querySelectorAll('.canva-style-card')].map((b) => ({
      label: b.textContent.trim(), cut: b.scrollWidth > b.clientWidth + 1,
    }));
    return {
      view: Math.round(pr.height),
      sections: Object.fromEntries(['텍스트 스타일', '글자', '글자색', '형광펜', '도구']
        .map((t) => [t, box(t)])),
      hasAlign: !!titled('문단 정렬'),
      cards,
      cols: getComputedStyle(pane.querySelector('.canva-styles')).gridTemplateColumns.split(' ').length,
    };
  });

  for (const [k, v] of Object.entries(o.sections)) {
    console.log(`  ${k}: ${v ? `y=${v.y} ${v.visible ? '보임' : '❌ 잘림'}` : '(없음)'}`);
  }
  console.log('  문단 정렬 중복:', o.hasAlign, '/ 프리셋 열 수:', o.cols,
    '/ 잘린 카드:', JSON.stringify(o.cards.filter((c) => c.cut).map((c) => c.label)));

  for (const [k, v] of Object.entries(o.sections)) {
    assert.ok(v, `${k} 섹션이 있어야 한다`);
    assert.ok(v.visible, `${k} 가 스크롤 없이 보여야 한다 (y=${v.y}, 화면 ${o.view})`);
  }
  assert.ok(!o.hasAlign,
    '문단 정렬·줄 간격은 문단 탭이 집이다 — 글자 탭에 중복되면 안 된다');
  assert.strictEqual(o.cols, 2, '프리셋 카드는 2열');
  assert.deepStrictEqual(o.cards.filter((c) => c.cut).map((c) => c.label), [],
    '카드 이름이 잘리면 뜻이 사라진다');

  // 뺐으면 다른 길이 살아 있는지 본다 — 기능을 없앤 게 아니라 한 곳으로 모은 것이다
  const al = await page.evaluate(async () => {
    const w = window.__wasm;
    w.insertText(0, 0, 0, '정렬 경로 확인용 문장입니다.');
    await new Promise((x) => setTimeout(x, 300));
    // 엔진 접근자 이름이 버전마다 달라 입력 핸들러 쪽을 쓴다(_al 예비 실측)
    const get = () => window.__inputHandler.getParaProperties().alignment;
    const before = get();
    // ① 리본 홈 탭 — mousedown 으로 명령을 낸다(main.ts 가 #ribbon-header 에 건다)
    document.querySelector('[data-cmd="format:align-center"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((x) => setTimeout(x, 400));
    const viaRibbon = get();
    // ② 문단 탭 「자주」
    [...document.querySelectorAll('.canva-rail--right *')]
      .find((e) => e.textContent.trim() === '문단' && e.children.length === 0)?.click();
    await new Promise((x) => setTimeout(x, 500));
    [...document.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent.trim() === '오른쪽')?.click();
    await new Promise((x) => setTimeout(x, 400));
    return { before, viaRibbon, viaPanel: get() };
  });
  console.log('  정렬 경로 — 처음:', al.before, '/ 리본:', al.viaRibbon, '/ 문단 탭:', al.viaPanel);
  assert.strictEqual(al.viaRibbon, 'center', '리본 홈 탭에서 정렬된다');
  assert.strictEqual(al.viaPanel, 'right', '문단 탭 「자주」에서 정렬된다');
});
