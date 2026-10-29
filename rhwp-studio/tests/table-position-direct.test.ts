import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import init, { HwpDocument } from '../../pkg/rhwp.js';
await init({ module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url)) });
function ast(path: string) { return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true); }
const snap = ast('../src/engine/canvas-snap.ts');
const fns = snap.statements.filter(n => ts.isFunctionDeclaration(n) && ['clampRangeForRelTo', 'clampToPage'].includes(n.name?.text ?? '')).map(n => n.getText(snap).replace(/^export\s+/, '')).join('\n');
const panel = ast('../src/ui/table-panel-sections.ts');
const cls = panel.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'TablePanelSections');
assert(cls && ts.isClassDeclaration(cls));
const method = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(panel) === 'patchTable');
assert(method);
const code = `${fns}\nclass Probe { ${method.getText(panel).replace(/^private\s+/, '')} }; Probe`;
const Probe = vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
for (const align of ['Left', 'Right']) test(`쪽 제한 직접 입력 ${align}: 표가 본문 경계를 넘지 않는다`, () => {
 const d = HwpDocument.createEmpty(); d.createBlankDocument();
 try {
  const t = JSON.parse(d.createTableEx(JSON.stringify({ sectionIdx:0, paraIdx:0, charOffset:0, rowCount:3, colCount:3, colWidths:[9000,9000,9000], rowHeights:[2000,2000,2000], treatAsChar:false })));
  d.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({ textWrap:'TopAndBottom', horzRelTo:'Para', horzAlign:align, vertRelTo:'Para', restrictInPage:true }));
  const w:any = { getTableBBox:(...a:any[])=>JSON.parse(d.getTableBBox(...a)), getPageInfo:(...a:any[])=>JSON.parse(d.getPageInfo(...a)), getTableProperties:(...a:any[])=>JSON.parse(d.getTableProperties(...a)), getTableCellBboxes:()=>[], setTableProperties:(...a:any[])=>d.setTableProperties(a[0],a[1],a[2],JSON.stringify(a[3])) };
  const p = new Probe(); Object.assign(p, {ctx:{sec:0,ppi:t.paraIdx,ci:t.controlIdx},wasm:w,tp:w.getTableProperties(0,t.paraIdx,t.controlIdx),run:(fn:()=>void)=>fn()});
  p.patchTable({horzOffset:70866}); p.patchTable({vertOffset:70866});
  const b=w.getTableBBox(0,t.paraIdx,t.controlIdx), i=w.getPageInfo(0), props=w.getTableProperties(0,t.paraIdx,t.controlIdx);
  console.info('[table-position-direct]',JSON.stringify({align,bounds:{left:i.marginLeft,right:i.width-i.marginRight,top:i.marginTop+i.marginHeader,bottom:i.height-i.marginBottom-i.marginFooter},bbox:b,offset:{h:props.horzOffset,v:props.vertOffset}}));
  assert.ok(b.x>=i.marginLeft-0.1 && b.x+b.width<=i.width-i.marginRight+0.1);
  assert.ok(b.y>=i.marginTop+i.marginHeader-0.1 && b.y+b.height<=i.height-i.marginBottom-i.marginFooter+0.1);
 } finally { d.free(); }
});
