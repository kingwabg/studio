import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import init,{HwpDocument} from '../../pkg/rhwp.js';
import {createPageReorderFixture,pageOrder,semanticInventory,inventoryHash} from './helpers/page-reorder-fixture.ts';
await init({module_or_path:readFileSync(new URL('../../pkg/rhwp_bg.wasm',import.meta.url))});
const load=()=>{const source=createPageReorderFixture(HwpDocument),doc=new HwpDocument(source.exportHwp());source.free();return doc as any;};
for(const [selection,inserted,expected]of [
  [[0,2],[1,4],['쪽-1','blank','쪽-2','쪽-3','blank','쪽-4']],
  [[1,2],[2,4],['쪽-1','쪽-2','blank','쪽-3','blank','쪽-4']],
  [[3],[4],['쪽-1','쪽-2','쪽-3','쪽-4','blank']],
] as const)test(`빈 쪽 삽입 ${JSON.stringify(selection)}: 본문·표·서식과 Undo/Redo·저장 재열기 보존`,()=>{
  const doc=load();try{
    const original=semanticInventory(doc),snap=doc.saveSnapshot(),result=JSON.parse(doc.insertBlankPages(JSON.stringify(selection)));
    assert(result.ok&&result.changed&&result.preservationVerified);assert.equal(result.contentDigestAfter,result.expectedContentDigest);
    assert.deepEqual(result.newSelectedPages,inserted);assert.equal(result.insertedPageCount,inserted.length);
    const order=(d:any)=>pageOrder(d).map((v:string)=>v.startsWith('unknown:')?'blank':v);
    assert.deepEqual(order(doc),expected);
    const after=semanticInventory(doc);assert.deepEqual(after.tables,original.tables);assert.deepEqual(after.pageDefs,original.pageDefs);
    const added=[...after.paragraphs];
    for(const paragraph of original.paragraphs){const index=added.indexOf(paragraph);assert(index>=0,'원본 문단과 서식 유지');added.splice(index,1);}
    assert.equal(added.length,inserted.length);assert(added.every((p:string)=>JSON.parse(p).text===''));
    for(const p of inserted){const pos=JSON.parse(doc.getPositionOfPage(p));assert.equal(doc.getParagraphLength(pos.sec,pos.para),0);assert.equal(JSON.parse(doc.getCharPropertiesAt(pos.sec,pos.para,0)).bold,false);assert.equal(JSON.parse(doc.getPageControlLayout(p)).controls.length,0);}
    const applied=doc.saveSnapshot();doc.restoreSnapshot(snap);assert.deepEqual(semanticInventory(doc),original);assert.equal(JSON.parse(doc.getDocumentInfo()).pageCount,4);
    doc.restoreSnapshot(applied);assert.deepEqual(semanticInventory(doc),after);assert.deepEqual(order(doc),expected);
    const reopened=new HwpDocument(doc.exportHwp());try{assert.deepEqual(order(reopened),expected);assert.deepEqual(semanticInventory(reopened),after);}finally{reopened.free();}
    console.info('[page-context-insert]',JSON.stringify({result,order:expected,originalInventory:inventoryHash(original),afterInventory:inventoryHash(after),bodyPreserved:true,tablesPreserved:true,stylesPreserved:true,undo:true,redo:true,saveReopen:true}));
  }finally{doc.free();}
});
test('전체 선택 빈 쪽 추가와 중복·잘못된 선택 및 머리말 문서 차단',()=>{
  const doc=load();try{
    const snap=doc.saveSnapshot(),result=JSON.parse(doc.insertBlankPages('[0,1,2,3]'));assert.equal(result.pageCount,8);assert.deepEqual(result.newSelectedPages,[1,3,5,7]);
    doc.restoreSnapshot(snap);const duplicate=JSON.parse(doc.insertBlankPages('[0,0]'));assert.equal(duplicate.pageCount,5);assert.equal(duplicate.insertedPageCount,1);
    doc.restoreSnapshot(snap);const bytes=doc.exportHwp();for(const arg of ['[]','[-1]','[99]','[0.5]','"0"'])assert.throws(()=>doc.insertBlankPages(arg));assert.deepEqual(doc.exportHwp(),bytes);
    doc.createHeaderFooter(0,true,0);const header=doc.exportHwp();assert.throws(()=>doc.insertBlankPages('[0]'),/머리말/);assert.deepEqual(doc.exportHwp(),header);
    console.info('[page-context-boundary]',JSON.stringify({allSelected:result,duplicateSelection:duplicate,invalidSelectionUnchanged:true,unsupportedHeaderUnchanged:true}));
  }finally{doc.free();}
});
test('이어진 문단은 나누지 않고 묶음 뒤에 빈 쪽 하나만 추가한다',()=>{
  const doc=HwpDocument.createEmpty() as any;doc.createBlankDocument();try{
    const text='문단 연결 상태를 유지하는 빈 쪽 삽입 검사입니다. '.repeat(450);doc.insertText(0,0,0,text);
    const next=JSON.parse(doc.insertPageBreak(0,0,doc.getLogicalLength(0,0))).paraIdx;doc.insertText(0,next,0,'마지막 쪽');
    const group=JSON.parse(doc.getPageMoveRanges()).ranges[0];assert(group.endPage>0);
    const original=semanticInventory(doc),snap=doc.saveSnapshot(),result=JSON.parse(doc.insertBlankPages('[1]'));
    assert.equal(result.insertedPageCount,1);assert.deepEqual(result.newSelectedPages,[group.endPage+1]);assert.equal(doc.getTextRange(0,0,0,text.length),text);
    assert.deepEqual(semanticInventory(doc).paragraphs.filter((p:string)=>JSON.parse(p).text!==''),original.paragraphs);
    doc.restoreSnapshot(snap);assert.deepEqual(semanticInventory(doc),original);
    console.info('[page-context-connected]',JSON.stringify({kind:'paragraph',result,undo:true}));
  }finally{doc.free();}
});
