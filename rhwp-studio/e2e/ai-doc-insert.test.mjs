/**
 * AI 초안을 서식과 함께 본문에 넣기.
 * ① 제목·소제목·본문의 **크기·굵기가 다르게** 들어간다
 * ② 되돌리기 **한 번**에 통째로 사라진다(줄마다 기록하면 20번 눌러야 한다)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const DRAFT = '사업 계획서\n\n1. 사업 개요\n가. 사업명: [사업명]\n본 사업은 목표를 향해 추진됩니다.';
const WITH_TABLE = '예산 계획\n1. 소요 예산\n|항목|금액|\n|인건비|1,000천원|\n|재료비|500천원|\n이상과 같이 편성하였습니다.';

runTest('AI 초안 삽입 — 서식·되돌리기', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  const before = await page.evaluate(() => window.__wasm.getParagraphCount(0));

  const styles = await page.evaluate(async (draft) => {
    const m = await import('/src/ui/ai-doc-insert.ts');
    const n = m.insertFormatted(window.__inputHandler, draft);
    window.__eventBus.emit('document-changed');
    await new Promise((r) => setTimeout(r, 600));
    const w = window.__wasm;
    const out = [];
    for (let i = 0; i < n; i++) {
      const len = w.getParagraphLength(0, i);
      const p = w.getCharPropertiesAt(0, i, 0);
      out.push({ text: w.getTextRange(0, i, 0, len).slice(0, 12), pt: p.fontSize / 100, bold: !!p.bold });
    }
    return { n, out };
  }, DRAFT);

  console.log('  ① 넣은 줄:', styles.n);
  for (const s of styles.out) console.log(`     ${s.pt}pt ${s.bold ? '굵게' : '보통'} — ${s.text}`);

  const [title, h1, h2, body] = styles.out;
  assert.ok(title.pt > h1.pt, `제목이 대제목보다 커야 한다: ${title.pt} vs ${h1.pt}`);
  assert.ok(h1.pt > h2.pt, `대제목이 소제목보다 커야 한다: ${h1.pt} vs ${h2.pt}`);
  assert.ok(h2.pt > body.pt, `소제목이 본문보다 커야 한다: ${h2.pt} vs ${body.pt}`);
  assert.ok(title.bold && h1.bold && h2.bold && !body.bold, '제목류만 굵게');

  // ② 되돌리기 한 번
  await clickEditArea(page);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate(() => window.__wasm.getParagraphCount(0));
  console.log('  ② 되돌린 뒤 문단 수:', after, '(넣기 전', before, ')');
  assert.strictEqual(after, before, '되돌리기 한 번에 통째로 사라져야 한다');

  // ③ 표가 실제 표로 들어가고, 제목은 가운데 정렬
  const t = await page.evaluate(async (draft) => {
    const m = await import('/src/ui/ai-doc-insert.ts');
    m.insertFormatted(window.__inputHandler, draft);
    window.__eventBus.emit('document-changed');
    await new Promise((r) => setTimeout(r, 900));
    const w = window.__wasm;
    const tables = w.getTables(0);
    let cells = [];
    if (tables.length) {
      const tb = tables[0];
      const seen = new Set();
      for (const b of w.getTableCellBboxes(0, tb.para, tb.controlIdx)) {
        if (seen.has(b.cellIdx)) continue;
        seen.add(b.cellIdx);
        const len = w.getCellParagraphLength(0, tb.para, tb.controlIdx, b.cellIdx, 0);
        cells.push(len ? w.getTextInCell(0, tb.para, tb.controlIdx, b.cellIdx, 0, 0, len) : '');
      }
    }
    return {
      표수: tables.length,
      크기: tables[0] ? `${tables[0].rowCount}×${tables[0].colCount}` : '',
      셀: cells,
      제목정렬: w.getParaProperties ? null : (w.getParagraphProperties?.(0, 0)?.alignment ?? null),
    };
  }, WITH_TABLE);
  console.log('  ③ 표:', t.표수, '개', t.크기, JSON.stringify(t.셀.slice(0, 6)));
  assert.strictEqual(t.표수, 1, '표가 하나 만들어져야 한다');
  assert.strictEqual(t.크기, '3×2', '3행 2열');
  assert.ok(t.셀.includes('인건비') && t.셀.includes('1,000천원'), `셀이 채워져야 한다: ${t.셀}`);
});
