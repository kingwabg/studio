/**
 * 리본 헤더 재설계(디자인 2a) — 2행 106px · 모든 버튼에 이름 · 「⋯ 편집」 탭별 켜고 끄기.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('리본 헤더', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // ① 치수 + 모든 버튼에 이름
  const m = await page.evaluate(() => {
    localStorage.removeItem('rhwpRibbonHidden');
    const h = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
    const btns = [...document.querySelectorAll('.rb-row-ribbon .rb-btn')];
    return {
      header: h('.ribbon-header'), ribbon: h('.rb-row-ribbon'),
      tile: Math.round(btns[0].getBoundingClientRect().height),
      noLabel: btns.filter((b) => !b.querySelector('.rb-btn-label')?.textContent).length,
      count: btns.length,
    };
  });
  console.log('  ① 헤더', m.header, '/ 리본', m.ribbon, '/ 타일', m.tile, '/ 버튼', m.count, '/ 이름없음', m.noLabel);
  assert.strictEqual(m.header, 106, '헤더 106px');
  assert.strictEqual(m.ribbon, 62, '리본 62px');
  assert.strictEqual(m.tile, 50, '타일 50px');
  assert.strictEqual(m.noLabel, 0, '이름 없는 버튼이 없어야 한다');

  // ② 기본으로 접힌 명령은 리본에 없고 「편집」 패널에는 있다
  const off = await page.evaluate(async () => {
    const lbl = () => [...document.querySelectorAll('.rb-row-ribbon .rb-btn .rb-btn-label')].map((x) => x.textContent);
    const before = lbl();
    document.querySelector('.rb-more').click();
    await new Promise((r) => setTimeout(r, 200));
    const inPanel = [...document.querySelectorAll('.rb-edit-item .rb-over-label')].map((x) => x.textContent);
    const folded = [...document.querySelectorAll('.rb-editpanel > .rb-over-item .rb-over-label')].map((x) => x.textContent);
    const swOff = [...document.querySelectorAll('.rb-edit-item')]
      .filter((r) => !r.querySelector('.rb-edit-switch').classList.contains('is-on'))
      .map((r) => r.querySelector('.rb-over-label').textContent);
    return { before, inPanel, folded, swOff };
  });
  console.log('  ② 리본에 없음:', !off.before.includes('취소선'), '/ 접힘 목록:', JSON.stringify(off.folded),
    '/ 스위치 꺼짐:', JSON.stringify(off.swOff));
  assert.ok(!off.before.includes('취소선'), '기본 접힘은 리본에 없다');
  assert.ok(off.folded.includes('취소선'), '접힌 명령이 패널 위쪽에 나온다');
  assert.deepStrictEqual(off.swOff.sort(), ['취소선', '한 수준 감소', '한 수준 증가'], '스위치가 접힘 상태를 보여준다');
  assert.ok(off.inPanel.includes('취소선') && off.inPanel.includes('굵게'), '탭의 모든 버튼이 목록에 있다');

  // ③ 켜면 리본에 즉시 나타나고 저장된다
  const on = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.rb-edit-item')]
      .find((r) => r.querySelector('.rb-over-label').textContent === '취소선');
    row.click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      inRibbon: [...document.querySelectorAll('.rb-row-ribbon .rb-btn-label')].map((x) => x.textContent).includes('취소선'),
      stored: JSON.parse(localStorage.getItem('rhwpRibbonHidden')).home,
      panelStillOpen: !!document.querySelector('.rb-editpanel'),
    };
  });
  console.log('  ③ 켠 뒤 리본에:', on.inRibbon, '/ 저장:', JSON.stringify(on.stored), '/ 패널 유지:', on.panelStillOpen);
  assert.ok(on.inRibbon, '켜면 리본에 나타난다');
  assert.ok(!on.stored.includes('취소선'), '저장에서 빠진다');
  assert.ok(on.panelStillOpen, '연달아 고르게 패널은 열려 있다');

  // ④ 기본값으로 되돌리기
  const reset = await page.evaluate(async () => {
    document.querySelector('.rb-edit-reset').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      stored: JSON.parse(localStorage.getItem('rhwpRibbonHidden')).home,
      inRibbon: [...document.querySelectorAll('.rb-row-ribbon .rb-btn-label')].map((x) => x.textContent).includes('취소선'),
    };
  });
  console.log('  ④ 기본값 후 저장:', JSON.stringify(reset.stored), '/ 리본에:', reset.inRibbon);
  assert.ok(reset.stored.includes('취소선') && !reset.inRibbon, '기본값으로 복귀');

  // ⑤ 색 피커 타일 — 한컴식 글리프('간'·✏)를 Phosphor 아이콘 + 색 막대로 갈아끼웠다.
  //    아이콘만 바꾸고 동작(팔레트 열기)이 죽으면 최악이라 클릭까지 본다.
  const color = await page.evaluate(async () => {
    const q = (s2) => document.querySelector(s2);
    const rect = (s2) => { const e = q(s2); const r = e.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`; };
    // 옛 글리프는 **리본 안**에서만 없으면 된다(숨은 구 서식바의 밑줄 '간' 은 그대로 산다)
    const legacy = /(?:>간<|>✏<)/.test(document.querySelector('.rb-row-ribbon').innerHTML);
    // 형광펜 버튼은 mousedown 으로 연다(click 은 안 먹는다 — 실측)
    q('#btn-highlight').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));
    const opened = q('#highlight-dropdown').classList.contains('open');
    q('#btn-highlight').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return {
      icons: [...document.querySelectorAll('.rb-slot.has-label .rb-adopt-ic')].map((i) =>
        Array.from(i.classList).find((c) => c.startsWith('ph-') && !/duotone|regular|fill|bold/.test(c))),
      bar: rect('#color-bar'),
      caret: getComputedStyle(q('.rb-slot.has-label .sb-dd')).display,
      labels: [...document.querySelectorAll('.rb-slot.has-label .rb-btn-label')].map((x) => x.textContent),
      legacyGlyph: legacy,
      opened,
    };
  });
  console.log('  ⑤ 아이콘', JSON.stringify(color.icons), '/ 막대', color.bar, '/ ▾', color.caret,
    '/ 이름', JSON.stringify(color.labels), '/ 옛 글리프', color.legacyGlyph, '/ 팔레트 열림', color.opened);
  assert.deepStrictEqual(color.icons, ['ph-palette', 'ph-highlighter'], 'Phosphor 아이콘으로 교체');
  assert.strictEqual(color.bar, '17x3', '색 막대 17×3px (디자인 2a)');
  assert.strictEqual(color.caret, 'none', '타일 안 ▾ 는 감춘다');
  assert.deepStrictEqual(color.labels, ['글자 색', '형광펜'], '이름이 붙는다');
  assert.ok(!color.legacyGlyph, "리본 안에 옛 글리프('간'·✏)가 남아 있지 않다");
  assert.ok(color.opened, '아이콘만 바뀌고 팔레트 동작은 산다');

  // ⑥ 우측 패널이 헤더와 같은 면인가 + 손잡이가 패널 **바깥**인가 (사용자 요청 2026-08-01)
  const panel = await page.evaluate(async () => {
    const g = document.querySelector('.canva-rail-grip');
    const rail = document.querySelector('.canva-rail--right');
    const cs = (e, k) => getComputedStyle(e)[k];
    const w0 = Math.round(rail.getBoundingClientRect().width);
    return {
      bgSame: cs(document.querySelector('.ribbon-header'), 'backgroundColor')
        === cs(rail, 'backgroundColor'),
      borderSame: cs(document.querySelector('.rb-row-tabs'), 'borderBottomColor')
        === cs(rail, 'borderLeftColor'),
      gripOutside: g.getBoundingClientRect().right <= rail.getBoundingClientRect().x + 1,
      gripWidth: Math.round(g.getBoundingClientRect().width),
      w0,
    };
  });
  console.log('  ⑥ 배경 동일', panel.bgSame, '/ 경계 동일', panel.borderSame,
    '/ 손잡이 바깥', panel.gripOutside, `(${panel.gripWidth}px)`, '/ 패널', panel.w0);
  assert.ok(panel.bgSame, '패널 배경이 헤더와 같다');
  assert.ok(panel.borderSame, '패널 경계선이 헤더와 같다');
  assert.ok(panel.gripOutside, '손잡이가 패널 안쪽 컨트롤을 덮지 않는다');

  // 손잡이로 폭이 실제로 바뀐다 — 위치만 옮기고 기능이 죽으면 최악
  const gp = await page.evaluate(() => {
    const r = document.querySelector('.canva-rail-grip').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await page.mouse.move(gp.x, gp.y);
  await page.mouse.down();
  await page.mouse.move(gp.x - 60, gp.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const w1 = await page.evaluate(() =>
    Math.round(document.querySelector('.canva-rail--right').getBoundingClientRect().width));
  console.log('  ⑥ 드래그', panel.w0, '→', w1);
  assert.ok(w1 > panel.w0 + 30, '왼쪽으로 끌면 패널이 넓어진다');
});
