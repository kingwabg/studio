/**
 * 변경 검토 — 판정식 실측(docs/specs/change-review.md).
 * 조언(AI)은 키가 필요해 제외 — 문서 불변(판정식 5)은 흐름상 fetch 실패로도 성립한다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const OLD = '우울하다 박으로 나갔다.';
const NEW = '기분 전환을 위해 밖으로 나갔다.';

runTest('변경 검토', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // 판정식 1 — 시작: 이전+새 글, 빨강 취소선 / 초록 밑줄
  const started = await page.evaluate(async ({ OLD, NEW }) => {
    const m = await import('/src/ui/change-review.ts');
    const w = window.__wasm;
    w.insertText(0, 0, 0, OLD);
    await new Promise((r) => setTimeout(r, 300));
    const services = { wasm: w, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } };
    m.startParaReview(services, { sec: 0, para: 0, oldText: OLD, newText: NEW });
    await new Promise((r) => setTimeout(r, 500));
    const text = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    const oldP = w.getCharPropertiesAt(0, 0, 1);
    const newP = w.getCharPropertiesAt(0, 0, OLD.length + 1);
    return {
      text,
      old: { strike: !!oldP.strikethrough, color: oldP.textColor },
      neu: { underline: !!newP.underline, color: newP.textColor },
      bar: !!document.querySelector('.chg-bar'),
    };
  }, { OLD, NEW });
  console.log('  ① 텍스트 결합:', started.text === OLD + NEW,
    '/ 이전', JSON.stringify(started.old), '/ 새', JSON.stringify(started.neu), '/ 바', started.bar);
  assert.strictEqual(started.text, OLD + NEW, '이전+새 글 결합');
  assert.ok(started.old.strike && /d93025/i.test(started.old.color), '이전 = 빨강 취소선');
  assert.ok(started.neu.underline && /188038/i.test(started.neu.color), '새 글 = 초록 밑줄');
  assert.ok(started.bar, '검토 바 표시');

  await page.screenshot({ path: 'e2e/screenshots/change-review.png' });

  // 판정식 2 — [진행]: 새 글만 남고 서식 완전 해제
  const accepted = await page.evaluate(async ({ NEW }) => {
    const w = window.__wasm;
    [...document.querySelectorAll('.chg-bar button')].find((b) => b.textContent === '진행').click();
    await new Promise((r) => setTimeout(r, 600));
    const text = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    const p1 = w.getCharPropertiesAt(0, 0, 1);
    const p2 = w.getCharPropertiesAt(0, 0, NEW.length - 2);
    return {
      text,
      clean: !p1.strikethrough && !p1.underline && !p2.strikethrough && !p2.underline,
      colors: [p1.textColor, p2.textColor],
      bar: !!document.querySelector('.chg-bar'),
    };
  }, { NEW });
  console.log('  ② 확정:', JSON.stringify(accepted.text), '/ 서식 해제', accepted.clean,
    '/ 색', JSON.stringify(accepted.colors), '/ 바 닫힘', !accepted.bar);
  assert.strictEqual(accepted.text, NEW, '새 글만 남는다');
  assert.ok(accepted.clean, '취소선·밑줄 해제');
  assert.ok(accepted.colors.every((c) => /000000|^#0+$/i.test(c)), '글자색 복귀');
  assert.ok(!accepted.bar, '바 닫힘');

  // 판정식 3 — [취소]: undo 1회로 원상
  const cancelled = await page.evaluate(async ({ OLD, NEW }) => {
    const m = await import('/src/ui/change-review.ts');
    const w = window.__wasm;
    const before = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    const services = { wasm: w, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } };
    m.startParaReview(services, { sec: 0, para: 0, oldText: before, newText: OLD });
    await new Promise((r) => setTimeout(r, 500));
    [...document.querySelectorAll('.chg-bar button')].find((b) => b.textContent === '취소').click();
    await new Promise((r) => setTimeout(r, 600));
    const after = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    const p = w.getCharPropertiesAt(0, 0, 1);
    return { same: after === before, clean: !p.strikethrough && !p.underline };
  }, { OLD, NEW });
  console.log('  ③ 취소 복원:', cancelled.same, '/ 서식 없음', cancelled.clean);
  assert.ok(cancelled.same && cancelled.clean, '취소 = 원상 복귀');

  // 판정식 4 — [재작성]: 복원이 먼저, 콜백이 나중
  const rewrite = await page.evaluate(async ({ NEW }) => {
    const m = await import('/src/ui/change-review.ts');
    const w = window.__wasm;
    const before = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    let textAtCallback = null;
    const services = { wasm: w, getInputHandler: () => window.__inputHandler,
      eventBus: { emit: () => {} } };
    m.startParaReview(services, {
      sec: 0, para: 0, oldText: before, newText: NEW,
      onRewrite: () => { textAtCallback = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)); },
    });
    await new Promise((r) => setTimeout(r, 500));
    [...document.querySelectorAll('.chg-bar button')].find((b) => b.textContent === '재작성').click();
    await new Promise((r) => setTimeout(r, 600));
    return { restoredFirst: textAtCallback === before };
  }, { NEW });
  console.log('  ④ 재작성: 복원 후 콜백', rewrite.restoredFirst);
  assert.ok(rewrite.restoredFirst, '원상 복귀가 먼저다');
});
