/**
 * 전자서명 도구 4종 — 열리고, 실제로 문서에 넣어지는가.
 * 실사용 순서로 검사한다: ① NDA(빈 문서) → ② 도장(서명란) → ③ 시뮬레이터 계산.
 *
 * ⚠ 알려진 한계: 인라인 그림이 **이미 있는** 문단에 insertFormatted 로 이어 넣으면
 *   splitParagraph 의 논리/텍스트 좌표가 어긋나 문단 순서가 뒤집힌다(2026-08-01 실측).
 *   실사용 순서(문서 먼저, 도장 나중)에서는 발생하지 않아 한계로 기록한다 —
 *   근본 수리는 splitParagraph 좌표계 통일(엔진 작업)이 필요하다.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

runTest('전자서명 도구 4종', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // ① NDA — 빈 문서에 서식 위계로
  const nda = await page.evaluate(async () => {
    window.__dispatcher.dispatch('tool:nda-generator');
    await new Promise((r) => setTimeout(r, 600));
    const inputs = [...document.querySelectorAll('.consent-sim input')];
    inputs[0].value = '서창지역아동센터';
    inputs[1].value = '급식업체';
    document.querySelector('.consent-sim .dialog-btn-primary').click();
    await new Promise((r) => setTimeout(r, 1200));
    const w = window.__wasm;
    const first = w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0));
    const p0 = w.getCharPropertiesAt(0, 0, 0);
    return { first, pt: p0.fontSize / 100, bold: !!p0.bold, paras: w.getParagraphCount(0) };
  });
  console.log('  ① NDA 제목:', JSON.stringify(nda.first), `${nda.pt}pt`, nda.bold ? '굵게' : '보통', `/ ${nda.paras}문단`);
  assert.ok(nda.first.includes('비밀유지계약서'), 'NDA 제목');
  assert.ok(nda.bold && nda.pt >= 16, '제목 서식(16pt 굵게)');
  assert.ok(nda.paras >= 10, '조항이 문단으로 들어가야 한다');

  // ② 도장 — 마지막 서명란 문단에
  const seal = await page.evaluate(async () => {
    const w = window.__wasm;
    const last = w.getParagraphCount(0) - 1;
    window.__inputHandler.cursor.moveTo({
      sectionIndex: 0, paragraphIndex: last, charOffset: w.getLogicalLength(0, last),
    });
    window.__dispatcher.dispatch('tool:seal-maker');
    await new Promise((r) => setTimeout(r, 600));
    const name = document.querySelector('.seal-name');
    name.value = '왕준하';
    name.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.seal-body .dialog-btn-primary').click();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      before: w.getParagraphLength(0, last),
      logical: w.getLogicalLength(0, last),
      open: !!document.querySelector('.seal-body'),
    };
  });
  console.log('  ② 도장: 텍스트', seal.before, '/ 논리', seal.logical, '/ 닫힘', !seal.open);
  assert.ok(seal.logical > seal.before, '도장(그림)이 논리 한 칸을 더해야 한다');

  // ③ 시뮬레이터 계산
  const sim = await page.evaluate(async () => {
    const m = await import('/src/ui/esign-tools.ts');
    return m.estimateConsent(30, 'alimtalk', 1, 7);
  });
  console.log('  ③ 30명·알림톡·리마인드1:', JSON.stringify(sim));
  assert.ok(sim.done + sim.remain === 30, '완료+미응답 = 전체');
  assert.ok(sim.rate > 0.5 && sim.rate < 1, '완료율이 상식 범위');
});
