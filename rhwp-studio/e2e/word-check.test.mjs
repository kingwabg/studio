/**
 * 문단 교정 — **지금 쓰는 문단만** 사전으로 확인하고, 우측 패널에서 고른다.
 * (사용자 결정 2026-07-31: "카카오톡처럼 내가 쓴 것만, 원할 때")
 *
 * ① 문서 전체가 아니라 커서 문단만 본다
 * ② 복합명사 대부분은 걸러진다 — 완전히는 아니다(아래 근거 참고)
 * ③ 낱말을 누르면 후보가 뜨고, 고르면 그 자리만 바뀐다(되돌리기 1회)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('문단 교정 — 낱말 확인·후보 선택', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(async () => { await window.__dict.ensureDictionary(); });

  const text = () => page.evaluate(() => {
    const w = window.__wasm;
    return w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
  });
  const chips = () => page.evaluate(() =>
    [...document.querySelectorAll('.canva-specimen-word')].map((b) => b.textContent));

  // ①② 오타가 있는 문단 + 복합명사가 있는 문단
  await page.evaluate(() => {
    const w = window.__wasm;
    w.doc.insertText(0, 0, 0, '뭐 잘 되는대 어차피 모드게 끝이라');
    w.doc.splitParagraph(0, 0, w.getParagraphLength(0, 0));
    w.doc.insertText(0, 1, 0, '통합재정수지 사회보장성기금 십억원');
    window.__inputHandler.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 5 });
    window.__eventBus.emit('document-changed');
  });
  await new Promise((r) => setTimeout(r, 1200));
  const bad = await chips();
  console.log('  ① 오타 문단:', JSON.stringify(bad));
  assert.ok(bad.includes('되는대') && bad.includes('모드게'), `오타를 잡아야 한다: ${bad}`);

  // ② 복합명사 문단으로 커서를 옮기면 조용해야 한다
  await page.evaluate(() => {
    window.__inputHandler.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 1, charOffset: 3 });
    window.__eventBus.emit('cursor-format-changed', window.__wasm.getCharPropertiesAt(0, 1, 0));
  });
  await new Promise((r) => setTimeout(r, 900));
  const compound = await chips();
  console.log('  ② 복합명사 문단:', JSON.stringify(compound));
  // 정직한 계약: 재귀 분해로 대부분 걸러지되 완전하지는 않다.
  // '사회보장성기금' 처럼 남는 게 있다 — 더 세게 쪼개면 '되는대'(오타)까지 통과해 버려서
  // 거기서 멈췄다(2026-07-31 실측). 문단 범위라 한둘은 무시하기 쉽다.
  assert.ok(!compound.includes('십억원'), `단위 접미사는 걸러야 한다: ${compound}`);
  assert.ok(!compound.includes('통합재정수지'), `복합명사는 걸러야 한다: ${compound}`);
  assert.ok(compound.length <= 1, `문단당 남는 복합명사는 1개 이하 (실측 ${compound.length}): ${compound}`);

  // ③ 후보를 골라 그 자리만 교체
  await page.evaluate(() => {
    window.__inputHandler.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 5 });
    window.__eventBus.emit('cursor-format-changed', window.__wasm.getCharPropertiesAt(0, 0, 0));
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    [...document.querySelectorAll('.canva-specimen-word')]
      .find((b) => b.textContent === '되는대')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 600));
  const cands = await page.evaluate(() =>
    [...document.querySelectorAll('.canva-word-cand')].map((b) => b.textContent));
  console.log('  ③ 후보:', JSON.stringify(cands));
  assert.ok(cands.includes('되는데'), `정답이 후보에 있어야 한다: ${cands}`);

  await page.evaluate(() => {
    [...document.querySelectorAll('.canva-word-cand')]
      .find((b) => b.textContent === '되는데')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  console.log('  ③ 고친 뒤:', JSON.stringify(await text()));
  assert.match(await text(), /되는데/, '고른 후보로 바뀌어야 한다');
});
