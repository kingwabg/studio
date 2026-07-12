import test from 'node:test';
import assert from 'node:assert/strict';

import { gridToTsv, gridToHtml, type CellGrid, type CellGridSlot } from '../src/engine/cell-copy.ts';

// 헬퍼 — anchor/covered/excluded 슬롯을 짧게 만든다.
const anchor = (paragraphs: string[], rowSpan = 1, colSpan = 1): CellGridSlot =>
  ({ kind: 'anchor', paragraphs, rowSpan, colSpan });
const covered: CellGridSlot = { kind: 'covered' };
const excluded: CellGridSlot = { kind: 'excluded' };

// 기본 2×2 그리드: 병합/제외 없이 텍스트만 채운 표
const basicGrid: CellGrid = [
  [anchor(['a1']), anchor(['b1'])],
  [anchor(['a2']), anchor(['b2'])],
];

test('gridToTsv — 기본 그리드는 셀 \\t, 행 \\n으로 직렬화한다', () => {
  assert.equal(gridToTsv(basicGrid), 'a1\tb1\na2\tb2');
});

test('gridToTsv — covered(병합 연장) 자리는 빈 칸으로 채워 열 정렬을 유지한다', () => {
  // 1행: (0,0)이 colSpan=2로 (0,1)을 덮음. 2행: 독립 셀 2개.
  const grid: CellGrid = [
    [anchor(['머리글'], 1, 2), covered],
    [anchor(['a2']), anchor(['b2'])],
  ];
  assert.equal(gridToTsv(grid), '머리글\t\na2\tb2');
});

test('gridToTsv — 셀 내부 여러 문단(줄바꿈)은 공백으로 치환한다', () => {
  const grid: CellGrid = [[anchor(['첫째줄', '둘째줄', '셋째줄'])]];
  assert.equal(gridToTsv(grid), '첫째줄 둘째줄 셋째줄');
});

test('gridToTsv — excluded(Ctrl+클릭 제외) 자리는 빈 문자열로 근사한다', () => {
  const grid: CellGrid = [[anchor(['a1']), excluded, anchor(['c1'])]];
  assert.equal(gridToTsv(grid), 'a1\t\tc1');
});

test('gridToHtml — 기본 그리드는 <table><tr><td> 구조로 직렬화한다', () => {
  const html = gridToHtml(basicGrid);
  assert.match(html, /^<table>.*<\/table>$/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 2);
  assert.equal((html.match(/<td>/g) ?? []).length, 4);
  assert.match(html, /<td><p>a1<\/p><\/td>/);
});

test('gridToHtml — 병합 셀은 rowspan/colspan 속성을 달고, covered 자리는 <td>를 생략한다', () => {
  const grid: CellGrid = [
    [anchor(['머리글'], 1, 2), covered],
    [anchor(['a2']), anchor(['b2'])],
  ];
  const html = gridToHtml(grid);
  assert.match(html, /<td colspan="2"><p>머리글<\/p><\/td>/);
  // covered 자리는 <td>를 아예 만들지 않으므로 1행의 <td> 개수는 1개뿐이어야 한다.
  const firstRow = /<tr>(.*?)<\/tr>/.exec(html)?.[1] ?? '';
  assert.equal((firstRow.match(/<td/g) ?? []).length, 1);
});

test('gridToHtml — rowSpan/colSpan이 모두 1이면 속성을 생략한다', () => {
  const html = gridToHtml([[anchor(['x'])]]);
  assert.doesNotMatch(html, /rowspan|colspan/);
});

test('gridToHtml — 텍스트의 <, &, ", > 를 이스케이프한다', () => {
  const html = gridToHtml([[anchor(['<script>a & "b" > c</script>'])]]);
  assert.match(html, /&lt;script&gt;a &amp; &quot;b&quot; &gt; c&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('gridToHtml — 셀 내부 여러 문단은 각각 <p>로 감싸 줄바꿈을 보존한다', () => {
  const html = gridToHtml([[anchor(['첫째줄', '둘째줄'])]]);
  assert.match(html, /<td><p>첫째줄<\/p><p>둘째줄<\/p><\/td>/);
});

test('gridToHtml — excluded 자리는 빈 <td></td>로 출력한다', () => {
  const html = gridToHtml([[anchor(['a1']), excluded]]);
  assert.match(html, /<td><\/td>/);
});

test('gridToHtml — 문단이 비어있으면(빈 셀) <p></p> 하나를 출력한다', () => {
  const html = gridToHtml([[anchor([])]]);
  assert.match(html, /<td><p><\/p><\/td>/);
});
