/**
 * P0-2 슬라이스1 실구동 검증: 다중 선택 개체 정렬(alignSelectedObjects).
 * 글상자 2개를 서로 다른 위치에 만들고 → 둘 다 선택 → '왼쪽 정렬' 호출 →
 * 개체 offset을 이전/이후로 실측한다. 스크린샷도 남긴다(정렬 전/후).
 * 실행: node e2e/align-verify.mjs  (dev 서버 7700 필요)
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';

const MM = 7200 / 25.4; // 1mm → HWPUNIT ≈ 283.46

runTest('개체 정렬 실구동', async ({ page }) => {
  await createNewDocument(page);

  // 1) 글상자 2개 생성 (A: 좌상 20,30 / B: 우하 120,80 — 일부러 어긋나게) + 글자
  const created = await page.evaluate((MM) => {
    const wasm = window.__wasm;
    const ih = window.__inputHandler;
    const mk = (xMm, yMm, wMm, hMm, label) => {
      const res = wasm.createShapeControl({
        sectionIdx: 0, paraIdx: 0, charOffset: 0,
        width: Math.round(wMm * MM), height: Math.round(hMm * MM),
        horzOffset: Math.round(xMm * MM), vertOffset: Math.round(yMm * MM),
        shapeType: 'textbox', treatAsChar: false, textWrap: 'InFrontOfText',
      });
      if (res.ok) wasm.insertTextInCell(0, res.paraIdx, res.controlIdx, 0, 0, 0, label);
      return res;
    };
    const a = mk(20, 30, 40, 20, '글상자 A');
    const b = mk(120, 80, 50, 25, '글상자 B');
    ih.eventBus.emit('document-changed');
    return { a, b };
  }, MM);

  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  // 2) 실제 컨트롤 목록에서 도형 2개를 집어 선택 (인덱스 재numbering 안전)
  const before = await page.evaluate(() => {
    const wasm = window.__wasm;
    const ih = window.__inputHandler;
    const controls = wasm.getPageControlLayout(0).controls
      .filter(c => c.type === 'shape' || c.type === 'image')
      .sort((p, q) => p.x - q.x); // 왼쪽(A) → 오른쪽(B)
    const refs = controls.map(c => ({ sec: 0, ppi: c.paraIdx, ci: c.controlIdx, type: 'shape' }));
    // 다중 선택: 첫 개체 직접 선택 → 나머지 토글 추가
    ih.cursor.enterPictureObjectSelectionDirect(0, refs[0].ppi, refs[0].ci, 'shape');
    for (let i = 1; i < refs.length; i++) ih.cursor.togglePictureObjectSelection(refs[i]);
    ih.renderPictureObjectSelection();
    // 인스펙터가 그림 컨텍스트로 전환되도록 선택 변경 이벤트 발행 → '개체 정렬' 섹션 노출
    ih.eventBus.emit('picture-object-selection-changed', true);
    const props = refs.map(r => {
      const p = wasm.getShapeProperties(0, r.ppi, r.ci);
      return { horzOffset: p.horzOffset, vertOffset: p.vertOffset, width: p.width, height: p.height };
    });
    return { count: refs.length, multi: ih.cursor.isMultiPictureSelection(), refs, props };
  });

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'align-01-before');

  // 3) 인스펙터의 '왼쪽 정렬' 버튼을 실제로 클릭 (UI 경로 전체 실증)
  const clicked = await page.evaluate(() => {
    // '개체 정렬' 섹션으로 스코프 (툴바의 문단 '왼쪽 정렬'과 혼동 방지)
    const label = Array.from(document.querySelectorAll('.canva-section-label'))
      .find(l => l.textContent.includes('개체 정렬'));
    const sec = label?.parentElement;
    const btn = sec?.querySelector('[title="왼쪽 정렬"]');
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return true;
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

  // 진단: 클릭 후에도 다중 선택이 살아있는가?
  const postClick = await page.evaluate(() => ({
    inPic: window.__inputHandler.isInPictureObjectSelection(),
    refs: window.__inputHandler.cursor.getSelectedPictureRefs().length,
  }));
  console.log(`[진단] 클릭 후 선택 상태: inPicture=${postClick.inPic}, refs=${postClick.refs}`);

  const after = await page.evaluate((refs) => {
    const wasm = window.__wasm;
    return refs.map(r => {
      const p = wasm.getShapeProperties(0, r.ppi, r.ci);
      return { horzOffset: p.horzOffset, vertOffset: p.vertOffset };
    });
  }, before.refs);

  await screenshot(page, 'align-02-after-left');

  // 4) 실측 보고 (HWPUNIT → mm 환산 병기)
  const hwToMm = (v) => (v / (7200 / 25.4)).toFixed(1);
  console.log('\n=== 개체 정렬 실측: 왼쪽 정렬 ===');
  console.log(`다중 선택 상태: ${before.multi} (개체 ${before.count}개)`);
  console.log(`인스펙터 '왼쪽 정렬' 버튼 발견·클릭: ${clicked}`);
  if (!clicked) throw new Error("인스펙터에 '개체 정렬' 버튼이 없음 — UI 미노출");
  for (let i = 0; i < before.props.length; i++) {
    const b = before.props[i], a = after[i];
    console.log(
      `[${i === 0 ? 'A' : 'B'}] horzOffset ${b.horzOffset}(${hwToMm(b.horzOffset)}mm) → ${a.horzOffset}(${hwToMm(a.horzOffset)}mm)` +
      ` · vertOffset ${b.vertOffset}(${hwToMm(b.vertOffset)}mm) → ${a.vertOffset}(${hwToMm(a.vertOffset)}mm)`,
    );
  }
  const minLeft = Math.min(...before.props.map(p => p.horzOffset));
  const allLeftAligned = after.every(a => a.horzOffset === minLeft);
  const vertUnchanged = after.every((a, i) => a.vertOffset === before.props[i].vertOffset);
  console.log(`\n검증: 모든 개체 left == 최소 left(${minLeft})? ${allLeftAligned}`);
  console.log(`검증: 세로 offset 불변? ${vertUnchanged}`);
  if (!allLeftAligned || !vertUnchanged) throw new Error('정렬 결과 불일치');
  console.log('✅ 왼쪽 정렬 실구동 검증 통과');
});
