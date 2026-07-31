/**
 * AI 초안을 서식과 함께 본문에 넣기.
 * ① 제목·소제목·본문의 **크기·굵기가 다르게** 들어간다
 * ② 되돌리기 **한 번**에 통째로 사라진다(줄마다 기록하면 20번 눌러야 한다)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const DRAFT = '사업 계획서\n\n1. 사업 개요\n가. 사업명: [사업명]\n본 사업은 목표를 향해 추진됩니다.';

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
});
