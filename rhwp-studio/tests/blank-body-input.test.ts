import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import init, { HwpDocument } from '../../pkg/rhwp.js';

await init({ module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url)) });
const module = { exports: {} as any };
const source = readFileSync(new URL('../src/engine/blank-body-input.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: module.exports });
const { planBlankBodyInput: plan, applyBlankBodyInput: apply } = module.exports;
function bridge(doc: HwpDocument): any {
  const parsed = ['getPageRenderTree', 'getPageInfo', 'getPageControlLayout', 'getCursorRect', 'getParaPropertiesAt'];
  return new Proxy({ doc }, { get(target, key: string) {
    if (key === 'doc') return doc;
    return (...args: any[]) => parsed.includes(key) ? JSON.parse((doc as any)[key](...args)) : (doc as any)[key](...args);
  } });
}
function blank() {
  const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
  return { doc, w: bridge(doc) };
}
test('빈 공간의 x/y에 본문 커서를 만들고 입력·저장·복원한다', () => {
  const { doc, w } = blank();
  const before = w.getCursorRect(0, 0, 0), target = { x: before.x + 100, y: before.y + 110 };
  const snap = doc.saveSnapshot();
  const p = plan(w, 0, target.x, target.y); assert(p);
  const pos = apply(w, p), actual = w.getCursorRect(0, pos.paragraphIndex, pos.charOffset);
  assert(Math.abs(actual.x - target.x) <= 2 && Math.abs(actual.y - target.y) <= 2);
  doc.insertText(0, pos.paragraphIndex, pos.charOffset, '빈 공간 입력');
  const reopened = new HwpDocument(doc.exportHwp());
  assert.equal(reopened.getTextRange(0, pos.paragraphIndex, 0, 100), '빈 공간 입력');
  const saved = JSON.parse(reopened.getCursorRect(0, pos.paragraphIndex, 0));
  assert(Math.abs(saved.x - target.x) <= 2 && Math.abs(saved.y - target.y) <= 2);
  reopened.free(); doc.restoreSnapshot(snap);
  assert.equal(doc.getParagraphCount(0), 1); assert.equal(doc.getParagraphLength(0, 0), 0);
  assert.deepEqual(w.getCursorRect(0, 0, 0), before); doc.free();
});
test('기존 텍스트와 단어 더블클릭을 보존하고 오른쪽 빈 곳은 탭으로 입력한다', () => {
  const { doc, w } = blank(); doc.insertText(0, 0, 0, '기존 본문');
  const start = w.getCursorRect(0, 0, 0), end = w.getCursorRect(0, 0, w.getLogicalLength(0, 0));
  assert.equal(plan(w, 0, start.x + 5, start.y + 3), null);
  const p = plan(w, 0, end.x + 100, end.y + 3); assert.equal(p.kind, 'tab');
  const pos = apply(w, p); doc.insertTextLogical(0, 0, pos.charOffset, '추가');
  assert.match(doc.getTextRange(0, 0, 0, 100), /^기존 본문\t+추가$/); doc.free();
});
test('기존 글 아래에는 별도 문단을 만들고 원문을 보존한다', () => {
  const { doc, w } = blank(); doc.insertText(0, 0, 0, '원문');
  const end = w.getCursorRect(0, 0, 2), p = plan(w, 0, end.x + 100, end.y + 100);
  assert.equal(p.kind, 'paragraph');
  const pos = apply(w, p); assert.equal(pos.paragraphIndex, 1);
  assert.equal(doc.getTextRange(0, 0, 0, 100), '원문'); doc.free();
});
test('가운데 정렬 제목 아래 빈 곳도 제목 서식을 바꾸지 않고 입력한다', () => {
  const { doc, w } = blank(); doc.insertText(0, 0, 0, '제목');
  doc.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center' }));
  const info = w.getPageInfo(0), end = w.getCursorRect(0, 0, 2);
  const p = plan(w, 0, info.marginLeft + 70, end.y + 100); assert(p);
  apply(w, p); assert.equal(w.getParaPropertiesAt(0, 0).alignment, 'center'); doc.free();
});
for (const wrap of ['Square', 'TopAndBottom', 'InFrontOfText', 'BehindText']) test(`${wrap}: 표 위 빈 공간 입력은 표 위치·셀·개체 수를 보존한다`, () => {
  const { doc, w } = blank();
  const t = JSON.parse(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, colWidths: [15000, 15000, 15000], rowHeights: [5000, 5000, 5000] })));
  doc.setTableProperties(0, t.paraIdx, t.controlIdx, JSON.stringify({ textWrap: wrap, horzRelTo: 'Column', vertRelTo: 'Para', vertOffset: 14000, restrictInPage: true }));
  const table = JSON.parse(doc.getTableBBox(0, t.paraIdx, t.controlIdx));
  assert.equal(plan(w, 0, table.x + 20, table.y + 20), null);
  assert.equal(plan(w, 0, table.x, table.y), null);
  const first = w.getCursorRect(0, 0, 0), target = { x: first.x + 80, y: first.y + 100 };
  const p = plan(w, 0, target.x, target.y); assert(p);
  const pos = apply(w, p); doc.insertTextLogical(0, pos.paragraphIndex, pos.charOffset, '표 위 입력');
  assert.deepEqual(JSON.parse(doc.getTableBBox(0, t.paraIdx, t.controlIdx)), table);
  assert.equal(w.getPageControlLayout(0).controls.filter((c: any) => c.type === 'table').length, 1);
  assert.equal(doc.getTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, 100), ''); doc.free();
});
test('용지 여백·머리말·꼬리말·쪽 바깥에는 본문을 만들지 않는다', () => {
  const { doc, w } = blank(), info = w.getPageInfo(0), first = w.getCursorRect(0, 0, 0);
  for (const [x,y] of [[0,first.y+100],[first.x,0],[first.x,info.height-1],[info.width+1,first.y],[-1,-1]]) assert.equal(plan(w, 0, x, y), null);
  assert.equal(plan(w, -1, first.x, first.y), null); assert.equal(doc.getParagraphCount(0), 1); doc.free();
});
test('더블클릭 배선은 한 번의 Undo 작업을 사용하고 조합·단어 선택을 보존한다', () => {
  const mouse = readFileSync(new URL('../src/engine/input-handler-mouse.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('mouse.ts', mouse, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'onDblClick'); assert(fn);
  const calls: string[] = [];
  let candidate: any = { sec: 0, para: 0 };
  const dbl = vm.runInNewContext(ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ';onDblClick', {
    URLSearchParams, window: { location: { search: '' } },
    planBlankBodyInput: () => candidate, applyBlankBodyInput() {},
  });
  const handler: any = { active: true, canvasMode: false, container: { querySelector: () => null },
    viewportManager: { getZoom: () => 1 }, pagePointFromClientPoint: () => ({ pageIdx: 0, pageX: 150, pageY: 250 }),
    cursor: { isInHeaderFooter: () => false, isInPictureObjectSelection: () => false, clearSelection: () => calls.push('clear'), selectWordAtCursor: () => { calls.push('word'); return true; } },
    executeOperation: (op: any) => calls.push(`${op.kind}:${op.operationType}`), textarea: { focus() {} }, updateCaret() {},
  };
  const event = { target: { closest: () => null }, preventDefault() {}, clientX: 150, clientY: 250 };
  handler.isComposing = true; dbl.call(handler, event); assert.deepEqual(calls, []);
  handler.isComposing = false; dbl.call(handler, event); assert.deepEqual(calls, ['clear', 'snapshot:blankBodyInput']);
  calls.length = 0; candidate = null; dbl.call(handler, event); assert.deepEqual(calls, ['word']);
});
