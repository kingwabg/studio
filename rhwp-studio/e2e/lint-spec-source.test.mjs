/**
 * 인라인 검사 3차 — 센터 규격(여러 벌) 적용 (스펙: docs/plans/format-linter.md)
 *
 * ① 호스트가 규격을 안 주면 내장 기본값으로 조용히 돈다(단독 실행에서 죽지 않는다)
 * ② 규격을 갈아끼우면 같은 문서의 지적이 그 규격대로 바뀐다
 * ③ 규칙을 끄면(*On:false) 그 지적이 사라진다 — 값 sentinel 이 아니라 명시 플래그
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const SENT = '이 문장은 규격 확인용으로 적어 둔 본문입니다.';

runTest('센터 규격 — 여러 벌·규칙 끄기', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 600));

  // ① 단독 실행이라 /api/format-specs 가 없다 — 내장 기본값으로 떨어져야 한다
  await page.evaluate((t) => {
    window.__wasm.doc.insertText(0, 0, 0, t);
    window.__inputHandler.applyCharPropsToRange(
      { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      { sectionIndex: 0, paragraphIndex: 0, charOffset: t.length },
      { fontFamily: '함초롬돋움', fontSize: 1400 });
    window.__eventBus.emit('document-changed');
  }, SENT);
  await page.evaluate(() => window.__lint.setFormatChecks(true));
  await new Promise((r) => setTimeout(r, 700));
  const base = await page.evaluate(() => { window.__lint.scan(); return window.__lint.count(); });
  console.log('  ① 내장 기본 규격 지적:', base, '건');
  assert.ok(base >= 2, '글꼴·크기 2건 이상');

  // ② 규격을 갈아끼운다 — 14pt·함초롬돋움을 규격으로 삼으면 지적이 사라져야 한다
  const after = await page.evaluate(() => {
    window.__lint.specs = [
      { id: 'a', name: '기본', isDefault: true,
        spec: { fontName: '함초롬바탕', fontNameOn: true, bodyPt: 10, bodyPtOn: true,
                boldBodyMinChars: 30, boldBodyOn: true, headerBoldOn: true,
                tableMaxPt: 10, tableMaxPtOn: true } },
      { id: 'b', name: '돋움 14pt 서식', isDefault: false,
        spec: { fontName: '함초롬돋움', fontNameOn: true, bodyPt: 14, bodyPtOn: true,
                boldBodyMinChars: 30, boldBodyOn: true, headerBoldOn: true,
                tableMaxPt: 10, tableMaxPtOn: true } },
    ];
    window.__lint.useSpec('b');
    return window.__lint.count();
  });
  console.log('  ② 규격을 문서에 맞추자:', after, '건');
  assert.strictEqual(after, 0, '규격을 바꾸면 지적이 사라진다');

  // ③ 규칙 끄기 — 기본 규격으로 되돌린 뒤 글꼴 규칙만 끈다
  const offCounts = await page.evaluate(() => {
    window.__lint.useSpec('a');
    const on = window.__lint.count();
    window.__lint.specs[0].spec.fontNameOn = false;
    window.__lint.useSpec('a');
    return { on, off: window.__lint.count() };
  });
  console.log('  ③ 글꼴 규칙 끄기:', JSON.stringify(offCounts));
  assert.ok(offCounts.off < offCounts.on, `규칙을 끄면 지적이 줄어야 한다 (${offCounts.on} → ${offCounts.off})`);
});
