import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRect, rectsIntersect, objectsInMarquee } from '../src/engine/marquee-select.ts';

test('normalizeRect — 어느 드래그 방향이든 좌상단+양수 크기로 정규화', () => {
  const expected = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(normalizeRect(10, 20, 40, 60), expected); // ↘
  assert.deepEqual(normalizeRect(40, 60, 10, 20), expected); // ↖
  assert.deepEqual(normalizeRect(40, 20, 10, 60), expected); // ↙
  assert.deepEqual(normalizeRect(10, 60, 40, 20), expected); // ↗
});

test('rectsIntersect — 겹침/비겹침/포함 판정', () => {
  const m = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(rectsIntersect(m, { x: 50, y: 50, w: 20, h: 20 }), true);   // 내부
  assert.equal(rectsIntersect(m, { x: 90, y: 90, w: 40, h: 40 }), true);   // 모서리 걸침
  assert.equal(rectsIntersect(m, { x: 200, y: 0, w: 10, h: 10 }), false);  // 오른쪽 밖
  assert.equal(rectsIntersect(m, { x: -50, y: -50, w: 400, h: 400 }), true); // 마퀴를 감쌈
});

test('rectsIntersect — 경계만 접하는 건 교차로 치지 않는다(오선택 방지)', () => {
  const m = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(rectsIntersect(m, { x: 100, y: 0, w: 10, h: 10 }), false); // 오른쪽 변에 딱 붙음
  assert.equal(rectsIntersect(m, { x: 0, y: 100, w: 10, h: 10 }), false); // 아래 변에 딱 붙음
});

test('objectsInMarquee — 걸린 개체 인덱스만, 원래 순서 유지', () => {
  const marquee = { x: 0, y: 0, w: 60, h: 60 };
  const boxes = [
    { x: 10, y: 10, w: 20, h: 20 }, // 0: 안 → hit
    { x: 200, y: 200, w: 20, h: 20 }, // 1: 밖
    { x: 50, y: 50, w: 40, h: 40 }, // 2: 모서리 걸침 → hit
    { x: 70, y: 5, w: 10, h: 10 }, // 3: 오른쪽 밖
  ];
  assert.deepEqual(objectsInMarquee(marquee, boxes), [0, 2]);
});

test('objectsInMarquee — 걸린 개체 없으면 빈 배열', () => {
  assert.deepEqual(objectsInMarquee({ x: 0, y: 0, w: 5, h: 5 }, [{ x: 100, y: 100, w: 10, h: 10 }]), []);
  assert.deepEqual(objectsInMarquee({ x: 0, y: 0, w: 5, h: 5 }, []), []);
});

test('objectsInMarquee — 비정상(NaN) 박스는 건너뛴다', () => {
  const marquee = { x: 0, y: 0, w: 100, h: 100 };
  const boxes = [
    { x: NaN, y: 10, w: 20, h: 20 }, // 0: 무시
    { x: 10, y: 10, w: 20, h: 20 }, // 1: hit
  ];
  assert.deepEqual(objectsInMarquee(marquee, boxes), [1]);
});
