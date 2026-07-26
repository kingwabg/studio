/**
 * floating 표 드래그가 A4 여백(인쇄영역) 안에서 멈추는지 검증.
 * Paper 앵커(가로·세로 모두 offset 이동 가능)로 4방향 각각 리셋 후 여백 밖으로 끌어 검증.
 * 실행: node e2e/officex-margin-clamp.test.mjs --mode=headless
 *
 * ⚠ 계약 전환(2026-07-26): 판정 기준이 여백 상자 → **용지 경계**다.
 * 여백 상자 클램프는 정상 배치까지 막았다 — 위35/아래30mm 여백 문서에서 세로 0~30mm
 * 지정이 전부 35mm 로 덮이고 아래 여백으로 못 내려갔다(사용자 실사용 보고).
 * 원래 목적(용지 밖 이탈 방지)만 남긴다. 실측: 5→6mm·250→251mm 반영, 400mm 는
 * 283mm(=297−표높이)에서 정지.
 */
import { runTest, loadApp, clickEditArea, captureCanvasScreenshot } from './helpers.mjs';
const OUT = 'e2e/screenshots';

async function setup(page) {
  await page.evaluate(() => window.__eventBus?.emit?.('create-new-document'));
  await page.waitForSelector('#scroll-container canvas', { timeout: 10000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)));
  await clickEditArea(page);
  const c = await page.evaluate(() => {
    const w = window.__wasm; const d = w.doc; const sec=0,para=0;
    const textLen = d.getParagraphLength(sec,para);
    const r = JSON.parse(d.createTableEx(JSON.stringify({ sectionIdx:sec, paraIdx:para, charOffset:textLen, rowCount:2, colCount:2, treatAsChar:true, colWidths:[6000,6000] })));
    for (let i=0;i<4;i++) d.insertTextInCell(sec, r.paraIdx, r.controlIdx, i, 0, 0, 'C'+i);
    // Paper 앵커 → 가로·세로 offset 모두 bbox 에 반영(자유 이동)
    w.setTableProperties(sec, r.paraIdx, r.controlIdx, { treatAsChar:false, textWrap:'Square', vertRelTo:'Paper', horzRelTo:'Paper', vertOffset:22500, horzOffset:22500 });
    window.__inputHandler.cursor.enterTableObjectSelectionDirect(sec, r.paraIdx, r.controlIdx);
    window.__inputHandler.renderTableObjectSelection?.();
    return { sec, ppi:r.paraIdx, ci:r.controlIdx };
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  return c;
}
async function resetMid(page, c) { // 표를 페이지 중앙 근처로 되돌리고 재선택
  await page.evaluate((cc)=>{ window.__wasm.setTableProperties(cc.sec, cc.ppi, cc.ci, { vertRelTo:'Paper', horzRelTo:'Paper', vertOffset:30000, horzOffset:22500 }); window.__inputHandler.cursor.enterTableObjectSelectionDirect(cc.sec, cc.ppi, cc.ci); window.__inputHandler.renderTableObjectSelection?.(); window.__eventBus?.emit?.('document-changed'); }, c);
  await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));
}
async function pageMetrics(page) {
  return page.evaluate(() => {
    const w = window.__wasm; const pd = w.getPageDef(0); const P = 75;
    return { pageWpx: pd.width/P, pageHpx: pd.height/P,
      left: pd.marginLeft/P, right: pd.width/P - pd.marginRight/P,
      top: (pd.marginTop+pd.marginHeader)/P, bottom: pd.height/P - (pd.marginBottom+pd.marginFooter)/P,
      zoom: (window.__canvasView.viewportManager||window.__canvasView).getZoom() };
  });
}
async function bbox(page, c){ return page.evaluate((cc)=> window.__wasm.getTableBBox(cc.sec, cc.ppi, cc.ci), c); }

async function drag(page, c, cb, m, tX, tY) {
  const bb = await bbox(page, c);
  const sx = cb.x + (bb.x + bb.width/2) * m.zoom;
  const sy = cb.y + (bb.y + bb.height/2) * m.zoom;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i=1;i<=24;i++){
    await page.mouse.move(sx + (tX-sx)*i/24, sy + (tY-sy)*i/24);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));
  }
  await page.evaluate(()=>new Promise(r=>setTimeout(r,120)));
  await page.mouse.up();
  await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));
  return bbox(page, c);
}

runTest('margin clamp', async ({ page }) => {
  await page.setViewport({ width: 1280, height: 1500, deviceScaleFactor: 2 });
  await loadApp(page);
  const c = await setup(page);
  const canvas = await page.$('#scroll-container canvas'); const cb = await canvas.boundingBox();
  const m = await pageMetrics(page);
  console.log('  여백 상자 px: x['+m.left.toFixed(1)+'~'+m.right.toFixed(1)+'] y['+m.top.toFixed(1)+'~'+m.bottom.toFixed(1)+']  (page '+m.pageWpx.toFixed(0)+'x'+m.pageHpx.toFixed(0)+', zoom '+m.zoom+')');
  console.log('  bbox 초기:', JSON.stringify(await bbox(page,c)));
  const EPS = 2; const results = [];

  await resetMid(page, c);
  let bb = await drag(page, c, cb, m, cb.x - 300, cb.y + (30000/75)*m.zoom);
  results.push(['LEFT ', bb, bb.x >= 0 - EPS]); // 용지 왼쪽 경계
  await captureCanvasScreenshot(page, `${OUT}/clamp-left.png`, 'left');

  await resetMid(page, c);
  bb = await drag(page, c, cb, m, cb.x + cb.width + 300, cb.y + (30000/75)*m.zoom);
  results.push(['RIGHT', bb, (bb.x+bb.width) <= m.pageWpx + EPS]); // 용지 오른쪽 경계
  await captureCanvasScreenshot(page, `${OUT}/clamp-right.png`, 'right');

  await resetMid(page, c);
  bb = await drag(page, c, cb, m, cb.x + (22500/75+80)*m.zoom, cb.y - 300);
  results.push(['TOP  ', bb, bb.y >= 0 - EPS]); // 용지 위 경계
  await captureCanvasScreenshot(page, `${OUT}/clamp-top.png`, 'top');

  await resetMid(page, c);
  bb = await drag(page, c, cb, m, cb.x + (22500/75+80)*m.zoom, cb.y + (m.bottom + 200)*m.zoom);
  results.push(['DOWN ', bb, (bb.y+bb.height) <= m.pageHpx + EPS]); // 용지 아래 경계
  await captureCanvasScreenshot(page, `${OUT}/clamp-bottom.png`, 'bottom');

  console.log('\n  === 결과 (용지 안 = PASS — 여백 배치는 허용, 2026-07-26 계약 전환) ===');
  let allPass = true;
  for (const [dir, b, pass] of results){ if(!pass) allPass=false;
    console.log(`  ${dir}: bbox x=${b.x.toFixed(1)}..${(b.x+b.width).toFixed(1)} y=${b.y.toFixed(1)}..${(b.y+b.height).toFixed(1)}  -> ${pass?'PASS(용지 안)':'FAIL(용지 밖!)'}`);
  }
  console.log('  전체:', allPass ? 'ALL PASS' : 'SOME FAIL');
});
