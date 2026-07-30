import test from 'node:test';
import assert from 'node:assert/strict';

import { shiftParagraphIndex, correctPositionAfterTableMove } from '../src/engine/table-move-cursor.ts';

// [커서 정합 2026-07-30] TAC 표 세로 이동 = 엔진의 문단 연쇄 swap.
// 커서 문단을 따라 보정하지 않으면 표를 옮긴 뒤 입력이 엉뚱한 문단으로 간다.

test('shiftParagraphIndex — 아래로 이동(2→5)', () => {
  assert.equal(shiftParagraphIndex(2, 2, 5), 5, '이동한 문단 자신');
  assert.equal(shiftParagraphIndex(3, 2, 5), 2, '구간 안은 한 칸 위로');
  assert.equal(shiftParagraphIndex(5, 2, 5), 4);
  assert.equal(shiftParagraphIndex(1, 2, 5), 1, '구간 밖(앞)은 불변');
  assert.equal(shiftParagraphIndex(6, 2, 5), 6, '구간 밖(뒤)은 불변');
});

test('shiftParagraphIndex — 위로 이동(5→2)', () => {
  assert.equal(shiftParagraphIndex(5, 5, 2), 2, '이동한 문단 자신');
  assert.equal(shiftParagraphIndex(2, 5, 2), 3, '구간 안은 한 칸 아래로');
  assert.equal(shiftParagraphIndex(4, 5, 2), 5);
  assert.equal(shiftParagraphIndex(1, 5, 2), 1);
  assert.equal(shiftParagraphIndex(6, 5, 2), 6);
});

test('shiftParagraphIndex — 이동 없음이면 항등', () => {
  for (const p of [0, 1, 7]) assert.equal(shiftParagraphIndex(p, 3, 3), p);
});

test('correctPositionAfterTableMove — 본문 커서는 paragraphIndex 를 따라간다', () => {
  const pos = { sectionIndex: 0, paragraphIndex: 3, charOffset: 4 };
  assert.deepEqual(correctPositionAfterTableMove(pos, 2, 5),
    { sectionIndex: 0, paragraphIndex: 2, charOffset: 4 });
});

test('correctPositionAfterTableMove — 표 안 커서는 parentParaIndex 를 따라간다', () => {
  const pos = {
    sectionIndex: 0, paragraphIndex: 0, charOffset: 1,
    parentParaIndex: 2, controlIndex: 0, cellIndex: 0, cellParaIndex: 0,
  };
  const out = correctPositionAfterTableMove(pos, 2, 5);
  assert.equal(out.parentParaIndex, 5, '표를 품은 문단 인덱스가 새 위치로');
  assert.equal(out.cellIndex, 0, '셀 좌표는 보존');
});

test('correctPositionAfterTableMove — 바뀔 게 없으면 같은 객체(불필요한 moveTo 방지)', () => {
  const pos = { sectionIndex: 0, paragraphIndex: 9, charOffset: 0 };
  assert.equal(correctPositionAfterTableMove(pos, 2, 5), pos);
  assert.equal(correctPositionAfterTableMove(pos, 4, 4), pos);
});
