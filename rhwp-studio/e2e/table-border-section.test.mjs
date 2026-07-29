/**
 * 회귀: 오른쪽 패널 「테두리·배경」 섹션(디자인 2c) — 프리셋이 **어느 변에만** 그어지나.
 *
 * 왜 이 판정식인가: 모달의 테두리 탭은 좌·우·상·하 4방향뿐이라 안쪽/가로선/세로선을
 * 못 만들었다. 새 섹션의 존재 이유가 그것이므로, '안쪽'이 표 가장자리를 건드리지 않고
 * 내부 변만 칠하는지를 셀 속성 실측으로 확인한다(눈이 아니라 값으로).
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('테두리·배경 섹션 — 안쪽/바깥 프리셋이 정확한 변만 칠한다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);

  const r = await page.evaluate(async () => {
    const { TableBorderSection } = await import('/src/ui/table-border-section.ts');
    const ih = window.__inputHandler;
    const w = window.__wasm;
    const tr = JSON.parse(w.doc.createTable(0, 0, 0, 3, 3));
    const ctx = { sec: 0, ppi: tr.paraIdx, ci: tr.controlIdx };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const sec = new TableBorderSection();
    // services 는 getInputHandler 만 쓴다(되돌리기 스냅샷)
    sec.mount(host, w, { getInputHandler: () => ih }, ctx, 0, 'table');

    const cardOf = (label) => [...host.querySelectorAll('.tbs-preset')].find((b) => b.title === label);
    const sels = host.querySelectorAll('.tbs-select');
    sels[0].value = '2';                                  // 파선
    sels[0].dispatchEvent(new Event('change'));
    cardOf('안쪽').click();

    const cp = (i) => w.getCellProperties(0, ctx.ppi, ctx.ci, i);
    const t = (b) => (b ? b.type : null);
    const corner = cp(0);       // (0,0) — 위·왼쪽은 표 바깥변
    const center = cp(4);       // (1,1) — 네 변 모두 안쪽
    const out = {
      cards: host.querySelectorAll('.tbs-preset').length,
      cornerTop: t(corner.borderTop), cornerLeft: t(corner.borderLeft),
      cornerRight: t(corner.borderRight), cornerBottom: t(corner.borderBottom),
      center: [t(center.borderTop), t(center.borderRight), t(center.borderBottom), t(center.borderLeft)],
    };

    // 이어서 '바깥' — 이번엔 가장자리만 바뀌어야 한다
    sels[0].value = '3';                                  // 점선
    sels[0].dispatchEvent(new Event('change'));
    cardOf('바깥').click();
    const corner2 = cp(0);
    const center2 = cp(4);
    out.outerCornerTop = t(corner2.borderTop);
    out.outerCornerLeft = t(corner2.borderLeft);
    out.outerCenter = [t(center2.borderTop), t(center2.borderRight), t(center2.borderBottom), t(center2.borderLeft)];

    host.remove();
    return out;
  });

  console.log('  실측:', JSON.stringify(r));
  assert.strictEqual(r.cards, 10, '프리셋 카드는 10종');
  // 안쪽(파선=2): 모서리 셀의 안쪽 두 변만, 가운데 셀은 네 변 모두
  assert.strictEqual(r.cornerRight, 2, '안쪽 — 모서리 셀 오른쪽(내부 변)에 적용');
  assert.strictEqual(r.cornerBottom, 2, '안쪽 — 모서리 셀 아래(내부 변)에 적용');
  assert.notStrictEqual(r.cornerTop, 2, '안쪽 — 표 바깥 변(위)은 건드리지 않는다');
  assert.notStrictEqual(r.cornerLeft, 2, '안쪽 — 표 바깥 변(왼쪽)은 건드리지 않는다');
  assert.deepStrictEqual(r.center, [2, 2, 2, 2], '안쪽 — 가운데 셀은 네 변 모두 내부 변');
  // 바깥(점선=3): 가장자리만
  assert.strictEqual(r.outerCornerTop, 3, '바깥 — 모서리 셀 위는 표 바깥 변');
  assert.strictEqual(r.outerCornerLeft, 3, '바깥 — 모서리 셀 왼쪽은 표 바깥 변');
  assert.deepStrictEqual(r.outerCenter, [2, 2, 2, 2], '바깥 — 가운데 셀은 그대로(직전 안쪽 값 유지)');

  assert.deepStrictEqual(errors, [], `페이지 오류 발생: ${JSON.stringify(errors)}`);
});
