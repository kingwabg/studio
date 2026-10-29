import type { PageInfo } from '@/core/types';
import { HWPUNIT_PER_MM } from '../../core/hwp-constants.ts';

/** 새 표의 바깥 여백(좌우 각 1mm)까지 현재 단 안에 둔다. */
export function defaultTableWidth(page: PageInfo, cursorX: number): number {
  const columns = page.columns ?? [];
  const column = columns.find(c => cursorX >= c.x && cursorX < c.x + c.width) ?? columns[0];
  const widthPx = column?.width ?? page.width - page.marginLeft - page.marginRight;
  return Math.round(widthPx * 75) - 2 * Math.round(HWPUNIT_PER_MM);
}

export function splitTableWidth(width: number, columns: number): number[] {
  if (!Number.isFinite(width) || width < columns * 200) throw new Error('현재 영역에 표의 칸을 넣을 공간이 부족합니다');
  const base = Math.floor(width / columns), remainder = width - base * columns;
  return Array.from({ length: columns }, (_, i) => base + (i < remainder ? 1 : 0));
}
