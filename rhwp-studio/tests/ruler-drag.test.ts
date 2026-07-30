import test from 'node:test';
import assert from 'node:assert/strict';

import { hitTestMarker, computeParaFromDrag } from '../src/view/ruler-drag.ts';

// [자 드래그 2026-07-30] 마커 ↔ 문단 서식 역산. 단위는 px(96dpi) — 실측으로 확정했다
// (marginLeft 0→2000 이면 커서 x 가 165→2139 로 1:1 이동).
const M = { firstX: 200, remainX: 150, rightX: 800, refLeft: 100, refRight: 900, zoom: 1 };

test('hitTestMarker — 반경 안에서 가장 가까운 마커', () => {
  assert.equal(hitTestMarker(200, M), 'first');
  assert.equal(hitTestMarker(152, M), 'remain');
  assert.equal(hitTestMarker(795, M), 'right');
  assert.equal(hitTestMarker(400, M), null, '멀면 잡히지 않는다');
  // 첫줄(200)과 나머지줄(150) 사이 — 가까운 쪽
  assert.equal(hitTestMarker(194, M), 'first');
  assert.equal(hitTestMarker(156, M), 'remain');
});

test('첫 줄 마커를 오른쪽으로 → 들여쓰기', () => {
  // 현재: ml=50, indent=50 (first=100, remain=50)
  const cur = { marginLeft: 50, marginRight: 0, indent: 50 };
  // 화면 x=280 → refLeft 100 기준 180px
  const out = computeParaFromDrag('first', 280, M, cur);
  assert.equal(out.marginLeft, 50, '나머지 줄(=왼쪽 여백)은 그대로');
  assert.equal(out.indent, 130, '첫 줄만 이동 → 들여쓰기 증가');
});

test('첫 줄 마커를 나머지 줄보다 왼쪽으로 → 내어쓰기(음수 indent)', () => {
  const cur = { marginLeft: 100, marginRight: 0, indent: 0 };
  // x=150 → 50px (나머지 줄 100px 보다 왼쪽)
  const out = computeParaFromDrag('first', 150, M, cur);
  assert.equal(out.marginLeft, 50, '왼쪽 여백은 둘 중 작은 값');
  assert.equal(out.indent, -50, '내어쓰기');
});

test('나머지 줄 마커 이동 → 왼쪽 여백 이동(첫 줄 위치 유지)', () => {
  // 현재: ml=50, indent=50 → first=100, remain=50
  const cur = { marginLeft: 50, marginRight: 0, indent: 50 };
  // remain 을 120 으로 → first(100)보다 오른쪽 → ml=100, indent=-20
  const out = computeParaFromDrag('remain', 220, M, cur);
  assert.equal(out.marginLeft, 100);
  assert.equal(out.indent, -20);
});

test('오른쪽 마커 → 오른쪽 여백(우측 기준에서의 거리)', () => {
  const cur = { marginLeft: 0, marginRight: 100, indent: 0 };
  const out = computeParaFromDrag('right', 850, M, cur);
  assert.equal(out.marginRight, 50, 'refRight 900 - 850 = 50');
  assert.equal(out.marginLeft, undefined, '왼쪽 값은 건드리지 않는다');
});

test('zoom 200% — 화면 dx 를 zoom 으로 나눈다', () => {
  const m2 = { ...M, zoom: 2 };
  const cur = { marginLeft: 0, marginRight: 0, indent: 0 };
  // 화면 x=300 → (300-100)/2 = 100px
  const out = computeParaFromDrag('first', 300, m2, cur);
  assert.equal(out.indent, 100);
});

test('본문 기준선 밖으로 끌면 0 으로 클램프(음수 여백 금지)', () => {
  const cur = { marginLeft: 40, marginRight: 0, indent: 0 };
  const out = computeParaFromDrag('remain', 0, M, cur); // refLeft(100)보다 왼쪽
  assert.equal(out.marginLeft, 0);
  const r = computeParaFromDrag('right', 1000, M, cur); // refRight(900)보다 오른쪽
  assert.equal(r.marginRight, 0);
});
