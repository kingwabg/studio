/** [캔버스 한컴 포크] 실제 WASM + 브리지 JSON 경계. DOM/입력기는 테스트 대역이다. */
import { readFile } from 'node:fs/promises';
import init, { HwpDocument } from '../../../pkg/rhwp.js';
import type { CanvaServices } from '../../src/ui/canva-services';

await init({ module_or_path: await readFile(new URL('../../../pkg/rhwp_bg.wasm', import.meta.url)) });
export { HwpDocument };
const decoded = new Set(['getPageDef','getPageInfo','getTables','getTableCellBboxes','getCellProperties',
  'getTableProperties','getTableBBox','getTableDimensions','getCharPropertiesAt','getCellCharPropertiesAt',
  'getParaPropertiesAt','getCellParaPropertiesAt','getStyleList','getStyleAt','getCellStyleAt','getStyleDetail']);
const jsonLast = new Set(['setPageDef','setTableProperties','setCellProperties']);

export function createRealEditor(bytes?: Uint8Array) {
  const native = bytes ? new HwpDocument(bytes) : HwpDocument.createEmpty();
  if (!bytes) native.createBlankDocument();
  const history: number[] = [];
  const wasm = new Proxy({}, {
    get(_target, key: string) {
      if (key === 'pageCount') return native.pageCount();
      return (...args: any[]) => {
        if (key === 'createTableEx') {
          const result = JSON.parse(native.createTableEx(JSON.stringify(args[0])));
          if (result.ok) native.setTableProperties(args[0].sectionIdx, result.paraIdx, result.controlIdx, JSON.stringify({ restrictInPage: true }));
          return result;
        }
        if (jsonLast.has(key)) args[args.length - 1] = JSON.stringify(args.at(-1));
        const result = (native as any)[key](...args);
        return decoded.has(key) || jsonLast.has(key) ? JSON.parse(result) : result;
      };
    },
  });
  const ih = {
    getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
    executeOperation(op: { operation: (w: unknown) => unknown }) {
      const before = native.saveSnapshot();
      try { const result = op.operation(wasm); history.push(before); return result; }
      catch (e) { native.restoreSnapshot(before); native.discardSnapshot(before); throw e; }
    },
  };
  const services = { wasm, getInputHandler: () => ih } as unknown as CanvaServices;
  return {
    native, services, history,
    undo() { const id = history.pop(); if (id !== undefined) { native.restoreSnapshot(id); native.discardSnapshot(id); } },
    close() { native.free(); },
  };
}
