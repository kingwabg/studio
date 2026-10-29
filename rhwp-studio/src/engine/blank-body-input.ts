import type { WasmBridge } from '../core/wasm-bridge';
import type { DocumentPosition } from '../core/types';

type Node = { type: string; pi?: number; text?: string; bbox: { x: number; y: number; w: number; h: number }; children?: Node[] };
export type BlankBodyPlan = {
  page: number; sec: number; para: number; x: number; y: number; columnX: number;
  kind: 'empty' | 'paragraph' | 'tab';
};

// [캔버스 한컴 포크] 빈 지면 입력도 본문 문단/탭으로 저장한다. 글상자는 만들지 않는다.
export function planBlankBodyInput(wasm: WasmBridge, page: number, x: number, y: number): BlankBodyPlan | null {
  if (page < 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const info = wasm.getPageInfo(page);
  const top = info.marginTop + info.marginHeader;
  const bottom = info.height - info.marginBottom - info.marginFooter;
  const column = (info.columns?.length ? info.columns : [{ x: info.marginLeft, width: info.width - info.marginLeft - info.marginRight }])
    .find(c => x >= c.x && x < c.x + c.width);
  if (!column || y < top || y >= bottom) return null;
  if (wasm.getPageControlLayout(page).controls.some(c => x >= c.x - 3 && x <= c.x + c.w + 3 && y >= c.y - 3 && y <= c.y + c.h + 3)) return null;
  const tree: Node = wasm.getPageRenderTree(page);
  const lines: Node[] = [];
  function collect(node: Node, body = false): void {
    if (node.type === 'Table' || node.type === 'Shape') return;
    body ||= node.type === 'Body';
    if (body && node.type === 'TextLine' && node.pi !== undefined && node.bbox.x >= column!.x - 1 && node.bbox.x < column!.x + column!.width) lines.push(node);
    for (const child of node.children ?? []) collect(child, body);
  }
  collect(tree);
  const sec = info.sectionIndex;
  const base = { page, sec, x, y, columnX: column.x };
  const line = lines.find(l => y >= l.bbox.y - 2 && y < l.bbox.y + l.bbox.h + 2);
  if (line) {
    const para = line.pi!;
    const length = wasm.getLogicalLength(sec, para);
    const end = wasm.getCursorRect(sec, para, length);
    if (length === 0) return Math.abs(x - end.x) > 2 ? { ...base, para, y: end.y, kind: 'empty' } : null;
    if (Math.abs(end.y - line.bbox.y) < 2 && x > end.x + 4) return { ...base, para, y: end.y, kind: 'tab' };
    return null;
  }
  const ends = [...new Set(lines.map(l => l.pi!))].map(para => ({ para, rect: wasm.getCursorRect(sec, para, wasm.getLogicalLength(sec, para)) }))
    .filter(v => v.rect.pageIndex === page && v.rect.y + v.rect.height < y && y + v.rect.height <= bottom)
    .sort((a, b) => b.rect.y - a.rect.y);
  const previous = ends[0];
  if (!previous) return null;
  return { ...base, para: previous.para, kind: 'paragraph' };
}

export function applyBlankBodyInput(wasm: WasmBridge, plan: BlankBodyPlan): DocumentPosition {
  const { sec, x, y, columnX } = plan;
  let para = plan.para;
  let offset = 0;
  const check = (result: string) => {
    const value = JSON.parse(result);
    if (value.ok === false || value.error) throw new Error(value.error ?? '빈 공간 입력 위치 생성 실패');
    return value;
  };
  if (plan.kind === 'tab') {
    offset = wasm.getLogicalLength(sec, para);
    const props = wasm.getParaPropertiesAt(sec, para);
    const position = Math.round((x - columnX) * 75);
    const tabStops = [...(props.tabStops ?? []).filter(t => t.position !== position), { position, type: 0, fill: 0 }].sort((a, b) => a.position - b.position);
    check(wasm.applyParaFormat(sec, para, JSON.stringify({ tabStops })));
    for (let i = 0; i < 128; i++) {
      check(wasm.insertTextLogical(sec, para, offset++, '\t'));
      const rect = wasm.getCursorRect(sec, para, offset);
      if (rect.x >= x - 2 || rect.pageIndex !== plan.page || Math.abs(rect.y - y) > 2) break;
    }
  } else {
    if (plan.kind === 'paragraph') para = check(wasm.splitParagraph(sec, para, wasm.getLogicalLength(sec, para))).paraIdx;
    check(wasm.applyParaFormat(sec, para, JSON.stringify({ alignment: 'left', marginLeft: x - columnX, marginRight: 0, indent: 0, spacingBefore: 0 })));
    const initial = wasm.getCursorRect(sec, para, 0);
    if (initial.pageIndex !== plan.page || initial.y > y + 2) throw new Error('본문 흐름 밖의 입력 위치입니다.');
    // shortcut: 현재 문단 간격 API는 렌더러의 2배 저장값을 받는다. API 단위 통일 시 제거한다.
    if (y > initial.y + 0.5) check(wasm.applyParaFormat(sec, para, JSON.stringify({ spacingBefore: Math.round((y - initial.y) * 2) })));
  }
  const actual = wasm.getCursorRect(sec, para, offset);
  if (actual.pageIndex !== plan.page || Math.abs(actual.x - x) > 2 || Math.abs(actual.y - y) > 2) throw new Error(`빈 공간 입력 좌표 불일치: ${JSON.stringify({ requested: { page: plan.page, x, y }, actual })}`);
  return { sectionIndex: sec, paragraphIndex: para, charOffset: offset };
}
