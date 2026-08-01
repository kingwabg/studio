/**
 * 열 경계선 드래그 — 끈 만큼만 옮겨지고 **격자가 무너지지 않는가**.
 * (사용자 신고 2026-08-01 "표 경계선 이동이 또 이상해졌어")
 *
 * 왜 이 검사가 필요했나: 스튜디오 단위 테스트(엔진에 보낼 델타 계산)와 엔진 단위
 * 테스트는 **둘 다 통과하고 있었다**. 아무도 "드래그하면 열 폭이 어떻게 되는가"를
 * 끝까지 보지 않아서, 그 사이(엔진의 적용 단계)에서 깨진 걸 못 잡았다.
 * 재발을 막는 건 이 끝-대-끝 검사다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('열 경계선 드래그', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 900));

  const before = await page.evaluate(async () => {
    const w = window.__wasm;
    w.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, treatAsChar: true });
    await new Promise((r) => setTimeout(r, 900));
    const t = w.getTables(0)[0];
    return w.getTableCellBboxes(0, t.para, t.controlIdx)
      .filter((b) => b.row === 0).sort((a, z) => a.col - z.col)
      .map((b) => [Math.round(b.x), Math.round(b.w)]);
  });
  console.log('  전:', JSON.stringify(before));

  const pt = await page.evaluate(() => {
    const cv = document.querySelector('#scroll-content canvas').getBoundingClientRect();
    const w = window.__wasm;
    const t = w.getTables(0)[0];
    const b = w.getTableCellBboxes(0, t.para, t.controlIdx).find((x) => x.row === 0 && x.col === 0);
    return { x: Math.round(cv.x + b.x + b.w), y: Math.round(cv.y + b.y + b.h / 2) };
  });
  await page.mouse.move(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 250));
  await page.mouse.down();
  await page.mouse.move(pt.x + 40, pt.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));

  const after = await page.evaluate(() => {
    const w = window.__wasm;
    const t = w.getTables(0)[0];
    const bb = w.getTableCellBboxes(0, t.para, t.controlIdx);
    const rows = {};
    for (const b of bb) (rows[b.row] ??= [])[b.col] = [Math.round(b.x), Math.round(b.w)];
    return rows;
  });
  console.log('  후:', JSON.stringify(after[0]));

  const r0 = after[0];
  // ① 첫 열은 넓어지고 둘째 열은 그만큼 좁아진다(표 폭 유지)
  assert.ok(r0[0][1] > before[0][1] + 20, `첫 열이 넓어져야 한다 (${before[0][1]} → ${r0[0][1]})`);
  assert.ok(r0[1][1] < before[1][1] - 20, `둘째 열이 좁아져야 한다 (${before[1][1]} → ${r0[1][1]})`);
  // ② 셋째 열은 그대로 — 드래그와 무관하다
  assert.strictEqual(r0[2][1], before[2][1], '셋째 열은 안 건드린다');
  // ③ 표 전체 폭이 유지된다
  const w0 = before.reduce((s, b) => s + b[1], 0);
  const w1 = r0.reduce((s, b) => s + b[1], 0);
  assert.ok(Math.abs(w0 - w1) <= 2, `표 폭이 유지돼야 한다 (${w0} → ${w1})`);
  // ④ 모든 행이 같은 격자를 쓴다 — 이게 무너진 게 신고된 증상이다
  for (const r of [1, 2]) {
    assert.deepStrictEqual(after[r], r0, `행 ${r} 의 열 경계가 행 0 과 달라졌다`);
  }
});
