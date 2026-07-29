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
  assert.deepStrictEqual(r.tabs, ['홈','편집','삽입','레이아웃','도구','검토'], '탭 6종');
  assert.strictEqual(r.active, '홈', '기본 활성 탭 = 홈');
  assert.ok(r.btns >= 12, `홈 리본 버튼 다수 기대 (실측 ${r.btns}) — 편집 묶음 6개가 편집 탭으로 빠졌다`);
  assert.deepStrictEqual(r.oldBars, [false, false], '구 툴바/서식바는 화면에 보이지 않아야 함');
  // 탭 전환
  const ins = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '삽입')?.click();
    return [...document.querySelectorAll('.rb-btn[data-cmd]')].map(b => b.dataset.cmd).slice(0, 4);
  });
  console.log('  삽입탭:', JSON.stringify(ins));
  assert.ok(ins.includes('table:create'), '삽입 탭에 표 만들기');

  // [2026-07-30] 되돌리기·오려두기 묶음은 '편집' 탭에 있고 홈에는 없다(중복 금지 규칙)
  const edit = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '편집')?.click();
    const cmds = [...document.querySelectorAll('.rb-btn[data-cmd]')].map(b => b.dataset.cmd);
    const over = [...document.querySelectorAll('.rb-over-item[data-cmd]')].map(b => b.dataset.cmd);
    return { cmds, over };
  });
  const MOVED = ['edit:undo', 'edit:redo', 'edit:cut', 'edit:copy', 'edit:paste', 'edit:format-copy'];
  console.log('  편집탭:', JSON.stringify(edit.cmds));
  for (const c of MOVED) assert.ok(edit.cmds.includes(c), `편집 탭에 ${c}`);
  assert.ok(edit.cmds.includes('edit:find'), '찾기 계열도 편집 탭으로');

  const home = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '홈')?.click();
    return {
      cmds: [...document.querySelectorAll('.rb-btn[data-cmd], .rb-over-item[data-cmd]')].map(b => b.dataset.cmd),
      // 「⋯」은 오버플로 항목이 있을 때만 그려진다 — 홈은 전부 리본에 꺼냈으므로 없어야 한다
      hasMore: !!document.querySelector('.rb-more'),
      hasExpander: !!document.querySelector('.rb-expander'),
      aligns: [...document.querySelectorAll('.rb-btn[data-cmd^="format:align-"]')].map(b => b.dataset.cmd),
    };
  });
  console.log('  홈탭:', JSON.stringify(home));
  for (const c of MOVED) assert.ok(!home.cmds.includes(c), `홈에는 ${c} 가 남아 있으면 안 됨`);

  // [2026-07-30] 「⋯」에 숨어 있던 4종을 리본으로 꺼냈다
  for (const c of ['format:align-right', 'format:strikethrough', 'format:char-shape', 'format:para-shape']) {
    assert.ok(home.cmds.includes(c), `홈 리본에 ${c}`);
  }
  assert.deepStrictEqual(home.aligns,
    ['format:align-left', 'format:align-center', 'format:align-right', 'format:align-justify'],
    '정렬 4종이 왼쪽·가운데·오른쪽·양쪽 순서로 나란히');
  assert.ok(!home.hasMore, '홈의 「⋯」은 비었으므로 사라져야 함');
  assert.ok(!home.hasExpander, "옛 '자세히' 확장 버튼은 글자 모양 버튼으로 대체됨");
  await screenshot(page, 'ribbon-header');
  // [2026-07-30] 도구 탭 — AI·녹음은 우측 패널을 여는 명령으로 배선
  const tools = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '도구')?.click();
    return [...document.querySelectorAll('.rb-btn[data-cmd]')].map(b => b.dataset.cmd);
  });
  console.log('  도구탭:', JSON.stringify(tools));
  for (const c of ['tool:ai-panel', 'tool:record-panel', 'tool:command-palette', 'tool:options']) {
    assert.ok(tools.includes(c), `도구 탭에 ${c}`);
  }
  // 중복 금지: 도구로 옮긴 것은 옛 자리에 남지 않는다
  const review = await page.evaluate(() => {
    [...document.querySelectorAll('.rb-tab')].find(b => b.textContent === '검토')?.click();
    return [...document.querySelectorAll('.rb-btn[data-cmd], .rb-over-item[data-cmd]')].map(b => b.dataset.cmd);
  });
  assert.ok(!review.includes('edit:spellcheck'), '맞춤법은 도구로 이동');
  assert.ok(!review.includes('tool:options'), '환경 설정은 도구로 이동');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
