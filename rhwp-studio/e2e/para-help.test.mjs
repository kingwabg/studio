/**
 * 문단 패널 — 「자주」 한 화면 + 설명 토글 + 「자세히」 접기.
 * (사용자 결정 2026-08-01: 설명이 많아 보기 불편하고 섹션을 오가는 조작도 불편하다)
 *
 * ⚠ 섹션·토글 버튼은 mousedown 으로 동작한다(click 은 안 먹는다 — 실측).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const md = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

runTest('문단 패널', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(async () => {
    localStorage.removeItem('rhwpParaHelp');
    [...document.querySelectorAll('.canva-rail--right *')]
      .find((e) => e.textContent.trim() === '문단' && e.children.length === 0)?.click();
    await new Promise((r) => setTimeout(r, 500));
  });

  // ① 기본: 설명 꺼짐 · 자주 한 화면 · 스크롤 없음 · 섹션 줄 감춤
  const base = await page.evaluate(() => {
    const t = document.querySelector('.tps');
    const labels = [...t.querySelectorAll('.tps-label')].map((e) => e.textContent.trim());
    return {
      h: Math.round(t.scrollHeight),
      view: Math.round(document.querySelector('.canva-rail-content').getBoundingClientRect().height),
      hints: t.querySelectorAll('.tps-hint, .tps-sec-hint').length,
      labels,
      strip: document.querySelectorAll('.canva-sec-btn').length,
      adv: !!document.querySelector('.canva-adv-toggle'),
      // 설명을 꺼도 툴팁으로는 읽을 수 있어야 한다
      tips: [...t.querySelectorAll('.tps-seg-btn')].filter((b) => b.title && b.title !== b.textContent).length,
      segs: t.querySelectorAll('.tps-seg-btn').length,
    };
  });
  console.log('  ① 높이', base.h, '/ 화면', base.view, '/ 설명', base.hints,
    '/ 섹션버튼', base.strip, '/ 항목', JSON.stringify(base.labels), '/ 툴팁', `${base.tips}/${base.segs}`);
  assert.ok(base.h <= base.view, `스크롤 없이 다 보여야 한다 (${base.h} > ${base.view})`);
  assert.strictEqual(base.hints, 0, '기본은 설명 꺼짐');
  assert.strictEqual(base.strip, 0, '고를 게 하나뿐이면 섹션 줄을 감춘다');
  assert.deepStrictEqual(base.labels, ['정렬', '줄 간격', '문단 간격', '첫 줄'],
    '자주 쓰는 넷이 한 화면에');
  assert.strictEqual(base.tips, base.segs, '설명을 꺼도 툴팁은 살아 있다');

  // ② [설명] 토글 — 켜면 문구가 붙고, 기억된다
  const on = await page.evaluate(async () => {
    document.querySelector('.canva-help-btn').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    return {
      hints: document.querySelectorAll('.tps-hint, .tps-sec-hint').length,
      stored: localStorage.getItem('rhwpParaHelp'),
      isOn: document.querySelector('.canva-help-btn').classList.contains('is-on'),
    };
  });
  console.log('  ② 설명 켬 →', on.hints, '개 / 저장', on.stored, '/ 버튼 켜짐', on.isOn);
  assert.ok(on.hints > 0 && on.isOn && on.stored === '1', '설명이 켜지고 기억된다');

  const off = await page.evaluate(async () => {
    document.querySelector('.canva-help-btn').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelectorAll('.tps-hint, .tps-sec-hint').length;
  });
  console.log('  ② 설명 끔 →', off, '개');
  assert.strictEqual(off, 0, '다시 끄면 사라진다');

  // ③ 「자세히」 — 펴면 고급 섹션이 나오고, 접으면 「자주」로 돌아온다
  const adv = await page.evaluate(async () => {
    document.querySelector('.canva-adv-toggle').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    const secs = [...document.querySelectorAll('.canva-sec-btn')].map((b) => b.textContent.trim());
    // 고급 섹션으로 옮겨 간 뒤 접는다 — 빈 화면이 되면 안 된다
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === '줄 나눔')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    const inAdv = [...document.querySelectorAll('.tps-label')].map((e) => e.textContent.trim());
    document.querySelector('.canva-adv-toggle').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { secs, inAdv, back: [...document.querySelectorAll('.tps-label')].map((e) => e.textContent.trim()) };
  });
  console.log('  ③ 폄:', JSON.stringify(adv.secs), '/ 줄 나눔:', JSON.stringify(adv.inAdv),
    '/ 접은 뒤:', JSON.stringify(adv.back));
  assert.deepStrictEqual(adv.secs, ['자주', '문단 종류', '줄 나눔', '탭'], '고급 3종이 나온다');
  assert.deepStrictEqual(adv.inAdv, ['한글', '영어'], '고급 섹션으로 전환된다');
  assert.deepStrictEqual(adv.back, ['정렬', '줄 간격', '문단 간격', '첫 줄'],
    '접으면 「자주」로 돌아온다 — 빈 화면이 되면 안 된다');

  // ④ 옵션 그림은 그대로 살아 있다(눌리면 안 된다)
  const g = await page.evaluate(() => {
    const s = document.querySelector('.tps-seg-btn svg.tps-glyph');
    return { n: document.querySelectorAll('.tps-seg-btn svg.tps-glyph').length,
      h: s ? Math.round(s.getBoundingClientRect().height) : -1 };
  });
  console.log('  ④ 그림', g.n, '개 (h=' + g.h + ')');
  assert.strictEqual(g.n, 9, '정렬 6 + 첫 줄 3');
  assert.ok(g.h >= 12, '그림이 세로로 눌리면 안 된다');
});
