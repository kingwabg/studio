import test from 'node:test';
import assert from 'node:assert/strict';

import { computeObjectAlignment, type AlignBox } from '../src/engine/object-align.ts';

// 두 개체: A(0,0,100×100), B(200,300,40×60)
const A: AlignBox = { horzOffset: 0, vertOffset: 0, width: 100, height: 100 };
const B: AlignBox = { horzOffset: 200, vertOffset: 300, width: 40, height: 60 };

test('left 정렬 — 모든 개체의 왼쪽 모서리를 그룹 최소 left(0)로 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'left');
  assert.equal(r[0], null);              // A는 이미 left=0 → 무변경
  assert.equal(r[1]?.horzOffset, 0);     // B: 200 → 0
  assert.equal(r[1]?.vertOffset, 300);   // 세로는 불변
});

test('right 정렬 — 모든 개체의 오른쪽 모서리를 그룹 최대 right(240)로 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'right'); // gRight = 200+40 = 240
  assert.equal(r[0]?.horzOffset, 140);   // A: 240-100
  assert.equal(r[1], null);              // B는 이미 right=240 → 무변경
});

test('hcenter 정렬 — 모든 개체의 가로 중심을 그룹 중심(120)에 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'hcenter'); // gHCenter = (0+240)/2 = 120
  assert.equal(r[0]?.horzOffset, 70);    // 120 - 100/2
  assert.equal(r[1]?.horzOffset, 100);   // 120 - 40/2
  // 중심이 실제로 일치하는지 재검산
  assert.equal(70 + 100 / 2, 120);
  assert.equal(100 + 40 / 2, 120);
});

test('top 정렬 — 위쪽 모서리를 그룹 최소 top(0)으로 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'top');
  assert.equal(r[0], null);
  assert.equal(r[1]?.vertOffset, 0);     // B: 300 → 0
  assert.equal(r[1]?.horzOffset, 200);   // 가로 불변
});

test('bottom 정렬 — 아래쪽 모서리를 그룹 최대 bottom(360)으로 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'bottom'); // gBottom = 300+60 = 360
  assert.equal(r[0]?.vertOffset, 260);   // A: 360-100
  assert.equal(r[1], null);
});

test('vcenter 정렬 — 세로 중심을 그룹 중심(180)에 맞춘다', () => {
  const r = computeObjectAlignment([A, B], 'vcenter'); // (0+360)/2 = 180
  assert.equal(r[0]?.vertOffset, 130);   // 180 - 100/2
  assert.equal(r[1]?.vertOffset, 150);   // 180 - 60/2
});

test('hdistribute — 양 끝 고정, 사이 간격 균등(가운데 개체만 이동)', () => {
  // A(0,w10) · B(30,w10) · C(100,w10) → span 0..110, sum 30, gap (110-30)/2 = 40
  const boxes: AlignBox[] = [
    { horzOffset: 0, vertOffset: 5, width: 10, height: 10 },
    { horzOffset: 30, vertOffset: 5, width: 10, height: 10 },
    { horzOffset: 100, vertOffset: 5, width: 10, height: 10 },
  ];
  const r = computeObjectAlignment(boxes, 'hdistribute');
  assert.equal(r[0], null);              // 첫 개체 = 앵커
  assert.equal(r[1]?.horzOffset, 50);    // 0 + 10 + 40 = 50 (30에서 이동)
  assert.equal(r[1]?.vertOffset, 5);     // 세로 불변
  assert.equal(r[2], null);              // 마지막 개체 = 앵커
});

test('vdistribute — 입력 순서와 무관하게 원래 인덱스 자리에 결과를 돌려준다', () => {
  // 입력 순서를 섞어도(위→아래가 아님) 정렬 후 결과가 원 인덱스에 매핑되는지
  const boxes: AlignBox[] = [
    { horzOffset: 5, vertOffset: 100, width: 10, height: 10 }, // idx0 = 맨 아래
    { horzOffset: 5, vertOffset: 0, width: 10, height: 10 },   // idx1 = 맨 위
    { horzOffset: 5, vertOffset: 30, width: 10, height: 10 },  // idx2 = 가운데
  ];
  const r = computeObjectAlignment(boxes, 'vdistribute');
  // span 0..110, sum 30, gap 40 → 위(idx1)=0, 가운데(idx2)=50, 아래(idx0)=100
  assert.equal(r[1], null);              // 맨 위 = 앵커(0)
  assert.equal(r[2]?.vertOffset, 50);    // 가운데 30 → 50
  assert.equal(r[0], null);              // 맨 아래 = 앵커(100)
});

test('개체 1개 이하 정렬은 전부 null (정렬할 대상 없음)', () => {
  assert.deepEqual(computeObjectAlignment([A], 'left'), [null]);
  assert.deepEqual(computeObjectAlignment([], 'left'), []);
});

test('분배는 3개 미만이면 전부 null (사이 간격이 없음)', () => {
  assert.deepEqual(computeObjectAlignment([A, B], 'hdistribute'), [null, null]);
});

test('이미 정렬된 그룹은 무변경(null)이라 불필요한 Undo를 만들지 않는다', () => {
  const l1: AlignBox = { horzOffset: 50, vertOffset: 0, width: 20, height: 20 };
  const l2: AlignBox = { horzOffset: 50, vertOffset: 80, width: 20, height: 20 };
  assert.deepEqual(computeObjectAlignment([l1, l2], 'left'), [null, null]);
});

test('비정상(NaN/Infinity) 입력은 전부 null로 흡수 — 문서 무변경', () => {
  const bad: AlignBox = { horzOffset: Number.NaN, vertOffset: 0, width: 10, height: 10 };
  assert.deepEqual(computeObjectAlignment([A, bad], 'left'), [null, null]);
});
