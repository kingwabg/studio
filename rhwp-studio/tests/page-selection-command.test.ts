import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports:any={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/core/page-selection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const normalize=exports.normalizePageSelection;
test('연결 범위 확장·중복 제거·정렬·잘못된 선택을 처리한다',()=>{
  const ranges=[{startPage:0,endPage:1},{startPage:2,endPage:2},{startPage:3,endPage:4}];
  assert.deepEqual(Array.from(normalize([4,1,1],ranges)),[0,1,3,4]);
  assert.throws(()=>normalize([8],ranges));assert.throws(()=>normalize([NaN],ranges));
});
test('다중 복제·삭제·이동은 한 번의 스냅샷으로 실행하고 조합 중에는 차단한다',()=>{
  const source=readFileSync(new URL('../src/engine/input-handler.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('input.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='InputHandler') as ts.ClassDeclaration;
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='editPages')!;
  const edit=vm.runInNewContext(ts.transpileModule(`class Handler{${method.getText(ast)}};Handler.prototype.editPages`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{normalizePageSelection:normalize});
  const calls:any[]=[],wasm={pageCount:4,getPageMoveRanges:()=>({ranges:[{startPage:0,endPage:1},{startPage:2,endPage:2},{startPage:3,endPage:3}]}),
    editPages:(action:string,pages:number[])=>{calls.push({action,pages:Array.from(pages)});return{ok:true,newStartPage:0};},getPositionOfPage:()=>({ok:true,sec:0,para:0,charOffset:0})};
  const cursor={clearSelection(){},exitCellSelectionMode(){},exitTableObjectSelection(){},exitPictureObjectSelection(){},exitHeaderFooterMode(){},exitFootnoteMode(){}};
  const handler:any={wasm,cursor,isComposing:false,executeOperation(op:any){calls.push(op.operationType);op.operation(wasm);}};
  edit.call(handler,'duplicate',[1,3]);assert.deepEqual(calls,['pages:duplicate',{action:'duplicate',pages:[0,1,3]}]);
  calls.length=0;edit.call(handler,'delete',[2]);assert.deepEqual(calls,['pages:delete',{action:'delete',pages:[2]}]);
  calls.length=0;edit.call(handler,'insertBlank',[1,3]);assert.deepEqual(calls,['pages:insertBlank',{action:'insertBlank',pages:[0,1,3]}]);
  calls.length=0;edit.call(handler,'move',[0],2);assert.deepEqual(calls,[],'원래 순서의 드롭은 Undo를 추가하지 않는다');
  handler.isComposing=true;assert.throws(()=>edit.call(handler,'delete',[1]),/한글 입력/);assert.deepEqual(calls,[]);
});
test('WASM 브리지는 빈 쪽 추가 API만 호출하고 알 수 없는 동작은 거부한다',()=>{
  const source=readFileSync(new URL('../src/core/wasm-bridge.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('bridge.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='WasmBridge') as ts.ClassDeclaration;
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='editPages')!;
  const edit=vm.runInNewContext(ts.transpileModule(`class Bridge{${method.getText(ast)}};Bridge.prototype.editPages`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
  const calls:string[]=[],bridge={doc:{insertBlankPages:(json:string)=>{calls.push(json);return '{"ok":true}';}}};
  assert.equal(edit.call(bridge,'insertBlank',[0,2]).ok,true);assert.deepEqual(calls,['[0,2]']);
  assert.throws(()=>edit.call(bridge,'bad',[0]),/지원하지/);assert.equal(calls.length,1);
});
