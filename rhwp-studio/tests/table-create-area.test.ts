import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import init, { HwpDocument } from '../../pkg/rhwp.js';
import { defaultTableWidth, splitTableWidth } from '../src/command/commands/table-create-width.ts';

await init({module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url))});
let dialog: any;
class Dialog { onApply: any; width: number; constructor(width: number) { this.width = width; dialog = this; } show() {} }
const source = readFileSync(new URL('../src/command/commands/table.ts', import.meta.url), 'utf8');
const exports: any = {};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports, console, URLSearchParams, require(id:string) {
    if (id.includes('table-create-width')) return {defaultTableWidth, splitTableWidth};
    if (id.includes('table-create-dialog')) return {TableCreateDialog:Dialog};
    return {};
  }});
const command = exports.tableCommands.find((c:any) => c.id === 'table:create');
const hu = (mm:number) => Math.round(mm * 7200 / 25.4);
for (const [name, width, height, left, right] of [['세로',210,297,20,30],['가로',297,210,25,35]] as const) {
  test(`기본 표 ${name}: 현재 본문 폭과 쪽 영역 제한`, () => {
    const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
    try {
      doc.setPageDef(0, JSON.stringify({width:hu(width),height:hu(height),marginLeft:hu(left),marginRight:hu(right),marginTop:hu(20),marginBottom:hu(20),marginHeader:hu(10),marginFooter:hu(10),marginGutter:0,landscape:false,binding:0}));
      const parse = (v:string) => JSON.parse(v);
      const wasm:any = { getCursorRect:(s:number,p:number,o:number)=>parse(doc.getCursorRect(s,p,o)),
        getPageInfo:(p:number)=>parse(doc.getPageInfo(p)), createTableEx:(o:any)=>parse(doc.createTableEx(JSON.stringify(o))),
        setTableProperties:(s:number,p:number,c:number,o:any)=>parse(doc.setTableProperties(s,p,c,JSON.stringify(o))) };
      let created:any;
      const ih:any = {getCursorPosition:()=>({sectionIndex:0,paragraphIndex:0,charOffset:0}),
        executeOperation:(op:any)=>{created=op.operation(wasm);},textarea:{focus(){}}};
      command.execute({wasm,getInputHandler:()=>ih},{});
      dialog.onApply(3,3,{treatAsChar:false});
      const props=parse(doc.getTableProperties(0,created.parentParaIndex,created.controlIndex));
      const page=parse(doc.getPageInfo(0));
      const actual=props.tableWidth + props.outerLeft + props.outerRight;
      assert.equal(props.restrictInPage,true); assert.equal(props.horzRelTo,'Column');
      assert.ok(Math.abs(actual-page.columns[0].width*75)<10, `${actual} vs ${page.columns[0].width*75}`);
      assert.ok(Math.abs(dialog.width + props.outerLeft + props.outerRight - actual)<5);
      console.info('[table-create-test]', JSON.stringify({name, areaHU:Math.round(page.columns[0].width*75), tableHU:props.tableWidth, outerHU:props.outerLeft+props.outerRight, restricted:props.restrictInPage}));
    } finally {doc.free();}
  });
}
test('사용자가 너비를 직접 지정한 경우 유지한다',()=>{
  const doc=HwpDocument.createEmpty();doc.createBlankDocument();
  try {const parse=(x:string)=>JSON.parse(x);const wasm:any={getCursorRect:(s:number,p:number,o:number)=>parse(doc.getCursorRect(s,p,o)),getPageInfo:(p:number)=>parse(doc.getPageInfo(p)),createTableEx:(o:any)=>parse(doc.createTableEx(JSON.stringify(o))),setTableProperties:(s:number,p:number,c:number,o:any)=>parse(doc.setTableProperties(s,p,c,JSON.stringify(o)))};let pos:any;const ih:any={getCursorPosition:()=>({sectionIndex:0,paragraphIndex:0,charOffset:0}),executeOperation:(op:any)=>{pos=op.operation(wasm);},textarea:{focus(){}}};command.execute({wasm,getInputHandler:()=>ih},{});dialog.onApply(2,2,{treatAsChar:false,colWidths:[hu(30),hu(30)]});const props=parse(doc.getTableProperties(0,pos.parentParaIndex,pos.controlIndex));assert.equal(props.tableWidth,hu(30)*2);assert.equal(props.restrictInPage,true);}finally{doc.free();}
});
test('다단에서는 커서가 속한 단 너비를 사용한다',()=>{
  const p:any={width:800,marginLeft:80,marginRight:80,columns:[{x:80,width:240},{x:360,width:320}]};
  assert.equal(defaultTableWidth(p,400),320*75-2*hu(1));
  assert.equal(splitTableWidth(1000,3).reduce((a,b)=>a+b,0),1000);
});
