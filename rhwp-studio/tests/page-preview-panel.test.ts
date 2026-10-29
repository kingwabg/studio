import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

class Element {
  children: Element[] = []; attrs = new Map<string,string>(); events = new Map<string,Function[]>();
  classes = new Set<string>(); dataset: any = {}; style: any = {}; hidden = false; textContent = ''; className = ''; width = 0; height = 0; scrollTop = 0; parent?: Element;
  classList = { toggle: (c: string, force?:boolean) => { const on = force ?? !this.classes.has(c); on ? this.classes.add(c) : this.classes.delete(c); return on; } };
  append(...items: Element[]) { for (const x of items) { this.children.push(x); x.parent = this; } }
  appendChild(item: Element) { this.append(item); return item; }
  prepend(x: Element) { this.children.unshift(x); x.parent = this; }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  setAttribute(k:string,v:string) { this.attrs.set(k,v); }
  removeAttribute(k:string) { this.attrs.delete(k); }
  addEventListener(k:string,f:Function) { this.events.set(k,[...(this.events.get(k)??[]),f]); }
  fire(k:string,e:any={}) { this.events.get(k)?.forEach(f => f(e)); }
  closest(selector:string): Element | null { return this.className.split(' ').includes(selector.slice(1)) ? this : this.parent?.closest(selector) ?? null; }
  querySelector(selector:string): Element | null { const cls=selector.slice(1); for(const child of this.children){if(child.className.split(' ').includes(cls))return child;const nested=child.querySelector(selector);if(nested)return nested;} return null; }
  getBoundingClientRect() { return { top:0,bottom:300 }; }
}
function setup() {
  let observer: any, next = 1;
  const raf = new Map<number,Function>(), timers = new Map<number,Function>(), handlers = new Map<string,Set<Function>>();
  const source = readFileSync(new URL('../src/ui/page-preview-panel.ts',import.meta.url),'utf8');
  const selection:any={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/core/page-selection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:selection});
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,require(id:string) { return id.includes('page-preview-drag') ? {PagePreviewDrag:class{cancel(){} dispose(){}}}:id.includes('page-preview-menu')?{PagePreviewMenu:class{items:any[]=[];anchor:any;show(_x:number,_y:number,items:any[],anchor:any){this.items=items;this.anchor=anchor;}hide(){}dispose(){}}}:id.includes('page-selection')?selection:{}; },document:{createElement:()=>new Element()},URLSearchParams,window:{location:{search:''},devicePixelRatio:2},console,performance,
    IntersectionObserver:class { callback:Function; constructor(callback:Function){this.callback=callback;observer=this;} observe(){} unobserve(){} disconnect(){} },
    requestAnimationFrame:(fn:Function)=>{const id=next++;raf.set(id,fn);return id;},cancelAnimationFrame:(id:number)=>raf.delete(id),
    setTimeout:(fn:Function)=>{const id=next++;timers.set(id,fn);return id;},clearTimeout:(id:number)=>timers.delete(id),
  });
  const rendered:number[]=[], navigated:number[]=[];
  const bus={on:(event:string,fn:Function)=>{if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event)!.add(fn);return()=>handlers.get(event)!.delete(fn);},emit:(event:string,...args:any[])=>handlers.get(event)?.forEach(fn=>fn(...args))};
  const wasm={pageCount:6,getPageInfo:()=>({width:794,height:1123}),getPageMoveRanges:()=>({ranges:Array.from({length:wasm.pageCount},(_,p)=>({startPage:p,endPage:p}))}),renderPageToCanvas:(p:number,c:Element)=>{rendered.push(p);c.width=332;c.height=470;}};
  const panel = new exports.PagePreviewPanel(new Element(),{wasm,eventBus:bus,navigateToPage:(page:number)=>{navigated.push(page);bus.emit('current-page-changed',page,wasm.pageCount);},getInputHandler:()=>{throw Error('쪽 탐색은 커서를 건드리지 않는다');}});
  const flush=()=>{let guard=100;while((timers.size||raf.size)&&guard--){for(const [id,fn]of [...timers]){timers.delete(id);fn();}for(const[id,fn]of [...raf]){raf.delete(id);fn();}}};
  return {panel,wasm,bus,rendered,navigated,flush,visible:(pages:number[])=>observer.callback(panel.slots.map((s:any,p:number)=>({target:s.button,isIntersecting:pages.includes(p)})))};
}
test('미리보기 클릭과 현재 쪽 이벤트를 양방향으로 연동한다',()=>{
  const s=setup();assert.equal(s.panel.slots.length,6);
  assert.equal(s.panel.slots[0].button.attrs.get('aria-current'),'page');
  s.panel.slots[4].button.fire('click');assert.deepEqual(s.navigated,[4]);
  assert.equal(s.panel.slots[4].button.attrs.get('aria-current'),'page');
  s.bus.emit('current-page-changed',2,6);
  assert.equal(s.panel.slots[2].button.attrs.get('aria-current'),'page');
  assert.equal(s.panel.slots[4].button.attrs.has('aria-current'),false);s.panel.dispose();
});
test('보이는 쪽만 렌더하고 화면 밖 캔버스 메모리를 반환한다',()=>{
  const s=setup();s.visible([0,1]);s.flush();assert.deepEqual(s.rendered,[0,1]);
  s.visible([4]);s.flush();assert.deepEqual(s.rendered,[0,1,4]);
  assert.equal(s.panel.slots[0].canvas.width,0);
  assert.equal(s.panel.slots[4].canvas.width,332);s.panel.dispose();
});
test('내용 수정·같은 쪽 수의 새 문서·쪽 수 변경을 갱신한다',()=>{
  const s=setup();s.visible([0]);s.flush();
  s.bus.emit('document-page-invalidated',{pageIndex:0});s.flush();assert.deepEqual(s.rendered,[0,0]);
  s.panel.status.textContent='쪽 이동 완료';s.bus.emit('document-changed');assert(s.panel.status.textContent.includes('드래그'));
  const old=s.panel.slots[0];s.bus.emit('document-pages-loaded');assert.notEqual(s.panel.slots[0],old);
  assert.equal(old.canvas.width,0);s.wasm.pageCount=2;s.bus.emit('current-page-changed',1,2);
  assert.equal(s.panel.slots.length,2);assert.equal(s.panel.slots[1].button.attrs.get('aria-current'),'page');s.panel.dispose();
});
test('접기·펼치기와 마우스 포커스 보존이 동작한다',()=>{
  const s=setup(),toggle=s.panel.element.querySelector('.page-preview-header').children[2];let prevented=false;
  toggle.fire('mousedown',{preventDefault:()=>{prevented=true;}});assert(prevented);
  toggle.fire('click');assert.equal(s.panel.list.hidden,true);assert.equal(toggle.attrs.get('aria-expanded'),'false');
  toggle.fire('click');assert.equal(s.panel.list.hidden,false);s.panel.dispose();
});
test('Shift 범위·Ctrl 개별·선택 모드로 여러 페이지를 선택한다',()=>{
  const s=setup();
  s.panel.slots[2].button.fire('click',{shiftKey:true});assert.deepEqual([...s.panel.selected],[0,1,2]);
  s.panel.slots[1].button.fire('click',{ctrlKey:true});assert.deepEqual([...s.panel.selected],[0,2]);
  assert.equal(s.panel.slots[2].button.attrs.get('aria-pressed'),'true');
  s.panel.toolbar.querySelector('.page-preview-select-tools').children[0].fire('click');s.panel.slots[4].button.fire('click');assert.deepEqual([...s.panel.selected],[0,2,4]);
  assert.deepEqual(s.navigated,[],'복수 선택은 본문 커서를 옮기지 않는다');
  s.panel.toolbar.querySelector('.page-preview-select-tools').children[1].fire('click');assert.equal(s.panel.selected.size,6);s.panel.dispose();
});
test('선택된 쪽 우클릭은 다중 선택을 유지하고 선택 밖 우클릭은 대상을 바꾼다',()=>{
  const s=setup(),calls:any[]=[];
  s.panel.services.getInputHandler=()=>({editPages:(action:string,pages:number[])=>{calls.push({action,pages:[...pages]});return null;}});
  s.panel.slots[2].button.fire('click',{ctrlKey:true});
  const right=(page:number)=>s.panel.list.fire('contextmenu',{target:s.panel.slots[page].button,clientX:20,clientY:30,preventDefault(){},stopPropagation(){}});
  right(2);assert.deepEqual([...s.panel.selected],[0,2]);assert.equal(s.panel.menu.items.length,3);
  for(const item of s.panel.menu.items)item.action();
  assert.deepEqual(calls,[{action:'insertBlank',pages:[0,2]},{action:'duplicate',pages:[0,2]},{action:'delete',pages:[0,2]}]);
  right(4);assert.deepEqual([...s.panel.selected],[4]);assert.equal(s.panel.menu.anchor,s.panel.slots[4].button);assert.deepEqual(s.navigated,[]);s.panel.dispose();
});
test('빈 쪽 추가·위아래 버튼과 Shift+F10 메뉴가 같은 쪽 편집 경로를 사용한다',()=>{
  const s=setup(),calls:any[]=[];
  s.panel.services.getInputHandler=()=>({editPages:(action:string,pages:number[],before?:number)=>{calls.push({action,pages:[...pages],before});return null;}});
  assert(s.panel.upButton.disabled);s.panel.blankButton.fire('click');
  s.panel.slots[2].button.fire('click');assert(!s.panel.upButton.disabled);assert(!s.panel.downButton.disabled);
  s.panel.upButton.fire('click');s.panel.downButton.fire('click');
  assert.deepEqual(calls,[{action:'insertBlank',pages:[0],before:undefined},{action:'move',pages:[2],before:1},{action:'move',pages:[2],before:4}]);
  let stopped=false;s.panel.list.fire('keydown',{key:'F10',shiftKey:true,target:s.panel.slots[3].button,preventDefault(){stopped=true;},stopPropagation(){}});
  assert(stopped);assert.deepEqual([...s.panel.selected],[3]);s.panel.dispose();
});
test('선택한 쪽 복제·삭제를 각각 한 번 호출하고 결과 쪽을 선택한다',()=>{
  const s=setup(),calls:any[]=[];
  let focused=0;
  s.panel.services.getInputHandler=()=>({focus:()=>focused++,editPages:(action:string,pages:number[])=>{
    calls.push({action,pages:[...pages]});s.wasm.pageCount+=action==='duplicate'?pages.length:-pages.length;
    return {changed:true,action,affectedPages:[...pages],newSelectedPages:action==='duplicate'?[3,4]:[3],newStartPage:3};
  }});
  s.panel.slots[2].button.fire('click',{metaKey:true});
  s.panel.duplicateButton.fire('click');assert.deepEqual(calls,[{action:'duplicate',pages:[0,2]}]);
  assert.deepEqual([...s.panel.selected],[3,4]);assert.equal(s.panel.slots.length,8);
  s.panel.deleteButton.fire('click');assert.deepEqual(calls[1],{action:'delete',pages:[3,4]});
  assert.equal(s.panel.slots.length,6);assert.deepEqual([...s.panel.selected],[3]);assert.equal(focused,2);s.panel.dispose();
});
test('연결된 페이지는 함께 선택하고 선택하지 않으면 복제·삭제를 비활성화한다',()=>{
  const s=setup();s.panel.rangeCache=null;
  s.wasm.getPageMoveRanges=()=>({ranges:[{startPage:0,endPage:1},{startPage:2,endPage:5}]});
  s.panel.slots[0].button.fire('click');assert.deepEqual([...s.panel.selected],[0,1]);
  s.panel.slots[0].button.fire('click',{ctrlKey:true});assert.equal(s.panel.selected.size,0);
  assert(s.panel.duplicateButton.disabled);assert(s.panel.deleteButton.disabled);s.panel.dispose();
});
