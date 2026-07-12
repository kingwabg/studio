/**
 * P0-2 슬라이스2 실구동 검증: 마퀴(러버밴드) 선택.
 * 글상자 3개(A·B는 왼쪽 세로, C는 멀리) → 빈 지면에서 A·B만 덮는 사각형 드래그 →
 * A·B 2개만 다중 선택되고 C는 빠지는지 실측. 정렬 전/중/후 스크린샷.
 * 실행: node e2e/marquee-verify.mjs --mode=headless  (dev 서버 7700)
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';

const MM = 7200 / 25.4; // 1mm → HWPUNIT

runTest('마퀴 선택 실구동', async ({ page }) => {
  await createNewDocument(page);

  // 1) 글상자 3개 생성 (A:30,40 / B:30,80 / C:130,200) + 캔버스 모드 보장
  await page.evaluate((MM) => {
    const wasm = window.__wasm, ih = window.__inputHandler;
    if (!ih.canvasMode) ih.setCanvasMode(true);
    const mk = (x, y, w, h, label) => {
      const r = wasm.createShapeControl({
        sectionIdx: 0, paraIdx: 0, charOffset: 0,
        width: Math.round(w * MM), height: Math.round(h * MM),
        horzOffset: Math.round(x * MM), vertOffset: Math.round(y * MM),
        shapeType: 'textbox', treatAsChar: false, textWrap: 'InFrontOfText',
      });
      if (r.ok) wasm.insertTextInCell(0, r.paraIdx, r.controlIdx, 0, 0, 0, label);
    };
    mk(30, 40, 30, 20, '글상자 A');
    mk(30, 80, 30, 20, '글상자 B');
    mk(130, 200, 30, 20, '글상자 C(제외)');
    ih.eventBus.emit('document-changed');
  }, MM);
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
  await screenshot(page, 'marquee-01-before');

  // 2) 빈 지면(10,20)에서 (70,110)까지 드래그 — A·B는 덮고 C는 제외
  await page.evaluate((MM) => {
    const ih = window.__inputHandler;
    const sc = document.querySelector('#scroll-content');
    const cr = sc.getBoundingClientRect();
    const zoom = ih.viewportManager.getZoom();
    const pl = ih.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
    const po = ih.virtualScroll.getPageOffset(0);
    const toClient = (mmX, mmY) => ({
      x: cr.left + pl + (mmX * 96 / 25.4) * zoom,
      y: cr.top + po + (mmY * 96 / 25.4) * zoom,
    });
    const s = toClient(10, 20), e = toClient(70, 110);
    const canvas = sc.querySelector('canvas') || sc;
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: s.x, clientY: s.y, bubbles: true, button: 0 }));
    for (const t of [0.25, 0.5, 0.75, 1.0]) {
      document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: s.x + (e.x - s.x) * t, clientY: s.y + (e.y - s.y) * t, bubbles: true,
      }));
    }
    window.__marqueeEnd = e; // mouseup용 좌표 보관
  }, MM);
  await screenshot(page, 'marquee-02-dragging'); // 드래그 중(사각형 보임)

  const dragState = await page.evaluate(() => ({
    active: !!window.__inputHandler.marqueeState,
    moved: !!window.__inputHandler.marqueeState?.moved,
    overlay: !!document.querySelector('div[style*="rgba(37, 110, 244"]') ||
             !!(window.__inputHandler.marqueeOverlay),
  }));

  // 3) 놓기 → 선택 확정
  await page.evaluate(() => {
    const e = window.__marqueeEnd;
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: e.x, clientY: e.y, bubbles: true }));
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await screenshot(page, 'marquee-03-selected');

  // 4) 실측
  const result = await page.evaluate(() => {
    const ih = window.__inputHandler, wasm = window.__wasm;
    const refs = ih.cursor.getSelectedPictureRefs();
    const xs = refs.map(r => Math.round(wasm.getShapeProperties(0, r.ppi, r.ci).horzOffset / (7200 / 25.4)));
    return { inPic: ih.isInPictureObjectSelection(), multi: ih.cursor.isMultiPictureSelection(), count: refs.length, xsMm: xs };
  });

  console.log('\n=== 마퀴 선택 실측 ===');
  console.log(`드래그 중: active=${dragState.active}, moved=${dragState.moved}, 오버레이=${dragState.overlay}`);
  console.log(`선택 상태: inPicture=${result.inPic}, multi=${result.multi}, 개체 수=${result.count}`);
  console.log(`선택된 개체 x좌표(mm): [${result.xsMm.join(', ')}] (A·B=30, C=130이면 제외 성공)`);

  if (result.count !== 2) throw new Error(`기대 2개, 실제 ${result.count}개`);
  if (!result.multi) throw new Error('다중 선택 아님');
  if (result.xsMm.some(x => x === 130)) throw new Error('멀리 있는 C가 잘못 선택됨');
  if (!result.xsMm.every(x => x === 30)) throw new Error('A·B(30mm) 이외가 선택됨');
  console.log('✅ 마퀴 선택 실구동 검증 통과 (A·B만 선택, C 제외)');
});
