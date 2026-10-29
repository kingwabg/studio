import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/engine/input-handler-table.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('table.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='finishResizeDrag');
assert(fn);
const finish=vm.runInNewContext(ts.transpileModule(fn.getText(ast).replace(/^export\s+/,''),
  {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';finishResizeDrag',{
  promoteResizeDragToSingleCell:()=>null,clampResizePosition:(p:number)=>p,
  applyBoundarySnap:(_s:unknown,p:number)=>({pos:p}),_snapLayerFor:()=>({clear(){}}),
  isOuterResizeEdge:()=>true,selectTableObjectFromResize(){},minCellSizeHwp:()=>100,
});
function resize(axis:string,delta:number,zoom=1,outer=true){
  const original=510.3,start=508.69375,calls:any[]=[];
  const box={cellIdx:0,x:410.3,y:410.3,w:100,h:100};
  const handler={tableResizeRenderer:{},viewportManager:{getZoom:()=>zoom},
    container:{style:{},querySelector:()=>({clientWidth:794,getBoundingClientRect:()=>({left:0,top:0})})},
    virtualScroll:{getPageOffset:()=>0,getPageWidth:()=>794,getPageLeftResolved:()=>0},
    resizeDragState:{edge:{type:axis,pageIndex:0},startPageX:start,startPageY:start,borderOriginalPos:original,
      minResizePos:original,maxResizePos:original,tableRef:{sec:0,ppi:0,ci:0},bboxes:[box],pageBboxes:[box],outerResize:outer},
    cursor:{isInCellSelectionMode:()=>false,getPosition:()=>({})},cleanupResizeDrag(){},
    executeOperation(op:any){op.operation({setCellProperties(...args:any[]){calls.push(args.at(-1));},reflowLinesegs(){}})},
  };
  finish.call(handler,{clientX:(axis==='col'?start+delta:start)*zoom,clientY:(axis==='row'?start+delta:start)*zoom});
  return calls.map(c=>({...c}));
}
test('경계 안쪽 더블클릭·미세 흔들림은 크기 변경을 기록하지 않는다',()=>{
  for(const axis of ['col','row'])for(const delta of [0,1,-1,2,-2])assert.deepEqual(resize(axis,delta),[],`${axis}/${delta}`);
  assert.deepEqual(resize('row',2,1,false),[],'클릭 흔들림이 행 성장 폴백을 실행하지 않는다');
  assert.deepEqual(resize('col',1,2),[],'화면2px 움직임도 클릭으로 처리한다');
});
test('실제 드래그는 누른 위치와 경계선의 간격을 보존한다',()=>{
  assert.deepEqual(resize('col',10),[{width:8250}]);
  assert.deepEqual(resize('row',-10),[{height:6750}]);
});
