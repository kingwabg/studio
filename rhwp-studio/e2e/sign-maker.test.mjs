/**
 * 서명·도장 만들기 — 탭 3종 판정식(사용자 요청 2026-08-01).
 *
 * 판정식
 *  ① 탭 3개(직접·글씨체·도장)가 있고, 고른 탭만 보인다.
 *  ② 「직접」 캔버스에 획을 그으면 잉크가 남고, 속도에 따라 굵기가 변한다.
 *  ③ 「글씨체」에 이름을 넣으면 잉크가 생기고, 글씨체를 바꾸면 그림이 달라진다.
 *  ④ 결과 PNG 는 **투명 배경**이다(가장자리 화소의 알파 = 0).
 *  ⑤ 비어 있으면 [투명 PNG 다운로드]·[문서에 넣기] 가 잠긴다.
 *  ⑥ [문서에 넣기] 는 그림을 **글자취급**으로 넣는다(논리 길이가 늘어난다).
 *
 * ⚠ 탭·글씨체 버튼은 click 으로 듣는다(mousedown 아님) — 프로브를 맞춰 둘 것.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

/** 캔버스에서 알파>8 인 화소 수 — '잉크가 있는가' 의 척도 */
const INK = `(c) => {
  const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < x.length; i += 4) if (x[i] > 8) n++;
  return n;
}`;

runTest('서명·도장 만들기', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  await page.evaluate(() => window.__dispatcher.dispatch('tool:seal-maker'));
  await new Promise((r) => setTimeout(r, 400));

  // ① 탭 3개 · 고른 탭만 보인다
  const tabs = await page.evaluate(() => {
    const names = [...document.querySelectorAll('.sgn-tab .sgn-tab-name')].map((e) => e.textContent);
    const shown = [...document.querySelectorAll('.sgn-panel')]
      .map((p) => getComputedStyle(p).display !== 'none');
    return { names, shown, on: document.querySelector('.sgn-tab.is-on .sgn-tab-name')?.textContent };
  });
  console.log('  ① 탭:', tabs.names.join('/'), '· 보이는 패널', tabs.shown, '· 선택', tabs.on);
  assert.deepStrictEqual(tabs.names, ['직접', '글씨체', '도장'], '탭 3종');
  // ⚠ hidden 속성만 보면 안 된다 — display:flex 가 [hidden] 의 display:none 을 이긴 전례가 있다.
  assert.deepStrictEqual(tabs.shown, [true, false, false], '첫 탭만 보인다');

  // ⑤ 빈 상태 = 잠김
  const locked = await page.evaluate(() => ({
    save: document.querySelector('.sgn-actions .dialog-btn-primary').disabled,
    insert: document.querySelector('.dialog-footer .dialog-btn-primary').disabled,
  }));
  console.log('  ⑤ 빈 상태 잠금: 다운로드', locked.save, '· 문서에 넣기', locked.insert);
  assert.ok(locked.save && locked.insert, '비었으면 두 버튼 모두 잠김');

  // ② 직접 — 느린 획과 빠른 획을 긋고 잉크·굵기를 잰다
  const drew = await page.evaluate(async (inkSrc) => {
    const ink = eval(inkSrc);
    const c = document.querySelector('.sgn-draw .sgn-canvas');
    const r = c.getBoundingClientRect();
    // ⚠ signature_pad 는 `buttons === 1`(왼쪽 버튼 눌림)이 아니면 획을 **무시한다**
    //   (dist/signature_pad.js:364 _isLeftButtonPressed). buttons 를 빠뜨리면 잉크가 0이다.
    const send = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'pen', pressure: 0.5,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
    /** steps 가 많을수록 = 점 사이 간격이 좁다 = 천천히 그은 것이다 */
    const stroke = async (y, steps) => {
      send('pointerdown', r.left + 40, r.top + y);
      for (let i = 1; i <= steps; i++) {
        send('pointermove', r.left + 40 + (i * 260) / steps, r.top + y);
        await new Promise((z) => setTimeout(z, 16));
      }
      send('pointerup', r.left + 300, r.top + y);
      await new Promise((z) => setTimeout(z, 60));
    };
    const before = ink(c);
    await stroke(70, 30);   // 천천히 = 굵게
    const slow = ink(c) - before;
    await stroke(170, 5);   // 빠르게 = 가늘게
    const fast = ink(c) - before - slow;
    const empty = document.querySelector('.sgn-draw .sgn-placeholder').hidden;
    return { before, slow, fast, placeholderHidden: empty,
      save: document.querySelector('.sgn-actions .dialog-btn-primary').disabled };
  }, INK);
  console.log('  ② 획: 시작 잉크', drew.before, '· 느린 획', drew.slow, '· 빠른 획', drew.fast,
    '· 안내문 숨김', drew.placeholderHidden, '· 다운로드 열림', !drew.save);
  assert.strictEqual(drew.before, 0, '처음엔 완전히 비어 있다(투명)');
  assert.ok(drew.slow > 0 && drew.fast > 0, '두 획 모두 잉크가 남는다');
  assert.ok(drew.slow > drew.fast, `천천히 그은 획이 더 굵다 (느림 ${drew.slow} > 빠름 ${drew.fast})`);
  assert.ok(!drew.save, '그림이 있으면 다운로드가 열린다');

  await page.screenshot({ path: 'e2e/screenshots/sign-draw.png' });

  // ③ 글씨체 — 이름 입력 + 글씨체 교체
  const fonts = await page.evaluate(async (inkSrc) => {
    const ink = eval(inkSrc);
    [...document.querySelectorAll('.sgn-tab')][1].click();
    await new Promise((r) => setTimeout(r, 300));
    const c = document.querySelector('.sgn-font .sgn-canvas');
    const input = document.querySelector('.sgn-font .sgn-input');
    input.value = '김준하';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await document.fonts.ready;              // ⚠ 글꼴이 오기 전에 재면 대체 글꼴을 잰다
    await new Promise((r) => setTimeout(r, 1200));
    const brush = ink(c);
    const chips = [...document.querySelectorAll('.sgn-chip')];
    chips[1].click();                        // 펜글씨
    await new Promise((r) => setTimeout(r, 1200));
    const pen = ink(c);
    return { chips: chips.map((b) => b.textContent), brush, pen,
      shown: [...document.querySelectorAll('.sgn-panel')]
        .map((p) => getComputedStyle(p).display !== 'none') };
  }, INK);
  console.log('  ③ 글씨체:', fonts.chips.join('/'), '· 붓 잉크', fonts.brush, '· 펜 잉크', fonts.pen,
    '· 보이는 패널', fonts.shown);
  assert.deepStrictEqual(fonts.shown, [false, true, false], '글씨체 탭만 보인다');
  assert.ok(fonts.brush > 500, `붓글씨가 그려진다 (잉크 ${fonts.brush})`);
  assert.ok(fonts.pen > 500, `펜글씨가 그려진다 (잉크 ${fonts.pen})`);
  assert.notStrictEqual(fonts.brush, fonts.pen, '글씨체를 바꾸면 그림이 달라진다');

  await page.screenshot({ path: 'e2e/screenshots/sign-font.png' });

  // ④ 투명 배경 — 네 귀퉁이의 알파가 0
  const clear = await page.evaluate(() => {
    const c = document.querySelector('.sgn-font .sgn-canvas');
    const g = c.getContext('2d');
    return [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]]
      .map(([x, y]) => g.getImageData(x, y, 1, 1).data[3]);
  });
  console.log('  ④ 귀퉁이 알파:', clear.join(','));
  assert.ok(clear.every((a) => a === 0), '배경이 투명하다');

  // 도장 탭도 같은 껍데기를 쓴다 — 그림이 나오는지만 확인하고 다시 글씨체로 돌아온다.
  const seal = await page.evaluate(async (inkSrc) => {
    const ink = eval(inkSrc);
    [...document.querySelectorAll('.sgn-tab')][2].click();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('.sgn-seal .sgn-input');
    input.value = '김준하';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { ink: ink(document.querySelector('.sgn-seal .sgn-canvas')),
      foot: document.querySelector('.sgn-foot').textContent.slice(0, 12) };
  }, INK);
  console.log('  ⑦ 도장: 잉크', seal.ink, '· 안내문 바뀜', JSON.stringify(seal.foot));
  assert.ok(seal.ink > 500, '도장이 그려진다');
  await page.screenshot({ path: 'e2e/screenshots/sign-seal.png' });
  await page.evaluate(async () => {
    [...document.querySelectorAll('.sgn-tab')][1].click();
    await new Promise((r) => setTimeout(r, 400));
  });

  // ⑥ 문서에 넣기 — 논리 길이가 늘어난다(= 글자취급으로 앉았다)
  const inserted = await page.evaluate(async () => {
    const w = window.__wasm;
    const before = w.getLogicalLength(0, 0);
    document.querySelector('.dialog-footer .dialog-btn-primary').click();
    await new Promise((r) => setTimeout(r, 900));
    return { before, after: w.getLogicalLength(0, 0), open: !!document.querySelector('.sgn-body') };
  });
  console.log('  ⑥ 삽입: 논리 길이', inserted.before, '→', inserted.after, '· 대화상자 닫힘', !inserted.open);
  assert.ok(inserted.after > inserted.before, '그림이 글자취급으로 들어갔다');
  assert.ok(!inserted.open, '넣은 뒤 대화상자가 닫힌다');
});
