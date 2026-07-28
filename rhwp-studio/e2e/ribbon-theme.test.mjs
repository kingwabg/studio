import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';
runTest('리본 우측 유틸 — 인쇄·도움 복귀 + 테마 순환 실동작', async ({ page }) => {
  await createNewDocument(page);
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('.rb-row-tabs .rb-icon-btn')].map(b => b.dataset.cmd ?? b.title));
  console.log('  우측 버튼:', JSON.stringify(btns));
  assert.ok(btns.includes('file:print'), '인쇄 버튼 복귀');
  assert.ok(btns.includes('file:about'), '도움(제품 정보) 버튼 복귀');

  // 테마 순환: system → light → dark → system, 실제 DOM 테마가 바뀌는지
  const seq = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('.rb-row-tabs .rb-icon-btn')].find(b => !b.dataset.cmd);
    const out = [];
    for (let i = 0; i < 3; i++) {
      btn.click();
      await new Promise(r => setTimeout(r, 250));
      out.push({
        mode: window.__theme?.getThemeMode?.() ?? null,
        effective: window.__theme?.getEffectiveTheme?.() ?? null,
        domTheme: document.documentElement.dataset.themeEffective ?? null,
        // 리본이 실제로 어두워졌는가 — 배경 밝기로 판정
        ribbonBg: getComputedStyle(document.querySelector('.ribbon-header')).backgroundColor,
        // 글자/아이콘이 배경에 묻히지 않는가 — 대비를 실측한다
        tabFg: getComputedStyle(document.querySelector('.rb-tab')).color,
        btnFg: getComputedStyle(document.querySelector('.rb-btn')).color,
      });
    }
    return out;
  });
  console.log('  순환:', JSON.stringify(seq));
  assert.deepStrictEqual(seq.map(s => s.mode), ['light', 'dark', 'system'], '테마 모드 순환');
  assert.strictEqual(seq[1].effective, 'dark', '어둡게 선택 시 실제 다크 적용');
  assert.strictEqual(seq[1].domTheme, 'dark', 'DOM 에 data-theme-effective=dark 반영');
  // 리본 배경이 실제로 어두워졌는지(밝기 합 < 300)
  const rgb = seq[1].ribbonBg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
  const sum = rgb[0] + rgb[1] + rgb[2];
  assert.ok(sum < 300, `다크에서 리본 배경이 어두워야 함 (실측 ${seq[1].ribbonBg})`);
  // 대비 판정: 배경과 글자의 밝기 차가 충분한가(단순 합 차 > 250)
  for (const [name, fg] of [['탭', seq[1].tabFg], ['버튼', seq[1].btnFg]]) {
    const f = fg.match(/\d+/g).map(Number);
    const fsum = f[0] + f[1] + f[2];
    assert.ok(Math.abs(fsum - sum) > 250,
      `다크에서 ${name} 글자가 배경에 묻힘 (bg=${seq[1].ribbonBg} fg=${fg})`);
  }
});
