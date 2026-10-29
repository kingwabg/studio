import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function setup(){
 const exports:any={},events:any[]=[],logs:any[]=[];
 const source=ts.transpileModule(readFileSync(new URL('../src/ui/ai-image-document.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,console:{info:(...args:any[])=>logs.push(args)},require:(name:string)=>name.includes('ai-editor-tools')?{EDITOR_TOOL_PROMPT:'schema',executeEditPlan:(_s:any,plan:any)=>{events.push(plan);return {ok:true,logs:[]};}}:name.includes('ai-edit-report')?{summarizeEditReport:JSON.stringify}: {}});
 const services={eventBus:{emit:(name:string,payload:any)=>{events.push(name);payload.onReady();}}};
 return {exports,events,services,logs};
}
test('불완전/파괴적 분석 결과는 새 문서로 교체하기 전에 거절',async()=>{
 const s=setup();
 for(const raw of ['{','{"version":1,"operations":[]}','{"version":1,"operations":[{"tool":"edit_text"}]}']){
  await assert.rejects(s.exports.generateImageDocument(s.services,['image'],'request',async()=>raw));
 }
 assert.equal(s.events.length,0);
});
test('모델이 이미지에서 만든 계획을 새 문서 준비 후 실행하고 적용값을 조회',async()=>{
 const s=setup();let modelArgs:any[]=[];
 const result=await s.exports.generateImageDocument(s.services,['image'],'이미지 재현',async(...args:any[])=>{modelArgs=args;return '{"version":1,"operations":[{"tool":"insert_paragraph","text":"모델 출력"}]}';});
 assert.equal(modelArgs[1],'이미지 재현');assert.equal(modelArgs[3][0],'image');
 assert.equal(s.events[0],'create-new-document');assert.equal(s.events[1].operations[0].text,'모델 출력');
 assert.equal(s.events[1].operations.at(-1).tool,'inspect_document');assert.match(result,/생성/);
 assert(!JSON.stringify(s.logs).includes('모델 출력'));
});
