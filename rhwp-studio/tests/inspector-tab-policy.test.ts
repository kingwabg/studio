import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {inspectorTabTarget} from '../src/ui/inspector-tab-policy.ts';
const source=readFileSync(new URL('../src/ui/canva-right-inspector.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('panel.ts',source,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='CanvaRightInspector') as ts.ClassDeclaration;
const names=['refreshContext','setPanelTab'];
const methods=cls.members.filter(n=>ts.isMethodDeclaration(n)&&names.includes(n.name.getText(ast))).map(n=>n.getText(ast).replace(/^private\s+/,''));
const Probe=vm.runInNewContext(ts.transpileModule(`class Probe{${methods.join('\n')}};Probe`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{inspectorTabTarget,cellIdentity:(ih:any)=>ih.key,pictureIdentity:()=>''});
function setup(){
 const ih:any={key:'0/1/0/0',isInTable:()=>true,isInCellSelectionMode:()=>false,getSelectedCellRange:()=>({startRow:0,endRow:0,startCol:0,endCol:0})};
 let renders=0;const p=new Probe();Object.assign(p,{services:{wasm:{pageCount:1},getInputHandler:()=>ih},ctx:'none',panelTab:'props',tabTargetKey:'',manualTabKey:'',paintBanner(){},applyContext(){renders++;},syncTabs(){}});
 return {p,ih,renders:()=>renders};
}
test('셀 글 편집·셀 범위·표 전체 선택에 맞춰 자동 전환',()=>{
 const s=setup();s.p.refreshContext();assert.equal(s.p.panelTab,'props');
 s.ih.isInCellSelectionMode=()=>true;s.p.refreshContext();assert.equal(s.p.panelTab,'cell');
 s.ih.isInTableObjectSelection=()=>true;s.p.refreshContext();assert.equal(s.p.panelTab,'table');
});
test('같은 셀의 수동 문단 탭 유지와 다른 셀에서 추천 복귀',()=>{
 const {p,ih}=setup();p.refreshContext();p.setPanelTab('text');p.refreshContext(true);assert.equal(p.panelTab,'text');
 ih.key='0/1/0/1';p.refreshContext();assert.equal(p.panelTab,'props');
 ih.key='0/1/0/0';p.refreshContext();assert.equal(p.panelTab,'props');
});
test('텍스트 드래그는 글 편집 유지, 셀 범위 선택은 셀 탭',()=>{
 const s=setup();s.p.refreshContext();s.p.setPanelTab('text');s.ih.selection=true;s.p.refreshContext();assert.equal(s.p.panelTab,'text');
 s.ih.isInCellSelectionMode=()=>true;s.p.refreshContext();assert.equal(s.p.panelTab,'cell');
});
test('한글 조합 중 DOM 갱신 없이 수동 전환 보류',()=>{
 const s=setup();s.p.refreshContext();const before=s.renders();s.ih.isComposing=true;s.ih.isInCellSelectionMode=()=>true;s.p.refreshContext(true);s.p.setPanelTab('text');
 assert.equal(s.renders(),before);assert.equal(s.p.pendingManualTab,'text');assert.equal(s.p.panelTab,'props');
 s.ih.isComposing=false;s.p.refreshContext();assert.equal(s.p.panelTab,'cell');
});
