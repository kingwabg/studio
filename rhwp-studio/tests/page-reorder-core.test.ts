import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import init,{HwpDocument} from '../../pkg/rhwp.js';
import {createPageReorderFixture,pageOrder,semanticInventory,inventoryHash} from './helpers/page-reorder-fixture.ts';
await init({module_or_path:readFileSync(new URL('../../pkg/rhwp_bg.wasm',import.meta.url))});
const load=()=>{const source=createPageReorderFixture(HwpDocument);const doc=new HwpDocument(source.exportHwp());source.free();return doc as any;};
for(const [source,before,expected]of [[0,3,['쪽-2','쪽-3','쪽-1','쪽-4']],[3,0,['쪽-4','쪽-1','쪽-2','쪽-3']],[1,4,['쪽-1','쪽-3','쪽-4','쪽-2']]] as const){
  test(`실제 HWP ${source+1}쪽→슬롯${before}: 본문·병합 표·서식 보존 및 Undo/Redo`,()=>{
    const doc=load();try{
      assert.deepEqual(pageOrder(doc),['쪽-1','쪽-2','쪽-3','쪽-4']);
      const original=semanticInventory(doc),hash=inventoryHash(original),snapshot=doc.saveSnapshot();
      const ranges=JSON.parse(doc.getPageMoveRanges());assert(ranges.ok);
      const result=JSON.parse(doc.movePageRange(source,before));assert(result.ok&&result.changed);
      assert.equal(result.preservationVerified,true);assert.equal(result.contentDigestBefore,result.contentDigestAfter);
      assert.deepEqual(pageOrder(doc),expected);assert.deepEqual(semanticInventory(doc),original);
      const after=doc.saveSnapshot();doc.restoreSnapshot(snapshot);
      assert.deepEqual(pageOrder(doc),['쪽-1','쪽-2','쪽-3','쪽-4']);assert.equal(inventoryHash(semanticInventory(doc)),hash);
      doc.restoreSnapshot(after);assert.deepEqual(pageOrder(doc),expected);assert.equal(inventoryHash(semanticInventory(doc)),hash);
      const reopened=new HwpDocument(doc.exportHwp());try{assert.deepEqual(pageOrder(reopened),expected);assert.deepEqual(semanticInventory(reopened),original);}finally{reopened.free();}
      console.info('[page-reorder-preservation]',JSON.stringify({source:source+1,beforeSlot:before,order:expected,paragraphs:original.paragraphs.length,tables:original.tables.length,inventoryHash:hash,undo:true,redo:true,saveReopen:true,result}));
    }finally{doc.free();}
  });
}
test('이동하지 않은 드롭과 잘못된 목적지는 원본 HWP를 바꾸지 않는다',()=>{
  const doc=load();try{
    const before=semanticInventory(doc),order=pageOrder(doc);
    assert.equal(JSON.parse(doc.movePageRange(1,2)).changed,false);
    assert.throws(()=>doc.movePageRange(0,99));assert.deepEqual(pageOrder(doc),order);assert.deepEqual(semanticInventory(doc),before);
  }finally{doc.free();}
});
test('여러 쪽에 걸친 한 문단은 나누지 않고 함께 이동한다',()=>{
  const doc=HwpDocument.createEmpty() as any;doc.createBlankDocument();
  try{
    const text='연결된 문단의 원문과 서식을 보존합니다. '.repeat(600);
    doc.insertText(0,0,0,text);
    const next=JSON.parse(doc.insertPageBreak(0,0,doc.getLogicalLength(0,0))).paraIdx;doc.insertText(0,next,0,'분리된 마지막 쪽');
    const ranges=JSON.parse(doc.getPageMoveRanges()),count=JSON.parse(doc.getDocumentInfo()).pageCount;
    assert.equal(ranges.ranges.length,2);assert(ranges.ranges[0].endPage>0);
    const snap=doc.saveSnapshot(),result=JSON.parse(doc.movePageRange(0,count));
    assert.equal(result.newStartPage,1);assert(result.preservationVerified);
    assert.equal(doc.getTextRange(0,1,0,text.length),text);assert.equal(JSON.parse(doc.getDocumentInfo()).pageCount,count);
    doc.restoreSnapshot(snap);assert.equal(doc.getTextRange(0,0,0,text.length),text);
    console.info('[page-reorder-connected]',JSON.stringify({kind:'paragraph',ranges:ranges.ranges,result,undo:true}));
  }finally{doc.free();}
});
test('여러 쪽으로 나뉜 표는 모든 셀을 한 묶음으로 이동한다',()=>{
  const doc=HwpDocument.createEmpty() as any;doc.createBlankDocument();
  try{
    const t=JSON.parse(doc.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:90,colCount:2,treatAsChar:false,colWidths:[10000,10000],rowHeights:Array(90).fill(2200)})));
    doc.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'첫 셀');doc.insertTextInCell(0,t.paraIdx,t.controlIdx,179,0,0,'마지막 셀');
    doc.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({textWrap:'TopAndBottom',vertRelTo:'Para',horzRelTo:'Column',pageBreak:2}));
    const tail=doc.getParagraphCount(0)-1,next=JSON.parse(doc.insertPageBreak(0,tail,doc.getLogicalLength(0,tail))).paraIdx;doc.insertText(0,next,0,'분리된 쪽');
    const ranges=JSON.parse(doc.getPageMoveRanges()),count=JSON.parse(doc.getDocumentInfo()).pageCount;
    assert.equal(ranges.ranges.length,2);assert(ranges.ranges[0].endPage>0);
    const snap=doc.saveSnapshot(),result=JSON.parse(doc.movePageRange(0,count));assert(result.preservationVerified);
    const controls=Array.from({length:count},(_,p)=>JSON.parse(doc.getPageControlLayout(p)).controls).flat().filter((c:any)=>c.type==='table');
    const table:any=controls[0];assert(table);
    assert.equal(doc.getTextInCell(table.secIdx,table.paraIdx,table.controlIdx,0,0,0,100),'첫 셀');
    assert.equal(doc.getTextInCell(table.secIdx,table.paraIdx,table.controlIdx,179,0,0,100),'마지막 셀');
    doc.restoreSnapshot(snap);assert.equal(doc.getTextInCell(0,t.paraIdx,t.controlIdx,179,0,0,100),'마지막 셀');
    console.info('[page-reorder-connected]',JSON.stringify({kind:'table',ranges:ranges.ranges,result,undo:true}));
  }finally{doc.free();}
});
test('머리말이 있는 문서의 지원되지 않는 이동은 원문을 보존한 채 차단한다',()=>{
  const doc=load();try{
    doc.createHeaderFooter(0,true,0);const header=doc.getHeaderFooter(0,true,0),order=pageOrder(doc),inventory=semanticInventory(doc);
    assert.throws(()=>doc.movePageRange(0,3),/머리말/);assert.deepEqual(pageOrder(doc),order);assert.equal(doc.getHeaderFooter(0,true,0),header);assert.deepEqual(semanticInventory(doc),inventory);
  }finally{doc.free();}
});
test('필드 연결 범위를 확인할 수 없는 문서는 이동하지 않는다',()=>{
  const doc=load();try{
    doc.insertClickHereField(0,0,0,'이름','','test-field',true);
    const order=pageOrder(doc),snapshot=doc.exportHwp();
    assert.throws(()=>doc.movePageRange(0,3),/필드/);
    assert.deepEqual(pageOrder(doc),order);assert.deepEqual(doc.exportHwp(),snapshot);
  }finally{doc.free();}
});
