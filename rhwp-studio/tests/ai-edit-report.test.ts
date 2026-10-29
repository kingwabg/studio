// [캔버스 한컴 포크] 큰 적용 로그는 화면만 줄이고, JSON과 실제 적용값 요약을 유지한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ui/ai-edit-report.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => ({}) });

test('작은 대상 조회는 글자·문단 속성을 포함한 원본 JSON을 그대로 표시한다', () => {
  const report = { ok: true, logs: [{ tool: 'inspect_target', status: 'applied', actual: { text: '본문', char: { fontSize: 1000 }, para: { alignment: 'left' } } }] };
  assert.equal(exports.summarizeEditReport(report), JSON.stringify(report, null, 2));
});

test('큰 로그는 유효한 16KB 이하 JSON 요약으로 표시하고 원본을 변경하지 않는다', () => {
  const report = { ok: true, logs: Array.from({ length: 100 }, (_, index) => ({
    index, tool: 'create_table', status: 'applied', requested: { text: '가'.repeat(5000) },
    actual: { table: index, bboxPx: { x: 100, y: 100, width: 200, height: 80 }, cells: Array(50).fill({}), text: '실제', char: { fontSize: 1000 }, para: { alignment: 'left' } },
  })) };
  const original = JSON.stringify(report);
  const output = exports.summarizeEditReport(report);
  const summary = JSON.parse(output);
  assert.ok(output.length <= 16_000);
  assert.equal(summary.totalOperations, 100);
  assert.ok(summary.omittedOperations > 0);
  assert.equal(summary.logs.at(-1).actual.table, 99);
  assert.equal(summary.logs[0].actual.cells, 50);
  assert.equal(summary.logs[0].actual.text, '실제');
  assert.deepEqual(summary.logs[0].actual.char, { fontSize: 1000 });
  assert.equal(original, JSON.stringify(report));
});


test('AI 결과 3500자 한도에서도 JSON이 유효하고 마지막 문서 조회를 보존한다', () => {
  const logs = Array.from({ length: 20 }, (_, index) => ({
    index, tool: 'format_text', status: 'applied', requested: { text: '가'.repeat(500) },
    actual: { text: '실제 글자', char: { fontSize: 1000 }, para: { alignment: 'left' } },
  }));
  const final = { index: 20, tool: 'inspect_document', status: 'applied',
    actual: { pageCount: 1, page: { width: 59528, height: 84189 }, tables: Array(5).fill({ cells: Array(20).fill({}) }) } };
  const output = exports.summarizeEditReport({ ok: true, logs: [...logs, final] }, 3500);
  const summary = JSON.parse(output);
  assert.ok(output.length <= 3500);
  assert.equal(summary.logs.at(-1).tool, 'inspect_document');
  assert.equal(summary.logs.at(-1).actual.tables, 5);
  assert.equal(summary.logs.at(-1).actual.pageCount, 1);
  assert.equal(summary.omittedOperations + summary.logs.length, 21);
});
