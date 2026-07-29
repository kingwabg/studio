/**
 * 회귀: 표/셀 패널의 나머지 섹션 10종(디자인 2c) — 렌더 + **저장이 실제로 되는가**.
 *
 * 판정식: 각 섹션이 빈 화면이 아니고(컨트롤 ≥1), 대표 값을 바꾼 뒤 엔진에서 되읽었을 때
 * 그 값이 남아 있어야 한다. 패널은 확인 버튼이 없어 "그려졌지만 저장 안 됨"이 조용한
 * 실패가 되기 쉬워서(모달 내장판에서 실제로 그랬다), 렌더만으론 판정하지 않는다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('표/셀 패널 섹션 — 10종 렌더 + 저장 왕복', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createNewDocument(page);

  const r = await page.evaluate(async () => {
    const { TablePanelSections } = await import('/src/ui/table-panel-sections.ts');
    const ih = window.__inputHandler;
    const w = window.__wasm;
    const tr = JSON.parse(w.doc.createTable(0, 0, 0, 3, 3));
    const ctx = { sec: 0, ppi: tr.paraIdx, ci: tr.controlIdx };
    const services = { getInputHandler: () => ih };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const ps = new TablePanelSections();
    const show = (tab, name) => ({
      ok: ps.mount(host, w, services, ctx, 0, tab, name),
      controls: host.querySelectorAll('input, select, button').length,
      // 표:크기는 읽기 전용(셀 크기의 합)이라 입력이 0개다 — 내용 유무로 본다
      nodes: host.childElementCount,
    });

    const rendered = {};
    for (const name of ['위치', '크기', '여백', '쪽 넘김', '캡션']) rendered[`표:${name}`] = show('table', name);
    for (const name of ['크기', '여백', '정렬', '속성', '필드']) rendered[`셀:${name}`] = show('cell', name);

    const saved = {};
    const tp = () => w.getTableProperties(0, ctx.ppi, ctx.ci);
    const cp = () => w.getCellProperties(0, ctx.ppi, ctx.ci, 0);

    // 표:쪽 넘김 — '나누지 않음' 카드
    ps.mount(host, w, services, ctx, 0, 'table', '쪽 넘김');
    [...host.querySelectorAll('.tps-card')].find((b) => b.textContent.includes('나누지 않음')).click();
    saved.pageBreak = tp().pageBreak;

    // 표:여백 — 바깥 위 여백 3mm
    ps.mount(host, w, services, ctx, 0, 'table', '여백');
    const top = host.querySelector('.tps-pill-top .tps-pill-val');
    top.value = '3'; top.dispatchEvent(new Event('change'));
    saved.outerTopMm = Math.round(tp().outerTop * 25.4 / 7200 * 10) / 10;

    // 표:캡션 — '아래' 칸
    ps.mount(host, w, services, ctx, 0, 'table', '캡션');
    [...host.querySelectorAll('.tps-cap')].find((b) => b.title === '아래').click();
    saved.caption = { has: tp().hasCaption, dir: tp().captionDirection };

    // 셀:정렬 — 세로 정렬 '아래쪽'
    ps.mount(host, w, services, ctx, 0, 'cell', '정렬');
    [...host.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent === '아래쪽').click();
    saved.verticalAlign = cp().verticalAlign;

    // 셀:속성 — 제목 셀 스위치
    ps.mount(host, w, services, ctx, 0, 'cell', '속성');
    const header = [...host.querySelectorAll('.tps-switch-row')].find((l) => l.textContent.includes('제목 셀'));
    const hi = header.querySelector('input');
    const want = !hi.checked;
    hi.checked = want; hi.dispatchEvent(new Event('change'));
    saved.isHeader = { want, got: cp().isHeader };

    // 셀:필드 — 필드 이름
    ps.mount(host, w, services, ctx, 0, 'cell', '필드');
    const fname = host.querySelector('input[type="text"]');
    fname.value = '금액'; fname.dispatchEvent(new Event('change'));
    saved.fieldName = cp().fieldName;

    // 여백 '연동' — 켜고 위쪽을 올리면 네 값이 함께 움직인다
    ps.mount(host, w, services, ctx, 0, 'table', '여백');
    host.querySelector('.tps-link').click();
    host.querySelector('.tps-pill-top .tps-pill-btn').click();  // 위쪽 −0.1
    const mm = (hu) => Math.round((hu ?? 0) * 25.4 / 7200 * 100) / 100;
    saved.linked = [mm(tp().outerTop), mm(tp().outerLeft), mm(tp().outerRight), mm(tp().outerBottom)];

    // 배치 미리보기 — '자리 차지' 를 고르면 그림과 설명이 함께 바뀐다
    ps.mount(host, w, services, ctx, 0, 'table', '위치');
    const capBefore = host.querySelector('.tps-pos-cap').textContent;
    // 지금 선택된 것과 다른 배치를 골라야 '바뀌는지'를 볼 수 있다
    const cur = host.querySelector('.tps-seg-btn.is-on')?.textContent;
    [...host.querySelectorAll('.tps-seg-btn')].find((b) => b.textContent === (cur === '글 앞으로' ? '어울림' : '글 앞으로')).click();
    saved.pos = { before: capBefore, after: host.querySelector('.tps-pos-cap').textContent,
                  pieces: host.querySelectorAll('.tps-pos-stage > *').length };

    // 모르는 섹션은 false 로 폴백을 알려야 한다
    const unknown = ps.mount(host, w, services, ctx, 0, 'table', '테두리·배경');

    host.remove();
    return { rendered, saved, unknown };
  });

  console.log('  렌더:', JSON.stringify(r.rendered));
  console.log('  저장:', JSON.stringify(r.saved));

  for (const [name, v] of Object.entries(r.rendered)) {
    assert.ok(v.ok, `${name} 섹션이 그려져야 함`);
    assert.ok(v.nodes > 0, `${name} 섹션에 내용이 있어야 함`);
  }
  assert.strictEqual(r.saved.pageBreak, 0, '쪽 넘김 — 나누지 않음 저장');
  assert.strictEqual(r.saved.outerTopMm, 3, '바깥 위 여백 3mm 저장');
  assert.deepStrictEqual(r.saved.caption, { has: true, dir: 3 }, '캡션 아래 저장');
  assert.strictEqual(r.saved.verticalAlign, 2, '세로 정렬 아래쪽 저장');
  assert.strictEqual(r.saved.isHeader.got, r.saved.isHeader.want, '제목 셀 저장');
  assert.strictEqual(r.saved.fieldName, '금액', '필드 이름 저장');
  assert.strictEqual(new Set(r.saved.linked).size, 1, `연동 — 네 값이 같아야 함: ${r.saved.linked}`);
  assert.ok(r.saved.pos.after.length > 0, '배치 미리보기 설명이 있음');
  assert.notStrictEqual(r.saved.pos.after, r.saved.pos.before, '배치를 바꾸면 미리보기도 바뀜');
  assert.ok(r.saved.pos.pieces > 3, '미리보기에 글줄·표가 그려짐');
  assert.strictEqual(r.unknown, false, '테두리·배경은 이 모듈이 맡지 않는다(폴백 신호)');

  assert.deepStrictEqual(errors, [], `페이지 오류 발생: ${JSON.stringify(errors)}`);
});
