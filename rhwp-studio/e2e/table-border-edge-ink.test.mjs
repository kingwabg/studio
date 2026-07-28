/**
 * 실측: 표 4변 테두리의 렌더된 잉크(px) — 왼쪽·위가 오른쪽·아래보다 얇으면 잘림.
 * 판정은 스크린샷 픽셀(studio 렌더가 진실 — 엔진 데이터만 믿지 않는다).
 * WebGL 캔버스는 drawImage 로 못 읽으므로 puppeteer screenshot 경유.
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { runTest, createNewDocument } from './helpers.mjs';
const sharp = createRequire('/Users/king/dev/sc-/package.json')('sharp');

runTest('표 4변 테두리 잉크 균일(스크린샷)', async ({ page }) => {
  await createNewDocument(page);

  const g = await page.evaluate(async () => {
    const w = window.__wasm;
    const tr = JSON.parse(w.doc.createTable(0, 0, 0, 2, 5));
    window.__eventBus?.emit('document-changed');
    await new Promise((res) => setTimeout(res, 800));
    const bbox = w.getTableBBox(0, tr.paraIdx, tr.controlIdx);
    const view = window.__canvasView;
    const zoom = view.viewportManager.getZoom();
    const sc = document.querySelector('#scroll-content');
    const rect = sc.getBoundingClientRect();
    const left = view.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
    const top = view.virtualScroll.getPageOffset(0);
    // 표 4변의 client 좌표
    const C = (px, py) => ({ x: rect.left + left + px * zoom, y: rect.top + top + py * zoom });
    return {
      zoom,
      tl: C(bbox.x, bbox.y),
      br: C(bbox.x + bbox.width, bbox.y + bbox.height),
    };
  });

  // 캐럿(DOM 오버레이)이 표 왼변 근처에 있어 잉크 측정을 오염 → 숨긴다
  await page.evaluate(() => {
    document.querySelectorAll('.caret, .caret-composition').forEach((el) => { el.style.display = 'none'; });
  });
  const shot = await page.screenshot({ type: 'png' });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / page.viewport().width; // dpr
  const darkAt = (x, y) => {
    const xi = Math.round(x * scale), yi = Math.round(y * scale);
    if (xi < 0 || yi < 0 || xi >= info.width || yi >= info.height) return 0;
    const i = (yi * info.width + xi) * info.channels;
    return 255 - (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  // 변에 수직으로 ±8px(CSS) 훑음 — sum=잉크 총량
  const scan = (cx, cy, horiz) => {
    let sum = 0, max = 0;
    for (let d = -8; d <= 8; d += 1 / scale) {
      const v = horiz ? darkAt(cx + d, cy) : darkAt(cx, cy + d);
      sum += v; max = Math.max(max, v);
    }
    return { sum: Math.round(sum), max: Math.round(max) };
  };
  // ⚠ 2행 표의 세로 중앙 = 행 경계선 → 왼/오 스캔이 내부 가로선을 오염 집계.
  //   행 중앙(1/4 지점)·열 중앙에서 잰다.
  const midX = g.tl.x + (g.br.x - g.tl.x) * 0.5, midY = g.tl.y + (g.br.y - g.tl.y) * 0.25;
  const r = {
    left: scan(g.tl.x, midY, true),
    right: scan(g.br.x, midY, true),
    top: scan(midX, g.tl.y, false),
    bottom: scan(midX, g.br.y, false),
  };
  console.log('  실측:', JSON.stringify(r), 'scale=', scale);

  assert.ok(r.left.max > 30 && r.top.max > 30, `테두리 자체가 안 잡힘: ${JSON.stringify(r)}`);
  assert.ok(r.left.sum >= r.right.sum * 0.7,
    `왼쪽 테두리 잉크 부족: left=${r.left.sum} right=${r.right.sum}`);
  assert.ok(r.top.sum >= r.bottom.sum * 0.7,
    `위 테두리 잉크 부족: top=${r.top.sum} bottom=${r.bottom.sum}`);
});
