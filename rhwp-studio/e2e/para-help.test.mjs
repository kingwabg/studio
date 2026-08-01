/**
 * 문단 패널 — 「자주」 한 화면 + 탭 4개 항상 노출 + 탭 줄 오른쪽 [설명] 토글.
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
      secs: [...document.querySelectorAll('.canva-sec-btn')].map((b) => b.textContent.trim()),
      adv: !!document.querySelector('.canva-adv-toggle'),
      // 탭 4개 + [설명] 이 **한 줄**인가 — y 좌표는 정렬 방식에 따라 다르므로
      // 줄 전체 높이로 본다(한 줄 ≈ 65px, 두 줄이면 100px 을 넘는다)
      rowH: Math.round(document.querySelector('.canva-sec-row').getBoundingClientRect().height),
      // [설명]의 세로 중심이 탭 줄 안에 있나
      helpInRow: (() => {
        const r = document.querySelector('.canva-sec-row').getBoundingClientRect();
        const h = document.querySelector('.canva-help-btn').getBoundingClientRect();
        return h.top >= r.top - 1 && h.bottom <= r.bottom + 1;
      })(),
      // 좁은 줄에서 '설 명' 으로 접히지 않는가
      helpH: Math.round(document.querySelector('.canva-help-btn').getBoundingClientRect().height),
      // 설명을 꺼도 툴팁으로는 읽을 수 있어야 한다
      tips: [...t.querySelectorAll('.tps-seg-btn')].filter((b) => b.title && b.title !== b.textContent).length,
      segs: t.querySelectorAll('.tps-seg-btn').length,
    };
  });
  console.log('  ① 높이', base.h, '/ 화면', base.view, '/ 설명', base.hints,
    '/ 탭', JSON.stringify(base.secs), '/ 줄높이', base.rowH, `(설명 ${base.helpH}px, 줄 안 ${base.helpInRow})`,
    '/ 항목', JSON.stringify(base.labels), '/ 툴팁', `${base.tips}/${base.segs}`);
  assert.ok(base.h <= base.view, `스크롤 없이 다 보여야 한다 (${base.h} > ${base.view})`);
  assert.strictEqual(base.hints, 0, '기본은 설명 꺼짐');
  assert.deepStrictEqual(base.secs, ['자주', '문단 종류', '줄 나눔', '탭'],
    '탭 4개는 늘 보인다 — 접지 않는다');
  assert.ok(!base.adv, '「자세히」 접기는 없앴다');
  assert.ok(base.rowH <= 80, `탭 줄이 한 줄이어야 한다 (h=${base.rowH})`);
  assert.ok(base.helpInRow, '[설명]이 탭 줄 안에 있어야 한다 — 따로 한 줄을 먹으면 안 된다');
  assert.ok(base.helpH <= 26, `[설명]이 두 줄로 접히면 안 된다 (h=${base.helpH})`);
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

  // ③ 탭 전환 — 접기 없이 바로 오갈 수 있다
  const tabs = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === '줄 나눔')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    const inAdv = [...document.querySelectorAll('.tps-label')].map((e) => e.textContent.trim());
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === '자주')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    return { inAdv, back: [...document.querySelectorAll('.tps-label')].map((e) => e.textContent.trim()) };
  });
  console.log('  ③ 줄 나눔:', JSON.stringify(tabs.inAdv), '→ 자주:', JSON.stringify(tabs.back));
  assert.deepStrictEqual(tabs.inAdv, ['한글', '영어'], '탭을 눌러 바로 옮겨간다');
  assert.deepStrictEqual(tabs.back, ['정렬', '줄 간격', '문단 간격', '첫 줄'], '되돌아온다');

  // ③a 줄 간격 — 프리셋 드롭다운 + 조절 버튼이 한 줄에서 값을 공유한다
  const ls = await page.evaluate(async () => {
    const sel = document.querySelector('.tps-select--mini');
    if (!sel) return { err: '드롭다운 없음' };
    const box = sel.parentElement.querySelector('.tps-pill-stepper');
    const num = box.querySelector('.tps-pill-num');
    const before = num.textContent;
    sel.value = '120';
    sel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    const afterSel = num.textContent;
    box.querySelectorAll('.tps-pill-btn')[1]
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    return {
      opts: [...sel.options].map((o) => o.textContent),
      before, afterSel, afterStep: num.textContent,
      // 조절로 목록에 없는 값이 되면 드롭다운도 그 값을 보여야 한다(거짓말 금지)
      selShows: sel.options[sel.selectedIndex].textContent,
      sameLine: new Set([sel, box].map((e) => Math.round(e.getBoundingClientRect().y / 4))).size === 1,
    };
  });
  console.log('  ③a 줄 간격:', JSON.stringify(ls));
  assert.deepStrictEqual(ls.opts.slice(0, 6), ['10%', '25%', '50%', '80%', '100%', '120%'],
    '요청한 프리셋 6종이 앞에 온다');
  assert.strictEqual(ls.afterSel, '120%', '드롭다운으로 고르면 값이 바뀐다');
  assert.strictEqual(ls.afterStep, '130%', '+ 로 10%씩 조절된다');
  assert.strictEqual(ls.selShows, '130%', '조절한 값을 드롭다운도 보여준다');
  assert.ok(ls.sameLine, '드롭다운과 조절 버튼이 한 줄에');

  // ③b 자간·장평 — 「자주」에 있고 실제로 값이 바뀐다(사용자 요청 2026-08-01)
  const sp = await page.evaluate(async () => {
    const wrap = [...document.querySelectorAll('.tps-mini')].filter((e) =>
      ['자간', '장평'].includes(e.querySelector('.tps-mini-label')?.textContent ?? ''));
    if (wrap.length !== 2) return { n: wrap.length };
    const before = wrap.map((w) => w.querySelector('.tps-pill-num').textContent);
    const md = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    md(wrap[0].querySelectorAll('.tps-pill-btn')[1]);
    md(wrap[0].querySelectorAll('.tps-pill-btn')[1]);
    md(wrap[1].querySelectorAll('.tps-pill-btn')[0]);
    await new Promise((r) => setTimeout(r, 300));
    return {
      n: 2, before, after: wrap.map((w) => w.querySelector('.tps-pill-num').textContent),
      sameLine: new Set(wrap.map((w) => Math.round(w.getBoundingClientRect().y / 4))).size === 1,
    };
  });
  console.log('  ③b 자간·장평:', JSON.stringify(sp));
  assert.strictEqual(sp.n, 2, '자간·장평이 「자주」에 있다');
  assert.deepStrictEqual(sp.before, ['0%', '100%'], '초기값');
  assert.deepStrictEqual(sp.after, ['2%', '99%'], '± 로 값이 바뀐다');
  assert.ok(sp.sameLine, '둘이 한 줄에 나란히');

  // ④ 옵션 그림은 그대로 살아 있다(눌리면 안 된다)
  const g = await page.evaluate(() => {
    const s = document.querySelector('.tps-seg-btn svg.tps-glyph');
    return { n: document.querySelectorAll('.tps-seg-btn svg.tps-glyph').length,
      h: s ? Math.round(s.getBoundingClientRect().height) : -1 };
  });
  console.log('  ④ 그림', g.n, '개 (h=' + g.h + ')');
  assert.strictEqual(g.n, 9, '정렬 6 + 첫 줄 3');
  assert.ok(g.h >= 12, '그림이 세로로 눌리면 안 된다');

  // ⑤ 정렬선 — 값 행의 왼쪽·오른쪽 끝이 한 선에 서는가(사용자 지적 2026-08-01:
  //    "위치가 너무 어지러워"). 실측 전: 값 행이 154·178·198 에서 제각각 끝났다.
  const grid = await page.evaluate(async () => {
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === '자주')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    const t = document.querySelector('.tps');
    const b = t.getBoundingClientRect();
    const w = Math.round(b.width);
    // 값 행(2열 격자)의 두 칸이 좌우 끝에 붙는가
    const pairs = [...t.querySelectorAll('.tps-row--pair')].map((row) => {
      const cells = [...row.children].filter((c) => !c.classList.contains('tps-label')
        && !c.classList.contains('tps-hint'));
      if (cells.length < 2) return null;
      const a = cells[0].getBoundingClientRect();
      const z = cells[cells.length - 1].getBoundingClientRect();
      return { l: Math.round(a.x - b.x), r: Math.round(z.right - b.x) };
    }).filter(Boolean);
    // 타일 행(정렬·첫 줄)은 전폭
    const segs = [...t.querySelectorAll('.tps-seg')].map((e) => {
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.x - b.x), r: Math.round(r.right - b.x) };
    });
    return { w, pairs, segs };
  });
  console.log('  ⑤ 폭', grid.w, '/ 값 행', JSON.stringify(grid.pairs), '/ 타일 행', JSON.stringify(grid.segs));
  assert.ok(grid.pairs.length >= 3, '값 행 3종(줄 간격·문단 간격·글자 간격)');
  for (const p of grid.pairs) {
    assert.strictEqual(p.l, 0, '값 행 왼쪽 끝이 0');
    assert.ok(Math.abs(p.r - grid.w) <= 2, `값 행 오른쪽 끝이 패널 끝과 같아야 한다 (${p.r} vs ${grid.w})`);
  }
  for (const g of grid.segs) {
    assert.strictEqual(g.l, 0, '타일 행 왼쪽 끝이 0');
    assert.ok(Math.abs(g.r - grid.w) <= 2, '타일 행 오른쪽 끝이 패널 끝과 같아야 한다');
  }

  // ⑤b 옵션 열 수 — 4개를 3열에 넣으면 하나가 혼자 떨어진다
  const cols = await page.evaluate(async () => {
    const out = {};
    for (const n of ['자주', '문단 종류']) {
      [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === n)
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 350));
      out[n] = [...document.querySelectorAll('.tps-seg')].map((e) => ({
        n: e.children.length,
        cols: getComputedStyle(e).gridTemplateColumns.split(' ').length,
      }));
    }
    return out;
  });
  console.log('  ⑤b 열 수:', JSON.stringify(cols));
  for (const [sec, list] of Object.entries(cols)) {
    for (const g of list) {
      assert.strictEqual(g.n % g.cols, 0,
        `${sec}: 옵션 ${g.n}개를 ${g.cols}열에 넣으면 마지막 줄이 빈다`);
    }
  }
});
