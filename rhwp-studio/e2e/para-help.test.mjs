/**
 * 문단 패널 설명 문구 — "봐도 이해가 안 된다"는 지적(2026-08-01)에 대한 회귀 검사.
 * 문구 정본 = src/ui/text-panel-help.ts.
 *
 * ⚠ 섹션 버튼은 mousedown 으로 전환한다(click 은 안 먹는다 — 실측).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const SECTIONS = ['정렬', '여백·첫 줄', '간격', '문단 종류', '줄 나눔', '탭'];

runTest('문단 패널 설명', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-rail--right *')]
      .find((e) => e.textContent.trim() === '문단' && e.children.length === 0)?.click();
    await new Promise((r) => setTimeout(r, 400));
  });

  const rows = [];
  for (const name of SECTIONS) {
    rows.push(await page.evaluate(async (n) => {
      [...document.querySelectorAll('.canva-sec-btn')].find((x) => x.textContent.trim() === n)
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 350));
      const body = document.querySelector('.tps');
      return {
        sec: n,
        secHint: document.querySelector('.tps-sec-hint')?.textContent ?? '',
        hints: [...document.querySelectorAll('.tps-hint')].length,
        // 한컴 대화상자 단축키 접미사 (K)(N)… 은 패널에서 눌리지 않는다 — 남아 있으면 잡음
        accel: /\([A-Z]\)(?!\s*[:%])/.test(body?.textContent ?? ''),
        // 화면은 textContent 라 마크다운 ** 은 별표로 찍힌다
        star: /\*\*/.test(body?.textContent ?? ''),
        tips: [...document.querySelectorAll('.tps-seg-btn')]
          .filter((b) => b.title && b.title !== b.textContent).length,
        segs: document.querySelectorAll('.tps-seg-btn').length,
      };
    }, name));
  }
  for (const r of rows) {
    console.log(`  ${r.sec}: 섹션설명 ${r.secHint ? '있음' : '없음'} · 행설명 ${r.hints}`
      + ` · 옵션툴팁 ${r.tips}/${r.segs} · 단축키잔재 ${r.accel} · 별표 ${r.star}`);
  }
  for (const r of rows) {
    assert.ok(r.secHint.length > 6, `${r.sec}: 섹션 설명이 있어야 한다`);
    assert.ok(!r.accel, `${r.sec}: 한컴 단축키 접미사가 남으면 안 된다`);
    assert.ok(!r.star, `${r.sec}: 마크다운 별표가 화면에 찍히면 안 된다`);
    if (r.segs > 0) assert.strictEqual(r.tips, r.segs, `${r.sec}: 옵션 전부에 툴팁`);
  }
  // 설명이 실제로 붙는 섹션(정렬은 컨트롤 1개라 섹션 설명만 — 중복 제거)
  const withHints = rows.filter((r) => r.hints > 0).map((r) => r.sec);
  console.log('  행 설명이 붙은 섹션:', JSON.stringify(withHints));
  assert.ok(withHints.length >= 4, '대부분의 섹션에 행 설명이 붙는다');
  assert.strictEqual(rows.find((r) => r.sec === '정렬').hints, 0,
    '정렬은 섹션 설명과 겹쳐 행 설명을 비운다');

  // 체크 항목은 이름 + "무엇을 막는지" 설명이 함께 있어야 한다
  const flags = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-sec-btn')].find((x) => x.textContent.trim() === '문단 종류')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    return [...document.querySelectorAll('.tps-switch-row')].map((r) => ({
      label: r.querySelector('.tps-switch-label')?.textContent ?? '',
      hint: r.querySelector('.tps-hint')?.textContent ?? '',
    }));
  });
  console.log('  체크 항목', flags.length, '개 / 설명 없는 것',
    flags.filter((f) => !f.hint).length, '/ 예:', JSON.stringify(flags[0]));
  assert.ok(flags.length >= 8, '체크 항목 8종');
  assert.strictEqual(flags.filter((f) => !f.hint).length, 0, '체크마다 설명이 붙는다');
  assert.ok(flags.every((f) => !/\([A-Z]\)/.test(f.label)), '체크 이름에 단축키 접미사 없음');
});
