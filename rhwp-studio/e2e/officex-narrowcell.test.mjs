/**
 * 좁은 병합 라벨 셀 다행 텍스트 겹침 재현 — 운영일지 라벨셀 모사.
 * 실행: node e2e/officex-narrowcell.test.mjs --mode=headless
 */
import { runTest, loadApp, captureCanvasScreenshot, cropPngBuffer } from './helpers.mjs';
import { writeFileSync } from 'fs';
import { PNG } from 'pngjs';

const OUT = 'e2e/screenshots';
function up(buf, f){ const s=PNG.sync.read(buf); const o=new PNG({width:s.width*f,height:s.height*f}); for(let y=0;y<o.height;y++)for(let x=0;x<o.width;x++){const sx=(x/f)|0,sy=(y/f)|0,si=(sy*s.width+sx)*4,di=(y*o.width+x)*4;o.data[di]=s.data[si];o.data[di+1]=s.data[si+1];o.data[di+2]=s.data[si+2];o.data[di+3]=255;} return PNG.sync.write(o); }

// 좁은 라벨 셀: 2열(라벨 좁음 + 값 넓음) × 여러 행 없음 — 단일 좁은 셀에 다행 라벨
async function buildCase(page, { valign, mode, font }) {
  return page.evaluate((cfg) => {
    const w = window.__wasm; const d = w.doc; const sec=0, para=0;
    const textLen = d.getParagraphLength(sec, para);
    // 라벨 열 아주 좁게(약 12mm≈ colWidth 값 작게), 값 열 넓게
    const r = JSON.parse(d.createTableEx(JSON.stringify({
      sectionIdx: sec, paraIdx: para, charOffset: textLen,
      rowCount: 1, colCount: 2, treatAsChar: true, colWidths: [1600, 12000],
    })));
    const ci = r.controlIdx, ppi = r.paraIdx;
    // 셀 0(좁은 라벨): 세로정렬 + 높이 지정
    d.setCellProperties(sec, ppi, ci, 0, JSON.stringify({ verticalAlign: cfg.valign, height: 4000 }));
    const label = ['아동','현황','(취약구분)'];
    if (cfg.mode === 'multipara') {
      let cp = 0;
      for (let i=0;i<label.length;i++){
        d.applyParaFormatInCell(sec, ppi, ci, 0, cp, JSON.stringify({ alignment:'Center', lineSpacing:130, lineSpacingType:'Percent' }));
        d.insertTextInCell(sec, ppi, ci, 0, cp, 0, label[i]);
        d.applyCharFormatInCell(sec, ppi, ci, 0, cp, 0, label[i].length, JSON.stringify({ fontSize: cfg.font==='hcr'? 800:800 }));
        if (i < label.length-1){ const sp = JSON.parse(d.splitParagraphInCell(sec, ppi, ci, 0, cp, label[i].length)); cp = sp.cellParaIndex ?? cp+1; }
      }
    } else { // single para with \n
      const text = label.join('\n');
      d.applyParaFormatInCell(sec, ppi, ci, 0, 0, JSON.stringify({ alignment:'Center', lineSpacing:130, lineSpacingType:'Percent' }));
      d.insertTextInCell(sec, ppi, ci, 0, 0, 0, text);
    }
    // 값 셀에 본문
    d.insertTextInCell(sec, ppi, ci, 1, 0, 0, '출근 : 왕시형(센터장)');
    return { sec, ppi, ci };
  }, { valign, mode, font });
}

async function inspectCell(page, c, cellIdx){
  return page.evaluate((cc, cellIdx) => {
    const w = window.__wasm;
    // 셀 bbox
    let bb=null; try { bb = w.getTableCellBboxes(cc.sec, cc.ppi, cc.ci).filter(b=>b.cellIdx===cellIdx); } catch(e){}
    // 렌더 트리에서 이 셀 영역의 TextLine/TextRun y
    let lines=[];
    try {
      const tree = JSON.parse(w.doc.getPageRenderTree ? w.doc.getPageRenderTree(0) : w.getPageLayerTree(0));
      const walk=(n)=>{ if(!n)return; const b=n.bbox; if((n.type==='TextLine'||n.type==='TextRun')&&b){ lines.push({t:n.type,x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.w.toFixed(1),h:+b.h.toFixed(1),text:n.text||''}); } (n.children||[]).forEach(walk); };
      walk(tree);
    } catch(e){ lines=[{err:String(e)}]; }
    return { bb, lines };
  }, c, cellIdx);
}

runTest('narrow cell overlap', async ({ page }) => {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await loadApp(page, '?officexTools=daily-log');

  for (const cfg of [
    { name:'middle-multipara', valign:1, mode:'multipara' },
    { name:'top-multipara', valign:0, mode:'multipara' },
    { name:'top-singlepara-nl', valign:0, mode:'single' },
  ]) {
    await page.evaluate(() => window.__eventBus?.emit?.('create-new-document'));
    await page.waitForSelector('#scroll-container canvas', { timeout: 10000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 800)));
    const canvas = await page.$('#scroll-container canvas'); const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width/2, box.y + 80);
    await page.evaluate(() => new Promise(r => setTimeout(r, 150)));
    const c = await buildCase(page, cfg);
    await page.evaluate(() => window.__eventBus?.emit?.('document-changed'));
    await page.evaluate(() => new Promise(r => setTimeout(r, 900)));
    const info = await inspectCell(page, c, 0);
    const cellLines = (info.lines||[]).filter(l=>!l.err && l.x<80 && l.text && l.text.trim());
    console.log(`\n  [${cfg.name}] cell0 bbox=${JSON.stringify(info.bb)}`);
    console.log(`  lines(라벨셀): ${JSON.stringify(cellLines)}`);
    // 겹침 판정: 라벨 라인들의 y 간격
    const ys=[...new Set(cellLines.map(l=>l.y))].sort((a,b)=>a-b);
    console.log(`  라벨 라인 y들: ${JSON.stringify(ys)}  (간격 0이면 겹침)`);
    // 크롭
    const { buffer } = await captureCanvasScreenshot(page, `${OUT}/nc-${cfg.name}-full.png`, cfg.name);
    if (info.bb && info.bb[0]) { const b=info.bb[0]; const zoom=2; // device px 좌표
      try { const crop = cropPngBuffer(buffer, { x: Math.max(0,Math.round(b.x*zoom)-6), y: Math.max(0,Math.round(b.y*zoom)-6), width: Math.round((b.w)*zoom)+30, height: Math.round(b.h*zoom)+12 }); writeFileSync(`${OUT}/nc-${cfg.name}.png`, up(crop, 6)); console.log('  crop ok'); }
      catch(e){ console.log('  crop fail', e.message); }
    }
  }
});
