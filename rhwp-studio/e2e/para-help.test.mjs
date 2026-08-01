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
  assert.deepStrictEqual(base.labels,
    ['정렬', '줄 간격', '문단 간격', '첫 줄', '첫 줄 값'],
    '자주 쓰는 것이 한 화면에 (첫 줄 값 포함)');
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
  assert.deepStrictEqual(tabs.back.slice(0, 3), ['정렬', '줄 간격', '문단 간격'], '되돌아온다');

  // ③a 줄 간격 — **한 칸**에서 직접 입력 · ▾ 프리셋 · ▲▼ 조절이 다 된다
  //     (사용자 요청 2026-08-01: "프리셋, 조절, 직접 입력 한번에 되게 — 한컴은 되던데")
  const ls = await page.evaluate(async () => {
    const M = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const box = document.querySelector('.tps-spin--combo');
    if (!box) return { err: '줄 간격 칸이 없다' };
    // 칸이 하나뿐인가 — 드롭다운이 따로 있으면 안 된다
    const extraSelect = !!box.parentElement.querySelector('select');
    const num = box.querySelector('.tps-spin-num');
    const get = () => window.__inputHandler.getParaProperties().lineSpacing;

    // ① 직접 입력
    num.value = '175';
    num.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    const typed = { shown: num.value, engine: get() };

    // ② ▲ 조절
    M(box.querySelectorAll('.tps-spin-arrow')[0]);
    await new Promise((r) => setTimeout(r, 300));
    const stepped = { shown: num.value, engine: get() };

    // ③ ▾ 프리셋
    // ⚠ el.hidden 만 보면 안 된다 — display:flex 가 [hidden] 을 이겨 화면엔 열려
    //   있는데 속성은 true 였다(2026-08-01). **계산된 display** 를 본다.
    const shown = () => getComputedStyle(box.querySelector('.tps-spin-menu')).display !== 'none';
    const openBefore = shown();
    M(box.querySelector('.tps-spin-caret'));
    await new Promise((r) => setTimeout(r, 200));
    const opened = shown();
    const items = [...box.querySelectorAll('.tps-spin-item')].map((b) => b.textContent);
    M([...box.querySelectorAll('.tps-spin-item')].find((b) => b.textContent === '120%'));
    await new Promise((r) => setTimeout(r, 300));
    const picked = { shown: num.value, engine: get(), closed: !shown() };

    // ④ 키보드 위/아래
    num.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { extraSelect, openBefore, typed, stepped, opened, items, picked, byKey: num.value };
  });
  console.log('  ③a 줄 간격:', JSON.stringify(ls));
  assert.ok(!ls.err, ls.err ?? '');
  assert.ok(!ls.extraSelect, '칸이 하나여야 한다 — 드롭다운이 따로 있으면 안 된다');
  assert.deepStrictEqual([ls.typed.shown, ls.typed.engine], ['175', 175], '직접 입력');
  assert.deepStrictEqual([ls.stepped.shown, ls.stepped.engine], ['185', 185], '▲ 로 10%');
  assert.ok(!ls.openBefore, '누르기 전에는 목록이 닫혀 있어야 한다');
  assert.ok(ls.opened && ls.items.includes('120%'), '▾ 로 프리셋이 열린다');
  assert.deepStrictEqual([ls.picked.shown, ls.picked.engine], ['120', 120], '프리셋 선택');
  assert.ok(ls.picked.closed, '고르면 목록이 닫힌다');
  assert.strictEqual(ls.byKey, '130', '입력칸에서 ↑ 로도 조절된다');

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
    // stack 행(줄 간격 등)도 전폭이어야 한다
    const stacks = [...t.querySelectorAll('.tps-row--stack > .tps-spin, .tps-row--stack > .tps-select')]
      .map((e) => { const r = e.getBoundingClientRect();
        return { l: Math.round(r.x - b.x), r: Math.round(r.right - b.x) }; });
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
    return { w, pairs, segs, stacks };
  });
  console.log('  ⑤ 폭', grid.w, '/ 2열 행', JSON.stringify(grid.pairs),
    '/ 전폭 행', JSON.stringify(grid.stacks), '/ 타일 행', JSON.stringify(grid.segs));
  // 줄 간격은 칸 하나로 합쳐져 stack 행이 됐다(2026-08-01) — pair 는 문단 간격·글자 간격·첫 줄 값
  assert.ok(grid.pairs.length >= 2, `2열 값 행이 2종 이상이어야 한다 (${grid.pairs.length})`);
  assert.ok(grid.stacks.length >= 1, '전폭 값 행(줄 간격)이 있어야 한다');
  for (const p of grid.pairs) {
    assert.strictEqual(p.l, 0, '값 행 왼쪽 끝이 0');
    assert.ok(Math.abs(p.r - grid.w) <= 2, `값 행 오른쪽 끝이 패널 끝과 같아야 한다 (${p.r} vs ${grid.w})`);
  }
  for (const st of grid.stacks) {
    assert.strictEqual(st.l, 0, '전폭 행 왼쪽 끝이 0');
    assert.ok(Math.abs(st.r - grid.w) <= 2, `전폭 행 오른쪽 끝이 패널 끝과 같아야 한다 (${st.r})`);
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

  // ⑥ 첫 줄 값 — "들여쓰기·내어쓰기는 내가 조절할 수도 있어야 해"(2026-08-01)
  const ind = await page.evaluate(async () => {
    const M = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // ⑤b 가 「문단 종류」로 옮겨 놨다 — 「자주」로 돌아와서 본다
    [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.textContent.trim() === '자주')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    const row = [...document.querySelectorAll('.tps-row--pair')]
      .find((r) => r.querySelector('.tps-label')?.textContent === '첫 줄 값');
    if (!row) return { err: '첫 줄 값 행이 없다' };
    const offBefore = row.classList.contains('is-off');
    [...document.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent.trim() === '들여쓰기')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const num = row.querySelector('.tps-pill-num');
    const start = num.textContent;
    for (let i = 0; i < 5; i++) M(row.querySelectorAll('.tps-pill-btn')[1]);
    await new Promise((r) => setTimeout(r, 400));
    const plus = { after: num.textContent, indent: window.__inputHandler.getParaProperties().indent };
    // 내어쓰기로 바꾸면 같은 크기가 음수로 간다
    [...document.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent.trim() === '내어쓰기')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return { offBefore, offAfter: row.classList.contains('is-off'), start, ...plus,
      hang: window.__inputHandler.getParaProperties().indent };
  });
  console.log('  ⑥ 첫 줄 값:', JSON.stringify(ind));
  assert.ok(!ind.err, ind.err ?? '');
  assert.ok(ind.offBefore, '보통일 때는 값 조절이 꺼져 있다');
  assert.ok(!ind.offAfter, '들여쓰기를 고르면 값 조절이 켜진다');
  assert.strictEqual(ind.start, '10pt', '기본 10pt');
  assert.strictEqual(ind.after, '15pt', '+ 다섯 번 → 15pt');
  assert.strictEqual(ind.indent, 1500, '엔진에 1500(=15pt)으로 반영');
  assert.ok(ind.hang < 0, '내어쓰기는 음수 — 같은 크기로 방향만 뒤집힌다');
});
