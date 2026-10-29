import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { HwpDocument } from '../../pkg/rhwp.js';
import { equalizeCellBoundaries } from '../src/command/commands/table-equal-cells.ts';

await init({ module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url)) });
for (const axis of ['width', 'height'] as const) {
  test(`어긋난 표 ${axis} 균등화는 전체 크기와 되돌리기를 보존한다`, () => {
    const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
    try {
      const table = JSON.parse(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0,
        rowCount: 3, colCount: 3, treatAsChar: false, colWidths: [14000, 14000, 14000], rowHeights: [3000, 3000, 3000] })));
      const { paraIdx: p, controlIdx: c } = table;
      doc.offsetCellBoundary(0, p, c, 0, axis === 'width' ? 'right' : 'bottom', axis === 'width' ? 900 : 450);
      const boxes = () => JSON.parse(doc.getTableCellBboxes(0, p, c));
      const before = boxes(); const beforeBytes = doc.exportHwp(); const snapshot = doc.saveSnapshot();
      const bridge: any = { getTableCellBboxes: boxes, offsetCellBoundary: (_s: number, _p: number, _c: number, idx: number, edge: string, delta: number) => doc.offsetCellBoundary(0, p, c, idx, edge, delta) };
      equalizeCellBoundaries(bridge, 0, p, c, before, axis);
      const after = boxes(); const size = (b: any) => axis === 'width' ? b.w : b.h;
      assert.ok(Math.max(...after.map(size)) - Math.min(...after.map(size)) < 0.6);
      const extent = (items: any[]) => axis === 'width'
        ? Math.max(...items.map(b => b.x + b.w)) - Math.min(...items.map(b => b.x))
        : Math.max(...items.map(b => b.y + b.h)) - Math.min(...items.map(b => b.y));
      assert.ok(Math.abs(extent(before) - extent(after)) < 0.6);
      doc.restoreSnapshot(snapshot); assert.deepEqual(doc.exportHwp(), beforeBytes);
      console.info('[table-equal-test]', JSON.stringify({ axis, before: before.map(size), after: after.map(size), extentBefore: extent(before), extentAfter: extent(after) }));
      doc.discardSnapshot(snapshot);
    } finally { doc.free(); }
  });
}
