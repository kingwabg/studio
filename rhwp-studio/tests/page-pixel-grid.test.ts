import test from 'node:test';
import assert from 'node:assert/strict';
import { pageScreenOrigin, snapPageOffset } from '../src/view/page-pixel-grid.ts';

test('fractional DPR/zoom/scroll origins land on physical pixels without moving a page over half a pixel', () => {
  for (const dpr of [0.75, 1, 1.25, 2]) {
    for (const zoom of [0.76, 1, 1.06]) {
      for (const origin of [198.10417175, 57.333335876, -113.27]) {
        const offset = 1122.52 * zoom + 10;
        const snapped = snapPageOffset(offset, origin, dpr);
        const physical = (origin + snapped) * dpr;
        assert.ok(Math.abs(physical - Math.round(physical)) < 1e-9);
        assert.ok(Math.abs(snapped - offset) <= 0.5 / dpr + 1e-9);
        assert.equal(snapPageOffset(snapped, origin, dpr), snapped);
      }
    }
  }
});

test('same-origin iframe origins and borders are included, not just the canvas local left', () => {
  const root = { frameElement: null };
  const frame = {
    getBoundingClientRect: () => ({ left: 20.25, top: 48.5 }),
    clientLeft: 1, clientTop: 2,
    ownerDocument: { defaultView: root },
  };
  const element = {
    getBoundingClientRect: () => ({ left: 112.15625, top: -50.25 }),
    ownerDocument: { defaultView: { frameElement: frame } },
  } as unknown as HTMLElement;
  assert.deepEqual(pageScreenOrigin(element), { x: 133.40625, y: 0.25 });
});

test('cross-origin frame access leaves the available local origin usable', () => {
  const element = {
    getBoundingClientRect: () => ({ left: 13.25, top: 27.75 }),
    ownerDocument: { defaultView: { get frameElement() { throw new Error('SecurityError'); } } },
  } as unknown as HTMLElement;
  assert.deepEqual(pageScreenOrigin(element), { x: 13.25, y: 27.75 });
});
