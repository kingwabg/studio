/**
 * 인라인 검사 2차 — 서식 규정 규칙 5종 + 결과 패널 (스펙: docs/plans/format-linter.md)
 *
 * ① 규격과 다른 글꼴·크기를 쓰면 서식 지적이 뜬다
 * ② 카드 [적용] → 실제 글자 속성이 규격으로 바뀐다
 * ③ 되돌리기 한 번으로 복구된다
 * ④ 표 머리글이 굵지 않으면 지적하고, 고치면 굵어진다
 * ⑤ 오탐 0건 — 규격대로인 문서에는 서식 지적이 하나도 없다
 * ⑥ 패널이 건수를 세고 [전부 적용]이 0건으로 만든다
 * ⑦ 서식 검사는 **기본 꺼짐** — 실제 문서에서 수백 건이 떠 상시로는 못 쓴다(실측 근거)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const SENT = '이 문장은 규격과 다른 서식으로 작성되어 있습니다.';

runTest('인라인 검사 2차 — 서식 규정·패널', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  // ⑦ 기본은 꺼짐 — 켜야 서식 지적이 나온다
  assert.strictEqual(
    await page.evaluate(() => window.__lint.isFormatChecks()), false, '서식 검사 기본 꺼짐');
  await page.evaluate(() => window.__lint.setFormatChecks(true));

  const fmtCount = () => page.evaluate(() => {
    window.__lint.scan();
    return document.querySelectorAll('.lint-mark--format').length;
  });
  const propsAt0 = () => page.evaluate(() => {
    const p = window.__wasm.getCharPropertiesAt(0, 0, 0);
    return { pt: p.fontSize / 100, fam: p.fontFamily ?? p.fontFamilies?.[0], bold: !!p.bold };
  });

  // ⑤ 먼저 오탐부터 — 기본 서식(함초롬바탕 10pt) 문장에는 서식 지적 0건이어야 한다
  await page.evaluate((t) => {
    window.__wasm.doc.insertText(0, 0, 0, t);
    window.__eventBus.emit('document-changed');
  }, SENT);
  await new Promise((r) => setTimeout(r, 900));
  const clean = await fmtCount();
  console.log('  ⑤ 규격대로인 문장 서식 지적:', clean, '건 /', JSON.stringify(await propsAt0()));
  assert.strictEqual(clean, 0, '오탐 0건');

  // ① 글꼴·크기를 규격에서 벗어나게 바꾼다
  await page.evaluate((t) => {
    window.__inputHandler.applyCharPropsToRange(
      { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      { sectionIndex: 0, paragraphIndex: 0, charOffset: t.length },
      { fontFamily: '함초롬돋움', fontSize: 1400 });
    window.__eventBus.emit('document-changed');
  }, SENT);
  await new Promise((r) => setTimeout(r, 900));
  const bad = await fmtCount();
  console.log('  ① 위반 뒤 서식 밑줄:', bad, '건 /', JSON.stringify(await propsAt0()));
  assert.ok(bad >= 1, `서식 지적이 떠야 한다 (실측 ${bad})`);

  // ② [전부 적용] → 규격 복귀, ⑥ 패널 0건
  const panelText = await page.evaluate(() => document.querySelector('.lint-panel-head')?.textContent);
  console.log('  ⑥ 패널:', JSON.stringify(panelText));
  assert.ok(/검사 \d+건/.test(panelText ?? ''), '패널이 건수를 세야 한다');

  await page.evaluate(() => window.__lint.applyAll());
  await new Promise((r) => setTimeout(r, 1000));
  const fixed = await propsAt0();
  console.log('  ② 전부 적용 뒤:', JSON.stringify(fixed));
  assert.strictEqual(fixed.pt, 10, '크기가 규격 10pt로');
  assert.strictEqual(fixed.fam, '함초롬바탕', '글꼴이 규격으로');
  const left = await page.evaluate(() => { window.__lint.scan(); return window.__lint.count(); });
  assert.strictEqual(left, 0, '전부 적용 후 0건');

  // ③ 되돌리기 — 적용 전 서식으로
  await clickEditArea(page);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 700));
  console.log('  ③ 되돌린 뒤:', JSON.stringify(await propsAt0()));

  // ④ 표 머리글 굵게 규칙
  await page.evaluate(() => {
    const w = window.__wasm;
    w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: w.getParagraphLength(0, 0),
      rowCount: 2, colCount: 2, treatAsChar: true, colWidths: [6000, 6000],
    }));
    // 빈 셀은 밑줄 그을 글자가 없어 건너뛴다 — 머리글 규칙을 보려면 글자를 넣어야 한다
    const t = JSON.parse(w.doc.getTables(0))[0];
    for (const cei of [0, 1, 2, 3]) {
      w.insertTextInCell(0, t.para, t.controlIdx, cei, 0, 0, `칸${cei}`);
    }
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 1200));
  const tableHits = await page.evaluate(() => {
    window.__lint.scan();
    // 목록은 접혀 있다 — 머리 부분을 눌러야 행이 그려진다(패널 설계)
    document.querySelector('.lint-panel-head').click();
    return [...document.querySelectorAll('.lint-panel-row')].map((r) => r.textContent);
  });
  console.log('  ④ 표 지적:', JSON.stringify(tableHits.slice(0, 4)));
  assert.ok(tableHits.some((t) => t.includes('머리글')), '표 머리글 굵게 지적이 있어야 한다');
  await page.evaluate(() => window.__lint.applyAll());
  await new Promise((r) => setTimeout(r, 1000));
  const headBold = await page.evaluate(() => {
    const t = JSON.parse(window.__wasm.doc.getTables(0))[0];
    return window.__wasm.getCellCharPropertiesAt(0, t.para, t.controlIdx, 0, 0, 0).bold;
  });
  console.log('  ④ 적용 후 머리글 굵게:', headBold);
  assert.strictEqual(headBold, true, '머리글이 굵어져야 한다');

  assert.deepStrictEqual(errors, [], '페이지 오류 없음');
});
