import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup(ranges = [{startPage:0,endPage:0},{startPage:1,endPage:1},{startPage:2,endPage:2}], selected?: number[]) {
  const classes = () => { const set = new Set<string>(); return { add:(...cs:string[])=>cs.forEach(c=>set.add(c)),remove:(...cs:string[])=>cs.forEach(c=>set.delete(c)),toggle:(c:string,on:boolean)=>on?set.add(c):set.delete(c),contains:(c:string)=>set.has(c) }; };
  const events = () => ({addEventListener() {},removeEventListener() {}});
  const drawn:any[]=[];
  const element=(tag='div'):any=>({tag,style:{},children:[],hidden:false,attrs:new Map(),width:0,height:0,
    append(...items:any[]){for(const item of items){this.children.push(item);item.parent=this;}},
    setAttribute(k:string,v:string){this.attrs.set(k,v);},
    getContext:()=>({drawImage:(...args:any[])=>drawn.push(args)}),
    remove(){if(this.parent)this.parent.children=this.parent.children.filter((c:any)=>c!==this);},
  });
  const body=element();
  const buttons:any[] = Array.from({length:Math.max(...ranges.map(r=>r.endPage))+1},(_,page)=>{
    const canvas=element('canvas');canvas.width=160;canvas.height=230;
    return {dataset:{page:String(page)},style:{},classList:classes(),querySelector:()=>canvas,closest(){return this;},getBoundingClientRect:()=>({top:page*120,bottom:page*120+100,left:10,width:170,height:100})};
  });
  const list:any = {...element(),...events(),scrollTop:0,classList:classes(),querySelectorAll:()=>buttons,contains:(b:any)=>buttons.includes(b),getBoundingClientRect:()=>({left:0,right:190,width:190,top:0,bottom:380})};
  const pending = new Map<number,Function>();let id=0;
  const exports:any={},drops:any[]=[],messages:string[]=[];
  const source=readFileSync(new URL('../src/ui/page-preview-drag.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require(){},document:{...events(),body,createElement:element},window:events(),
    requestAnimationFrame:(fn:Function)=>{pending.set(++id,fn);return id;},cancelAnimationFrame:(n:number)=>pending.delete(n),
  });
  const drag=new exports.PagePreviewDrag(list,{ranges:()=>ranges,...(selected?{selected:()=>selected}:{}),drop:(...args:any[])=>drops.push(args),announce:(m:string)=>messages.push(m)});
  const event=(page:number,x:number,y:number)=>({button:0,pointerId:1,target:buttons[page],clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});
  const frame=()=>{const entry=[...pending][0];if(entry){pending.delete(entry[0]);entry[1]();}};
  return {drag,list,buttons,drops,messages,pending,event,body,drawn,frame};
}
test('6px 미만은 클릭으로 유지하고 실제 드래그만 삽입 위치에 한 번 적용한다',()=>{
  const s=setup();s.drag.start(s.event(0,50,50));s.drag.update(s.event(0,52,52));s.drag.finish(s.event(0,52,52));assert.deepEqual(s.drops,[]);
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,250));assert(s.buttons[2].classList.contains('drop-before'));
  s.drag.finish(s.event(2,50,250));assert.deepEqual(s.drops,[[0,2]]);s.drag.dispose();
});
test('여러 쪽에 걸친 본문·표의 범위를 함께 강조하고 대상 그룹 경계로 놓는다',()=>{
  const s=setup([{startPage:0,endPage:0},{startPage:1,endPage:2},{startPage:3,endPage:3}]);
  s.drag.start(s.event(2,50,280));s.drag.update(s.event(0,50,20));
  assert(s.buttons[1].classList.contains('is-drag-source'));assert(s.buttons[2].classList.contains('is-drag-source'));
  assert(s.messages.at(-1)?.includes('2~3쪽 함께'));
  s.drag.finish(s.event(0,50,20));assert.deepEqual(s.drops,[[2,0]]);s.drag.dispose();
});
test('그룹 내부·패널 밖 드롭과 Esc 취소는 문서를 바꾸지 않는다',()=>{
  const s=setup();s.drag.start(s.event(0,50,50));s.drag.update(s.event(0,55,20));s.drag.finish(s.event(0,55,20));
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,220,250));s.drag.finish(s.event(2,220,250));
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,250));s.drag.finish(s.event(2,220,250));
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,250));s.drag.keyboard({key:'Escape',preventDefault(){},stopPropagation(){}});
  s.drag.finish(s.event(2,50,250));assert.deepEqual(s.drops,[]);s.drag.dispose();
});
test('키보드 이동과 패널 가장자리 자동 스크롤을 지원한다',()=>{
  const s=setup();s.drag.keyboard({altKey:true,key:'ArrowDown',target:s.buttons[0],preventDefault(){},stopPropagation(){}});
  assert.deepEqual(s.drops,[[0,2]]);
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,370));
  const [id,fn]=[...s.pending][0];s.pending.delete(id);fn();assert.equal(s.list.scrollTop,12);s.drag.dispose();
});
test('잡은 미리보기를 복사한 고스트가 마우스를 따라가고 형제 쪽이 들어갈 자리를 비운다',()=>{
  const s=setup();s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,250));
  assert.equal(s.body.children.length,1);assert.equal(s.drawn.length,1);
  assert.equal(s.drag.ghost.attrs.get('aria-hidden'),'true');assert.equal(s.drag.gap.hidden,false);
  assert.equal(s.buttons[1].style.transform,'translateY(-120px)');
  s.frame();const first=s.drag.ghost.style.transform;
  s.drag.update(s.event(2,80,270));s.frame();assert.notEqual(s.drag.ghost.style.transform,first);
  assert.deepEqual(s.drops,[],'놓기 전까지 원본 문서는 바꾸지 않는다');
  s.drag.finish(s.event(2,80,270));assert.equal(s.body.children.length,0);assert.equal(s.drag.gap,null);
  assert(s.buttons.every(b=>b.style.transform===''));s.drag.dispose();
});
test('떨어진 여러 쪽 선택을 모두 들어 올리고 하나의 삽입 자리로 표시한다',()=>{
  const s=setup([{startPage:0,endPage:0},{startPage:1,endPage:1},{startPage:2,endPage:2},{startPage:3,endPage:3}],[0,2]);
  s.drag.start(s.event(0,50,50));s.drag.update(s.event(3,50,370));
  assert(s.buttons[0].classList.contains('is-drag-source'));assert(s.buttons[2].classList.contains('is-drag-source'));
  assert.equal(s.drag.ghost.children.at(-1).textContent,'2쪽');
  s.drag.finish(s.event(3,50,370));assert.deepEqual(JSON.parse(JSON.stringify(s.drops)),[[0,3,[0,2]]]);s.drag.dispose();
});
test('Esc 취소는 고스트·삽입 자리·애니메이션을 모두 정리한다',()=>{
  const s=setup();s.drag.start(s.event(0,50,50));s.drag.update(s.event(2,50,250));
  s.drag.keyboard({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(s.body.children.length,0);assert.equal(s.drag.gap,null);assert.equal(s.pending.size,0);
  assert.deepEqual(s.drops,[]);s.drag.dispose();
});
test('페이지 이동은 기존 스냅샷 Undo 경로를 한 번 호출하고 조합 중에는 차단한다',()=>{
  const source=readFileSync(new URL('../src/engine/input-handler.ts',import.meta.url),'utf8');const ast=ts.createSourceFile('input.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='InputHandler') as ts.ClassDeclaration;
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='reorderPages')!;
  const reorder=vm.runInNewContext(ts.transpileModule(`class Handler{${method.getText(ast)}};Handler.prototype.reorderPages`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
  const calls:any[]=[],result={ok:true,changed:true,newStartPage:1};
  const wasm={getPageMoveRanges:()=>({ranges:[{startPage:0,endPage:0}]}),movePageRange:()=>{calls.push('move');return result;},getPositionOfPage:()=>({ok:true,sec:0,para:5,charOffset:0})};
  const handler:any={wasm,isComposing:false,cursor:{clearSelection(){},exitCellSelectionMode(){},exitTableObjectSelection(){},exitPictureObjectSelection(){},exitHeaderFooterMode(){},exitFootnoteMode(){}},executeOperation(op:any){calls.push(op.operationType);const pos=op.operation(wasm);assert.equal(pos.paragraphIndex,5);}};
  assert.equal(reorder.call(handler,0,2),result);assert.deepEqual(calls,['reorderPages','move']);
  calls.length=0;reorder.call(handler,0,1);assert.deepEqual(calls,[]);
  handler.isComposing=true;assert.throws(()=>reorder.call(handler,0,2),/한글 입력/);
});
