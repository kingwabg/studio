import { VirtualScroll } from '@/view/virtual-scroll';
import type { CellBbox, TableGrid } from '@/core/types';

/** 경계선 종류 */
export type BorderEdgeType = 'row' | 'col';

/** 감지된 경계선 정보 */
export interface BorderEdge {
  type: BorderEdgeType;
  /** 경계선 인덱스 (행: 0=첫 행 상단, 열: 0=첫 열 좌측) */
  index: number;
  pageIndex: number;
}

interface RowLine { y: number; xStart: number; xEnd: number; index: number }
interface ColLine { x: number; yStart: number; yEnd: number; index: number }

/** 표 셀 경계선 위 hover 시 마커(하이라이트 라인)를 표시한다 */
export class TableResizeRenderer {
  private layer: HTMLDivElement;
  private marker: HTMLDivElement | null = null;
  private static readonly MARKER_COLOR = 'rgba(0, 120, 215, 0.5)';
  private static readonly MARKER_THICKNESS = 3;
  /** 바깥 테두리 호버 힌트 — 잡아서 크기 조절할 수 있는 구간 */
  private static readonly GRAB_COLOR = 'rgba(0, 110, 210, 0.95)';
  /** 바깥 테두리 호버 힌트 — 표를 통째로 잡는 가운데 구간 */
  private static readonly HOLD_COLOR = 'rgba(120, 132, 145, 0.55)';
  /** 힌트 두께 — 표 테두리와 비슷하게(사용자 지시 2026-08-17) */
  private static readonly HINT_THICKNESS = 2;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'table-resize-layer';
    this.layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    const scrollContent = container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.layer);
    }
  }

  /** 셀 bbox 배열에서 행/열 경계선 좌표를 계산한다 (페이지 좌표 기준).
   * [12-b] grid 가 있으면 선 소유권은 엔진 정본 — 관통 칸이 있는 선(crossers>0)은 소유 칸 구간만 뻗는다. */
  computeBorderLines(bboxes: CellBbox[], grid?: TableGrid | null): { rowLines: RowLine[]; colLines: ColLine[] } {
    if (bboxes.length === 0) return { rowLines: [], colLines: [] };

    // 표 전체 범위
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of bboxes) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.h);
    }

    // 행 경계선 (수평): 셀 상단/하단 y 좌표 수집
    const rowYSet = new Map<number, number>(); // y(rounded) → index
    // 열 경계선 (수직): 셀 좌측/우측 x 좌표 수집
    const colXSet = new Map<number, number>(); // x(rounded) → index

    // 표 상단/하단, 좌측/우측 추가
    const ry = (v: number) => Math.round(v * 10) / 10; // 소수점 1자리 반올림

    // 모든 셀의 상/하단, 좌/우측 좌표 수집
    const rowYs = new Set<number>();
    const colXs = new Set<number>();
    for (const b of bboxes) {
      rowYs.add(ry(b.y));
      rowYs.add(ry(b.y + b.h));
      colXs.add(ry(b.x));
      colXs.add(ry(b.x + b.w));
    }

    // 정렬하여 인덱스 부여.
    // [근사 중복 병합 2026-08-13] 같은 논리 경계가 셀 bbox 부동소수 오차(x+w vs 이웃 x,
    // ~0.03px)로 0.1px 반올림을 넘어 두 항목(예: 340.6/340.7)이 되면 — 어긋난 표에서 실측 —
    // 선 인덱스가 한 칸 밀려 리사이즈 클램프 창이 뒤집힌다(min>orig → 왼쪽으로 끌어도
    // 오른쪽으로 점프, 2026-08-13 신고 ①). 0.5px 미만 간격은 한 선으로 흡수한다(실제
    // 인접 경계 최소 간격은 최소 셀 폭 ≫ 0.5px 라 안전).
    const mergeNear = (vals: number[]): number[] => {
      const out: number[] = [];
      for (const v of vals) {
        if (out.length > 0 && Math.abs(v - out[out.length - 1]) < 0.5) {
          out[out.length - 1] = (out[out.length - 1] + v) / 2;
        } else {
          out.push(v);
        }
      }
      return out;
    };
    const sortedRowYs = mergeNear([...rowYs].sort((a, b) => a - b));
    const sortedColXs = mergeNear([...colXs].sort((a, b) => a - b));

    const rowLines: RowLine[] = sortedRowYs.map((y, i) => ({
      y, xStart: minX, xEnd: maxX, index: i,
    }));

    const colLines: ColLine[] = sortedColXs.map((x, i) => ({
      x, yStart: minY, yEnd: maxY, index: i,
    }));

    if (grid) {
      // px 위치·index 는 bbox 군집 그대로(같은 논리선이 행마다 다른 x 에 있을 수 있어 px 가 식별자),
      // 관통 여부만 엔진 선(bbox 변 → 논리 인덱스)에서 읽어 마커가 관통 칸 위를 지나지 않게 한다.
      // ponytail: 소유 구간 hull — 비연속 소유(사이 행이 관통)면 그 칸도 덮는다. 세그 배열 마커가 필요해지면 분할.
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      for (const line of colLines) {
        const owners = bboxes.filter(b => near(b.x, line.x) || near(b.x + b.w, line.x));
        if (owners.length === 0) continue;
        const k = near(owners[0].x, line.x) ? owners[0].col : owners[0].col + owners[0].colSpan;
        if (!(grid.colLines[k]?.crossers > 0)) continue;
        line.yStart = Math.min(...owners.map(b => b.y));
        line.yEnd = Math.max(...owners.map(b => b.y + b.h));
      }
      for (const line of rowLines) {
        const owners = bboxes.filter(b => near(b.y, line.y) || near(b.y + b.h, line.y));
        if (owners.length === 0) continue;
        const k = near(owners[0].y, line.y) ? owners[0].row : owners[0].row + owners[0].rowSpan;
        if (!(grid.rowLines[k]?.crossers > 0)) continue;
        line.xStart = Math.min(...owners.map(b => b.x));
        line.xEnd = Math.max(...owners.map(b => b.x + b.w));
      }
    }

    return { rowLines, colLines };
  }

  /** 마우스 좌표가 경계선 위인지 판별한다 (페이지 좌표 기준) */
  hitTestBorder(
    pageX: number, pageY: number,
    bboxes: CellBbox[],
    tolerance = 4,
  ): BorderEdge | null {
    if (bboxes.length === 0) return null;

    const { rowLines, colLines } = this.computeBorderLines(bboxes);
    const pageIndex = bboxes[0].pageIndex;
    const rounded = (v: number) => Math.round(v * 10) / 10;
    const rowIndexByY = new Map(rowLines.map(line => [rounded(line.y), line.index]));
    const colIndexByX = new Map(colLines.map(line => [rounded(line.x), line.index]));

    const candidates: Array<{ edge: BorderEdge; distance: number; priority: number }> = [];

    // 행 경계선 검사 (수평선): 실제 셀 segment 위에서만 잡는다.
    for (const b of bboxes) {
      if (pageX < b.x - tolerance || pageX > b.x + b.w + tolerance) continue;

      const topIndex = rowIndexByY.get(rounded(b.y));
      if (topIndex !== undefined && Math.abs(pageY - b.y) <= tolerance) {
        candidates.push({
          edge: { type: 'row', index: topIndex, pageIndex },
          distance: Math.abs(pageY - b.y),
          priority: 1,
        });
      }

      const bottomY = b.y + b.h;
      const bottomIndex = rowIndexByY.get(rounded(bottomY));
      if (bottomIndex !== undefined && Math.abs(pageY - bottomY) <= tolerance) {
        candidates.push({
          edge: { type: 'row', index: bottomIndex, pageIndex },
          distance: Math.abs(pageY - bottomY),
          priority: 1,
        });
      }
    }

    // 열 경계선 검사 (수직선): 실제 셀 segment 위에서만 잡는다.
    for (const b of bboxes) {
      if (pageY < b.y - tolerance || pageY > b.y + b.h + tolerance) continue;

      const leftIndex = colIndexByX.get(rounded(b.x));
      if (leftIndex !== undefined && Math.abs(pageX - b.x) <= tolerance) {
        candidates.push({
          edge: { type: 'col', index: leftIndex, pageIndex },
          distance: Math.abs(pageX - b.x),
          priority: 0,
        });
      }

      const rightX = b.x + b.w;
      const rightIndex = colIndexByX.get(rounded(rightX));
      if (rightIndex !== undefined && Math.abs(pageX - rightX) <= tolerance) {
        candidates.push({
          edge: { type: 'col', index: rightIndex, pageIndex },
          distance: Math.abs(pageX - rightX),
          priority: 0,
        });
      }
    }

    if (candidates.length === 0) return null;
    // [2026-08-17 사용자 규칙 변경] 아래·오른쪽 바깥 테두리도 크기 조절을 연다 —
    // 단 **칸마다 가운데 구간은 표를 잡는 자리**로 남긴다(거기서 누르면 종전대로
    // 표 개체 선택). 위·왼쪽 테두리는 계속 제외한다: 그 선을 끝변으로 갖는 칸이
    // 없어 옮길 대상이 없고, 표 위치까지 움직이는 별개 조작이 된다.
    const usable = candidates.filter((c) => {
      const last = c.edge.type === 'row' ? rowLines.length - 1 : colLines.length - 1;
      if (c.edge.index <= 0) return false;
      if (c.edge.index < last) return true;
      return !this.isOuterGrabZone(pageX, pageY, bboxes, c.edge);
    });
    if (usable.length === 0) return null;
    usable.sort((a, b) => a.distance - b.distance || a.priority - b.priority);
    return usable[0].edge;
  }

  /**
   * [2026-08-17] 마우스가 **바깥 테두리 근처**인지와, 거기서 잡을 수 있는 구간이
   * 어디인지 알려준다 — 호버 힌트용. 가운데(표 잡기)에 있어도 정보를 돌려주므로
   * "어디를 잡아야 크기가 바뀌는지"를 그려줄 수 있다.
   */
  outerHoverInfo(
    pageX: number, pageY: number, bboxes: CellBbox[], tolerance = 7,
  ): { edge: BorderEdge; horiz: boolean; linePos: number; start: number; len: number; inGrabZone: boolean } | null {
    if (bboxes.length === 0) return null;
    const { rowLines, colLines } = this.computeBorderLines(bboxes);
    const pageIndex = bboxes[0].pageIndex;
    for (const horiz of [true, false]) {
      const lines = horiz ? rowLines : colLines;
      if (lines.length < 2) continue;
      const last = lines[lines.length - 1];
      const linePos = horiz ? (last as RowLine).y : (last as ColLine).x;
      const across = horiz ? pageY : pageX;
      if (Math.abs(across - linePos) > tolerance) continue;
      const along = horiz ? pageX : pageY;
      for (const b of bboxes) {
        const end = horiz ? b.y + b.h : b.x + b.w;
        if (Math.abs(end - linePos) > 1.0) continue;
        const start = horiz ? b.x : b.y;
        const len = horiz ? b.w : b.h;
        if (along < start || along > start + len) continue;
        const inGrabZone = Math.abs(along - (start + len / 2)) > (len / 3) / 2;
        return {
          edge: { type: horiz ? 'row' : 'col', index: lines.length - 1, pageIndex },
          horiz, linePos, start, len, inGrabZone,
        };
      }
    }
    return null;
  }

  /**
   * 바깥 테두리 호버 힌트 — 양 끝 1/3(크기 조절 가능)은 진한 파랑,
   * 가운데 1/3(표 잡기)은 옅은 회색으로 그려 어디를 잡아야 하는지 보이게 한다.
   */
  showOuterHint(
    info: { edge: BorderEdge; horiz: boolean; linePos: number; start: number; len: number },
    zoom: number,
  ): void {
    this.clear();
    this.ensureAttached();
    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const pageOffset = this.virtualScroll.getPageOffset(info.edge.pageIndex);
    const pageLeft = this.virtualScroll.getPageLeftResolved(info.edge.pageIndex, contentWidth);
    const third = info.len / 3;
    const bar = (from: number, size: number, color: string, thick: number) => {
      const el = document.createElement('div');
      if (info.horiz) {
        el.style.cssText = `position:absolute;left:${pageLeft + from * zoom}px;`
          + `top:${pageOffset + info.linePos * zoom - thick / 2}px;`
          + `width:${size * zoom}px;height:${thick}px;background:${color};`
          + `border-radius:${thick / 2}px;pointer-events:none;`;
      } else {
        el.style.cssText = `position:absolute;left:${pageLeft + info.linePos * zoom - thick / 2}px;`
          + `top:${pageOffset + from * zoom}px;`
          + `width:${thick}px;height:${size * zoom}px;background:${color};`
          + `border-radius:${thick / 2}px;pointer-events:none;`;
      }
      this.layer.appendChild(el);
      return el;
    };
    // 표 선과 비슷한 굵기로 얹는다(2026-08-17 사용자 지시) — 굵은 막대는 테두리를
    // 덮어 표가 두꺼워 보였다. 색만으로 구간을 구분한다.
    const t = TableResizeRenderer.HINT_THICKNESS;
    bar(info.start, third, TableResizeRenderer.GRAB_COLOR, t);
    bar(info.start + third, third, TableResizeRenderer.HOLD_COLOR, t);
    bar(info.start + third * 2, third, TableResizeRenderer.GRAB_COLOR, t);
    this.marker = this.layer.lastElementChild as HTMLDivElement;
  }

  /**
   * 바깥 테두리에서 "표를 잡는" 가운데 구간인가 — 칸 구간의 가운데 1/3.
   * 이 구간은 리사이즈 그랩에서 빼서 표 개체 선택이 되게 한다(사용자 규칙 2026-08-17).
   */
  private isOuterGrabZone(
    pageX: number, pageY: number, bboxes: CellBbox[], edge: BorderEdge,
  ): boolean {
    const { rowLines, colLines } = this.computeBorderLines(bboxes);
    const horiz = edge.type === 'row';
    const line = (horiz ? rowLines : colLines).find(l => l.index === edge.index);
    if (!line) return false;
    const linePos = horiz ? (line as RowLine).y : (line as ColLine).x;
    const along = horiz ? pageX : pageY;
    // 가운데 1/3 이 표 잡기, 양 끝 1/3 씩이 크기 조절. **비율만** 쓴다 — 최소 픽셀을
    // 두면 얇은 칸(예: 11px 행)에서 그 최소값이 칸 전체를 덮어 크기 조절이 아예
    // 불가능해진다(배포 실측: 오른쪽 테두리 559→560.5px 무동작).
    const CENTER_RATIO = 1 / 3;
    for (const b of bboxes) {
      const end = horiz ? b.y + b.h : b.x + b.w;
      if (Math.abs(end - linePos) > 1.0) continue; // 이 선에 맞닿은 칸만
      const start = horiz ? b.x : b.y;
      const len = horiz ? b.w : b.h;
      if (along < start || along > start + len) continue; // 이 칸 구간 밖
      return Math.abs(along - (start + len / 2)) <= (len * CENTER_RATIO) / 2;
    }
    return false;
  }

  /** 경계선 위에 마커(하이라이트 라인)를 표시한다 */
  showMarker(
    edge: BorderEdge,
    bboxes: CellBbox[],
    zoom: number,
    grid?: TableGrid | null,
  ): void {
    this.clear();
    this.ensureAttached();
    if (bboxes.length === 0) return;

    const { rowLines, colLines } = this.computeBorderLines(bboxes, grid);
    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const pageOffset = this.virtualScroll.getPageOffset(edge.pageIndex);
    // [H4 2026-07-28] 중앙 정렬 정본 = getPageLeftResolved — 단일컬럼 공식 사본은
    // 그리드 모드(zoom≤0.5 다열)에서 마커·핸들이 엉뚱한 열 위치에 그려졌다.
    const pageLeft = this.virtualScroll.getPageLeftResolved(edge.pageIndex, contentWidth);

    const t = TableResizeRenderer.MARKER_THICKNESS;
    const el = document.createElement('div');

    if (edge.type === 'row') {
      const line = rowLines.find(l => l.index === edge.index);
      if (!line) return;
      const left = pageLeft + line.xStart * zoom;
      const top = pageOffset + line.y * zoom - t / 2;
      const width = (line.xEnd - line.xStart) * zoom;
      el.style.cssText =
        `position:absolute;` +
        `left:${left}px;top:${top}px;` +
        `width:${width}px;height:${t}px;` +
        `background:${TableResizeRenderer.MARKER_COLOR};pointer-events:none;`;
    } else {
      const line = colLines.find(l => l.index === edge.index);
      if (!line) return;
      const left = pageLeft + line.x * zoom - t / 2;
      const top = pageOffset + line.yStart * zoom;
      const height = (line.yEnd - line.yStart) * zoom;
      el.style.cssText =
        `position:absolute;` +
        `left:${left}px;top:${top}px;` +
        `width:${t}px;height:${height}px;` +
        `background:${TableResizeRenderer.MARKER_COLOR};pointer-events:none;`;
    }

    this.layer.appendChild(el);
    this.marker = el;
  }

  /** 드래그 중 마커를 지정된 위치에 표시한다 (원래 경계선이 아닌 마우스 위치) */
  showDragMarker(
    type: BorderEdgeType,
    position: number, // row: pageY, col: pageX
    pageIndex: number,
    bboxes: CellBbox[],
    zoom: number,
    markerBboxes?: CellBbox[],
  ): void {
    this.clear();
    this.ensureAttached();
    if (bboxes.length === 0) return;
    const markerRange = markerBboxes && markerBboxes.length > 0 ? markerBboxes : bboxes;

    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const pageOffset = this.virtualScroll.getPageOffset(pageIndex);
    // [H4 2026-07-28] 중앙 정렬 정본 = getPageLeftResolved — 단일컬럼 공식 사본은
    // 그리드 모드(zoom≤0.5 다열)에서 마커·핸들이 엉뚱한 열 위치에 그려졌다.
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIndex, contentWidth);

    const t = TableResizeRenderer.MARKER_THICKNESS;
    const el = document.createElement('div');

    if (type === 'row') {
      const minX = Math.min(...markerRange.map(b => b.x));
      const maxX = Math.max(...markerRange.map(b => b.x + b.w));
      const left = pageLeft + minX * zoom;
      const top = pageOffset + position * zoom - t / 2;
      const width = (maxX - minX) * zoom;
      el.style.cssText =
        `position:absolute;left:${left}px;top:${top}px;` +
        `width:${width}px;height:${t}px;` +
        `background:${TableResizeRenderer.MARKER_COLOR};pointer-events:none;`;
    } else {
      const minY = Math.min(...markerRange.map(b => b.y));
      const maxY = Math.max(...markerRange.map(b => b.y + b.h));
      const left = pageLeft + position * zoom - t / 2;
      const top = pageOffset + minY * zoom;
      const height = (maxY - minY) * zoom;
      el.style.cssText =
        `position:absolute;left:${left}px;top:${top}px;` +
        `width:${t}px;height:${height}px;` +
        `background:${TableResizeRenderer.MARKER_COLOR};pointer-events:none;`;
    }

    this.layer.appendChild(el);
    this.marker = el;
  }

  /** 마커를 제거한다 */
  clear(): void {
    // 호버 힌트는 요소가 여러 개(양 끝 + 가운데)라 레이어를 통째로 비운다.
    while (this.layer.firstChild) this.layer.removeChild(this.layer.firstChild);
    this.marker = null;
  }

  /** 레이어가 DOM에 없으면 재부착한다 */
  private ensureAttached(): void {
    if (this.layer.parentElement) return;
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.layer);
    }
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }
}
