import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
runTest('리본 헤더 — 2행 88px·탭 전환·명령 배선', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  const r = await page.evaluate(() => {
    const h = document.getElementById('ribbon-header');
    const rect = h?.getBoundingClientRect();
    const tabs = [...document.querySelectorAll('.rb-tab')].map(b => b.textContent);
    const btns = document.querySelectorAll('.rb-btn[data-cmd]').length;
    const active = document.querySelector('.rb-tab.is-active')?.textContent;
    // 구 툴바는 DOM 엔 남기고 숨긴다(부팅 로직이 조회함) — 보이지 않는지로 판정
    const oldBars = ['icon-toolbar','style-bar'].map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().height > 0 : false;
    });
    return { h: rect ? Math.round(rect.height) : null, tabs, btns, active, oldBars };
  });
  console.log('  실측:', JSON.stringify(r));
  assert.strictEqual(r.h, 88, `헤더 88px 기대 (실측 ${r.h})`);
  assert.deepStrictEqual(r.tabs, ['홈','삽입','레이아웃','검토'], '탭 4종');
  assert.strictEqual(r.active, '홈', '기본 활성 탭 = 홈');
  assert.ok(r.btns >= 15, `홈 리본 버튼 다수 기대 (실측 ${r.btns})`);
  assert.deepStrictEqual(r.oldBars, [false, false], '구 툴바/서식바는 화면에 보이지 않아야 함');
  // 탭 전환
  const ins = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '삽입')?.click();
    return [...document.querySelectorAll('.rb-btn[data-cmd]')].map(b => b.dataset.cmd).slice(0, 4);
  });
  console.log('  삽입탭:', JSON.stringify(ins));
  assert.ok(ins.includes('table:create'), '삽입 탭에 표 만들기');
  await screenshot(page, 'ribbon-header');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
