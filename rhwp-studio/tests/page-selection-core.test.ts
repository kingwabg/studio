import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import init,{HwpDocument} from '../../pkg/rhwp.js';
import{createPageReorderFixture,pageOrder,semanticInventory,inventoryHash}from './helpers/page-reorder-fixture.ts';
await init({module_or_path:readFileSync(new URL('../../pkg/rhwp_bg.wasm',import.meta.url))});
const load=()=>{const source=createPageReorderFixture(HwpDocument),doc=new HwpDocument(source.exportHwp());source.free();return doc as any;};
const subtract=(all:string[],selected:string[])=>{const result=[...all];for(const item of selected){const index=result.indexOf(item);assert(index>=0);result.splice(index,1);}return result;};
for(const action of ['duplicate','delete'] as const)test(`비연속 두 쪽 ${action}: 본문·병합 표·서식의 개수와 Undo/Redo·저장 재열기 보존`,()=>{
  const doc=load();try{
    const original=semanticInventory(doc),selected=semanticInventory(doc,[0,2]),snapshot=doc.saveSnapshot();
    const result=JSON.parse(action==='duplicate'?doc.duplicatePages('[0,2]'):doc.deletePages('[0,2]'));
    assert(result.ok&&result.changed&&result.preservationVerified);assert.equal(result.contentDigestAfter,result.expectedContentDigest);
    assert.deepEqual(result.affectedPages,[0,2]);
    const expected={pageDefs:original.pageDefs,paragraphs:action==='duplicate'?[...original.paragraphs,...selected.paragraphs].sort():subtract(original.paragraphs,selected.paragraphs),tables:action==='duplicate'?[...original.tables,...selected.tables].sort():subtract(original.tables,selected.tables)};
    const expectedOrder=action==='duplicate'?['쪽-1','쪽-2','쪽-3','쪽-1','쪽-3','쪽-4']:['쪽-2','쪽-4'];
    assert.deepEqual(pageOrder(doc),expectedOrder);assert.deepEqual(semanticInventory(doc),expected);
    const after=doc.saveSnapshot();doc.restoreSnapshot(snapshot);assert.deepEqual(pageOrder(doc),['쪽-1','쪽-2','쪽-3','쪽-4']);assert.deepEqual(semanticInventory(doc),original);
    doc.restoreSnapshot(after);assert.deepEqual(semanticInventory(doc),expected);
    const reopened=new HwpDocument(doc.exportHwp());try{assert.deepEqual(pageOrder(reopened),expectedOrder);assert.deepEqual(semanticInventory(reopened),expected);}finally{reopened.free();}
    console.info('[page-selection-preservation]',JSON.stringify({action,result,order:expectedOrder,paragraphsBefore:original.paragraphs.length,paragraphsAfter:expected.paragraphs.length,tablesBefore:original.tables.length,tablesAfter:expected.tables.length,expectedInventory:inventoryHash(expected),actualInventory:inventoryHash(semanticInventory(doc)),undo:true,redo:true,saveReopen:true}));
  }finally{doc.free();}
});
test('비연속 여러 쪽을 한 번에 이동하고 Undo로 복원한다',()=>{
  const doc=load();try{
    const original=semanticInventory(doc),snap=doc.saveSnapshot();
    const result=JSON.parse(doc.movePages('[0,2]',4));
    assert.deepEqual(pageOrder(doc),['쪽-2','쪽-4','쪽-1','쪽-3']);assert.deepEqual(semanticInventory(doc),original);assert.deepEqual(result.newSelectedPages,[2,3]);
    doc.restoreSnapshot(snap);assert.deepEqual(pageOrder(doc),['쪽-1','쪽-2','쪽-3','쪽-4']);assert.deepEqual(semanticInventory(doc),original);
  }finally{doc.free();}
});
test('전체 삭제는 빈 쪽 하나를 남기고 Undo로 모든 본문·표·서식을 복원한다',()=>{
  const doc=load();try{
    const original=semanticInventory(doc),snap=doc.saveSnapshot(),result=JSON.parse(doc.deletePages('[0,1,2,3]'));
    assert(result.preservationVerified);assert.equal(result.pageCount,1);assert.equal(doc.getParagraphCount(0),1);assert.equal(doc.getParagraphLength(0,0),0);assert.equal(JSON.parse(doc.getPageControlLayout(0)).controls.length,0);
    assert.deepEqual(JSON.parse(doc.getPageDef(0)),original.pageDefs[0]);
    const blank=new HwpDocument(doc.exportHwp());try{assert.equal(JSON.parse(blank.getDocumentInfo()).pageCount,1);assert.equal(blank.getParagraphLength(0,0),0);}finally{blank.free();}
    doc.restoreSnapshot(snap);assert.deepEqual(semanticInventory(doc),original);assert.deepEqual(pageOrder(doc),['쪽-1','쪽-2','쪽-3','쪽-4']);
    console.info('[page-selection-delete-all]',JSON.stringify({result,undo:true,emptyPageRetained:true}));
  }finally{doc.free();}
});
test('잘못된 선택·머리말 문서의 복제·삭제 실패는 원본을 그대로 유지한다',()=>{
  const doc=load();try{
    const original=semanticInventory(doc),order=pageOrder(doc);
    for(const selection of ['[-1]','[99]','[0.5]','"0"']){assert.throws(()=>doc.duplicatePages(selection));assert.throws(()=>doc.deletePages(selection));}
    assert.deepEqual(semanticInventory(doc),original);assert.deepEqual(pageOrder(doc),order);
    doc.createHeaderFooter(0,true,0);const bytes=doc.exportHwp();assert.throws(()=>doc.duplicatePages('[1]'),/머리말/);assert.throws(()=>doc.deletePages('[1]'),/머리말/);assert.deepEqual(doc.exportHwp(),bytes);
  }finally{doc.free();}
});
test('여러 쪽으로 나뉜 문단을 선택하면 연결된 쪽 전체를 복제·삭제한다',()=>{
  const doc=HwpDocument.createEmpty() as any;doc.createBlankDocument();try{
    const text='연결된 문단 보존 검사입니다. '.repeat(400);doc.insertText(0,0,0,text);
    const tail=JSON.parse(doc.insertPageBreak(0,0,doc.getLogicalLength(0,0))).paraIdx;doc.insertText(0,tail,0,'마지막 쪽');
    const ranges=JSON.parse(doc.getPageMoveRanges()).ranges,originalCount=JSON.parse(doc.getDocumentInfo()).pageCount;assert(ranges[0].endPage>0);
    const snap=doc.saveSnapshot(),result=JSON.parse(doc.duplicatePages('[1]')),size=ranges[0].endPage+1;
    assert.equal(result.affectedPages.length,size);assert.equal(result.pageCount,originalCount+size);assert.equal(doc.getTextRange(0,1,0,text.length),text);
    doc.restoreSnapshot(snap);const removed=JSON.parse(doc.deletePages('[1]'));assert.equal(removed.pageCount,1);assert.equal(doc.getTextRange(0,0,0,100),'마지막 쪽');
    doc.restoreSnapshot(snap);assert.equal(doc.getTextRange(0,0,0,text.length),text);
    console.info('[page-selection-connected]',JSON.stringify({kind:'paragraph',result,removed,undo:true}));
  }finally{doc.free();}
});
test('여러 쪽에 걸친 표도 셀과 서식을 유지하며 함께 복제·삭제한다',()=>{
  const doc=HwpDocument.createEmpty() as any;doc.createBlankDocument();try{
    const t=JSON.parse(doc.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:90,colCount:2,treatAsChar:false,colWidths:[10000,10000],rowHeights:Array(90).fill(2200)})));
    doc.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'첫 셀');doc.insertTextInCell(0,t.paraIdx,t.controlIdx,179,0,0,'마지막 셀');
    doc.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({textWrap:'TopAndBottom',vertRelTo:'Para',horzRelTo:'Column',pageBreak:2,repeatHeader:true}));
    const tail=doc.getParagraphCount(0)-1,next=JSON.parse(doc.insertPageBreak(0,tail,doc.getLogicalLength(0,tail))).paraIdx;doc.insertText(0,next,0,'분리된 쪽');
    const original=semanticInventory(doc),snap=doc.saveSnapshot(),range=JSON.parse(doc.getPageMoveRanges()).ranges[0];assert(range.endPage>0);
    const copied=JSON.parse(doc.duplicatePages('[1]')),after=semanticInventory(doc);assert(copied.preservationVerified);assert.deepEqual(after.tables,[...original.tables,...original.tables].sort());
    const reopened=new HwpDocument(doc.exportHwp());try{assert.deepEqual(semanticInventory(reopened),after);}finally{reopened.free();}
    doc.restoreSnapshot(snap);const deleted=JSON.parse(doc.deletePages('[1]'));assert(deleted.preservationVerified);assert.equal(deleted.pageCount,1);assert.equal(semanticInventory(doc).tables.length,0);assert.equal(doc.getTextRange(0,0,0,100),'분리된 쪽');
    doc.restoreSnapshot(snap);assert.deepEqual(semanticInventory(doc),original);
    console.info('[page-selection-connected]',JSON.stringify({kind:'table',copied,deleted,saveReopen:true,undo:true}));
  }finally{doc.free();}
});
