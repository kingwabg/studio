import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { HwpDocument } from '../../pkg/rhwp.js';

await init({ module_or_path: readFileSync(new URL('../../pkg/rhwp_bg.wasm', import.meta.url)) });
for (const wrap of ['TopAndBottom', 'Square']) {
  test(`새 표 아래 클릭은 뒤 본문에 커서를 놓는다: ${wrap}`, () => {
    const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
    try {
      const t = JSON.parse(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 3, colCount: 3, treatAsChar: false })));
      doc.setTableProperties(0, t.paraIdx, t.controlIdx, JSON.stringify({ textWrap: wrap, horzRelTo: 'Column', restrictInPage: true }));
      const box = JSON.parse(doc.getTableBBox(0, t.paraIdx, t.controlIdx));
      const hit = JSON.parse(doc.hitTest(box.pageIndex, box.x + 20, box.y + box.height + 25));
      assert.equal(hit.parentParaIndex, undefined);
      assert.ok(hit.paragraphIndex > t.paraIdx);
      const caret = JSON.parse(doc.getCursorRect(hit.sectionIndex, hit.paragraphIndex, hit.charOffset));
      assert.ok(caret.y >= box.y + box.height - 1);
      doc.insertText(hit.sectionIndex, hit.paragraphIndex, hit.charOffset, '표 아래');
      assert.equal(doc.getTextRange(hit.sectionIndex, hit.paragraphIndex, 0, 100), '표 아래');
      assert.equal(doc.getTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, 100), '');
      console.info('[table-after-caret-test]', JSON.stringify({ wrap, tableBottom: box.y + box.height, caretY: caret.y, paragraph: hit.paragraphIndex }));
    } finally { doc.free(); }
  });
}
