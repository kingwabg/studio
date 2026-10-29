import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup() {
  class Hub {
    events=new Map<string,Set<Function>>();
    addEventListener(type:string,fn:Function){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type)!.add(fn);}
    removeEventListener(type:string,fn:Function){this.events.get(type)?.delete(fn);}
    fire(type:string,values:any={}){const event={target:this,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...values};for(const fn of [...this.events.get(type)??[]])fn(event);return event;}
    listenerCount(){return [...this.events.values()].reduce((n,s)=>n+s.size,0);}
  }
  class Element extends Hub {
    children:Element[]=[];parent:Element|null=null;style:any={};attrs=new Map<string,string>();className='';textContent='';disabled=false;tabIndex=0;tag:string;
    constructor(tag:string){super();this.tag=tag;}
    append(...children:Element[]){for(const child of children){child.parent=this;this.children.push(child);}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
    setAttribute(k:string,v:string){this.attrs.set(k,v);}
    contains(target:Element){return this===target||this.children.some(child=>child.contains(target));}
    get isConnected():boolean{return this===document.body||!!this.parent?.isConnected;}
    focus(_options?:unknown){document.activeElement=this;}
    getBoundingClientRect(){return{width:Math.min(180,parseFloat(this.style.maxWidth)||180),height:Math.min(this.children.length*30,parseFloat(this.style.maxHeight)||1000)};}
  }
  const document=Object.assign(new Hub(),{body:new Element('body'),activeElement:null as Element|null,createElement:(tag:string)=>new Element(tag)});
  const window=Object.assign(new Hub(),{innerWidth:320,innerHeight:200});
  const exports:any={};
  const source=readFileSync(new URL('../src/ui/page-preview-menu.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,document,window});
  const menu=new exports.PagePreviewMenu(),anchor=new Element('button');document.body.append(anchor);anchor.focus();
  const opened=()=>document.body.children.find(e=>e.className==='page-preview-context-menu')!;
  return{menu,document,window,anchor,opened,Element};
}
test('접근 가능한 메뉴를 화면 안에 배치하고 첫 활성 항목에 포커스를 둔다',()=>{
  const s=setup();s.menu.show(310,195,[{label:'사용 불가',disabled:true,action(){}},{label:'복제',action(){}}],s.anchor);
  const el=s.opened();assert.equal(el.attrs.get('role'),'menu');assert.equal(el.children[0].attrs.get('role'),'menuitem');
  assert.equal(el.style.left,'136px');assert.equal(el.style.top,'136px');assert.equal(s.document.activeElement,el.children[1]);
  assert.equal(el.fire('mousedown').prevented,true);s.menu.dispose();
});
test('방향키·Home·End가 비활성 항목을 건너뛰고 Escape·Tab은 앵커로 돌아간다',()=>{
  const s=setup(),items=[{label:'복제',action(){}},{label:'사용 불가',disabled:true,action(){}},{label:'삭제',danger:true,action(){}}];
  s.menu.show(0,0,items,s.anchor);let el=s.opened();
  el.fire('keydown',{key:'ArrowUp'});assert.equal(s.document.activeElement,el.children[2]);
  el.fire('keydown',{key:'ArrowDown'});assert.equal(s.document.activeElement,el.children[0]);
  el.fire('keydown',{key:'End'});assert.equal(s.document.activeElement,el.children[2]);
  el.fire('keydown',{key:'Home'});assert.equal(s.document.activeElement,el.children[0]);
  const escape=el.fire('keydown',{key:'Escape'});assert(escape.prevented);assert.equal(s.opened(),undefined);assert.equal(s.document.activeElement,s.anchor);
  s.menu.show(0,0,items,s.anchor);el=s.opened();assert(el.fire('keydown',{key:'Tab'}).prevented);assert.equal(s.document.activeElement,s.anchor);s.menu.dispose();
});
test('작업 실행 뒤 입력기 포커스를 유지하고 비활성 작업을 실행하지 않는다',()=>{
  const s=setup(),input=new s.Element('textarea');s.document.body.append(input);let calls=0;
  s.menu.show(20,20,[{label:'불가',disabled:true,action(){calls++;}},{label:'복제',action(){calls++;input.focus();}}],s.anchor);
  const el=s.opened();el.children[0].fire('click');assert.equal(calls,0);assert.equal(s.opened(),el);
  el.children[1].fire('click');assert.equal(calls,1);assert.equal(s.opened(),undefined);assert.equal(s.document.activeElement,input);
  assert.equal(s.document.listenerCount(),0);assert.equal(s.window.listenerCount(),0);s.menu.dispose();
});
test('바깥 클릭·스크롤·창 변경은 닫고 다른 곳으로 이동한 포커스를 빼앗지 않는다',()=>{
  for(const event of ['pointerdown','scroll','resize','blur']){
    const s=setup(),outside=new s.Element('button');s.document.body.append(outside);
    s.menu.show(0,0,[{label:'복제',action(){}}],s.anchor);outside.focus();
    if(event==='pointerdown'||event==='scroll')s.document.fire(event,{target:outside});else s.window.fire(event);
    assert.equal(s.opened(),undefined,event);assert.equal(s.document.activeElement,outside,event);
    assert.equal(s.document.listenerCount(),0);assert.equal(s.window.listenerCount(),0);s.menu.dispose();
  }
});
test('반복 열기와 작업 중 새 메뉴 열기에서 이전 정리가 새 메뉴를 닫지 않는다',()=>{
  const s=setup();s.menu.show(0,0,[{label:'다시 열기',action(){s.menu.show(10,10,[{label:'새 항목',action(){}}],s.anchor);}}],s.anchor);
  const old=s.opened();old.children[0].fire('click');const current=s.opened();assert.notEqual(current,old);assert.equal(current.children[0].textContent,'새 항목');
  assert.equal(s.document.listenerCount(),2);assert.equal(s.window.listenerCount(),2);
  s.menu.dispose();assert.equal(s.document.listenerCount(),0);assert.equal(s.window.listenerCount(),0);assert.equal(s.opened(),undefined);
});
test('항목이 모두 비활성이거나 메뉴가 비어 있어도 안전하게 닫힌다',()=>{
  const s=setup();s.menu.show(0,0,[],s.anchor);assert.equal(s.opened(),undefined);assert.equal(s.document.listenerCount(),0);
  s.menu.show(0,0,[{label:'불가',disabled:true,action(){throw Error('실행하면 안 됨');}}],s.anchor);
  const el=s.opened();assert.equal(s.document.activeElement,el);el.fire('keydown',{key:'ArrowDown'});s.menu.hide(true);assert.equal(s.document.activeElement,s.anchor);s.menu.dispose();
});
