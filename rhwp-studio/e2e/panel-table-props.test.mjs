/**
 * 회귀: **실제 UI 경로**(탭 클릭 → 섹션 클릭)로 표/셀 속성이 저장되는가.
 *
 * table-panel-sections.test.mjs 는 클래스를 직접 mount 해 로직만 본다. 이 테스트는
 * 사용자가 실제로 밟는 길 — 레일 탭 클릭 → 섹션 칩 클릭 → 컨트롤 조작 — 을 지킨다.
 * (배선이 끊겨도 로직 테스트는 초록일 수 있다.)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';

runTest('패널 내장 표/셀 속성 — 폼 렌더·자동 저장', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);

  const ref = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.active = true;
    if (ih.canvasMode && !ih.canvasEditingRef) ih.canvasEditingRef = { kind: 'body' };
    let r = null;
    ih.executeOperation({
      kind: 'snapshot', operationType: 'createTable',
      operation: (w) => {
        const t = w.createTable(0, 0, 0, 3, 3);
        if (t.ok) r = { sec: 0, ppi: t.paraIdx, ci: t.controlIdx };
        return t.ok ? { sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
          parentParaIndex: t.paraIdx, controlIndex: t.controlIdx, cellIndex: 0, cellParaIndex: 0 }
          : ih.cursor.getPosition();
      },
    });
    if (ih.updateCaret) ih.updateCaret();
    await new Promise((x) => setTimeout(x, 600));
    return r;
  });
  assert.ok(ref, '표 생성 실패');

  // 셀 탭 → 여백 섹션 (둘 다 실제 클릭)
  const mounted = await page.evaluate(async () => {
    const tab = [...document.querySelectorAll('.canva-rail--right .canva-tab')].find((t) => t.textContent.trim() === '셀');
    tab.click();
    await new Promise((r) => setTimeout(r, 700));
    const chip = [...document.querySelectorAll('.canva-sec-btn')].find((b) => b.title === '여백');
    chip?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const host = document.querySelector('.canva-props-host');
    return {
      sections: document.querySelectorAll('.canva-sec-btn').length,
      active: document.querySelector('.canva-sec-btn.is-on')?.title ?? null,
      wrap: host?.firstElementChild?.className ?? null,
      inputs: host ? host.querySelectorAll('input, select').length : 0,
    };
  });
  console.log('  섹션:', JSON.stringify(mounted));
  assert.strictEqual(mounted.sections, 6, '셀 탭 섹션 6종');
  assert.strictEqual(mounted.active, '여백', '고른 섹션이 활성화');
  assert.strictEqual(mounted.wrap, 'tps', '섹션 내용이 그려져야 함');
  assert.ok(mounted.inputs >= 4, `사면 여백 입력 (실측 ${mounted.inputs})`);

  // 기능 판정: 폼에서 값을 바꾸면 문서에 반영되는가(확인 버튼 없이 자동 저장)
  const applied = await page.evaluate(async (ref) => {
    const host = document.querySelector('.canva-props-host');
    const w = window.__inputHandler.wasm;
    const before = w.getCellProperties(ref.sec, ref.ppi, ref.ci, 0);
    // '안 여백 지정' 체크 → 왼쪽 여백 값 변경
    // 라벨은 체크박스의 형제 텍스트다 — 부모 텍스트로 찾는다
    const label = (el) => (el.parentElement?.textContent ?? '').trim();
    const checks = [...host.querySelectorAll('input[type=checkbox]')];
    const marginChk = checks.find((c) => label(c).includes('안 여백 지정'));
    if (!marginChk) return { changed: false, why: '안 여백 지정 스위치를 못 찾음', labels: checks.map(label).slice(0, 14) };
    marginChk.checked = !marginChk.checked;
    marginChk.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1000));
    const after = w.getCellProperties(ref.sec, ref.ppi, ref.ci, 0);
    return {
      changed: JSON.stringify(before) !== JSON.stringify(after),
      appliedInnerMargin: after.applyInnerMargin,
    };
  }, ref);
  console.log('  자동 저장:', JSON.stringify(applied));
  assert.ok(applied.changed, '폼 변경이 문서에 반영돼야 함(확인 버튼 없이)');

  await screenshot(page, 'panel-table-props');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
