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
});
