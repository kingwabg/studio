/**
 * 회귀: 표 모달의 기능이 오른쪽 패널 안에서 동작하는가(모달 없이).
 * 판정: 표 탭에 실제 폼이 뜨고, 값을 바꾸면 문서에 반영된다.
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

  // 셀 탭으로 전환 → 폼이 뜨는가
  const mounted = await page.evaluate(async () => {
    const tab = [...document.querySelectorAll('.canva-rail--right .canva-tab')].find((t) => t.textContent.trim() === '셀');
    tab.click();
    await new Promise((r) => setTimeout(r, 700));
    const host = document.querySelector('.canva-props-host');
    return {
      hasForm: !!host && host.children.length > 0,
      inputs: host ? host.querySelectorAll('input, select').length : 0,
      hiddenTabs: host ? getComputedStyle(host.querySelector('.dialog-tabs') ?? document.body).display : null,
    };
  });
  console.log('  폼:', JSON.stringify(mounted));
  assert.ok(mounted.hasForm, '패널에 표/셀 속성 폼이 떠야 함');
  assert.ok(mounted.inputs >= 8, `폼 입력이 다수 있어야 함 (실측 ${mounted.inputs})`);

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
    if (!marginChk) return { changed: false, why: '안 여백 지정 체크박스를 못 찾음', labels: checks.map(label).slice(0, 14) };
    if (!marginChk.checked) marginChk.click();
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
