// [캔버스 한컴 포크] 셀 범위(다중 셀) 복사 — F5/드래그 셀 선택 모드에서 Ctrl+C 시 표 구조를
// 그대로 클립보드에 담는다 (G1, docs/parity/table.md — onCopy가 텍스트 앵커만 검사해 죽어있던 경로).
// 그리드 수집(buildCellGrid)만 wasm 의존, 직렬화(gridToTsv/gridToHtml)는 순수 함수라
// 단위 테스트로 정합 검증(object-align.ts와 동일 분리 패턴).
// 내부 클립보드 marker(prepareRhwpInternalClipboardHtml)는 쓰지 않는다 — 일반 HTML 표로
// 내보내면 기존 onPaste의 pasteHtml 분기가 표로 붙여넣어 준다(왕복이 공짜,
// input-handler-keyboard.ts의 onPaste 참조). 다른 표 셀 안으로의 "셀 채움" 붙여넣기
// 의미론은 미확정(한컴 확인 대기)이라 이번 범위 밖.

import type { WasmBridge } from '@/core/wasm-bridge';
import type { CellPathEntry } from '@/core/types';

/** cursor.getCellTableContext()의 반환 형태 (셀 선택 중인 표 좌표). */
export interface CellTableContext {
  sec: number;
  ppi: number;
  ci: number;
  cellPath?: CellPathEntry[];
}

/** cursor.getSelectedCellRange()의 반환 형태 (정렬된 시작/끝 행·열). */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * 그리드의 한 자리.
 * - anchor: 병합 셀의 좌상단 — 실제 텍스트를 담는다.
 * - covered: 다른 anchor의 rowSpan/colSpan에 덮인 자리 — 출력에서 건너뛴다.
 * - excluded: Ctrl+클릭으로 선택에서 뺀 자리 — 빈 셀로 근사(비사각형 선택은 TSV/HTML 모두 미지원).
 */
export type CellGridSlot =
  | { kind: 'anchor'; paragraphs: string[]; rowSpan: number; colSpan: number }
  | { kind: 'covered' }
  | { kind: 'excluded' };

export type CellGrid = CellGridSlot[][];

/** cellPath 기반(중첩 표) 접근인지 판별 — cursor.ts moveToCellByIndex와 동일 규약. */
function usesCellPath(cellPath: CellPathEntry[] | undefined): cellPath is CellPathEntry[] {
  return (cellPath?.length ?? 0) > 0;
}

/** cellPath의 마지막 segment만 target 셀/문단 인덱스로 바꿔치기한다 (다른 셀 주소 지정). */
function pathFor(cellPath: CellPathEntry[], targetCellIdx: number, targetCellParaIdx: number): CellPathEntry[] {
  return cellPath.map((seg, i) =>
    i < cellPath.length - 1 ? seg : { ...seg, cellIndex: targetCellIdx, cellParaIndex: targetCellParaIdx },
  );
}

/** 셀 하나의 문단 텍스트 배열을 읽는다 (일반 표 / 중첩 표(cellPath) 양쪽 대응). */
function readCellParagraphs(
  wasm: WasmBridge, sec: number, ppi: number, ci: number,
  cellPath: CellPathEntry[] | undefined, cellIdx: number,
): string[] {
  if (usesCellPath(cellPath)) {
    const countPath = JSON.stringify(pathFor(cellPath, cellIdx, 0));
    const count = wasm.getCellParagraphCountByPath(sec, ppi, countPath);
    const out: string[] = [];
    for (let p = 0; p < count; p++) {
      const pathJson = JSON.stringify(pathFor(cellPath, cellIdx, p));
      const len = wasm.getCellParagraphLengthByPath(sec, ppi, pathJson);
      out.push(wasm.getTextInCellByPath(sec, ppi, pathJson, 0, len));
    }
    return out;
  }
  const count = wasm.getCellParagraphCount(sec, ppi, ci, cellIdx);
  const out: string[] = [];
  for (let p = 0; p < count; p++) {
    const len = wasm.getCellParagraphLength(sec, ppi, ci, cellIdx, p);
    out.push(wasm.getTextInCell(sec, ppi, ci, cellIdx, p, 0, len));
  }
  return out;
}

/**
 * 선택된 셀 범위를 텍스트 그리드로 수집한다.
 * 병합 셀은 좌상단(anchor)에만 텍스트를 담고 나머지 자리는 covered로 표시해 rowSpan/colSpan을
 * 보존한다. 범위 경계에서 병합이 잘리면(부분 선택) span을 그리드 크기 안으로 클램프한다.
 */
export function buildCellGrid(
  wasm: WasmBridge, ctx: CellTableContext, range: CellRange, excluded?: Set<string>,
): CellGrid {
  const { sec, ppi, ci, cellPath } = ctx;
  const bboxes = usesCellPath(cellPath)
    ? wasm.getTableCellBboxesByPath(sec, ppi, JSON.stringify(cellPath))
    : wasm.getTableCellBboxes(sec, ppi, ci);

  const grid: CellGrid = [];
  for (let r = range.startRow; r <= range.endRow; r++) {
    const gridRow: CellGridSlot[] = [];
    for (let c = range.startCol; c <= range.endCol; c++) {
      if (excluded?.has(`${r},${c}`)) {
        gridRow.push({ kind: 'excluded' });
        continue;
      }
      const bbox = bboxes.find(b => r >= b.row && r < b.row + b.rowSpan && c >= b.col && c < b.col + b.colSpan);
      if (!bbox || bbox.row !== r || bbox.col !== c) {
        // bbox 없음(표 경계 밖) 또는 병합 앵커가 아닌 연장 자리 → 건너뜀
        gridRow.push({ kind: 'covered' });
        continue;
      }
      const paragraphs = readCellParagraphs(wasm, sec, ppi, ci, cellPath, bbox.cellIdx);
      gridRow.push({
        kind: 'anchor',
        paragraphs,
        rowSpan: Math.min(bbox.rowSpan, range.endRow - r + 1),
        colSpan: Math.min(bbox.colSpan, range.endCol - c + 1),
      });
    }
    grid.push(gridRow);
  }
  return grid;
}

/**
 * text/plain용 TSV — 셀은 \t, 행은 \n으로 구분.
 * covered/excluded 자리는 빈 칸으로 채워 열 정렬을 유지한다(TSV는 병합을 표현 못 하는 한계).
 * 셀 내부 줄바꿈(여러 문단)은 TSV 행 구분과 충돌하므로 공백으로 치환한다.
 */
export function gridToTsv(grid: CellGrid): string {
  return grid
    .map(row => row.map(slot => (slot.kind === 'anchor' ? slot.paragraphs.join(' ') : '')).join('\t'))
    .join('\n');
}

function escapeHtml(text: string): string {
  // input-handler-keyboard.ts의 escapeClipboardHtmlText와 동일 로직(의도적 중복) —
  // 이 모듈은 순수(wasm 무관)라 wasm 의존 파일을 import해 순환 참조를 만들지 않기 위해 분리.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * text/html용 — <table><tr><td rowspan colspan>. covered 자리는 표준 표 구조상 완전히 건너뛰고,
 * excluded 자리는 빈 <td>로 출력한다. 셀 문단은 <p>로 감싸 붙여넣기(pasteHtml) 시 줄바꿈이 복원되게 한다.
 */
export function gridToHtml(grid: CellGrid): string {
  const rows = grid
    .map(row => {
      const cells = row
        .map(slot => {
          if (slot.kind === 'covered') return '';
          if (slot.kind === 'excluded') return '<td></td>';
          const attrs =
            (slot.rowSpan > 1 ? ` rowspan="${slot.rowSpan}"` : '') +
            (slot.colSpan > 1 ? ` colspan="${slot.colSpan}"` : '');
          const body = slot.paragraphs.length > 0
            ? slot.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')
            : '<p></p>';
          return `<td${attrs}>${body}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table>${rows}</table>`;
}
