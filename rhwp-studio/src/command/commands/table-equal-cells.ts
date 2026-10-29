import type { CellBbox } from '@/core/types';
import type { WasmBridge } from '@/core/wasm-bridge';

type Axis = 'width' | 'height';

/** Move shared boundaries instead of changing independent cell sizes on a staggered grid. */
export function equalizeCellBoundaries(
  wasm: Pick<WasmBridge, 'getTableCellBboxes' | 'offsetCellBoundary'>,
  sec: number, ppi: number, ci: number, selected: CellBbox[], axis: Axis,
): void {
  const horizontal = axis === 'width';
  const start = (b: CellBbox) => horizontal ? b.x : b.y;
  const length = (b: CellBbox) => horizontal ? b.w : b.h;
  const bandStart = (b: CellBbox) => horizontal ? b.y : b.x;
  const bandSize = (b: CellBbox) => horizontal ? b.h : b.w;
  const groups: CellBbox[][] = [];
  for (const box of selected) {
    const group = groups.find(g => g[0].pageIndex === box.pageIndex &&
      Math.abs(bandStart(g[0]) - bandStart(box)) < 0.5 && Math.abs(bandSize(g[0]) - bandSize(box)) < 0.5);
    if (group) group.push(box); else groups.push([box]);
  }
  for (const group of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => start(a) - start(b));
    const left = start(group[0]), right = start(group[group.length - 1]) + length(group[group.length - 1]);
    for (let i = 1; i < group.length; i++) {
      if (Math.abs(start(group[i]) - start(group[i - 1]) - length(group[i - 1])) > 1) {
        throw new Error('연속된 셀만 크기를 같게 할 수 있습니다');
      }
    }
    const find = () => wasm.getTableCellBboxes(sec, ppi, ci).filter(b =>
      b.pageIndex === group[0].pageIndex && Math.abs(bandStart(b) - bandStart(group[0])) < 0.5 &&
      Math.abs(bandSize(b) - bandSize(group[0])) < 0.5 && start(b) >= left - 0.5 &&
      start(b) + length(b) <= right + 0.5).sort((a, b) => start(a) - start(b));
    for (let i = 0; i < group.length - 1; i++) {
      const current = find();
      if (current.length !== group.length) throw new Error('셀 경계가 변경되어 크기 조정을 취소했습니다');
      const delta = Math.round((left + (right - left) * (i + 1) / group.length - start(current[i]) - length(current[i])) * 75);
      if (Math.abs(delta) > 10) wasm.offsetCellBoundary(sec, ppi, ci, current[i].cellIdx, horizontal ? 'right' : 'bottom', delta);
    }
    const result = find();
    if (result.length !== group.length || result.some(b => Math.abs(length(b) - (right - left) / group.length) > 0.6)) {
      throw new Error('셀 크기를 균등하게 조정할 수 없어 변경을 취소했습니다');
    }
  }
}
