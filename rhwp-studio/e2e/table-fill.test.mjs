/**
 * 표 빈칸 AI 채우기 — 판정식 실측(docs/specs/table-fill-ai.md).
 * AI 호출은 키·네트워크가 필요하므로 여기서는 부르지 않는다. 대신 위험한 쪽,
 * 즉 **읽기(빈칸 판별)와 쓰기(채워진 칸 불변·되돌리기)** 를 실제 문서로 검사한다.
 *
 * 판정식 1 채워진 셀 불변 · 2 적용 결과 일치 · 4 되돌리기 1회 · 5 빈칸 0이면 AI 미호출
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

/** (라)용 최소 xlsx — python zipfile 로 만든 실물 압축 파일(3행 3열, 공유문자열+inlineStr). */
const XLSX_B64 = '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';

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

  // (가) 문서 파악 — 보낸 프롬프트에 본문 전체·완성된 표(참고)·지시가 실리는가
  const sent = await page.evaluate(async () => {
    history.replaceState(null, '', location.pathname); // child-record 해제
    const w = window.__wasm;
    // 완성된 참고 표 하나를 문서 끝에 추가
    const last = w.getParagraphCount(0) - 1;
    const res = w.createTableEx({ sectionIdx: 0, paraIdx: last, charOffset: 0, rowCount: 2, colCount: 2, treatAsChar: true });
    const pp = res.paraIdx ?? last, ci = res.controlIdx;
    const cell = (r, c) => w.getTableCellBboxes(0, pp, ci).find((x) => x.row === r && x.col === c).cellIdx;
    w.insertTextInCell(0, pp, ci, cell(0, 0), 0, 0, '총사업비');
    w.insertTextInCell(0, pp, ci, cell(0, 1), 0, 0, '4,800만원');
    w.insertTextInCell(0, pp, ci, cell(1, 0), 0, 0, '대상');
    w.insertTextInCell(0, pp, ci, cell(1, 1), 0, 0, '30명');
    await new Promise((r) => setTimeout(r, 400));
    // fetch 를 가로채 보낸 본문을 붙잡는다 — 응답은 빈 제안
    let captured = '';
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (!String(u).includes('/api/ai/')) return real(u, o);
      captured = JSON.parse(o.body).messages[1].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"fills":[]}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const m = await import('/src/ui/table-fill.ts');
    const services = { wasm: w, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } };
    m.openTableFill(services, '강사비는 주 3회 기준으로');
    await new Promise((r) => setTimeout(r, 900));
    window.fetch = real;
    document.querySelector('.dialog-wrap .dialog-btn')?.click(); // 닫기
    return captured;
  });
  const has = (t) => sent.includes(t);
  console.log('  (가) 프롬프트: 참고표', has('참고'), '/ 완성표값', has('4,800만원'),
    '/ 지시', has('주 3회'), '/ 빈칸좌표', has('{{'), '/ 길이', sent.length);
  assert.ok(has('참고') && has('4,800만원'), '완성된 표가 참고자료로 실린다');
  assert.ok(has('주 3회'), '사용자 지시가 실린다');
  assert.ok(has('{{'), '채울 표의 빈칸 좌표가 실린다');

  // (나) 자료 첨부 — CSV 파서 · 지원 밖 확장자 거부
  const parsed = await page.evaluate(async () => {
    const s = await import('/src/ui/table-fill-source.ts');
    const rows = s.parseCsv('항목,수량,금액\r\n"급식, 간식",15,"1,200,000"\n교재비,,30000\n');
    const file = (name, body) => new File([body], name, { type: 'text/plain' });
    const err = async (name, body) => {
      try { await s.readSourceFile(file(name, body)); return null; } catch (e) { return e.message; }
    };
    const csv = await s.readSourceFile(file('예산.csv', '항목,금액\n급식비,1250000\n'));
    return {
      rows,
      pdf: await err('자료.pdf', 'x'),
      hwp: await err('자료.hwp', 'x'),
      text: csv.text, totalRows: csv.totalRows,
    };
  });
  console.log('  (나) CSV 행:', JSON.stringify(parsed.rows));
  console.log('      PDF 거부:', parsed.pdf, '/ 기타 거부:', parsed.hwp);
  assert.deepStrictEqual(parsed.rows, [
    ['항목', '수량', '금액'], ['급식, 간식', '15', '1,200,000'], ['교재비', '', '30000'],
  ], '따옴표 안의 쉼표·빈 칸을 그대로 읽는다');
  assert.ok(parsed.pdf?.includes('PDF'), 'PDF 는 이유를 밝히고 거부한다');
  assert.ok(parsed.hwp?.includes('.xlsx'), '지원 밖 확장자는 되는 형식을 알려준다');
  assert.ok(parsed.text.includes('1250000') && parsed.totalRows === 2, 'CSV 가 프롬프트 텍스트가 된다');

  // (다) 첨부한 자료가 프롬프트의 [첨부 자료] 절로 실리고, 시스템 규칙이 얹히는가
  const attached = await page.evaluate(async () => {
    let user = '', system = '';
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (!String(u).includes('/api/ai/')) return real(u, o);
      const m = JSON.parse(o.body).messages;
      system = m[0].content; user = m[1].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"fills":[]}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const m = await import('/src/ui/table-fill.ts');
    m.openTableFill({ wasm: window.__wasm, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } });
    await new Promise((r) => setTimeout(r, 500));
    // 파일 선택 경로를 그대로 태운다 — DataTransfer 로 input.files 를 채운다
    const input = document.querySelector('.tfill-src input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['항목,금액\n급식비,1250000\n교재비,340000\n'], '예산.csv', { type: 'text/csv' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 900));
    const info = document.querySelector('.tfill-srcinfo')?.textContent ?? '';
    window.fetch = real;
    document.querySelector('.dialog-wrap .dialog-btn')?.click();
    return { user, system, info };
  });
  console.log('  (다) 첨부 절', attached.user.includes('[첨부 자료 — 예산.csv]'),
    '/ 값', attached.user.includes('1250000'), '/ 규칙', attached.system.includes('(확인 필요)'));
  console.log('      화면 고지:', attached.info);
  assert.ok(attached.user.includes('[첨부 자료 — 예산.csv]'), '첨부가 [첨부 자료] 절로 실린다');
  assert.ok(attached.user.includes('1250000') && attached.user.includes('340000'), '첨부의 숫자가 실린다');
  assert.ok(attached.system.includes('그대로 옮겨 적는다')
    && attached.system.includes('(확인 필요)') && attached.system.includes('추정 금지'),
    '첨부가 있으면 "자료 값을 그대로 · 없는 값은 (확인 필요)" 규칙이 얹힌다');
  assert.ok(/3행 \d+자 전송/.test(attached.info) && attached.info.includes('AI 서버'),
    '전송되는 행·글자 수를 화면에 밝힌다');

  // (라) 진짜 xlsx — 압축(deflate)·공유 문자열·inlineStr·빈 칸·XML 이스케이프를 한 번에.
  //      라이브러리 없이 zip 을 푸는 경로라 실물 바이트로만 검사가 된다.
  const xlsx = await page.evaluate(async (b64) => {
    const s = await import('/src/ui/table-fill-source.ts');
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await s.readSourceFile(new File([bin], '예산.xlsx'));
    return { rows: doc.rows, text: doc.text };
  }, XLSX_B64);
  console.log('  (라) xlsx 행:', JSON.stringify(xlsx.rows));
  assert.deepStrictEqual(xlsx.rows, [
    ['항목', '수량', '금액'],
    ['급식비', '15', '1250000'],
    ['교재비 & 부자재', '', '340,000'],
  ], 'xlsx 를 라이브러리 없이 격자로 읽는다(공유문자열·inlineStr·빈 칸·&amp;)');
  assert.ok(xlsx.text.includes('| 급식비 | 15 | 1250000 |'), 'xlsx 도 같은 격자 텍스트가 된다');

  // (마) 경합 — 대화상자를 열면 곧바로 1차 scan 이 뜨고, 자료를 붙이면 2차가 뜬다.
  //      **1차(자료 없음) 응답이 늦게 도착해 첨부 결과를 덮어쓰던 실사고**의 재발 방지.
  //      실물 AI 검증에서 "첨부를 무시한 답"으로 보였던 것의 진짜 원인이 이것이었다.
  const race = await page.evaluate(async () => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (!String(u).includes('/api/ai/')) return real(u, o);
      const withSrc = JSON.parse(o.body).messages[1].content.includes('[첨부 자료');
      const text = withSrc ? '첨부값' : '헌답';
      if (!withSrc) await new Promise((r) => setTimeout(r, 1500)); // 1차를 일부러 늦춘다
      return new Response(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify({ fills: [{ table: 1, row: 1, col: 1, text }] }) } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const m = await import('/src/ui/table-fill.ts');
    m.openTableFill({ wasm: window.__wasm, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } });
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('.tfill-src input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['항목,금액\n급식비,1\n'], 'a.csv', { type: 'text/csv' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 2500)); // 늦은 1차가 도착하고도 남을 시간
    const shown = [...document.querySelectorAll('.tfill-text')].map((i) => i.value);
    window.fetch = real;
    document.querySelector('.dialog-wrap .dialog-btn + .dialog-btn')?.click(); // 취소
    return shown;
  });
  console.log('  (마) 늦게 온 1차 응답 이후 화면:', JSON.stringify(race));
  assert.deepStrictEqual(race, ['첨부값'], '늦게 도착한 첨부 없는 답이 첨부 결과를 덮지 않는다');
});
