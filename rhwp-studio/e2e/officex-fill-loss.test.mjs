/**
 * 회귀: 표 속성을 바꿔도 **셀 배경색이 살아남는가**.
 *
 * 배경: setTableProperties 는 borderFill 을 재빌드하면서 표 전 셀의 fill 을 날린다(엔진 함정).
 * 그래서 저장 경로는 앞뒤로 셀 배경을 스냅샷·복원해야 한다. 예전엔 표/셀 속성 **대화상자**가
 * 그 책임을 졌고, 2026-07-29 대화상자가 은퇴하면서 오른쪽 패널(table-panel-sections)이
 * 이어받았다 — 그래서 이 회귀는 패널 경로로 다시 세운다.
 *
 * 판정식: 빨/노/파/초 4칸에 색을 넣고 '글자처럼 취급'을 해제한 뒤, 네 칸의 fillColor 가
 * 그대로여야 한다(과거 실사고: 전부 백지).
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('표 속성 변경 후에도 셀 배경색 보존 (패널 경로)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);
  await clickEditArea(page);

  const COLORS = ['#ff0000', '#ffff00', '#0000ff', '#00cc00'];

  const r = await page.evaluate(async (colors) => {
    const { TablePanelSections } = await import('/src/ui/table-panel-sections.ts');
    const w = window.__wasm;
    const ih = window.__inputHandler;
    const sec = 0, para = 0;
    const textLen = w.doc.getParagraphLength(sec, para);
    const t = JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: sec, paraIdx: para, charOffset: textLen,
      rowCount: 2, colCount: 2, treatAsChar: true, colWidths: [8000, 8000],
    })));
    const ctx = { sec, ppi: t.paraIdx, ci: t.controlIdx };
    for (let i = 0; i < 4; i++) {
      w.setCellProperties(sec, ctx.ppi, ctx.ci, i, {
        fillType: 'solid', fillColor: colors[i], patternColor: '#000000', patternType: 0,
      });
    }
    const read = () => [0, 1, 2, 3].map((i) => w.getCellProperties(sec, ctx.ppi, ctx.ci, i).fillColor);
    const before = read();

    // 패널 위치 섹션에서 '글자처럼 취급' 해제 — 표 속성을 실제로 건드리는 가장 무거운 경로
    const host = document.createElement('div');
    document.body.appendChild(host);
    new TablePanelSections().mount(host, w, { getInputHandler: () => ih }, ctx, 0, 'table', '위치');
    const sw = [...host.querySelectorAll('.tps-switch-row')]
      .find((l) => l.textContent.includes('글자처럼 취급')).querySelector('input');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));

    const after = read();
    const tp = w.getTableProperties(sec, ctx.ppi, ctx.ci);
    host.remove();
    return { before, after, treatAsChar: tp.treatAsChar };
  }, COLORS);

  console.log('  변경 전:', JSON.stringify(r.before));
  console.log('  변경 후:', JSON.stringify(r.after));

  assert.deepStrictEqual(r.before, COLORS, '사전 조건 — 네 칸에 색이 들어가야 함');
  assert.strictEqual(r.treatAsChar, false, '글자처럼 취급이 실제로 해제되어야 함');
  assert.deepStrictEqual(r.after, COLORS, '표 속성을 바꿔도 셀 배경색이 유지되어야 함');
  assert.deepStrictEqual(errors, [], `페이지 오류 발생: ${JSON.stringify(errors)}`);
});
