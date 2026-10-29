import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { inspectorTabTarget } from '../src/ui/inspector-tab-policy.ts';

// [캔버스 한컴 포크] 실제 패널 판정 함수를 실행해 이동 전 셀 캐시가 남은 경우를 재현한다.
const source = readFileSync(new URL('../src/ui/canva-right-inspector.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'cellIdentity');
assert(fn);
const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const identity = vm.runInNewContext(`${js}; cellIdentity`);

test('표가 문단·구조 컨트롤 경계를 넘으면 패널이 새 선택 참조를 따른다', () => {
  let selected = { sec: 0, ppi: 2, ci: 0 };
  const ih = {
    getSelectedTableRef: () => selected,
    cursor: { getCellTableContext: () => ({ sec: 0, ppi: 2, ci: 0 }), getPosition: () => ({ cellIndex: 0 }) },
  };
  const before = identity(ih);
  selected = { sec: 0, ppi: 0, ci: 2 };
  assert.notEqual(identity(ih), before, '이동 후 패널을 다시 만들어야 한다');
  assert.equal(identity(ih), '0/0/2/0');
});

test('표 개체 선택을 끝내면 현재 셀을 계속 따른다', () => {
  const ih = { getSelectedTableRef: () => null,
    cursor: { getCellTableContext: () => ({ sec: 0, ppi: 3, ci: 0 }), getPosition: () => ({ cellIndex: 2 }) } };
  assert.equal(identity(ih), '0/3/0/2');
  assert.equal(identity({}), '');
});

test('같은 문단에서 표를 이동해도 드롭 후 위치 입력값을 다시 읽는다', () => {
  const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CanvaRightInspector');
  assert(cls && ts.isClassDeclaration(cls));
  const method = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === 'refreshContext');
  assert(method);
  const probeCode = `class Probe { ${method.getText(ast).replace(/^private\s+/, '')} }; Probe`;
  const Probe = vm.runInNewContext(ts.transpileModule(probeCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { inspectorTabTarget, cellIdentity: () => '0/2/0/0', pictureIdentity: () => '' });
  const probe = new Probe(); let renders = 0;
  Object.assign(probe, { services: { wasm: { pageCount: 1 }, getInputHandler: () => ({ isInTableObjectSelection: () => true }) },
    ctx: 'table', panelTab:'table', tabTargetKey:'table:0/2/0/0', painted: true, lastMulti: false, lastCellKey: '0/2/0/0', lastPicKey: '',
    paintBanner() {}, applyContext() { renders++; }, syncTabs() {} });
  probe.refreshContext(); assert.equal(renders, 0, '일반 커서 신호는 재생성하지 않는다');
  probe.refreshContext(true); assert.equal(renders, 1, '드롭 후 실제 위치를 다시 읽는다');
});
