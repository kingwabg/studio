import type { PageMoveRange } from './wasm-bridge';

// [캔버스 한컴 포크] 이어진 문단·표를 페이지 선택으로 잘라내지 않는다.
export function normalizePageSelection(pages: readonly number[], ranges: readonly PageMoveRange[]): number[] {
  const result = new Set<number>();
  for (const page of pages) {
    const range = Number.isInteger(page) && ranges.find(r => page >= r.startPage && page <= r.endPage);
    if (!range) throw new Error('선택한 쪽의 연결 범위를 확인할 수 없습니다.');
    for (let p = range.startPage; p <= range.endPage; p++) result.add(p);
  }
  return [...result].sort((a, b) => a - b);
}
