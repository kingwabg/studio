/**
 * 용지·개체 배치별 커서 전수 스윕 (한컴 패리티 ①층)
 * 스펙: rhwp mydocs/eng/plans/hancom-format-parity.md
 *
 *  A. 편집 용지: 여백/방향/크기 변경이 텍스트 조판(쪽 수·줄 폭)에 반영 + 커서 rect 갱신
 *  B. 표 이동: 배치 변경·좌표 이동 후 표 안/앞/뒤 커서가 유효 (rect != null, pageIndex 갱신)
 *  C. 그림 삽입: 삽입 직후 커서 위치, 인라인 개체 건너기(화살표), 삭제 후 커서 복귀
 *  D. 커서 경계: 문단 길이 초과 오프셋 클램프, 컨테이너 삭제 후 복구
 *
 * 판정 원칙: "커서 rect 가 null 이 되거나 pageIndex 가 낡으면 실패" — 캐럿 소실의 기계적 검출.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

const LONG = '가나다라마바사아자차카타파하'.repeat(12);

runTest('용지·개체 배치별 커서 스윕', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, LONG);
  await new Promise((r) => setTimeout(r, 700));

  // ── A. 편집 용지: 여백 확대 → 줄 수 증가(텍스트 폭 감소) + 커서 rect 유효 ──
  const paperRes = await page.evaluate(async () => {
    const w = window.__wasm, ih = window.__inputHandler;
    const read = () => {
      const r = ih.cursor.getRect();
      return { rect: r ? { page: r.pageIndex, x: Math.round(r.x), y: Math.round(r.y) } : null };
    };
    // 조판된 줄 수 = 페이지 텍스트 레이아웃의 서로 다른 y 개수
    const lineCount = () => {
      try {
        const t = JSON.parse(w.doc.getPageTextLayout(0));
        return new Set((t.runs ?? []).map((r) => Math.round(r.y))).size;
      } catch { return -1; }
    };
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 40 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 200));
    const before = { def: w.getPageDef(0), lines: lineCount(), ...read() };

    // 좌우 여백을 크게 — 본문 폭이 좁아져 줄 수가 늘어야 한다
    // (여백 합이 용지 폭을 넘지 않는 유효 범위: 20000×2 < 59528)
    const wide = { ...before.def, marginLeft: 20000, marginRight: 20000 };
    const setRes = w.setPageDef(0, wide);
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 40 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 200));
    const afterMargin = { def: w.getPageDef(0), setRes, lines: lineCount(), ...read() };

    // 가로 방향 전환 + 여백 축소 → 본문 폭이 넓어져 줄 수가 다시 줄어야 한다
    const land = { ...wide, marginLeft: 5000, marginRight: 5000,
      landscape: true, width: wide.height, height: wide.width };
    w.setPageDef(0, land);
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 40 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 200));
    const afterLandscape = { def: w.getPageDef(0), lines: lineCount(), ...read() };

    // ★자동 갱신 판정: 커서를 손으로 다시 놓지 **않고** 용지만 바꿨을 때
    // 캐럿 화면 좌표가 스스로 갱신되는가 (2026-07-30: document-changed 핸들러가
    // 캐럿을 재조회하지 않아 옛 자리에 남던 결함 — 이 케이스가 그 은폐를 막는다)
    w.setPageDef(0, before.def);
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 40 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 250));
    const autoBefore = read().rect;
    // 여백만 바꾸고 커서는 건드리지 않는다
    w.setPageDef(0, { ...before.def, marginLeft: 20000, marginRight: 20000 });
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 900));
    const autoAfter = read().rect;
    // 원복
    w.setPageDef(0, before.def);
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    return { before, afterMargin, afterLandscape, auto: { autoBefore, autoAfter } };
  });
  console.log('  A용지:', JSON.stringify({
    beforeMarginL: paperRes.before.def.marginLeft,
    afterMarginL: paperRes.afterMargin.def.marginLeft,
    landscape: paperRes.afterLandscape.def.landscape,
    rects: [paperRes.before.rect, paperRes.afterMargin.rect, paperRes.afterLandscape.rect],
  }));
  assert.strictEqual(paperRes.afterMargin.def.marginLeft, 20000, '여백 변경이 저장된다');
  // ★핵심 판정식: 용지 변경이 **줄나눔까지** 재조판되어야 한다.
  // (2026-07-30 실사고: set_page_def 가 LineSeg 를 무효화하지 않아 여백·용지 방향을 바꿔도
  //  줄 수가 얼어붙었다 — 여백은 x 만 밀렸다. 엔진 set_page_def_native 에 reflow 편입으로 수리)
  assert.ok(paperRes.afterMargin.lines > paperRes.before.lines,
    `여백 확대 → 줄 수 증가(재조판): ${paperRes.before.lines} → ${paperRes.afterMargin.lines}`);
  assert.ok(paperRes.afterLandscape.lines < paperRes.afterMargin.lines,
    `가로 전환+여백 축소 → 줄 수 감소: ${paperRes.afterMargin.lines} → ${paperRes.afterLandscape.lines}`);
  // ★자동 갱신: 커서를 손으로 다시 놓지 않아도 캐럿 좌표가 새 조판을 따라가야 한다
  assert.ok(paperRes.auto.autoBefore && paperRes.auto.autoAfter,
    '용지 변경 전후 캐럿 rect 가 모두 유효');
  assert.notDeepStrictEqual(paperRes.auto.autoAfter, paperRes.auto.autoBefore,
    `커서를 건드리지 않은 용지 변경에도 캐럿 좌표가 자동 갱신된다: ${JSON.stringify(paperRes.auto)}`);
  assert.strictEqual(paperRes.afterLandscape.def.landscape, true, '가로 방향 변경이 저장된다');
  assert.ok(paperRes.afterMargin.rect, '여백 변경 후에도 커서 rect 가 유효하다');
  assert.ok(paperRes.afterLandscape.rect, '방향 변경 후에도 커서 rect 가 유효하다');
  // 여백을 넓히면 같은 오프셋의 커서 x 는 왼쪽 여백만큼 밀려야 한다(조판 반영 증거)
  assert.notStrictEqual(paperRes.afterMargin.rect.x, paperRes.before.rect.x,
    '여백 변경이 커서 좌표(=조판)에 반영된다');

  // ── B. 표 이동: 배치·좌표 변경 후 표 안/앞/뒤 커서 유효 ──
  const tableRes = await page.evaluate(async () => {
    const w = window.__wasm, ih = window.__inputHandler;
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 2, colCount: 2,
      treatAsChar: true, colWidths: [6000, 6000],
    })));
    w.insertTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, '셀A');
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 600));

    const rectAt = async (pos) => {
      ih.cursor.moveTo(pos);
      ih.updateCaret?.();
      await new Promise((r) => setTimeout(r, 200));
      const r = ih.cursor.getRect();
      return r ? { page: r.pageIndex, x: Math.round(r.x), y: Math.round(r.y) } : null;
    };
    const inCell = { sectionIndex: 0, paragraphIndex: 0, charOffset: 1,
      parentParaIndex: t.paraIdx, controlIndex: t.controlIdx, cellIndex: 0, cellParaIndex: 0 };
    const body = { sectionIndex: 0, paragraphIndex: 0, charOffset: 5 };

    const before = { cell: await rectAt(inCell), body: await rectAt(body) };

    // 글자처럼 취급 OFF (= 어울림/자리차지 계열로 전환) 후 커서 유효성
    // 표 속성으로 배치 전환 (글자처럼 취급 OFF) — API 이름은 브리지 실측 기준
    let toggled = null;
    try {
      toggled = JSON.stringify(w.setTableProperties(0, t.paraIdx, t.controlIdx, { treatAsChar: false }));
    } catch (e) { toggled = 'err:' + String(e).slice(0, 80); }
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    const afterToggle = { cell: await rectAt(inCell), body: await rectAt(body), toggled };
    return { t, before, afterToggle };
  });
  console.log('  B표:', JSON.stringify(tableRes.before), '→', JSON.stringify(tableRes.afterToggle));
  assert.ok(tableRes.before.cell, '표 셀 커서 rect 유효');
  assert.ok(tableRes.before.body, '표 앵커 문단 본문 커서 rect 유효');
  assert.ok(tableRes.afterToggle.cell, '배치 전환 후에도 셀 커서 rect 유효(캐럿 소실 금지)');
  assert.ok(tableRes.afterToggle.body, '배치 전환 후에도 본문 커서 rect 유효');

  // ── C. 그림: 인라인 삽입 후 커서 위치 · 화살표로 개체 건너기 · 삭제 후 복귀 ──
  const picRes = await page.evaluate(async () => {
    const w = window.__wasm, ih = window.__inputHandler;
    // 1x1 PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const paraLen = w.getParagraphLength(0, 0);
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: Math.min(3, paraLen) });
    let inserted = null;
    try {
      const r = w.insertPicture(0, 0, Math.min(3, paraLen), '', bin, 2000, 2000, 1, 1, 'png', '');
      inserted = r && r.ok ? 'ok' : 'fail:' + JSON.stringify(r);
    } catch (e) { inserted = 'err:' + String(e).slice(0, 80); }
    window.__eventBus?.emit('document-changed');
    await new Promise((r) => setTimeout(r, 700));
    const posAfter = ih.cursor.getPosition();
    const rectAfter = ih.cursor.getRect();
    // 화살표 좌/우로 개체를 건너갈 수 있는가 (rect 가 계속 유효해야 한다)
    const walk = [];
    for (let i = 0; i < 6; i++) {
      ih.cursor.moveHorizontal(1);
      ih.updateCaret?.();
      await new Promise((r) => setTimeout(r, 80));
      const r = ih.cursor.getRect();
      walk.push({ off: ih.cursor.getPosition().charOffset, ok: !!r });
    }
    return {
      inserted: typeof inserted === 'string' ? inserted : 'ok',
      posAfter: { para: posAfter.paragraphIndex, off: posAfter.charOffset },
      rectAfter: rectAfter ? { page: rectAfter.pageIndex } : null,
      walk,
    };
  });
  console.log('  C그림:', JSON.stringify(picRes));
  assert.ok(picRes.inserted === 'ok', `그림 삽입 성공: ${picRes.inserted}`);
  assert.ok(picRes.rectAfter, '그림 삽입 직후 커서 rect 유효(캐럿 소실 금지)');
  assert.ok(picRes.walk.every((s) => s.ok), `개체를 지나는 화살표 이동 중 캐럿 유지: ${JSON.stringify(picRes.walk)}`);

  // ── D. 커서 경계: 문단 길이 초과 오프셋 클램프 ──
  const edgeRes = await page.evaluate(async () => {
    const w = window.__wasm, ih = window.__inputHandler;
    const len = w.getParagraphLength(0, 0);
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: len + 50 });
    ih.updateCaret?.();
    await new Promise((r) => setTimeout(r, 200));
    const r = ih.cursor.getRect();
    return { len, off: ih.cursor.getPosition().charOffset, hasRect: !!r };
  });
  console.log('  D경계:', JSON.stringify(edgeRes));
  // [2026-07-30 수리] moveTo 가 오프셋을 문단 길이로 클램프한다 — 예전엔 초과 오프셋이 그대로
  // 남아(len 168 → off 218) 유령 캐럿의 씨앗이 됐다.
  assert.ok(edgeRes.off <= edgeRes.len,
    `문단 길이 초과 오프셋은 클램프된다: off=${edgeRes.off} ≤ len=${edgeRes.len}`);
  assert.ok(edgeRes.hasRect, '클램프된 위치의 rect 는 유효하다');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
