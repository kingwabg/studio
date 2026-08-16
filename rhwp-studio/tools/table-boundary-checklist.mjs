// 표 경계선 전 조작 체크리스트 — 키보드·마우스·클릭 경계 이동 전부 목록화 검증.
//
// [2026-08-16 사용자 요구] "정밀한 테스트 만들어서 하나하나 목록화해서 체크화해.
// 키보드, 마우스 클릭 경계선 이동 전부!!" — 표 물리 수정 후엔 반드시 이 스크립트를
// 돌려 전 항목 ✓ 를 확인한다. 실행: dev 서버(7702)·headless 크롬(9666) 켠 뒤
//   node tools/table-boundary-checklist.mjs
// 규약: mydocs 표 경계선 6규칙(안쪽 전체 이동·바깥 금지·어긋내기 자기축·표 크기 불변).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
let shot = 0;
const check = async (page, cat, name, ok, detail = '') => {
  results.push({ cat, name, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} [${cat}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) {
    const f = `/tmp/tbc-${String(shot++).padStart(2, '0')}.png`;
    try { await page.screenshot({ path: f, clip: { x: 140, y: 190, width: 720, height: 360 } }); console.log(`    ↳ ${f}`); } catch {}
  }
};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9666', defaultViewport: null, protocolTimeout: 900000 });
for (const p of await browser.pages()) { const u = p.url(); if (u.includes('7702') || u.includes('sc-hazel')) await p.close().catch(() => {}); }
const page = await browser.newPage();
await page.bringToFront();
await page.setViewport({ width: 1380, height: 950, deviceScaleFactor: 1 });
await page.goto('http://localhost:7702', { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(3500);
await page.evaluate(() => { for (const el of document.querySelectorAll('body > div')) { if ((el.textContent || '').includes('불러오는 중') || (el.textContent || '').includes('복구')) el.remove(); } });
await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if ((b.textContent || '').trim() === '캔버스') { b.click(); break; } });
await sleep(1200);

const freshDoc = async () => {
  // 직전 케이스가 남긴 개체 선택·셀 선택 상태가 다음 mousedown 을 먹지 않게 초기화
  await page.keyboard.press('Escape'); await sleep(80);
  await page.keyboard.press('Escape'); await sleep(80);
  await page.evaluate(async () => {
    const r = await fetch('/samples/officex_blank.hwpx'); const b = await r.arrayBuffer();
    window.__wasm.loadDocument(new Uint8Array(b), 'blank.hwpx'); window.__canvasView.loadDocument();
  });
  await sleep(750);
  for (let t = 0; t < 4; t++) { const h = await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { const x = (b.textContent || '').trim(); if (['대체 글꼴로 보기', '확인', '그대로 보기', '닫기'].includes(x) && b.getBoundingClientRect().width > 0) { b.click(); return x; } } return null; }); if (!h) break; await sleep(300); }
  await page.mouse.click(240, 275); await sleep(220);
  const info = await page.evaluate(() => {
    const w = window.__wasm; const ih = window.__inputHandler ?? window.__ih;
    const pos = ih.getPosition();
    const r = JSON.parse(w.doc.createTable(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, 3, 3));
    window.__canvasView?.rerender?.(); return r;
  });
  await sleep(550);
  await page.evaluate((info) => { window.__tbl = { pi: info.paraIdx, ci: info.controlIdx }; }, info);
  // 초기 시각 격자 앵커 — 어긋낸 뒤에도 "사용자가 보는 (행,열)" 위치로 조작하기 위함
  await page.evaluate(() => {
    const w = window.__wasm; const t = window.__tbl;
    const bbs = w.getTableCellBboxes(0, t.pi, t.ci);
    window.__vis0 = bbs.map(b => ({ row: b.row, col: b.col, x: b.x, y: b.y, w: b.w, h: b.h }));
  });
};
const grid = () => page.evaluate(() => {
  const w = window.__wasm; const t = window.__tbl;
  const bbs = w.getTableCellBboxes(0, t.pi, t.ci).map(b => ({ row: b.row, col: b.col, rs: b.rowSpan, cs: b.colSpan, x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1), ci: b.cellIdx }));
  const tb = w.getTableBBox(0, t.pi, t.ci);
  return { cells: bbs, tW: +tb.width.toFixed(1), tH: +tb.height.toFixed(1) };
});
// (r,c) = **초기 시각 격자** 기준 — 어긋낸 뒤에도 사용자가 보는 그 자리의 픽셀로 계산.
// 경계(bottomY/rightX)는 그 자리의 **현재** 셀 bbox 에서 읽는다(경계선이 이동했을 수 있음).
const vis = (r, c) => page.evaluate(([r, c]) => {
  const w = window.__wasm; const t = window.__tbl;
  const v0 = (window.__vis0 || []).find(b => b.row === r && b.col === c);
  if (!v0) return null;
  const px = v0.x + v0.w / 2;
  const py = v0.y + Math.min(v0.h, 16) / 2 + 2;
  const bbs = w.getTableCellBboxes(0, t.pi, t.ci);
  const cur = bbs.find(b => b.x <= px && px < b.x + b.w && b.y <= py && py < b.y + b.h) || null;
  const cv = [...document.querySelectorAll('canvas')].filter(c => c.width > 1000).pop();
  const rc = cv.getBoundingClientRect(); const z = rc.width / (cv.width / 2);
  const bb = cur || v0;
  return { cx: rc.left + px * z, cy: rc.top + py * z,
    bottomY: rc.top + (bb.y + bb.h) * z, rightX: rc.left + (bb.x + bb.w) * z, midY: rc.top + (bb.y + bb.h / 2) * z,
    row: cur ? cur.row : v0.row, col: cur ? cur.col : v0.col,
    rs: cur ? cur.rowSpan : 1, cs: cur ? cur.colSpan : 1,
    curBottomPagePx: bb.y + bb.h, curRightPagePx: bb.x + bb.w };
}, [r, c]);
const dragV = async (x, y, dx, dy, shift) => {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y); await sleep(70);
  await page.mouse.down(); await sleep(90);
  await page.mouse.move(x + dx, y + dy, { steps: 5 }); await sleep(90);
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await sleep(430);
};
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const sizeOk = (g0, g1) => near(g0.tW, g1.tW, 0.4) && near(g0.tH, g1.tH, 0.4);
const curCell = () => page.evaluate(() => {
  const ih = window.__inputHandler ?? window.__ih;
  const ctx = ih.cursor?.getCellTableContext?.();
  const cp = ctx?.cellPath?.[0];
  return cp ? cp.cellIndex : null;
});
const selRange = () => page.evaluate(() => {
  const ih = window.__inputHandler ?? window.__ih;
  const r = ih.cursor?.getSelectedCellRange?.();
  return r ? `${r.startRow},${r.startCol}-${r.endRow},${r.endCol}` : null;
});

// ═══════════ 1. 일반 경계 이동(마우스, 전체 선) — 규약 1: 선 전체 이동·표 크기 불변 ═══════════
for (const [name, seg, d] of [
  ['가로 내부선1 ↓', [0, 1, 'bottom'], [0, 8]], ['가로 내부선1 ↑', [0, 1, 'bottom'], [0, -8]],
  ['가로 내부선2 ↓', [1, 1, 'bottom'], [0, 8]], ['가로 내부선2 ↑', [1, 1, 'bottom'], [0, -8]],
  ['세로 내부선1 →', [1, 0, 'right'], [8, 0]], ['세로 내부선1 ←', [1, 0, 'right'], [-8, 0]],
  ['세로 내부선2 →', [1, 1, 'right'], [8, 0]], ['세로 내부선2 ←', [1, 1, 'right'], [-8, 0]],
]) {
  await freshDoc();
  const g0 = await grid();
  const v = await vis(seg[0], seg[1]);
  const [px, py] = seg[2] === 'bottom' ? [v.cx, v.bottomY] : [v.rightX, v.midY];
  await dragV(px, py, d[0], d[1], false);
  const g1 = await grid();
  // 전체 선: 그 선의 모든 세그가 같이 이동, 표 크기 불변
  const isRow = seg[2] === 'bottom';
  const linePosBefore = isRow ? g0.cells.find(b => b.row === seg[0] && b.col === 0).y + g0.cells.find(b => b.row === seg[0] && b.col === 0).h
                             : g0.cells.find(b => b.col === seg[1] && b.row === 0).x + g0.cells.find(b => b.col === seg[1] && b.row === 0).w;
  const segsMoved = [0, 1, 2].map(k => {
    const b0 = isRow ? g0.cells.find(b => b.row === seg[0] && b.col === k) : g0.cells.find(b => b.col === seg[1] && b.row === k);
    const b1 = isRow ? g1.cells.find(b => b.row === seg[0] && b.col === k) : g1.cells.find(b => b.col === seg[1] && b.row === k);
    if (!b0 || !b1) return null;
    return isRow ? (b1.y + b1.h) - (b0.y + b0.h) : (b1.x + b1.w) - (b0.x + b0.w);
  });
  // 규약(사용자 확정): 표 크기 불변 + 이동 한계 = 이웃 최소. 신선 표는 모든 행이
  // 글줄 바닥이라 **가로선 일반 이동은 무동작이 정답**이고, 세로선은 폭 여유가 있어
  // 전체 선이 함께 이동해야 한다.
  const want = isRow ? 0 : d[0];
  const allMoved = segsMoved.every(m => m !== null && near(m, want, isRow ? 0.6 : 2.0));
  await check(page, '일반이동', `${name}${isRow ? ' [신선=무동작]' : ''}`, allMoved && sizeOk(g0, g1),
    `세그 이동 ${segsMoved.map(m => m?.toFixed(1)).join('/')} (기대 ${want}) 표 ${g0.tW}x${g0.tH}→${g1.tW}x${g1.tH}`);
}

// ═══════════ 2. 마우스 어긋내기 단발 + 왕복 (12세그 × ±) ═══════════
for (let b = 0; b < 12; b++) {
  for (const dir of [+1, -1]) {
    await freshDoc();
    const isRow = b < 6;
    const [r, c] = isRow ? [Math.floor(b / 3), b % 3] : [(b - 6) % 3, Math.floor((b - 6) / 3)];
    const g0 = await grid();
    const v = await vis(r, c);
    const [px, py] = isRow ? [v.cx, v.bottomY] : [v.rightX, v.midY];
    await dragV(px, py, isRow ? 0 : 12 * dir, isRow ? 12 * dir : 0, true);
    const g1 = await grid();
    const b1 = g1.cells.find(x => x.row <= r && r < x.row + x.rs && x.col <= c && c < x.col + x.cs);
    const posB = isRow ? (await (async () => { const q = g0.cells.find(x => x.row === r && x.col === c); return q.y + q.h; })()) : (() => { const q = g0.cells.find(x => x.row === r && x.col === c); return q.x + q.w; })();
    const posA = b1 ? (isRow ? b1.y + b1.h : b1.x + b1.w) : NaN;
    const moved = posA - posB;
    await check(page, '어긋단발', `${isRow ? '하' : '우'}(${r},${c}) ${dir > 0 ? '+' : '−'}12`,
      near(moved, 12 * dir, 3) && sizeOk(g0, g1),
      `이동 ${moved.toFixed(1)} 표 ${g0.tH}→${g1.tH}`);
    // 왕복 — 방금 만든 어긋난 경계(posA)를 정확히 잡아 반대로 끈다.
    // (시각 앵커의 +8px 지점은 조각이 얇으면 아래 셀로 새 나가 엉뚱한 정렬선을 잡는다)
    if (!isNaN(posA)) {
      const scr = await page.evaluate(([pos, isRow2]) => {
        const cv = [...document.querySelectorAll('canvas')].filter(c => c.width > 1000).pop();
        const rc = cv.getBoundingClientRect(); const z = rc.width / (cv.width / 2);
        return isRow2 ? rc.top + pos * z : rc.left + pos * z;
      }, [posA, isRow]);
      const v2 = await vis(r, c);
      const [qx, qy] = isRow ? [v2.cx, scr] : [scr, v2.midY];
      await dragV(qx, qy, isRow ? 0 : -12 * dir, isRow ? -12 * dir : 0, true);
      const g2 = await grid();
      const restored = g2.cells.length === 9 && g0.cells.every(x0 => {
        const x2 = g2.cells.find(y => y.row === x0.row && y.col === x0.col);
        return x2 && near(x2.y, x0.y, 2) && near(x2.h, x0.h, 2) && near(x2.x, x0.x, 2) && near(x2.w, x0.w, 2);
      });
      await check(page, '어긋왕복', `${isRow ? '하' : '우'}(${r},${c}) ${dir > 0 ? '+' : '−'}→복귀`, restored && sizeOk(g0, g2),
        `셀 ${g2.cells.length} 표 ${g2.tH}`);
    }
  }
}

// ═══════════ 3. 키보드 어긋내기 (9셀 × 4방향) ═══════════
for (let cell = 0; cell < 9; cell++) {
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
    await freshDoc();
    const r = Math.floor(cell / 3), c = cell % 3;
    const g0 = await grid();
    const v = await vis(r, c);
    await page.mouse.click(v.cx, v.cy); await sleep(200);
    await page.keyboard.press('F5'); await sleep(180);
    await page.keyboard.down('Shift'); await page.keyboard.press(key); await page.keyboard.up('Shift');
    await sleep(380);
    const g1 = await grid();
    const horizB = (key === 'ArrowUp' || key === 'ArrowDown');
    const dir = (key === 'ArrowDown' || key === 'ArrowRight') ? 1 : -1;
    const isOuter = (horizB && r === 2) || (!horizB && c === 2);
    const b1 = g1.cells.find(x => x.row <= r && r < x.row + x.rs && x.col <= c && c < x.col + x.cs);
    const b0 = g0.cells.find(x => x.row === r && x.col === c);
    const posB = horizB ? b0.y + b0.h : b0.x + b0.w;
    const posA = b1 ? (horizB ? b1.y + b1.h : b1.x + b1.w) : NaN;
    const moved = posA - posB;
    const ok = isOuter ? near(moved, 0, 0.6) && sizeOk(g0, g1)
                       : (moved * dir > 0.5) && sizeOk(g0, g1);
    await check(page, '어긋키보드', `(${r},${c}) ${key}${isOuter ? ' [바깥=무동작]' : ''}`, ok,
      `이동 ${isNaN(moved) ? '셀소실' : moved.toFixed(1)} 표 ${g0.tH}→${g1.tH}`);
  }
}

// ═══════════ 4. 연쇄 어긋내기 — 신고 ②: 같은 열 위→아래 순차(마우스·키보드) ═══════════
for (const mode of ['마우스', '키보드']) {
  for (let col = 0; col < 3; col++) {
    await freshDoc();
    const g0 = await grid();
    let ok = true; let detail = [];
    for (let step = 0; step < 2; step++) {
      // 신고 ② 그대로: "아래 행"의 하변 = **초기 행 step 의 하변 선**을 직접 잡는다.
      // (앵커 셀의 현재 하변을 잡으면, 첫 어긋내기 뒤엔 병합 셀의 어긋난 선을 잡아
      //  CATCH 치유가 발동한다 — 그건 별개 제스처다)
      const v = await vis(step, col);
      if (!v) { ok = false; detail.push(`스텝${step} 셀 없음`); break; }
      const lineY = await page.evaluate(([r]) => {
        const v0 = window.__vis0.find(b => b.row === r && b.col === 0);
        const cv = [...document.querySelectorAll('canvas')].filter(c => c.width > 1000).pop();
        const rc = cv.getBoundingClientRect(); const z = rc.width / (cv.width / 2);
        return rc.top + (v0.y + v0.h) * z;
      }, [step]);
      const gPre = await grid();
      if (mode === '마우스') {
        await dragV(v.cx, lineY, 0, 10, true);
      } else {
        await page.mouse.click(v.cx, v.cy); await sleep(200);
        await page.keyboard.press('F5'); await sleep(180);
        await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
        await sleep(300);
        await page.keyboard.press('Escape'); await sleep(150);
      }
      const gPost = await grid();
      const bPre = gPre.cells.find(x => x.row <= v.row && v.row < x.row + x.rs && x.col <= col && col < x.col + x.cs);
      const bPost = gPost.cells.find(x => x.row <= v.row && v.row < x.row + x.rs && x.col <= col && col < x.col + x.cs);
      const mv = (bPost ? bPost.y + bPost.h : NaN) - (bPre.y + bPre.h);
      if (!(mv > 0.5)) { ok = false; detail.push(`스텝${step} 이동 ${isNaN(mv) ? '소실' : mv.toFixed(1)}`); }
      if (!sizeOk(g0, gPost)) { ok = false; detail.push(`스텝${step} 표 ${g0.tH}→${gPost.tH}`); }
    }
    await check(page, '연쇄', `${mode} 열${col} 위→아래 순차`, ok, detail.join(' · ') || '2스텝 정상');
  }
}

// ═══════════ 5. F5 블록 이동 — 신고 ①: 어긋낸 표에서 전체 순회 ═══════════
{
  await freshDoc();
  let v = await vis(0, 0);
  await page.mouse.click(v.cx, v.cy); await sleep(200);
  await page.keyboard.press('F5'); await sleep(180);
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
  await sleep(350);
  await page.keyboard.press('Escape'); await sleep(200);
  // 시각 (0,0) 에서 F5 → S자 순회: →→↓←←↓→→ (8스텝, 모두 표 안쪽 이동 = 범위가 매번 변해야)
  v = await vis(0, 0);
  await page.mouse.click(v.cx, v.cy); await sleep(200);
  await page.keyboard.press('F5'); await sleep(200);
  let prev = await selRange();
  const path = ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowRight'];
  const stuck = [];
  for (const k of path) {
    await page.keyboard.press(k); await sleep(170);
    const cur = await selRange();
    if (cur === prev) stuck.push(`${k}@${cur}`);
    prev = cur;
  }
  await check(page, 'F5이동', '어긋낸 표 S자 순회 8스텝', stuck.length === 0, stuck.join(' ') || '전 스텝 이동');
  await page.keyboard.press('Escape'); await sleep(150);
  // 조각(아래 시각 셀)에서 위로 올라가기 — 병합 셀로 진입해야
  const v2 = await vis(1, 0);
  await page.mouse.click(v2.cx, v2.cy); await sleep(200);
  await page.keyboard.press('F5'); await sleep(200);
  const s0 = await selRange();
  await page.keyboard.press('ArrowUp'); await sleep(180);
  const s1 = await selRange();
  await page.keyboard.press('Escape'); await sleep(120);
  await check(page, 'F5이동', '시각(1,0)→위(병합 진입)', s1 !== null && s1 !== s0, `${s0} → ${s1}`);
  // 아래로 끝까지: 시각(0,0) F5 후 ↓↓ — 마지막 행까지 도달
  const v3 = await vis(0, 0);
  await page.mouse.click(v3.cx, v3.cy); await sleep(200);
  await page.keyboard.press('F5'); await sleep(200);
  let last = await selRange(); const downs = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown'); await sleep(170);
    const cur = await selRange();
    downs.push(cur === last ? `정지@${cur}` : 'ok');
    last = cur;
  }
  await page.keyboard.press('Escape'); await sleep(120);
  const lastRowReached = /(^|-)2,/.test(last || '') || (last || '').includes('-2') || downs.filter(d=>d==='ok').length >= 2;
  await check(page, 'F5이동', '시각(0,0)→아래 연속(끝까지)', lastRowReached, `${downs.join(' ')} 최종 ${last}`);
}

// ═══════════ 6. 캐럿 셀 진입(클릭) — 어긋낸 표 ═══════════
{
  await freshDoc();
  let v = await vis(0, 0);
  await dragV(v.cx, v.bottomY, 0, 10, true); // 마우스 어긋내기
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const vv = await vis(r, c);
    if (!vv) { await check(page, '클릭진입', `시각(${r},${c})`, false, 'bbox 없음'); continue; }
    await page.mouse.click(vv.cx, vv.cy); await sleep(150);
    const cc = await curCell();
    await check(page, '클릭진입', `시각(${r},${c})`, cc !== null, `cellIndex=${cc}`);
  }
}

// ═══════════ 요약 ═══════════
const fail = results.filter(r => !r.ok);
console.log(`\n═══ 체크리스트 요약: ${results.length - fail.length}/${results.length} 통과, 실패 ${fail.length}건 ═══`);
for (const f of fail) console.log(`  ✗ [${f.cat}] ${f.name} — ${f.detail}`);
browser.disconnect();
process.exit(fail.length ? 1 : 0);
