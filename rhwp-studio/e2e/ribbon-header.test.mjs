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
  // 기본 접힘 목록은 DEFAULT_OFF(ribbon-tabs.ts)가 정본 — 한 수준 증가·감소는
  // 2026-08-01 사용자 요청으로 노출로 바뀌었고, 대신 장평 둘이 접힌다
  assert.deepStrictEqual(off.swOff.sort(), ['장평 늘리기', '장평 줄이기', '취소선'],
    '스위치가 접힘 상태를 보여준다');
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
      // 색 피커 두 자리만 본다(스타일·글꼴·크기도 이제 이름을 갖는다 — 2026-08-01)
      labels: ['text-color', 'highlight'].map((n) =>
        document.querySelector(`.rb-slot[data-slot="${n}"] .rb-btn-label`)?.textContent ?? ''),
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

  // ⑤b 「간격」 무리 — 한 수준 증가·감소가 기본 노출이고, 자간이 그 옆에 붙는다
  //     (사용자 요청 2026-08-01: 문단 간격 버튼이니 기존 것과 같이 쓰자)
  const spacing = await page.evaluate(() => {
    localStorage.removeItem('rhwpRibbonHidden');
    return null;
  });
  void spacing;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3500));
  const grp = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.rb-row-ribbon .rb-btn')];
    // ⚠ title 은 이제 설명문이다(자간/장평 차이를 담느라) — 이름은 라벨에서 읽는다
    const name = (b) => b.querySelector('.rb-btn-label')?.textContent ?? '';
    return {
      // 한 수준 증가 다음에 자간 둘이 이어지는가(순서가 곧 '같은 무리'다)
      order: bs.map(name).filter((t) => /한 수준|자간|장평/.test(t)),
      cmds: bs.filter((b) => /자간/.test(name(b))).map((b) => b.dataset.cmd),
      // 자간·장평은 '기능이 비슷하다'는 지적을 받은 자리 — 툴팁이 차이를 설명해야 한다
      hints: bs.filter((b) => /자간|장평/.test(name(b)))
        .map((b) => (b.title.includes('사이') || b.title.includes('글자 자체'))),
    };
  });
  console.log('  ⑤b 간격 무리:', JSON.stringify(grp.order), '/ 명령', JSON.stringify(grp.cmds),
    '/ 툴팁 설명', JSON.stringify(grp.hints));
  assert.deepStrictEqual(grp.order,
    ['한 수준 증가', '한 수준 감소', '자간 줄이기', '자간 늘리기'],
    '한 수준 증가·감소가 기본 노출이고 자간이 옆에 붙는다');
  assert.deepStrictEqual(grp.cmds,
    ['format:char-spacing-decrease', 'format:char-spacing-increase'], '자간 명령 배선');
  assert.ok(grp.hints.length > 0 && grp.hints.every(Boolean),
    '자간·장평 툴팁이 차이(사이 vs 글자 자체)를 설명해야 한다');

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

  // ⑦ 앞머리 다섯 칸의 높이·밑선이 같은가 (사용자 지적 2026-08-01 "높이를 다 동일하게")
  //    실측 전: 스타일 19 · 글꼴 19 · 크기 28 · 글자색 27 · 형광펜 25px
  const heads = await page.evaluate(() => {
    const rows = ['style-name', 'font-name', 'font-size', 'text-color', 'highlight'].map((n) => {
      const el = document.querySelector(`.rb-slot[data-slot="${n}"] .rb-adopted`);
      if (!el) return { n, miss: true };
      const r = el.getBoundingClientRect();
      return { n, h: Math.round(r.height), y: Math.round(r.y), w: Math.round(r.width) };
    });
    const sel = document.querySelector('.rb-slot select#style-name');
    return {
      rows,
      // 네이티브 select 크롬을 끄고 우리 화살표를 단다 — 늘 눌린 단추처럼 보였다
      appearance: sel ? getComputedStyle(sel).appearance : '',
      // 'pt' 가 회색 상자(선택된 글자처럼)로 보이면 안 된다
      unitBg: getComputedStyle(document.querySelector('.rb-slot .sb-size-unit')).backgroundColor,
      unitBorder: getComputedStyle(document.querySelector('.rb-slot .sb-size-unit')).borderTopWidth,
    };
  });
  console.log('  ⑦ 앞머리:', JSON.stringify(heads.rows));
  console.log('     select appearance:', heads.appearance, '/ pt 배경', heads.unitBg, heads.unitBorder);
  const hs = heads.rows.filter((r) => !r.miss);
  assert.strictEqual(hs.length, 5, '앞머리 다섯 칸이 다 있어야 한다');
  const h0 = hs[0].h;
  for (const r of hs) {
    assert.strictEqual(r.h, h0, `${r.n} 높이가 다르다 (${r.h} vs ${h0})`);
    assert.strictEqual(r.y, hs[0].y, `${r.n} 윗선이 어긋난다`);
  }
  assert.strictEqual(heads.appearance, 'none', 'select 는 네이티브 크롬을 끈다');
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(heads.unitBg), "'pt' 에 배경이 없어야 한다");
  assert.strictEqual(heads.unitBorder, '0px', "'pt' 에 테두리가 없어야 한다");
  // 스타일 이름이 잘리지 않는가 — 구 서식바가 #style-name 에 60px 를 박아 뒀었다
  const styleW = hs.find((r) => r.n === 'style-name').w;
  console.log('     스타일 칸 폭:', styleW);
  assert.ok(styleW >= 100, `스타일 칸이 좁아 이름이 잘린다 (${styleW}px)`);

  // ⑧ 스타일 아이콘 — 콤보 옆에서 기존 스타일 모달(F6)을 연다(사용자 요청 2026-08-01)
  const st = await page.evaluate(async () => {
    const names = [...document.querySelectorAll('.rb-row-ribbon .rb-btn-label')].map((e) => e.textContent);
    document.querySelector('[data-cmd="format:style-dialog"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 800));
    const title = document.querySelector('.dialog-wrap .dialog-title')?.textContent?.trim() ?? '';
    document.querySelector('.dialog-wrap .dialog-btn:not(.dialog-btn-primary)')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { has: names.includes('스타일 설정'), title };
  });
  console.log('  ⑧ 스타일 설정 버튼:', st.has, '/ 모달:', st.title);
  assert.ok(st.has, '리본에 스타일 설정 아이콘이 있어야 한다');
  assert.ok(st.title.includes('스타일'), '기존 스타일 모달이 열려야 한다');

  // ⑨ 「⋯ 편집」에 리본의 **모든** 항목(버튼 + 칸)이 들어 있고 칸도 켜고 끌 수 있다
  //    (사용자 요청 2026-08-01 "새로 추가된 기능들을 편집에 토글 방식 다 넣자")
  //    ⚠ ⋯ 버튼과 목록 행은 click 이다(mousedown 아님 — 실측).
  const tog = await page.evaluate(async () => {
    document.querySelector('.rb-more').click();
    await new Promise((r) => setTimeout(r, 400));
    const list = [...document.querySelectorAll('.rb-edit-item .rb-over-label')].map((e) => e.textContent);
    const row = [...document.querySelectorAll('.rb-edit-item')]
      .find((e) => e.querySelector('.rb-over-label').textContent === '스타일');
    if (!row) return { list, err: '칸(스타일)이 목록에 없다' };
    row.click();
    await new Promise((r) => setTimeout(r, 400));
    const gone = !document.querySelector('.rb-slot[data-slot="style-name"]');
    row.click();
    await new Promise((r) => setTimeout(r, 400));
    return { list, gone, back: !!document.querySelector('.rb-slot[data-slot="style-name"]') };
  });
  console.log('  ⑨ 편집 목록', tog.list.length, '개 / 칸 끄기', tog.gone, '켜기', tog.back);
  assert.ok(!tog.err, tog.err ?? '');
  for (const n of ['되돌리기', '스타일', '스타일 설정', '글꼴', '크기', '글자 색', '형광펜', '자간 줄이기'])
    assert.ok(tog.list.includes(n), `${n} 이 편집 목록에 있어야 한다`);
  assert.ok(tog.gone && tog.back, '칸(콤보·피커)도 켜고 끌 수 있어야 한다');
});
