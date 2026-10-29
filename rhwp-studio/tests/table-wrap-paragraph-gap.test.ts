import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { HwpDocument } from '../../pkg/rhwp.js';

await init({ module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url)) });
const hu = (mm: number) => Math.round(mm * 7200 / 25.4);
for (const width of [100, 168]) for (const offset of [40, 65]) for (const lineSpacing of [160, 200]) {
  test(`자리차지↔어울림: 폭${width}mm·이동${offset}mm·줄간격${lineSpacing}%의 본문 간격과 표 좌표 유지`, () => {
    const doc = HwpDocument.createEmpty();
    try {
      doc.createBlankDocument();
      doc.setPageDef(0, JSON.stringify({ width: hu(210), height: hu(297), marginLeft: hu(20), marginRight: hu(20), marginTop: hu(20), marginBottom: hu(20), marginHeader: hu(10), marginFooter: hu(10), marginGutter: 0, landscape: false, binding: 0 }));
      doc.updateStyleShapes(0, JSON.stringify({ fontSize: 1000 }), JSON.stringify({ lineSpacingType: 'Percent', lineSpacing, spacingBefore: 0, spacingAfter: 0 }));
      doc.applyStyle(0, 0, 0, true);
      const t = JSON.parse(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, colWidths: Array(3).fill(hu(width / 3)), rowHeights: Array(3).fill(hu(18)) })));
      doc.setTableProperties(0, t.paraIdx, t.controlIdx, JSON.stringify({ textWrap: 'TopAndBottom', horzRelTo: 'Column', vertRelTo: 'Para', vertOffset: hu(offset), restrictInPage: true }));
      const read = (wrap: string) => {
        const rects = [0, 1].map(p => JSON.parse(doc.getCursorRect(0, p, 0)));
        return { wrap, rects, gap: rects[1].y - rects[0].y, table: JSON.parse(doc.getTableBBox(0, t.paraIdx, t.controlIdx)), paragraphs: doc.getParagraphCount(0), props: [0, 1].map(p => JSON.parse(doc.getParaPropertiesAt(0, p))) };
      };
      const initial = read('TopAndBottom');
      assert(initial.gap >= 13.3 * lineSpacing / 100 - 1, '기준 본문 한 줄 높이 확보');
      const transitions = [initial];
      for (const wrap of ['Square', 'TopAndBottom', 'Square', 'TopAndBottom', 'Square']) {
        doc.setTableProperties(0, t.paraIdx, t.controlIdx, JSON.stringify({ textWrap: wrap }));
        const actual = read(wrap);
        assert(Math.abs(actual.gap - initial.gap) <= 0.2, `문단 간격 ${initial.gap} → ${actual.gap}`);
        assert.deepEqual(actual.table, initial.table, '배치 전환으로 표 위치·크기를 바꾸지 않는다');
        assert.equal(actual.paragraphs, initial.paragraphs);
        assert.deepEqual(actual.props, initial.props, '본문 서식을 바꾸지 않는다');
        transitions.push(actual);
      }
      console.info('[paragraph-gap-transition]', JSON.stringify({ width, offset, lineSpacing, transitions: transitions.map(({ wrap, gap, rects, table }) => ({ wrap, gap: Math.round(gap * 10) / 10, caretY: rects.map(r => r.y), table })) }));
    } finally { doc.free(); }
  });
}
