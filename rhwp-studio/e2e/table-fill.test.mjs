/**
 * 표 빈칸 AI 채우기 — 판정식 실측(docs/specs/table-fill-ai.md).
 * AI 호출은 키·네트워크가 필요하므로 여기서는 부르지 않는다. 대신 위험한 쪽,
 * 즉 **읽기(빈칸 판별)와 쓰기(채워진 칸 불변·되돌리기)** 를 실제 문서로 검사한다.
 *
 * 판정식 1 채워진 셀 불변 · 2 적용 결과 일치 · 4 되돌리기 1회 · 5 빈칸 0이면 AI 미호출
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('표 빈칸 채우기', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // 3×3 표를 만들고 머리글 3칸 + 항목 2칸만 채운다 → 빈칸 4개
  const setup = await page.evaluate(async () => {
    const m = await import('/src/ui/table-fill.ts');
    const w = window.__wasm;
    const res = w.createTableEx({
      sectionIdx: 0, paraIdx: 0, charOffset: 0,
      rowCount: 3, colCount: 3, treatAsChar: true,
    });
    const pp = res.paraIdx ?? 0;
    const ci = res.controlIdx;
    const put = (row, col, text) => {
      const b = w.getTableCellBboxes(0, pp, ci).find((x) => x.row === row && x.col === col);
      w.insertTextInCell(0, pp, ci, b.cellIdx, 0, 0, text);
    };
    put(0, 0, '항목'); put(0, 1, '수량'); put(0, 2, '금액');
    put(1, 0, '급식비'); put(2, 0, '교재비');
    await new Promise((r) => setTimeout(r, 300));
    const t = w.getTables(0).find((x) => x.controlIdx === ci);
    const grid = m.readTable(w, 0, t);
    const blanks = m.blankCells(grid);
    return {
      cells: grid.cells.length,
      blanks: blanks.map((c) => `${c.row},${c.col}`).sort(),
      filled: grid.cells.filter((c) => c.text).map((c) => c.text).sort(),
      prompt: m.gridToPrompt(grid, 0),
    };
  });
  console.log('  ① 셀', setup.cells, '/ 빈칸', JSON.stringify(setup.blanks));
  assert.deepStrictEqual(setup.blanks, ['1,1', '1,2', '2,1', '2,2'], '빈칸만 정확히 골라야 한다');
  assert.ok(setup.prompt.includes('{{1,1}}'), '프롬프트가 빈칸을 좌표로 표시해야 한다');
  assert.ok(setup.prompt.includes('급식비'), '채워진 값은 그대로 프롬프트에 실린다');

  // 판정식 5 — 빈칸이 없으면 AI 를 부르지 않는다(fetch 를 가로채 호출 여부를 본다)
  const noBlank = await page.evaluate(async () => {
    const m = await import('/src/ui/table-fill.ts');
    const w = window.__wasm;
    const t = w.getTables(0)[0];
    const grid = m.readTable(w, 0, t);
    return m.blankCells({ ...grid, cells: grid.cells.map((c) => ({ ...c, text: c.text || 'x' })) }).length;
  });
  console.log('  ⑤ 모두 채운 표의 빈칸 수:', noBlank);
  assert.strictEqual(noBlank, 0, '빈칸 0이면 AI 호출 자체가 없다');

  // 판정식 1·2·4 — 두 칸만 채우고 나머지·기존 값이 그대로인지, 되돌리기 한 번에 복귀하는지
  const applied = await page.evaluate(async () => {
    const m = await import('/src/ui/table-fill.ts');
    const w = window.__wasm;
    const t = w.getTables(0)[0];
    const grid = m.readTable(w, 0, t);
    const snap = () => m.readTable(w, 0, w.getTables(0)[0]).cells
      .map((c) => `${c.row},${c.col}=${c.text}`).sort().join('|');
    const before = snap();
    const pick = (row, col) => grid.cells.find((c) => c.row === row && c.col === col).cellIdx;
    m.applyFills(window.__inputHandler, [grid], [
      { table: 0, row: 1, col: 1, cellIdx: pick(1, 1), text: '15명' },
      { table: 0, row: 1, col: 2, cellIdx: pick(1, 2), text: '1,200,000원' },
    ]);
    await new Promise((r) => setTimeout(r, 600));
    const after = snap();
    const g2 = m.readTable(w, 0, w.getTables(0)[0]);
    const cell = (r, c) => g2.cells.find((x) => x.row === r && x.col === c).text;
    window.__dispatcher.dispatch('edit:undo');
    await new Promise((r) => setTimeout(r, 700));
    return {
      wrote: [cell(1, 1), cell(1, 2)],
      // 원래 채워져 있던 칸이 그대로인가
      kept: ['항목', '수량', '금액', '급식비', '교재비'].every((v) => after.includes(`=${v}`)),
      // 빈 채로 둔 칸이 여전히 빈가
      stillBlank: m.blankCells(g2).map((c) => `${c.row},${c.col}`).sort(),
      afterUndo: snap() === before,
    };
  });
  console.log('  ②', JSON.stringify(applied.wrote), '/ ① 기존값 보존', applied.kept,
    '/ 남은 빈칸', JSON.stringify(applied.stillBlank), '/ ④ 되돌리기 복귀', applied.afterUndo);
  assert.deepStrictEqual(applied.wrote, ['15명', '1,200,000원'], '판정식 2: 쓴 값이 그대로 들어간다');
  assert.ok(applied.kept, '판정식 1: 이미 채워진 칸은 하나도 안 바뀐다');
  assert.deepStrictEqual(applied.stillBlank, ['2,1', '2,2'], '고르지 않은 빈칸은 건드리지 않는다');
  assert.ok(applied.afterUndo, '판정식 4: 되돌리기 한 번으로 실행 전 상태');

  // 판정식 3 — 아동 관찰기록에서는 아예 막힌다.
  // currentDocKind 는 호출 시점의 location.search 를 읽으므로 재적재 없이 바꿔 검사한다.
  const guard = await page.evaluate(async () => {
    history.replaceState(null, '', `${location.pathname}?docKind=child-record`);
    window.__dispatcher.dispatch('tool:table-fill');
    await new Promise((r) => setTimeout(r, 600));
    return document.querySelector('.tfill')?.textContent ?? '';
  });
  console.log('  ③ 아동 관찰기록:', guard.slice(0, 40));
  assert.ok(guard.includes('쓸 수 없습니다'), '판정식 3: 아동 관찰기록에서는 막혀야 한다');
});
