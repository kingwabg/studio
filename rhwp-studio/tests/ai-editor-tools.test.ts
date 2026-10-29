/** [캔버스 한컴 포크] AI 도구→실제 WASM→속성 재조회. 브라우저 조작 테스트는 아니다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeEditPlan } from '../src/ui/ai-editor-tools.ts';
import { hu } from '../src/ui/ai-editor-values.ts';
import { createRealEditor } from './helpers/ai-real-engine.ts';

type Editor = ReturnType<typeof createRealEditor>;
function run(e: Editor, ...operations: any[]) {
  const result = executeEditPlan(e.services, { version: 1, operations });
  assert.equal(result.ok, true, result.error);
  return result.logs.at(-1)!.actual;
}
const page = { widthMm:210,heightMm:297,leftMm:20,rightMm:20,topMm:15,bottomMm:15,headerMm:10,footerMm:8 };
const target = { table:0,row:0,col:0 };
function makeTable(e: Editor) {
  return run(e, {tool:'create_table',colWidthsMm:[20,40,30],rowHeightsMm:[12,14],
    merges:[{top:0,left:0,bottom:0,right:1}],
    cells:[{row:0,col:0,text:'병합 셀',char:{fontPt:10,bold:true}},
      {row:1,col:0,text:'업무 내용\n한글 😀',para:{alignment:'left',linePercent:160}}],
    cell:{paddingLeftMm:1,paddingRightMm:1,paddingTopMm:1,paddingBottomMm:1,applyInnerMargin:true,
      borderLeft:{type:1,width:1,color:'#000000'}},
    placement:{horzRelTo:'Column',vertRelTo:'Para',textWrap:'TopAndBottom'}});
}

test('실제 엔진: A4 여백·스타일·한국어/이모지 문단의 요청값과 적용값 일치', () => {
  const e=createRealEditor();
  try {
    const result=run(e,{tool:'set_page',props:page});
    assert.equal(result.page.width,hu(210)); assert.equal(result.page.height,hu(297));
    assert.equal(result.page.marginHeader,hu(10)); assert.equal(result.page.marginFooter,hu(8));
    const style=run(e,{tool:'define_style',name:'AI 검증 본문',char:{fontName:'함초롬바탕',fontPt:12,bold:true,widthPercent:100,spacingPercent:0},para:{alignment:'center',linePercent:170,beforePt:3,afterPt:6}});
    const p=run(e,{tool:'insert_paragraph',text:'한글 😀 문단',styleId:style.styleId});
    assert.equal(p.text,'한글 😀 문단'); assert.equal(p.char.fontSize,1200); assert.equal(p.char.bold,true);
    assert.equal(p.para.alignment,'center'); assert.equal(p.para.lineSpacing,170); assert.equal(p.style.id,style.styleId);
    assert.equal(p.para.spacingBefore,4); assert.equal(p.para.spacingAfter,8);
    const edited=run(e,{tool:'edit_text',target:{paragraph:0,from:3,to:4},text:'🌱'});
    assert.equal(edited.text,'🌱');
    const read=run(e,{tool:'inspect_target',target:{paragraph:0}});
    assert.equal(read.text,'한글 🌱 문단');
    const format=run(e,{tool:'format_text',target:{paragraph:0,from:0,to:2},props:{fontPt:15,textColor:'#123456'}});
    assert.equal(format.char.fontSize,1500); assert.equal(format.char.textColor.toLowerCase(),'#123456');
    const para=run(e,{tool:'format_paragraph',target:{paragraph:0},props:{alignment:'left',linePercent:180,beforePt:3,afterPt:6}});
    assert.equal(para.para.alignment,'left'); assert.equal(para.para.lineSpacing,180);
    assert.equal(para.para.spacingBefore,4); assert.equal(para.para.spacingAfter,8);
    const restored=run(e,{tool:'apply_style',target:{paragraph:0},styleId:style.styleId});
    assert.equal(restored.char.fontSize,1200); assert.equal(restored.style.id,style.styleId);
  } finally {e.close();}
});

test('실제 엔진: 비균등 표 크기·병합·셀 서식·직렬화 재열기', () => {
  const e=createRealEditor();
  try {
    run(e,{tool:'set_page',props:page});
    const table=makeTable(e);
    assert.equal(table.cells.length,5);
    const merged=table.cells.find((c:any)=>c.row===0&&c.col===0);
    assert.equal(merged.colSpan,2); assert.equal(merged.props.width,hu(20)+hu(40));
    assert.equal(merged.props.height,hu(12)); assert.equal(merged.paragraphs[0].text,'병합 셀');
    const last=table.cells.find((c:any)=>c.row===1&&c.col===2);
    assert.equal(last.props.width,hu(30)); assert.equal(last.props.height,hu(14));
    assert.equal(merged.props.paddingLeft,hu(1));
    const formatted=run(e,{tool:'format_cells',target:{table:0},cells:[{row:0,col:0,props:{fillColor:'#dddddd',verticalAlign:1},char:{fontPt:11},para:{alignment:'center'}}]});
    const cell=formatted.cells.find((c:any)=>c.row===0&&c.col===0);
    assert.equal(cell.props.fillColor.toLowerCase(),'#dddddd'); assert.equal(cell.props.verticalAlign,1);
    assert.equal(cell.paragraphs[0].char.fontSize,1100); assert.equal(cell.paragraphs[0].para.alignment,'center');
    const moved=run(e,{tool:'set_table',target:{table:0},props:{horzOffsetMm:5,vertOffsetMm:3,textWrap:'Square'}});
    assert.equal(moved.props.horzOffset,hu(5)); assert.equal(moved.props.vertOffset,hu(3)); assert.equal(moved.props.textWrap,'Square');
    const reopened=createRealEditor(e.native.exportHwp());
    try {
      const doc=run(reopened,{tool:'inspect_document'});
      assert.equal(doc.tables.length,1); assert.equal(doc.tables[0].cells.length,5);
      const c=run(reopened,{tool:'inspect_target',target});
      assert.equal(c.text,'병합 셀'); assert.equal(c.char.fontSize,1100); assert.equal(c.cell.fillColor.toLowerCase(),'#dddddd');
      assert.equal(doc.page.marginFooter,hu(8));
    } finally {reopened.close();}
  } finally {e.close();}
});

test('실제 엔진: 실패한 묶음 전체 복원·한 묶음 한 번 undo·셀 보호', () => {
  const e=createRealEditor();
  try {
    const initial=e.native.exportHwp();
    const failed=executeEditPlan(e.services,{version:1,operations:[{tool:'insert_paragraph',text:'실패하면 없어져야 함'},
      {tool:'format_text',target:{paragraph:99},props:{fontPt:12}}]});
    assert.equal(failed.ok,false); assert.equal(failed.rolledBack,true); assert.equal(failed.logs[0].status,'rolled_back');
    assert.equal(e.native.getTextRange(0,0,0,100),''); assert.deepEqual(e.native.exportHwp(),initial);
    run(e,{tool:'insert_paragraph',text:'첫째'},{tool:'insert_paragraph',text:'둘째'});
    assert.equal(e.history.length,1); e.undo(); assert.equal(e.native.getParagraphCount(0),1); assert.equal(e.native.getTextRange(0,0,0,100),'');
    const table=makeTable(e); const c=table.cells.find((x:any)=>x.row===0&&x.col===0);
    e.native.setCellProperties(0,table.address.p,table.address.ci,c.cellIdx,JSON.stringify({cellProtect:true}));
    const denied=executeEditPlan(e.services,{version:1,operations:[{tool:'edit_text',target,text:'덮기'}]});
    assert.equal(denied.ok,false); assert.match(denied.error??'',/보호/);
    assert.equal(e.native.getTextInCell(0,table.address.p,table.address.ci,c.cellIdx,0,0,100),'병합 셀');
  } finally {e.close();}
});


test('운영일지 이미지 재현 계획: 실제 표 5개·셀 내용·치수·저장 재열기', () => {
  const plan=JSON.parse(readFileSync(new URL('./fixtures/daily-log-child.plan.json',import.meta.url),'utf8'));
  const e=createRealEditor();
  try {
    const result=executeEditPlan(e.services,plan);
    assert.equal(result.ok,true,result.error);
    const report=result.logs.at(-1)!.actual;
    assert.equal(report.pageCount,1); assert.equal(report.tables.length,5);
    assert.ok(report.paragraphs.some((p:any)=>p.text==='운영일지(아동)'));
    const requested=plan.operations.filter((o:any)=>o.tool==='create_table');
    for(let i=0;i<requested.length;i++) {
      const req=requested[i],actual=report.tables[i];
      const expectedWidth=req.colWidthsMm.reduce((sum:number,n:number)=>sum+hu(n),0)/75;
      assert.ok(Math.abs(actual.bboxPx.width-expectedWidth)<0.2, `표 ${i} 실제 폭 ${actual.bboxPx.width} ≠ ${expectedWidth}`);
      for(const wanted of req.cells??[]) {
        const cell=actual.cells.find((c:any)=>c.row===wanted.row&&c.col===wanted.col);
        assert.ok(cell, `표 ${i} 셀 ${wanted.row},${wanted.col}`);
        if(wanted.text!==undefined) assert.equal(cell.paragraphs.map((p:any)=>p.text).join('\n'),wanted.text);
      }
    }
    const reopened=createRealEditor(e.native.exportHwp());
    try {
      const after=run(reopened,{tool:'inspect_document'});
      assert.equal(after.tables.length,5); assert.equal(after.pageCount,1);
      const contents=(doc:any)=>doc.tables.map((t:any)=>t.cells.map((c:any)=>c.paragraphs.map((p:any)=>p.text)));
      assert.deepEqual(contents(after),contents(report));
    } finally {reopened.close();}
  } finally {e.close();}
});

test('빈 셀의 요청 글자모양이 나중에 삽입하는 텍스트에도 유지된다', () => {
  const e=createRealEditor();
  try {
    const emptyBody=executeEditPlan(e.services,{version:1,operations:[{tool:'format_text',target:{paragraph:0},props:{fontPt:10}}]});
    assert.equal(emptyBody.ok,false); assert.match(emptyBody.error??'',/빈 본문/);
    assert.equal(e.native.getTextRange(0,0,0,100),'');
    run(e,{tool:'insert_paragraph',text:'22pt 제목',char:{fontPt:22,bold:true}});
    const table=run(e,{tool:'create_table',colWidthsMm:[40,40],rowHeightsMm:[12],
      char:{fontPt:10,bold:false},cells:[{row:0,col:0,text:'이름'}]});
    const blank=table.cells.find((c:any)=>c.row===0&&c.col===1);
    assert.equal(blank.paragraphs[0].text,'');
    assert.equal(blank.paragraphs[0].char.fontSize,1000);
    assert.equal(blank.paragraphs[0].char.bold,false);
    const edit=run(e,{tool:'edit_text',target:{table:0,row:0,col:1},text:'나중에 입력'});
    assert.equal(edit.text,'나중에 입력');
    assert.equal(edit.char.fontSize,1000); assert.equal(edit.char.bold,false);
    const reopen=createRealEditor(e.native.exportHwp());
    try {
      const actual=run(reopen,{tool:'inspect_target',target:{table:0,row:0,col:1}});
      assert.equal(actual.text,'나중에 입력'); assert.equal(actual.char.fontSize,1000); assert.equal(actual.char.bold,false);
    } finally {reopen.close();}
    const next=run(e,{tool:'create_table',colWidthsMm:[40],rowHeightsMm:[12],char:{fontPt:10,bold:false}});
    const blankTarget={table:next.table,row:0,col:0};
    const style=run(e,{tool:'define_style',name:'빈 셀 12pt',char:{fontPt:12,bold:false},para:{alignment:'center'}});
    const styled=run(e,{tool:'apply_style',target:blankTarget,styleId:style.styleId});
    assert.equal(styled.text,''); assert.equal(styled.char.fontSize,1200); assert.equal(styled.char.bold,false);
    const later=run(e,{tool:'edit_text',target:blankTarget,text:'스타일 후 입력'});
    assert.equal(later.text,'스타일 후 입력'); assert.equal(later.char.fontSize,1200); assert.equal(later.char.bold,false);
    assert.equal(later.para.alignment,'center');
  } finally {e.close();}
});

test('잘못된 도구·속성·숫자는 명시적으로 거절하고 중간 편집을 복원한다', () => {
  const e=createRealEditor();
  try {
    const initial=e.native.exportHwp();
    const unknown=executeEditPlan(e.services,{version:1,operations:[{tool:'insert_paragraph',text:'작성 금지'}, {tool:'unknown_tool'}]});
    assert.equal(unknown.ok,false); assert.equal(unknown.logs.length,0); assert.equal(unknown.rolledBack,false);
    assert.match(unknown.error??'',/지원하지 않는 도구/);
    const badProps=executeEditPlan(e.services,{version:1,operations:[{tool:'insert_paragraph',text:'중간 내용'},
      {tool:'format_text',target:{paragraph:0},props:{fontPt:12,typoFont:true}}]});
    assert.equal(badProps.ok,false); assert.equal(badProps.rolledBack,true); assert.match(badProps.error??'',/지원하지 않는 속성/);
    assert.equal(badProps.logs[0].status,'rolled_back');
    const badNumber=executeEditPlan(e.services,{version:1,operations:[{tool:'set_page',props:{widthMm:NaN}}]});
    assert.equal(badNumber.ok,false); assert.match(badNumber.error??'',/숫자/);
    assert.equal(e.native.getTextRange(0,0,0,100),''); assert.deepEqual(e.native.exportHwp(),initial);
  } finally {e.close();}
});
