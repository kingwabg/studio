// table-king-Custom(github.com/kingwabg/table-king-Custom) App.jsx의 문서 블록 이식본.
// 엔진 로직(경계선·병합·나누기·클립보드·실행취소)은 원본 그대로 유지하고,
// 문서 편집기 통합을 위해 딱 세 가지만 바꿨다:
//  1. 진실은 문서 모델(doc) — 초기값은 value로 시드하고 모든 변경을 onChange로 올린다 (H4).
//     외부 교체(AI 적용·표 전체 리사이즈 등)는 값 시그니처가 달라질 때 내부 상태와 동기화한다.
//  2. 한 문서에 표가 여러 개 공존하므로 전역 키보드 리스너는 active(선택된 표)일 때만 붙인다.
//  3. localStorage 저장/불러오기 제거 — 문서 저장이 표 저장을 대체한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableCanvas } from "./components/TableCanvas";
import { PrimaryToolbar, StyleToolbar } from "./components/Toolbars";
import { CELL_FONT_SIZE, CELL_LINE_HEIGHT, EPS, HANDLE, HISTORY_LIMIT, MIN_COL_W, MIN_ROW_H, STEP } from "./table/constants";
import {
  cellHeight as getCellHeight,
  cellStartX as getCellStartX,
  cellStartY as getCellStartY,
  cellWidth as getCellWidth,
  collectXBoundaries,
  collectYBoundaries,
  findNearestBoundaryIndex,
  sizesFromBoundaries,
} from "./table/boundaryGrid";
import { parseClipboardTable } from "./table/clipboard";
import {
  expandRectForMerges,
  makeKey,
  mergeToRect,
  rectFromSelection,
  rectsOverlap,
} from "./table/selection";
import {
  cloneCell,
  cloneCellGrid,
  getCellStyle,
  getCellText,
  makeCell,
  normalizeCells,
  patchCellStyle,
  setCellText,
} from "./table/cellData";
import { buildBoundarySegments } from "./table/boundarySegments";
// hover 통선도 실제 드래그와 같은 그룹(위치 기반)으로 켠다 — 표 감사: 인덱스 매칭 hover는
// 어긋난 표에서 지그재그가 되고 mousedown 순간 하이라이트 모양이 급변했다.
import { findColumnBoundaryGroup, findRowBoundaryGroup } from "./table/boundaryResize";
import {
  makeNormalColumnHeights,
  makeNormalInsertedColumnWidth,
  makeNormalInsertedRowHeights,
  makeNormalRowWidths,
} from "./table/normalDimensions";
import { useBoundaryDrag, HANGUL_MIN_ROW_H } from "./hooks/useBoundaryDrag";
import { coveringMerge, mergeAt as findMergeAt } from "./table/merge.js";

// ── 문서 모델 브리지 ─────────────────────────────
// AI/템플릿의 rows(문자열 2D) → table-king 스냅샷.
// 열 너비: 표가 본문 폭(maxWidth)을 넘지 않는 선에서 균등 분배 (기존 makeTableData와 동일한 근거).
export const makeTableKingData = (rows, maxWidth = 620) => {
  const nCols = rows[0].length;
  const w = Math.max(MIN_COL_W + 20, Math.floor(Math.min(maxWidth, 620) / nCols));
  return {
    cells: rows.map((r) => r.map((t) => makeCell(t))),
    widths: rows.map(() => Array(nCols).fill(w)),
    cellHeights: rows.map(() => Array(nCols).fill(HANGUL_MIN_ROW_H)),
    merges: [],
  };
};

// table-king 스냅샷 → AI 컨텍스트용 rows(문자열 2D). 스타일·병합은 텍스트 직렬화에서 제외.
export const tableDataToRows = (data) => data.cells.map((row) => row.map(getCellText));

// 로드 시 행 높이 수리. cellHeights는 열별 2D라 "행 갈라짐"이 두 종류다:
// ① 의도적 어긋남(한컴식 Shift 국소 드래그) — 경계만 어긋나고 열 합은 같다 → 보존.
// ② 손상(과거 병합 경계 드래그 버그) — 열 합 자체가 달라 바닥이 들쭉날쭉 → 행별 최대로 통일.
// 판별 = 열 합 동일성(EPS). 온전한 표는 균일 행에만 한글 한 줄 최소 바닥을 적용하고
// (빈 셀 최소 보장 — 균일 행은 전 열이 같이 올라 열 합 동일성이 유지된다),
// 어긋난 행은 의도 편집이라 건드리지 않는다. 변화 없으면 입력 참조 그대로 반환.
export const repairRowHeights = (cellHeights) => {
  const colCount = Math.max(0, ...cellHeights.map((row) => row.length));
  if (!colCount) return cellHeights;
  const sums = Array.from({ length: colCount }, (_, c) =>
    cellHeights.reduce((acc, row) => acc + (Number.isFinite(row[c]) ? row[c] : MIN_ROW_H), 0)
  );
  const corrupted = sums.some((sum) => Math.abs(sum - sums[0]) > EPS);
  if (corrupted)
    return cellHeights.map((row) => {
      const h = Math.max(HANGUL_MIN_ROW_H, ...row.map((v) => (Number.isFinite(v) ? v : HANGUL_MIN_ROW_H)));
      return row.map(() => h);
    });
  let raised = false;
  const next = cellHeights.map((row) => {
    const uniform = row.every((v) => Math.abs(v - row[0]) <= EPS);
    if (uniform && row.length && row[0] < HANGUL_MIN_ROW_H) {
      raised = true;
      return row.map(() => HANGUL_MIN_ROW_H);
    }
    return row;
  });
  return raised ? next : cellHeights;
};

const fitCellTextMetrics = (width) => {
  const paddingX = Math.max(2, Math.min(10, width * 0.12));

  // 셀 안 여백: --tk-cell-pad-* 변수가 있으면(문서 편집기가 block.padX/padY에서 주입) 그 값을,
  // 없으면 폭 비례 자동(폴백). 화면 여백 = 내보내기 cellMargin = 인스펙터 값(mm)으로 일관.
  // 글자 치수는 table/constants의 단일 소스(CELL_FONT_SIZE) — 내보내기 pt와 정합.
  return {
    fontSize: `${CELL_FONT_SIZE}px`,
    lineHeight: `${CELL_LINE_HEIGHT}px`,
    paddingInline: `var(--tk-cell-pad-x, ${paddingX}px)`,
    paddingBlock: `var(--tk-cell-pad-y, 0px)`,
  };
};

const justifyContentFromVAlign = (vAlign) => {
  if (vAlign === "top") return "flex-start";
  if (vAlign === "bottom") return "flex-end";
  return "center";
};

const textAlignFromHAlign = (hAlign) => {
  if (hAlign === "center") return "center";
  if (hAlign === "right") return "right";
  return "left";
};

const moveTextCaretToEdge = (target, edge, extend = false) => {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  const end = edge === "start" ? 0 : target.value.length;
  if (!extend) {
    target.setSelectionRange(end, end);
    return;
  }

  const anchor = target.selectionDirection === "backward"
    ? target.selectionEnd ?? end
    : target.selectionStart ?? end;
  target.setSelectionRange(anchor, end, anchor <= end ? "forward" : "backward");
};

const moveFixedAxisBoundary = (values, index, step, minimum) => {
  const next = [...values];
  if (index < 0 || index >= next.length || next.length < 2) return next;

  const target = next[index];
  const neighborIndex = index < next.length - 1 ? index + 1 : index - 1;
  const neighbor = next[neighborIndex];
  const delta = Math.max(minimum - target, Math.min(step, neighbor - minimum));

  next[index] = target + delta;
  next[neighborIndex] = neighbor - delta;
  return next;
};
export function TableKingBlock({
  value,
  onChange,
  active,
  onActivate,
  showHandles,
  setShowHandles,
  themeVars,
  blockId = "",
  outerResizeHandles = /** @type {import("react").ReactNode} */ (null),
  onEnterEditing = /** @type {(() => void) | undefined} */ (undefined),
  onExitEditing = /** @type {(() => void) | undefined} */ (undefined),
  // 셀 상하 여백 합(px) — 문서 편집기가 block.padY에서 주입, 최소 높이 공식용
  cellPadY = /** @type {number | undefined} */ (undefined),
}) {
  // value는 마운트 시드로만 쓴다 — 이후 진실은 내부 상태이며 onChange로 문서에 반영된다.
  const [cells, setCells] = useState(() => normalizeCells(value.cells));
  const [widths, setWidths] = useState(() => value.widths.map((row) => [...row]));
  const [cellHeights, setCellHeights] = useState(() =>
    repairRowHeights(value.cellHeights.map((row) => [...row]))
  );
  const [selection, setSelection] = useState({
    anchorRow: 0,
    anchorCol: 0,
    focusRow: 0,
    focusCol: 0,
  });
  const [merges, setMerges] = useState(() => (value.merges || []).map((m) => ({ ...m })));
  const [splitRows, setSplitRows] = useState(2);
  const [splitCols, setSplitCols] = useState(2);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [hoverBoundary, setHoverBoundary] = useState(null);
  const [activeBoundary, setActiveBoundary] = useState(null);
  // 셀 확장(파란 범위 표시)은 명시적 제스처에서만 — 드래그 확장·F3/F5·F7/F8·Ctrl+A·Ctrl+클릭.
  // 단순 클릭(캐럿 놓기)마다 셀이 파랗게 칠해지던 것 억제(사용자 요청 ⑥). 선택 "상태"는
  // 그대로 유지(병합·스타일 명령의 대상) — 시각 표시만 게이트.
  const [rangeVisible, setRangeVisible] = useState(false);
  const rangeVisibleRef = useRef(false);
  useEffect(() => {
    rangeVisibleRef.current = rangeVisible;
  }, [rangeVisible]);

  const selectingRef = useRef(false);
  const hoverClearTimerRef = useRef(null);
  const hoverAxisSwitchTimerRef = useRef(null);
  const lastHoverBoundaryRef = useRef(null);
  const pendingHoverBoundaryRef = useRef(null);
  const cellBlockStepRef = useRef(null);
  const clipRef = useRef(null);
  const cellsRef = useRef(cells);
  const selectionRef = useRef(selection);
  const mergesRef = useRef(merges);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const isRestoringRef = useRef(false);
  const isApplyingExternalValueRef = useRef(false);
  const liveDataRef = useRef({ cells, widths, cellHeights, merges });
  const cellInputRefs = useRef(new Map());
  liveDataRef.current = { cells, widths, cellHeights, merges };

  const valueSignature = useMemo(
    () => JSON.stringify({
      cells: value.cells,
      widths: value.widths,
      cellHeights: value.cellHeights,
      merges: value.merges || [],
    }),
    [value]
  );

  // 변경을 문서로 올린다. 마운트 직후 1회는 건너뜀 — 시드 자체가 문서에서 온 값이라 재반영이 무의미.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (isApplyingExternalValueRef.current) {
      isApplyingExternalValueRef.current = false;
      return;
    }
    onChangeRef.current?.({ cells, widths, cellHeights, merges });
  }, [cells, widths, cellHeights, merges]);

  const makeSnapshot = useCallback(
    () => ({
      cells,
      widths,
      cellHeights,
      selection,
      merges,
      splitRows,
      splitCols,
    }),
    [cellHeights, cells, merges, selection, splitCols, splitRows, widths]
  );

  const applySnapshot = useCallback((snapshot) => {
    setCells(normalizeCells(snapshot.cells, snapshot.cellStyles || {}));
    setWidths(snapshot.widths);
    setCellHeights(snapshot.cellHeights);
    setSelection(snapshot.selection);
    setMerges(snapshot.merges);
    setSplitRows(snapshot.splitRows || 2);
    setSplitCols(snapshot.splitCols || 2);
  }, []);

  // 캔버스의 8개 외곽 핸들은 문서 스냅샷(value)을 직접 바꾼다.
  // 내부 편집 상태와 값이 실제로 다를 때만 받아들여 셀 편집 중 선택 상태는 유지한다.
  useEffect(() => {
    const currentSignature = JSON.stringify({
      cells: liveDataRef.current.cells,
      widths: liveDataRef.current.widths,
      cellHeights: liveDataRef.current.cellHeights,
      merges: liveDataRef.current.merges || [],
    });
    if (currentSignature === valueSignature) return;

    isApplyingExternalValueRef.current = true;
    // ⚠ isRestoringRef를 세우지 않는다 — 외부 변경(외곽 8핸들 리사이즈·AI 적용)도 히스토리에
    // 쌓여야 Ctrl+Z가 "리사이즈 이전"으로 통째로 되돌아가는 부작용이 없다(감사 E5 CONFIRMED).
    setCells(normalizeCells(value.cells));
    setWidths(value.widths.map((row) => [...row]));
    setCellHeights(repairRowHeights(value.cellHeights.map((row) => [...row])));
    setMerges((value.merges || []).map((merge) => ({ ...merge })));
  }, [value, valueSignature]);

  // 히스토리는 "데이터"가 바뀔 때만 쌓는다 — 스냅샷에 selection/split 스피너가 포함되지만
  // 그것만 바뀐 변화는 푸시하지 않는다. 셀 클릭·방향키·스피너 조작이 80칸 버퍼를 밀어내
  // 실제 편집이 증발하고 Ctrl+Z가 "아무 일도 안 하는" 것처럼 보였다(감사 E4 CONFIRMED).
  const makeSnapshotRef = useRef(makeSnapshot);
  makeSnapshotRef.current = makeSnapshot;
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }

    const serialized = JSON.stringify(makeSnapshotRef.current());
    const history = historyRef.current;
    if (history[history.length - 1] === serialized) return;

    history.push(serialized);
    if (history.length > HISTORY_LIMIT) history.shift();
    redoRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, [cells, widths, cellHeights, merges]);

  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    mergesRef.current = merges;
  }, [merges]);

  const xs = useMemo(() => collectXBoundaries(widths), [widths]);

  const totalWidth = xs[xs.length - 1] || 0;

  const ys = useMemo(
    () => collectYBoundaries(cellHeights, cells[0]?.length || 0),
    [cellHeights, cells]
  );

  const rowGroupHeights = useMemo(() => sizesFromBoundaries(ys), [ys]);

  const rowHeights = useMemo(
    () => cellHeights.map((row) => Math.max(...row)),
    [cellHeights]
  );

  const setRowHeights = useCallback((updater) => {
    setCellHeights((currentHeights) => {
      const currentRows = currentHeights.map((row) => Math.max(...row));
      const nextRows =
        typeof updater === "function" ? updater(currentRows) : updater;

      return nextRows.map((height, rowIndex) =>
        (currentHeights[rowIndex] || currentHeights[0]).map(() => height)
      );
    });
  }, []);

  // 훅(드래그 시작·앵커 잠금 거부)이 hover를 지울 때 stable 캐시(ref)도 함께 리셋 —
  // 원시 setter만 부르면 lastHoverBoundaryRef가 낡은 경계를 기억해, 드래그 직후 같은
  // 경계에 다시 올려도 sameHoverBoundary 조기 return으로 하이라이트가 안 뜬다(표 감사).
  const setHoverBoundarySynced = useCallback((next) => {
    lastHoverBoundaryRef.current = next;
    pendingHoverBoundaryRef.current = null;
    setHoverBoundary(next);
  }, []);

  const { startDrag } = useBoundaryDrag({
    cellHeights,
    cells,
    merges,
    rowHeights,
    setActiveBoundary,
    setCellHeights,
    setHoverBoundary: setHoverBoundarySynced,
    setRowHeights,
    setSaveMessage,
    setWidths,
    widths,
    ...(cellPadY != null ? { cellPadY } : {}),
  });

  const totalHeight = useMemo(() => ys[ys.length - 1] || 0, [ys]);
  const boundarySegments = useMemo(
    () => buildBoundarySegments({ cells, widths, cellHeights, merges }),
    [cellHeights, cells, merges, widths]
  );
  const selectedRect = useMemo(() => rectFromSelection(selection), [selection]);

  const expandRect = useCallback(
    (rect, mergeList = mergesRef.current) => expandRectForMerges(rect, mergeList),
    []
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.length < 2) return;

    const current = history.pop();
    redoRef.current.push(current);
    const previous = history[history.length - 1];

    isRestoringRef.current = true;
    applySnapshot(JSON.parse(previous));
    setHistoryVersion((version) => version + 1);
    setSaveMessage("실행 취소");
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;

    historyRef.current.push(next);
    isRestoringRef.current = true;
    applySnapshot(JSON.parse(next));
    setHistoryVersion((version) => version + 1);
    setSaveMessage("다시 실행");
  }, [applySnapshot]);

  const findYBoundaryIndex = useCallback(
    (value) => findNearestBoundaryIndex(ys, value),
    [ys]
  );

  const cellStartX = useCallback(
    (row, col) => getCellStartX(widths, row, col),
    [widths]
  );

  const cellWidth = useCallback(
    (row, col, colSpan = 1) => getCellWidth(widths, row, col, colSpan),
    [widths]
  );

  const cellStartY = useCallback(
    (row, col) => getCellStartY(cellHeights, row, col),
    [cellHeights]
  );

  const cellHeight = useCallback(
    (row, col, rowSpan = 1) => getCellHeight(cellHeights, row, col, rowSpan),
    [cellHeights]
  );

  const isSelected = useCallback(
    (row, col) => {
      const rect = expandRect(selectedRect);
      if (!rect) return false;
      return row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
    },
    [expandRect, selectedRect]
  );

  // 병합 술어는 table/merge.js 단일 소스 — 래퍼는 현재 merges 상태만 바인딩
  const coveredByMerge = useCallback((row, col) => coveringMerge(merges, row, col), [merges]);

  const mergeAt = useCallback((row, col) => findMergeAt(merges, row, col), [merges]);

  const updateSelection = (anchorRow, anchorCol, focusRow, focusCol) => {
    cellBlockStepRef.current = null;
    setRangeVisible(false); // 단순 이동/클릭은 확장 표시 없음 — 명시 제스처에서만 켠다
    setSelection({ anchorRow, anchorCol, focusRow, focusCol });
  };

  // ⚠ 지연은 rAF가 아니라 setTimeout(0) — rAF는 백그라운드 탭에서 정지해(브라우저 스로틀)
  //   키보드 셀 이동 후 포커스가 영영 안 따라오는 경우가 생긴다. "커밋 다음 틱"이면 충분.
  const focusCellTextEnd = (row, col) => {
    const input = cellInputRefs.current.get(makeKey(row, col));
    if (!input) return;

    setTimeout(() => {
      input.focus({ preventScroll: true });
      const end = input.value.length;
      try {
        input.setSelectionRange(end, end);
      } catch {
        // Some input-like controls may not support selection ranges.
      }
    }, 0);
  };

  // 셀 이동 후 캐럿을 시작(왼쪽에서 들어옴)이나 끝(오른쪽에서 들어옴)에 놓는다.
  const focusCellCaret = (row, col, pos) => {
    const input = cellInputRefs.current.get(makeKey(row, col));
    if (!input) return;
    setTimeout(() => {
      input.focus({ preventScroll: true });
      const at = pos === "start" ? 0 : input.value.length;
      try {
        input.setSelectionRange(at, at);
      } catch {
        // ignore
      }
    }, 0);
  };

  // (row,col)에서 한 칸 이동한 셀 — 우/좌는 행 끝에서 다음/이전 행으로 랩, 상/하는 같은 열.
  // 병합에 덮인 칸은 그 병합의 앵커(좌상단)로 넘긴다. 표 밖이면 null.
  // ⚠ 출발 셀이 병합 앵커면 스팬 "바깥"으로 한 칸 — +1이면 자기 덮인 칸에 착지해 자기
  //   앵커로 되돌아오는 무한 루프가 된다(감사 E2 CONFIRMED: 병합 셀 탈출 불가).
  const findAdjacentCell = (row, col, dRow, dCol) => {
    const rowCount = cellsRef.current.length;
    const colCount = cellsRef.current[0]?.length || 0;
    const own = mergeAt(row, col);
    let r = row;
    let c = col;
    if (dCol > 0) {
      c = col + (own?.cs || 1);
      if (c >= colCount) { c = 0; r += 1; }
    } else if (dCol < 0) {
      c -= 1;
      if (c < 0) { c = colCount - 1; r -= 1; }
    } else if (dRow > 0) {
      r = row + (own?.rs || 1);
    } else {
      r += dRow;
    }
    if (r < 0 || r >= rowCount || c < 0 || c >= colCount) return null;
    const cov = coveredByMerge(r, c);
    if (cov) { r = cov.r; c = cov.c; }
    return { row: r, col: c };
  };

  const focusSelectedCellTextEnd = useCallback(() => {
    const current = selectionRef.current;
    focusCellTextEnd(current.focusRow, current.focusCol);
  }, []);

  const moveSelectedCell = useCallback(
    (direction) => {
      const current = selectionRef.current;
      const rowCount = cellsRef.current.length;
      const colCount = cellsRef.current[0]?.length || 0;
      if (!rowCount || !colCount) return;

      // 병합 스팬을 건너뛴다 — 덮인 좌표에 서면 textarea가 없어(렌더 null) 포커스는 이전
      // 셀에 남고 선택만 이동하는 탈선이 났다(감사 E3 CONFIRMED). 앵커에서 나갈 땐 스팬
      // 바깥으로, 착지가 덮인 칸이면 그 병합의 앵커로 넘긴다.
      const own = findMergeAt(mergesRef.current, current.focusRow, current.focusCol);
      let row = current.focusRow;
      let col = direction > 0 ? current.focusCol + (own?.cs || 1) : current.focusCol - 1;
      if (col >= colCount) {
        col = 0;
        row = Math.min(rowCount - 1, row + 1);
      } else if (col < 0) {
        col = colCount - 1;
        row = Math.max(0, row - 1);
      }
      const cov = coveringMerge(mergesRef.current, row, col);
      if (cov) {
        row = cov.r;
        col = cov.c;
      }

      updateSelection(row, col, row, col);
      focusCellTextEnd(row, col);
    },
    []
  );

  const selectWholeTable = useCallback(() => {
    const rowCount = cellsRef.current.length;
    const colCount = cellsRef.current[0]?.length || 0;
    if (!rowCount || !colCount) return;
    updateSelection(0, 0, rowCount - 1, colCount - 1);
    setRangeVisible(true); // 전체 선택은 확장 표시
  }, []);

  const applyCellBlockSelection = useCallback((row, col, mode = "cell") => {
    selectingRef.current = false;
    setRangeVisible(true); // 셀 확장 제스처(F3/F5·Ctrl+클릭) — 표시 켬

    if (mode === "all") {
      const rowCount = cellsRef.current.length;
      const colCount = cellsRef.current[0]?.length || 0;
      if (!rowCount || !colCount) return;
      setSelection({ anchorRow: 0, anchorCol: 0, focusRow: rowCount - 1, focusCol: colCount - 1 });
      setSaveMessage("표 전체 셀 확장");
      return;
    }

    setSelection({ anchorRow: row, anchorCol: col, focusRow: row, focusCol: col });
    focusCellTextEnd(row, col);
    setSaveMessage("셀 확장");
  }, []);

  const selectWholeColumn = useCallback(() => {
    const current = selectionRef.current;
    const rowCount = cellsRef.current.length;
    const colCount = cellsRef.current[0]?.length || 0;
    const col = Math.max(0, Math.min(colCount - 1, current.focusCol ?? 0));
    if (!rowCount || !colCount) return;
    setRangeVisible(true);
    setSelection({ anchorRow: 0, anchorCol: col, focusRow: rowCount - 1, focusCol: col });
    cellBlockStepRef.current = null;
    setSaveMessage("열 전체 선택");
  }, []);

  const selectWholeRow = useCallback(() => {
    const current = selectionRef.current;
    const rowCount = cellsRef.current.length;
    const colCount = cellsRef.current[0]?.length || 0;
    const row = Math.max(0, Math.min(rowCount - 1, current.focusRow ?? 0));
    if (!rowCount || !colCount) return;
    setRangeVisible(true);
    setSelection({ anchorRow: row, anchorCol: 0, focusRow: row, focusCol: colCount - 1 });
    cellBlockStepRef.current = null;
    setSaveMessage("행 전체 선택");
  }, []);

  const toggleCurrentCellBlock = useCallback(() => {
    const current = selectionRef.current;
    const row = current.focusRow ?? current.anchorRow ?? 0;
    const col = current.focusCol ?? current.anchorCol ?? 0;
    const previous = cellBlockStepRef.current;
    const sameCell = previous?.row === row && previous?.col === col;

    if (sameCell) {
      cellBlockStepRef.current = null;
      applyCellBlockSelection(row, col, "all");
      return;
    }

    cellBlockStepRef.current = { row, col };
    applyCellBlockSelection(row, col, "cell");
  }, [applyCellBlockSelection]);
  const startSelect = (event, row, col) => {
    if (event.button !== 0) return;
    const target = event.target;
    const isResizeHandle = target instanceof Element && target.closest(".resize-handle");
    // 셀은 <textarea>다(병렬 WIP에서 <input>→<textarea> 전환). textarea를 못 알아보면
    // 셀 텍스트를 직접 눌러도 preventDefault+focusCellTextEnd가 걸려 캐럿이 항상 끝(오른쪽)에
    // 고정되고 네이티브 드래그 선택이 막힌다 — 96행 moveTextCaretToEdge와 같은 판정.
    const isDirectInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    if (isResizeHandle) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      cellBlockStepRef.current = { row, col };
      applyCellBlockSelection(row, col, "cell");
      return;
    }

    selectingRef.current = true;
    updateSelection(row, col, row, col);

    if (!isDirectInput) {
      event.preventDefault();
      focusCellTextEnd(row, col);
    }
  };

  const extendSelect = (row, col) => {
    if (!selectingRef.current) return;
    setRangeVisible(true); // 드래그 확장 — 이때부터 파란 범위 표시
    setSelection((current) => ({ ...current, focusRow: row, focusCol: col }));
  };

  useEffect(() => {
    const stopSelecting = () => {
      selectingRef.current = false;
    };

    window.addEventListener("mouseup", stopSelecting);
    return () => window.removeEventListener("mouseup", stopSelecting);
  }, []);

  const clearRange = useCallback(() => {
    const rect = expandRect(rectFromSelection(selectionRef.current));
    if (!rect) return;

    setCells((currentCells) =>
      currentCells.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          rowIndex >= rect.r1 &&
          rowIndex <= rect.r2 &&
          colIndex >= rect.c1 &&
          colIndex <= rect.c2
            ? setCellText(cell, "")
            : cell
        )
      )
    );
  }, [expandRect]);

  const copyRange = useCallback(
    (cut = false) => {
      const rect = expandRect(rectFromSelection(selectionRef.current));
      if (!rect) return;

      const data = [];
      for (let row = rect.r1; row <= rect.r2; row += 1) {
        const line = [];
        for (let col = rect.c1; col <= rect.c2; col += 1) {
          line.push(cloneCell(cellsRef.current[row][col]));
        }
        data.push(line);
      }

      clipRef.current = { data, cut, rect };
      navigator.clipboard?.writeText(
        data.map((row) => row.map(getCellText).join("\t")).join("\n")
      );
    },
    [expandRect]
  );

  const pasteDataAtSelection = useCallback((data) => {
    const selectionNow = selectionRef.current;
    if (!data.length || !selectionNow) return false;

    const startRow = Math.min(selectionNow.anchorRow, selectionNow.focusRow);
    const startCol = Math.min(selectionNow.anchorCol, selectionNow.focusCol);

    setCells((currentCells) => {
      const next = cloneCellGrid(currentCells);
      data.forEach((line, rowOffset) => {
        line.forEach((value, colOffset) => {
          const row = startRow + rowOffset;
          const col = startCol + colOffset;
          if (next[row]?.[col] === undefined) return;
          next[row][col] =
            typeof value === "string" ? setCellText(next[row][col], value) : cloneCell(value);
        });
      });
      return next;
    });

    return true;
  }, []);

  const pasteAt = useCallback(async () => {
    const clip = clipRef.current;

    if (clip) {
      if (clip.cut) {
        setCells((currentCells) => {
          const next = cloneCellGrid(currentCells);
          for (let row = clip.rect.r1; row <= clip.rect.r2; row += 1) {
            for (let col = clip.rect.c1; col <= clip.rect.c2; col += 1) {
              next[row][col] = setCellText(next[row][col], "");
            }
          }
          return next;
        });
      }

      pasteDataAtSelection(clip.data);
      if (clip.cut) clipRef.current = { ...clip, cut: false };
      return;
    }

    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        pasteDataAtSelection(parseClipboardTable(text));
        setSaveMessage("외부 붙여넣기");
      }
    } catch {
      setSaveMessage("붙여넣기 권한 필요");
    }
  }, [pasteDataAtSelection]);

  const alignForMerge = (rect) => {
    setWidths((currentWidths) => {
      const next = currentWidths.map((row) => [...row]);
      for (let row = rect.r1 + 1; row <= rect.r2; row += 1) {
        for (let col = rect.c1; col <= rect.c2; col += 1) {
          next[row][col] = next[rect.r1][col];
        }
      }
      return next;
    });

    setCellHeights((currentHeights) => {
      const next = currentHeights.map((row) => [...row]);
      for (let row = rect.r1; row <= rect.r2; row += 1) {
        for (let col = rect.c1 + 1; col <= rect.c2; col += 1) {
          next[row][col] = next[row][rect.c1];
        }
      }
      return next;
    });
  };

  const mergeSelection = () => {
    const rect = expandRect(selectedRect);
    if (!rect || (rect.r1 === rect.r2 && rect.c1 === rect.c2)) return;

    alignForMerge(rect);

    const mergedText = [];
    for (let row = rect.r1; row <= rect.r2; row += 1) {
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        const value = getCellText(cells[row][col]);
        if (value) mergedText.push(value);
      }
    }

    setCells((currentCells) =>
      currentCells.map((line, rowIndex) =>
        line.map((cell, colIndex) => {
          const inside =
            rowIndex >= rect.r1 &&
            rowIndex <= rect.r2 &&
            colIndex >= rect.c1 &&
            colIndex <= rect.c2;
          if (!inside) return cell;
          return rowIndex === rect.r1 && colIndex === rect.c1
            ? setCellText(cell, mergedText.join(" "))
            : setCellText(cell, "");
        })
      )
    );

    setMerges((currentMerges) => [
      ...currentMerges.filter((merge) => !rectsOverlap(mergeToRect(merge), rect)),
      {
        r: rect.r1,
        c: rect.c1,
        rs: rect.r2 - rect.r1 + 1,
        cs: rect.c2 - rect.c1 + 1,
      },
    ]);
  };

  const unmergeSelection = () => {
    const rect = selectedRect;
    if (!rect) return;
    setMerges((currentMerges) =>
      currentMerges.filter((merge) => !rectsOverlap(mergeToRect(merge), rect))
    );
  };

  const applyStyle = (stylePatch) => {
    const rect = expandRect(selectedRect);
    if (!rect) return;

    setCells((currentCells) => {
      const next = cloneCellGrid(currentCells);
      for (let row = rect.r1; row <= rect.r2; row += 1) {
        for (let col = rect.c1; col <= rect.c2; col += 1) {
          next[row][col] = patchCellStyle(next[row][col], stylePatch);
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (!active || !blockId) return undefined;
    const onApplyStyle = (event) => {
      const detail = event.detail;
      if (!detail || detail.blockId !== blockId || !detail.style) return;
      applyStyle(detail.style);
    };
    window.addEventListener("studio:table-apply-style", onApplyStyle);
    return () => window.removeEventListener("studio:table-apply-style", onApplyStyle);
  }, [active, blockId, selectedRect]);

  const equalizeWidths = () => {
    const rect = expandRect(selectedRect);
    if (!rect || rect.c1 === rect.c2) return;

    setWidths((currentWidths) =>
      currentWidths.map((line, rowIndex) => {
        if (rowIndex < rect.r1 || rowIndex > rect.r2) return line;
        const next = [...line];
        let total = 0;
        for (let col = rect.c1; col <= rect.c2; col += 1) total += line[col];
        const each = Math.max(MIN_COL_W, total / (rect.c2 - rect.c1 + 1));
        for (let col = rect.c1; col <= rect.c2; col += 1) next[col] = each;
        return next;
      })
    );
  };

  const equalizeHeights = () => {
    const rect = expandRect(selectedRect);
    if (!rect || rect.r1 === rect.r2) return;

    setCellHeights((currentHeights) => {
      const next = currentHeights.map((row) => [...row]);
      for (let col = rect.c1; col <= rect.c2; col += 1) {
        let total = 0;
        for (let row = rect.r1; row <= rect.r2; row += 1) {
          total += currentHeights[row][col];
        }
        const each = Math.max(HANGUL_MIN_ROW_H, total / (rect.r2 - rect.r1 + 1));
        for (let row = rect.r1; row <= rect.r2; row += 1) next[row][col] = each;
      }
      return next;
    });
  };

  const nudgeWidth = useCallback(
    (mode, step) => {
      const rect = expandRect(rectFromSelection(selectionRef.current));
      if (!rect) return;

      setWidths((currentWidths) =>
        currentWidths.map((line, rowIndex) => {
          const shouldAffectRow =
            mode === "ctrl" ||
            mode === "alt" ||
            (rowIndex >= rect.r1 && rowIndex <= rect.r2);
          if (!shouldAffectRow) return line;

          const col = rect.c2;
          if (mode === "ctrl") {
            const next = [...line];
            if (next[col] !== undefined) next[col] = Math.max(MIN_COL_W, next[col] + step);
            return next;
          }

          return moveFixedAxisBoundary(line, col, step, MIN_COL_W);
        })
      );
    },
    [expandRect]
  );

  const nudgeHeight = useCallback(
    (mode, step) => {
      const rect = expandRect(rectFromSelection(selectionRef.current));
      if (!rect) return;

      setCellHeights((currentHeights) => {
        const next = currentHeights.map((row) => [...row]);
        const targetRow = rect.r2;
        const colCount = next[0]?.length || 0;

        for (let col = 0; col < colCount; col += 1) {
          const shouldAffectCol =
            mode === "ctrl" ||
            mode === "alt" ||
            (col >= rect.c1 && col <= rect.c2);
          if (!shouldAffectCol || next[targetRow]?.[col] === undefined) continue;

          if (mode === "ctrl") {
            // 행 하한 = 한글 한 줄 최소(HANGUL_MIN_ROW_H) — 드래그 경로와 같은 바닥(값 표류 방지)
            next[targetRow][col] = Math.max(HANGUL_MIN_ROW_H, currentHeights[targetRow][col] + step);
            continue;
          }

          const columnHeights = currentHeights.map((row) => row[col] ?? MIN_ROW_H);
          const adjusted = moveFixedAxisBoundary(columnHeights, targetRow, step, HANGUL_MIN_ROW_H);
          adjusted.forEach((height, rowIndex) => {
            if (next[rowIndex]) next[rowIndex][col] = height;
          });
        }
        return next;
      });
    },
    [expandRect]
  );

  const splitSelection = () => {
    const rect = expandRect(selectedRect);
    const rowsToAdd = Math.max(1, Math.floor(splitRows));
    const colsToAdd = Math.max(1, Math.floor(splitCols));
    if (!rect || (rowsToAdd === 1 && colsToAdd === 1)) return;

    const oldRows = cells.length;
    const oldCols = cells[0].length;
    const rowMultiplier = (row) =>
      row >= rect.r1 && row <= rect.r2 ? rowsToAdd : 1;
    const colMultiplier = (col) =>
      col >= rect.c1 && col <= rect.c2 ? colsToAdd : 1;

    const rowStart = [];
    let rowCursor = 0;
    for (let row = 0; row < oldRows; row += 1) {
      rowStart[row] = rowCursor;
      rowCursor += rowMultiplier(row);
    }

    const colStart = [];
    let colCursor = 0;
    for (let col = 0; col < oldCols; col += 1) {
      colStart[col] = colCursor;
      colCursor += colMultiplier(col);
    }

    const newCells = Array.from({ length: rowCursor }, () =>
      Array.from({ length: colCursor }, () => makeCell(""))
    );
    const newWidths = [];
    const newHeights = [];

    // 정수 분배(큰 나머지) — 나눗셈 float 폭(33.33…)은 경계를 소수 위치로 보내
    // 선이 뿌옇게 번지고 반올림 드리프트의 씨앗이 된다(표 감사). 합은 원본을 보존.
    // 단, 트랙이 최소 미만으로 쪼개지면(40px 열을 3분할 등) 최소값으로 고정해 표가
    // 자라게 한다(HWP식) — 최소 미만 트랙은 셀 상자(min-width 30px)와 겹쳐 그려지고
    // 경계가 되돌릴 수 없게 얼어붙는다(감사 E7 CONFIRMED).
    const distribute = (total, n, minTrack = 1) => {
      const base = Math.floor(total / n);
      if (base < minTrack) return Array.from({ length: n }, () => minTrack);
      const rem = Math.round(total - base * n);
      return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
    };

    for (let row = 0; row < oldRows; row += 1) {
      const splitRowCount = rowMultiplier(row);
      const splitWidthLines = Array.from({ length: splitRowCount }, () => []);
      const splitHeightLines = Array.from({ length: splitRowCount }, () => []);

      for (let col = 0; col < oldCols; col += 1) {
        const splitColCount = colMultiplier(col);
        const splitWidths = distribute(widths[row][col], splitColCount, MIN_COL_W);
        const splitHeights = distribute(cellHeights[row][col], splitRowCount, HANGUL_MIN_ROW_H);

        for (let addRow = 0; addRow < splitRowCount; addRow += 1) {
          for (let addCol = 0; addCol < splitColCount; addCol += 1) {
            splitWidthLines[addRow].push(splitWidths[addCol]);
            splitHeightLines[addRow].push(splitHeights[addRow]);
          }
        }
      }

      newWidths.push(...splitWidthLines);
      newHeights.push(...splitHeightLines);
    }

    for (let row = 0; row < oldRows; row += 1) {
      for (let col = 0; col < oldCols; col += 1) {
        const nextRow = rowStart[row];
        const nextCol = colStart[col];
        const sourceCell = cells[row][col];
        const sourceStyle = getCellStyle(sourceCell);

        for (let addRow = 0; addRow < rowMultiplier(row); addRow += 1) {
          for (let addCol = 0; addCol < colMultiplier(col); addCol += 1) {
            const targetRow = nextRow + addRow;
            const targetCol = nextCol + addCol;
            newCells[targetRow][targetCol] =
              addRow === 0 && addCol === 0
                ? cloneCell(sourceCell)
                : makeCell("", sourceStyle);
          }
        }
      }
    }

    const newMerges = merges
      .filter((merge) => !rectsOverlap(mergeToRect(merge), rect))
      .map((merge) => ({
        r: rowStart[merge.r],
        c: colStart[merge.c],
        rs: rowStart[merge.r + merge.rs - 1] - rowStart[merge.r] + 1,
        cs: colStart[merge.c + merge.cs - 1] - colStart[merge.c] + 1,
      }));

    setCells(newCells);
    setWidths(newWidths);
    setCellHeights(newHeights);
    setMerges(newMerges);
    updateSelection(rowStart[rect.r1], colStart[rect.c1], rowStart[rect.r1], colStart[rect.c1]);
  };

  const insertRowBelow = () => {
    const rect = expandRect(selectedRect);
    if (!rect) return;
    const insertAt = rect.r2 + 1;

    setCells((current) => {
      const next = cloneCellGrid(current);
      next.splice(
        insertAt,
        0,
        Array.from({ length: current[0].length }, () => makeCell(""))
      );
      return next;
    });
    setWidths((current) => {
      const next = current.map((row) => [...row]);
      next.splice(insertAt, 0, makeNormalRowWidths(current));
      return next;
    });
    setCellHeights((current) => {
      const next = current.map((row) => [...row]);
      next.splice(
        insertAt,
        0,
        makeNormalInsertedRowHeights(current[rect.r2], current[0]?.length || 0)
      );
      return next;
    });
    setMerges((current) =>
      current.map((merge) => (merge.r >= insertAt ? { ...merge, r: merge.r + 1 } : merge))
    );
    updateSelection(insertAt, rect.c1, insertAt, rect.c1);
  };

  const insertColRight = () => {
    const rect = expandRect(selectedRect);
    if (!rect) return;
    const insertAt = rect.c2 + 1;

    setCells((current) =>
      current.map((row) => {
        const next = row.map(cloneCell);
        next.splice(insertAt, 0, makeCell(""));
        return next;
      })
    );
    setWidths((current) => {
      const normalWidth = makeNormalInsertedColumnWidth(current, rect.c2);
      return current.map((row) => {
        const next = [...row];
        next.splice(insertAt, 0, normalWidth);
        return next;
      });
    });
    setCellHeights((current) => {
      const normalHeights = makeNormalColumnHeights(current);
      return current.map((row, rowIndex) => {
        const next = [...row];
        next.splice(insertAt, 0, normalHeights[rowIndex]);
        return next;
      });
    });
    setMerges((current) =>
      current.map((merge) => (merge.c >= insertAt ? { ...merge, c: merge.c + 1 } : merge))
    );
    updateSelection(rect.r1, insertAt, rect.r1, insertAt);
  };

  const deleteSelectedRows = () => {
    const rect = expandRect(selectedRect);
    if (!rect || cells.length <= rect.r2 - rect.r1 + 1) return;
    const removed = rect.r2 - rect.r1 + 1;
    const deleteRect = { r1: rect.r1, c1: 0, r2: rect.r2, c2: cells[0].length - 1 };

    setCells((current) => current.filter((_, row) => row < rect.r1 || row > rect.r2));
    setWidths((current) => current.filter((_, row) => row < rect.r1 || row > rect.r2));
    setCellHeights((current) => current.filter((_, row) => row < rect.r1 || row > rect.r2));
    setMerges((current) =>
      current
        .filter((merge) => !rectsOverlap(mergeToRect(merge), deleteRect))
        .map((merge) => (merge.r > rect.r2 ? { ...merge, r: merge.r - removed } : merge))
    );
    updateSelection(Math.max(0, rect.r1 - 1), rect.c1, Math.max(0, rect.r1 - 1), rect.c1);
  };

  const deleteSelectedCols = () => {
    const rect = expandRect(selectedRect);
    if (!rect || cells[0].length <= rect.c2 - rect.c1 + 1) return;
    const removed = rect.c2 - rect.c1 + 1;
    const deleteRect = { r1: 0, c1: rect.c1, r2: cells.length - 1, c2: rect.c2 };

    setCells((current) =>
      current.map((row) => row.filter((_, col) => col < rect.c1 || col > rect.c2))
    );
    setWidths((current) =>
      current.map((row) => row.filter((_, col) => col < rect.c1 || col > rect.c2))
    );
    setCellHeights((current) =>
      current.map((row) => row.filter((_, col) => col < rect.c1 || col > rect.c2))
    );
    setMerges((current) =>
      current
        .filter((merge) => !rectsOverlap(mergeToRect(merge), deleteRect))
        .map((merge) => (merge.c > rect.c2 ? { ...merge, c: merge.c - removed } : merge))
    );
    updateSelection(rect.r1, Math.max(0, rect.c1 - 1), rect.r1, Math.max(0, rect.c1 - 1));
  };

  // 전역 리스너는 활성 표에만 붙인다 — 문서에 표가 여러 개면 단축키가 전부에 적용되는 사고 방지.
  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (event) => {
      const target = event.target;
      const tagName = target?.tagName || "";
      const isTextEditing = tagName === "INPUT" || tagName === "TEXTAREA";
      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
      const horizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";

      // F3/F5는 표 안에서만 셀 확장 단계로 사용한다. 표 밖 새로고침은 건드리지 않는다.
      if (event.key === "F3" || event.key === "F5") {
        event.preventDefault();
        event.stopPropagation();
        toggleCurrentCellBlock();
        return;
      }

      if (event.key === "F7") {
        event.preventDefault();
        selectWholeColumn();
        return;
      }

      if (event.key === "F8") {
        event.preventDefault();
        selectWholeRow();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        target?.blur?.();
        onExitEditing?.();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        moveSelectedCell(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key.startsWith("Arrow")) {
        // ① 셀 확장 모드(F3/F5·드래그)에서는 방향키가 셀 선택 자체를 이동한다.
        //   병합 스팬은 건너뛴다 — 덮인 좌표는 textarea가 없어(렌더 null) 포커스가 이전 셀에
        //   남고 방향키가 죽은 듯 보였다(findAdjacentCell·Tab과 동일 규칙, 감사 E2/E3 계열).
        if (rangeVisibleRef.current) {
          event.preventDefault();
          event.stopPropagation();
          const dr = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          const dc = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          const cur = selectionRef.current;
          const rowCount = cellsRef.current.length;
          const colCount = cellsRef.current[0]?.length || 0;
          const own = findMergeAt(mergesRef.current, cur.focusRow ?? 0, cur.focusCol ?? 0);
          const stepR = dr > 0 ? (own?.rs || 1) : dr;
          const stepC = dc > 0 ? (own?.cs || 1) : dc;
          let row = Math.max(0, Math.min(rowCount - 1, (cur.focusRow ?? 0) + stepR));
          let col = Math.max(0, Math.min(colCount - 1, (cur.focusCol ?? 0) + stepC));
          const cov = coveringMerge(mergesRef.current, row, col);
          if (cov) {
            row = cov.r;
            col = cov.c;
          }
          setSelection({ anchorRow: row, anchorCol: col, focusRow: row, focusCol: col });
          cellBlockStepRef.current = null;
          focusCellTextEnd(row, col);
          return;
        }

        // ② 일반 텍스트 편집 중 — 캐럿이 경계에 닿으면 옆/위/아래 칸으로 넘어간다.
        //    "텍스트 끝까지 간 후 옆칸" — 캐럿이 아직 안쪽이면 네이티브 캐럿 이동에 맡긴다.
        //    (선택 구간이 있으면 shift+화살표 텍스트 선택이므로 개입 안 함)
        if (isTextEditing && target && typeof target.selectionStart === "number") {
          const collapsed = target.selectionStart === target.selectionEnd;
          const atStart = collapsed && target.selectionStart === 0;
          const atEnd = collapsed && target.selectionStart === target.value.length;
          const cur = selectionRef.current;
          const row = cur.focusRow ?? 0;
          const col = cur.focusCol ?? 0;
          let dest = null;
          let caret = "start";
          if (event.key === "ArrowRight" && atEnd) { dest = findAdjacentCell(row, col, 0, 1); caret = "start"; }
          else if (event.key === "ArrowLeft" && atStart) { dest = findAdjacentCell(row, col, 0, -1); caret = "end"; }
          else if (event.key === "ArrowDown" && atEnd) { dest = findAdjacentCell(row, col, 1, 0); caret = "start"; }
          else if (event.key === "ArrowUp" && atStart) { dest = findAdjacentCell(row, col, -1, 0); caret = "end"; }
          if (dest) {
            event.preventDefault();
            event.stopPropagation();
            setSelection({ anchorRow: dest.row, anchorCol: dest.col, focusRow: dest.row, focusCol: dest.col });
            cellBlockStepRef.current = null;
            focusCellCaret(dest.row, dest.col, caret);
            return;
          }
          // 경계가 아니면 return하지 않고 네이티브 캐럿 이동을 그대로 둔다.
        }
      }

      // 의도된 HWP식 규칙(docs/table-editing-rules.md §9): 표 활성 중 Ctrl+A는 "표 전체 셀
      // 선택" — 셀 텍스트 편집 중에도 가로챈다(브라우저 기본 전체선택 아님).
      if (commandKey && key === "a") {
        event.preventDefault();
        selectWholeTable();
        setSaveMessage("표 전체 선택");
        return;
      }

      // 텍스트 입력 중에도 충돌이 적은 표 구조 단축키는 허용한다.
      if (commandKey && event.key === "Enter") {
        event.preventDefault();
        insertRowBelow();
        setSaveMessage("행 추가");
        return;
      }

      if (event.altKey && event.key === "Insert") {
        event.preventDefault();
        insertColRight();
        setSaveMessage("열 추가");
        return;
      }

      if (event.altKey && event.key === "Delete") {
        event.preventDefault();
        deleteSelectedCols();
        setSaveMessage("열 삭제");
        return;
      }

      if (commandKey && key === "e") {
        event.preventDefault();
        clearRange();
        setSaveMessage("셀 내용 지우기");
        return;
      }
      // 셀 텍스트를 직접 입력 중일 때는 일반 편집 키를 먼저 존중한다.
      if (isTextEditing) {
        if (commandKey && ["z", "y", "c", "x", "v"].includes(key)) {
          event.preventDefault();
          if (key === "z") event.shiftKey ? redo() : undo();
          if (key === "y") redo();
          if (key === "c") copyRange(false);
          if (key === "x") copyRange(true);
          if (key === "v") pasteAt();
          return;
        }
        if (commandKey && horizontalArrow) {
          event.preventDefault();
          moveTextCaretToEdge(
            target,
            event.key === "ArrowLeft" ? "start" : "end",
            event.shiftKey
          );
          return;
        }
        return;
      }

      if (commandKey && event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedRows();
        setSaveMessage("행 삭제");
      } else if (commandKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (commandKey && key === "y") {
        event.preventDefault();
        redo();
      } else if (commandKey && key === "c") {
        event.preventDefault();
        copyRange(false);
      } else if (commandKey && key === "x") {
        event.preventDefault();
        copyRange(true);
      } else if (commandKey && key === "v") {
        event.preventDefault();
        pasteAt();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        clearRange();
      } else if (event.key === "Enter") {
        event.preventDefault();
        focusSelectedCellTextEnd();
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("alt", STEP);
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("alt", -STEP);
      } else if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        nudgeHeight("alt", STEP);
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        nudgeHeight("alt", -STEP);
      } else if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("shift", STEP);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("shift", -STEP);
      } else if (commandKey && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("ctrl", STEP);
      } else if (commandKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("ctrl", -STEP);
      } else if (event.shiftKey && event.key === "ArrowDown") {
        event.preventDefault();
        nudgeHeight("shift", STEP);
      } else if (event.shiftKey && event.key === "ArrowUp") {
        event.preventDefault();
        nudgeHeight("shift", -STEP);
      } else if (commandKey && event.key === "ArrowDown") {
        event.preventDefault();
        nudgeHeight("ctrl", STEP);
      } else if (commandKey && event.key === "ArrowUp") {
        event.preventDefault();
        nudgeHeight("ctrl", -STEP);
      } else if (key === "h") {
        event.preventDefault();
        equalizeHeights();
      } else if (key === "w") {
        event.preventDefault();
        equalizeWidths();
      } else if (key === "m") {
        event.preventDefault();
        mergeSelection();
      } else if (key === "s") {
        event.preventDefault();
        splitSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    clearRange,
    copyRange,
    equalizeHeights,
    deleteSelectedCols,
    deleteSelectedRows,
    equalizeWidths,
    focusSelectedCellTextEnd,
    applyCellBlockSelection,
    selectWholeColumn,
    selectWholeRow,
    toggleCurrentCellBlock,
    insertColRight,
    insertRowBelow,
    mergeSelection,
    moveSelectedCell,
    nudgeHeight,
    nudgeWidth,
    onExitEditing,
    pasteAt,
    redo,
    selectWholeTable,
    splitSelection,
    undo,
  ]);

  // hover 하이라이트 = 실제 드래그가 움직일 그룹과 동일 형상(위치 기반 findGroup).
  // 이전의 fullLine(boundaryIndex 인덱스 매칭)은 어긋난 표에서 x가 다른 세그먼트까지
  // 지그재그로 켜고, mousedown 순간 activeBoundary(위치 기반)로 바뀌며 모양이 급변했다.
  const makeColumnHoverBoundary = useCallback(
    (event, rowIndex, boundaryIndex) =>
      event.shiftKey
        ? { type: "col", items: [{ row: rowIndex, boundaryIndex }] }
        : {
            type: "col",
            items: findColumnBoundaryGroup({ cells, widths, cellHeights, merges, rowIndex, boundaryIndex }),
          },
    [cells, widths, cellHeights, merges]
  );

  const makeRowHoverBoundary = useCallback(
    (event, boundaryIndex, colIndex) =>
      event.shiftKey
        ? { type: "row", items: [{ boundaryIndex, col: colIndex }] }
        : {
            type: "row",
            items: findRowBoundaryGroup({ cells, widths, cellHeights, merges, boundaryIndex, colIndex }),
          },
    [cells, widths, cellHeights, merges]
  );
  const sameHoverBoundary = (left, right) => {
    if (left === right) return true;
    if (!left || !right) return false;
    if (left.type !== right.type) return false;
    const leftItems = left.items || [];
    const rightItems = right.items || [];
    if (leftItems.length !== rightItems.length) return false;
    return leftItems.every((item, index) => {
      const other = rightItems[index];
      return (
        item.row === other?.row &&
        item.col === other?.col &&
        item.boundaryIndex === other?.boundaryIndex
      );
    });
  };

  // 교차점에서는 가로/세로 hitbox가 순서대로 leave/enter 되므로,
  // 정리보다 축 전환을 먼저 확정해야 hover가 빈 상태로 깜빡이지 않는다.
  const HOVER_AXIS_SWITCH_DELAY_MS = 80;
  const HOVER_CLEAR_DELAY_MS = 180;

  const setStableHoverBoundary = (nextBoundary) => {
    if (hoverClearTimerRef.current) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    const currentBoundary = lastHoverBoundaryRef.current;
    if (sameHoverBoundary(currentBoundary, nextBoundary)) {
      if (hoverAxisSwitchTimerRef.current) {
        window.clearTimeout(hoverAxisSwitchTimerRef.current);
        hoverAxisSwitchTimerRef.current = null;
      }
      pendingHoverBoundaryRef.current = null;
      return;
    }

    // 가로/세로 hitbox가 겹치는 교차점에서는 먼저 잡은 축을 잠깐 유지한다.
    // 교차점을 통과하면 그대로 유지하고, 새 축 위에 머물 때만 전환한다.
    if (currentBoundary && nextBoundary && currentBoundary.type !== nextBoundary.type) {
      if (sameHoverBoundary(pendingHoverBoundaryRef.current, nextBoundary)) return;
      if (hoverAxisSwitchTimerRef.current) {
        window.clearTimeout(hoverAxisSwitchTimerRef.current);
      }
      pendingHoverBoundaryRef.current = nextBoundary;
      hoverAxisSwitchTimerRef.current = window.setTimeout(() => {
        const pendingBoundary = pendingHoverBoundaryRef.current;
        pendingHoverBoundaryRef.current = null;
        hoverAxisSwitchTimerRef.current = null;
        if (!pendingBoundary) return;
        lastHoverBoundaryRef.current = pendingBoundary;
        setHoverBoundary(pendingBoundary);
      }, HOVER_AXIS_SWITCH_DELAY_MS);
      return;
    }

    if (hoverAxisSwitchTimerRef.current) {
      window.clearTimeout(hoverAxisSwitchTimerRef.current);
      hoverAxisSwitchTimerRef.current = null;
    }
    pendingHoverBoundaryRef.current = null;
    lastHoverBoundaryRef.current = nextBoundary;
    setHoverBoundary(nextBoundary);
  };

  const clearHoverBoundarySoon = () => {
    if (hoverClearTimerRef.current) window.clearTimeout(hoverClearTimerRef.current);
    hoverClearTimerRef.current = window.setTimeout(() => {
      if (hoverAxisSwitchTimerRef.current) {
        window.clearTimeout(hoverAxisSwitchTimerRef.current);
        hoverAxisSwitchTimerRef.current = null;
      }
      pendingHoverBoundaryRef.current = null;
      lastHoverBoundaryRef.current = null;
      setHoverBoundary(null);
      hoverClearTimerRef.current = null;
    }, HOVER_CLEAR_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (hoverClearTimerRef.current) window.clearTimeout(hoverClearTimerRef.current);
      if (hoverAxisSwitchTimerRef.current) window.clearTimeout(hoverAxisSwitchTimerRef.current);
    },
    []
  );

  const stableResizeCursor =
    hoverBoundary?.type === "col"
      ? "col-resize"
      : hoverBoundary?.type === "row"
        ? "row-resize"
        : null;

  const renderCell = (cellData, row, col) => {
    if (coveredByMerge(row, col)) return null;

    const value = getCellText(cellData);
    const merge = mergeAt(row, col);
    const logicalRowSpan = merge?.rs || 1;
    const logicalColSpan = merge?.cs || 1;
    const start = cellStartX(row, col);
    const startY = cellStartY(row, col);
    const cellPixelWidth = cellWidth(row, col, logicalColSpan);
    const cellPixelHeight = cellHeight(row, col, logicalRowSpan);
    const selected = active && rangeVisible && isSelected(row, col);
    const style = getCellStyle(cellData);
    const textMetrics = fitCellTextMetrics(cellPixelWidth);
    const handlesVisible = active && showHandles;
    const handleHitboxStyle = { opacity: handlesVisible ? 1 : 0, pointerEvents: handlesVisible ? "auto" : "none" };

    return (
      <div
        key={makeKey(row, col)}
        className={["table-cell", row === 0 && "table-header-cell", selected && "selected"].filter(Boolean).join(" ")}
        style={{
          position: "absolute",
          left: start,
          top: startY,
          width: cellPixelWidth,
          height: cellPixelHeight,
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontWeight: style.bold ? 800 : undefined,
          fontStyle: style.italic ? "italic" : undefined,
        }}
        onMouseDown={(event) => startSelect(event, row, col)}
        onMouseEnter={() => extendSelect(row, col)}
      >
        <div
          className="cell-editor"
          style={{ justifyContent: justifyContentFromVAlign(style.vAlign) }}
        >
          <textarea
            rows={1}
            wrap="soft"
            ref={(node) => {
              const key = makeKey(row, col);
              if (node) {
                cellInputRefs.current.set(key, node);
              } else {
                cellInputRefs.current.delete(key);
              }
            }}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setCells((currentCells) =>
                currentCells.map((line, rowIndex) =>
                  rowIndex === row
                    ? line.map((cell, colIndex) =>
                        colIndex === col ? setCellText(cell, nextValue) : cell
                      )
                    : line
                )
              );
            }}
            onFocus={() => updateSelection(row, col, row, col)}
            style={{
              ...textMetrics,
              height: "100%",
              minHeight: 0,
              resize: "none",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              textAlign: textAlignFromHAlign(style.hAlign),
            }}
          />
        </div>
        <div
          className="resize-handle col-handle"
          onMouseEnter={(event) =>
            setStableHoverBoundary(makeColumnHoverBoundary(event, row, col + logicalColSpan - 1))
          }
          onMouseMove={(event) =>
            setStableHoverBoundary(makeColumnHoverBoundary(event, row, col + logicalColSpan - 1))
          }
          onMouseLeave={clearHoverBoundarySoon}
          onMouseDown={(event) => startDrag(event, "col", col + logicalColSpan - 1, row)}
          style={{
            ...handleHitboxStyle,
            width: HANDLE,
            cursor: stableResizeCursor || "col-resize",
          }}
        />
        <div
          className="resize-handle row-handle"
          // ⚠ 앵커 col도 colSpan 보정(col-handle의 rowSpan 보정과 대칭) — 세그먼트 메타가
          //   col+cs-1이라 미보정 시 병합 셀 아래 경계의 그룹 seed가 안 잡혀 표식이 실종된다
          onMouseEnter={(event) =>
            setStableHoverBoundary(makeRowHoverBoundary(event, row + logicalRowSpan - 1, col + logicalColSpan - 1))
          }
          onMouseMove={(event) =>
            setStableHoverBoundary(makeRowHoverBoundary(event, row + logicalRowSpan - 1, col + logicalColSpan - 1))
          }
          onMouseLeave={clearHoverBoundarySoon}
          onMouseDown={(event) => startDrag(event, "row", row + logicalRowSpan - 1, null, col + logicalColSpan - 1)}
          style={{
            ...handleHitboxStyle,
            height: HANDLE,
            cursor: stableResizeCursor || "row-resize",
          }}
        />
      </div>
    );
  };

  const getCellsForYRow = (yIndex) => {
    const items = [];

    cells.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (coveredByMerge(rowIndex, colIndex)) return;

        const startY = cellStartY(rowIndex, colIndex);
        const startYIdx = findYBoundaryIndex(startY);
        if (startYIdx !== yIndex) return;

        items.push({
          cell,
          rowIndex,
          colIndex,
          x: cellStartX(rowIndex, colIndex),
        });
      });
    });

    return items.sort((a, b) => a.x - b.x);
  };

  const canUndo = historyVersion > 1;
  const canRedo = redoRef.current.length > 0;

  // 비활성(객체 모드)에서도 마우스가 경계 근처를 지나면 행/열 통선 하이라이트를 켠다(요청 ③).
  // 활성일 땐 셀 안 핸들이 담당하므로 개입하지 않는다. 좌표→행/열은 그 행의 누적 폭·그 열의
  // 누적 높이(행별 widths 존중)로 계산 — hover 마커는 활성과 같은 그룹 파인더를 쓴다.
  const handleInactiveHoverMove = (event) => {
    if (active) return;
    const frame = event.currentTarget.querySelector(".table-frame");
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (px < -HANDLE || py < -HANDLE || px > rect.width + HANDLE || py > rect.height + HANDLE) {
      clearHoverBoundarySoon();
      return;
    }
    // 행 찾기(첫 열 세로 누적) → 그 행의 세로 경계 중 근접한 것
    let row = 0;
    for (let acc = 0; row < cellHeights.length - 1; row++) {
      acc += cellHeights[row]?.[0] ?? 0;
      if (py < acc) break;
    }
    let bestCol = -1;
    let bestColDist = HANDLE;
    let cx = 0;
    (widths[row] || []).forEach((w, i) => {
      cx += w;
      const d = Math.abs(px - cx);
      if (d < bestColDist) {
        bestColDist = d;
        bestCol = i;
      }
    });
    // 열 찾기(그 행 가로 누적) → 그 열의 가로 경계 중 근접한 것
    let col = 0;
    for (let ax = 0; col < (widths[row] || []).length - 1; col++) {
      ax += widths[row][col];
      if (px < ax) break;
    }
    let bestRow = -1;
    let bestRowDist = HANDLE;
    let cy = 0;
    cellHeights.forEach((r, i) => {
      cy += r?.[col] ?? 0;
      const d = Math.abs(py - cy);
      if (d < bestRowDist) {
        bestRowDist = d;
        bestRow = i;
      }
    });
    if (bestCol >= 0 && bestColDist <= bestRowDist) {
      setStableHoverBoundary(makeColumnHoverBoundary(event, row, bestCol));
    } else if (bestRow >= 0) {
      setStableHoverBoundary(makeRowHoverBoundary(event, bestRow, col));
    } else {
      clearHoverBoundarySoon();
    }
  };

  return (
    <div
      className={`tk-root${active ? " tk-active" : ""}`}
      style={themeVars}
      onMouseMove={active ? undefined : handleInactiveHoverMove}
      onMouseLeave={active ? undefined : clearHoverBoundarySoon}
      onMouseDown={(event) => {
        // 캔버스 배경 mousedown이 표 비활성화를 유발하므로 여기서 전파를 끊는다.
        event.stopPropagation();
        onActivate?.();
        const target = event.target;
        const isObjectControl = target instanceof Element && target.closest(".table-object-control");
        if (!active && !isObjectControl) onEnterEditing?.();
      }}
    >
      {active && (
        <>
          <PrimaryToolbar
            canRedo={canRedo}
            canUndo={canUndo}
            clearRange={clearRange}
            copyRange={copyRange}
            deleteSelectedCols={deleteSelectedCols}
            deleteSelectedRows={deleteSelectedRows}
            equalizeHeights={equalizeHeights}
            equalizeWidths={equalizeWidths}
            insertColRight={insertColRight}
            insertRowBelow={insertRowBelow}
            mergeSelection={mergeSelection}
            pasteAt={pasteAt}
            redo={redo}
            setShowHandles={setShowHandles}
            showHandles={showHandles}
            undo={undo}
            unmergeSelection={unmergeSelection}
          />
          <StyleToolbar
            applyStyle={applyStyle}
            setSplitCols={setSplitCols}
            setSplitRows={setSplitRows}
            splitCols={splitCols}
            splitRows={splitRows}
            splitSelection={splitSelection}
          />
        </>
      )}

      <TableCanvas
        activeBoundary={activeBoundary}
        boundarySegments={boundarySegments}
        getCellsForYRow={getCellsForYRow}
        hoverBoundary={hoverBoundary}
        outerResizeHandles={outerResizeHandles}
        renderCell={renderCell}
        rowGroupHeights={rowGroupHeights}
        showHandles={active && showHandles}
        startDrag={startDrag}
        totalHeight={totalHeight}
        totalWidth={totalWidth}
      />

      {active && (
        <div className="status-line">
          {Math.round(totalWidth)}×{Math.round(totalHeight)}px · 선택 R
          {(selectedRect?.r1 ?? 0) + 1}:C{(selectedRect?.c1 ?? 0) + 1}
          {saveMessage ? ` · ${saveMessage}` : ""}
        </div>
      )}
    </div>
  );
}


















