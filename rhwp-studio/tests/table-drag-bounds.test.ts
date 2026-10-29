import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function functions(file: string, names: string[]): string {
  const source = readFileSync(new URL(`../src/engine/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ''))
    .map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n');
}
const code = functions('canvas-snap.ts', ['pageClampRange', 'clampToPage', 'clampRangeForRelTo'])
  + '\n' + functions('input-handler-table.ts', ['updateMoveDrag']);
const api = vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  + ';({clampRangeForRelTo, updateMoveDrag})');
const page = { width: 793.7, height: 1122.5, marginLeft: 113.4, marginRight: 113.4,
  marginTop: 75.6, marginBottom: 75.6, marginHeader: 37.8, marginFooter: 37.8,
  columns: [{ x: 113.4, width: 567 }] };
const outer = { outerLeft: 283, outerRight: 283, outerTop: 283, outerBottom: 283 };

test('단/문단 기준의 경계에 한컴 표 바깥 여백을 포함한다', () => {
  const bounds = api.clampRangeForRelTo(page, 'Column', 'Para', 555.7, 85.5, 400, true, outer);
  assert(Math.abs(bounds.minX - (113.4 + 283 / 75)) < 0.001);
  assert(Math.abs(bounds.maxX - (680.4 - 555.7 - 283 / 75)) < 0.001);
  assert(Math.abs(bounds.minY - (113.4 + 283 / 75)) < 0.001);
  const off = api.clampRangeForRelTo(page, 'Column', 'Para', 555.7, 85.5, 400, false, outer);
  assert.equal(off.minY, 0, '쪽 제한 OFF는 위 여백 이동 허용');
  assert.equal(off.minX, bounds.minX, 'OFF여도 단의 가로 경계는 유지');
});

test('경계 밖 기존 표를 가로로 끌 때 세로가 튀지 않고 바깥 방향 이동도 역전하지 않는다', () => {
  let box = { x: 300, y: 110, width: 200, height: 40, pageIndex: 0 };
  const applied: number[][] = [];
  const handler: any = {
    moveDragState: { hasMoved: true, lastPageX: 300, lastPageY: 110, tableRef: { sec: 0, ppi: 0, ci: 0 },
      totalDeltaH: 0, totalDeltaV: 0, relToCache: { horzRelTo: 'Column', vertRelTo: 'Para', restrictInPage: true, outer, info: page, pageIndex: 0 } },
    viewportManager: { getZoom: () => 1 },
    container: { querySelector: () => ({ clientWidth: 794, getBoundingClientRect: () => ({ left: 0, top: 0 }) }) },
    virtualScroll: { getPageAtPoint: () => 0, getPageOffset: () => 0, getPageWidth: () => 794, getPageLeftResolved: () => 0 },
    wasm: { getTableBBox: () => ({ ...box }), saveSnapshot: () => 1,
      moveTableOffset: (_s: number, _p: number, _c: number, h: number, v: number) => {
        applied.push([h,v]); box = { ...box, x: box.x + h / 75, y: box.y + v / 75 }; return { ppi: 0, ci: 0 };
      } },
    eventBus: { emit() {} }, renderTableObjectSelection() {},
  };
  api.updateMoveDrag.call(handler, { clientX: 320, clientY: 110 });
  assert.equal(box.x, 320); assert.equal(box.y, 110);
  api.updateMoveDrag.call(handler, { clientX: 320, clientY: 100 });
  assert.equal(applied.length, 1, '위쪽으로 끌어도 아래쪽 강제 보정이 발생하지 않는다');
});
