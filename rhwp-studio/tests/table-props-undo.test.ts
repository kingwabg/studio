import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function source(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

// 표/셀 속성·셀 테두리/배경 다이얼로그는 수십 개 속성을 한 번에 덮어쓰는
// 문서 mutation 이므로 반드시 편집 라우터(executeOperation)를 통과해 undo
// 스택에 기록되어야 한다 (#1320 계약, picture-props-dialog #2027 과 동일).

test('표/셀 속성 패널은 스냅샷으로 undo 기록된다', () => {
  // 은퇴한 모달 대신 현재 속성/테두리 패널의 동일 undo 계약을 검사한다.
  for (const path of ['src/ui/table-panel-sections.ts', 'src/ui/table-border-section.ts']) {
    const panel = source(path);
    const start = panel.indexOf('private run(');
    assert.notEqual(start, -1, `${path}: run not found`);
    assert.match(panel.slice(start), /executeOperation\(\{\s*kind: 'snapshot',\s*operationType: 'objectProps'/);
    assert.match(panel, /this\.run\(\(\) =>/, '속성 변경은 undo helper를 사용해야 함');
  }
  const panel = source('src/ui/table-panel-sections.ts');
  assert.match(panel, /this\.run\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*this\.wasm\.setTableProperties/);
  assert.match(panel, /this\.run\(\(\) => this\.wasm\.setCellProperties/);
});

test('셀 테두리/배경 다이얼로그 onConfirm은 스냅샷으로 undo 기록된다', () => {
  const dialog = source('src/ui/cell-border-bg-dialog.ts');
  const start = dialog.indexOf('protected onConfirm');
  assert.notEqual(start, -1, 'onConfirm not found');
  const block = dialog.slice(start, dialog.indexOf('\n  private ', start + 1));

  assert.match(
    block,
    /executeOperation\(\{\s*kind: 'snapshot',\s*operationType: 'objectProps'/,
    '셀 테두리/배경 적용은 snapshot 명령으로 기록되어야 함',
  );
});

test('표/셀 속성 진입점과 테두리 다이얼로그는 undo 서비스를 연결한다', () => {
  const table = source('src/command/commands/table.ts');
  const format = source('src/command/commands/format.ts');

  assert.match(
    table,
    /isInTableObjectSelection\(\)\) \{ openTablePanel\('table', '위치'\)/,
    '표 선택은 표 속성 패널로 연결되어야 함',
  );
  assert.match(
    table,
    /openTablePanel\('cell', '크기'\)/,
    '셀 커서는 셀 속성 패널로 연결되어야 함',
  );
  assert.match(
    format,
    /isInTableObjectSelection\(\)\) openTablePanel\('table', '위치'\)/,
    '개체 속성은 표 속성 패널로 연결되어야 함',
  );
  const inspector = source('src/ui/canva-right-inspector.ts');
  for (const section of ['panelSections', 'borderSection']) {
    assert.ok(inspector.includes(`this.${section}.mount(host, this.services.wasm, this.services,`), '패널에 undo 서비스 전달 필요');
  }
  const borderDialogCalls = table.match(/new CellBorderBgDialog\([\s\S]*?\);/g) ?? [];
  assert.equal(borderDialogCalls.length, 2, 'CellBorderBgDialog 진입점 2곳');
  for (const call of borderDialogCalls) {
    assert.match(call, /services,\s*\);$/, '셀 테두리/배경 진입점에서 services 전달 필요');
  }
});
