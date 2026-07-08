// table-king-Custom(github.com/kingwabg/table-king-Custom) App.jsx의 문서 블록 이식본.
// 엔진 로직(경계선·병합·나누기·클립보드·실행취소)은 원본 그대로 유지하고,
// 문서 편집기 통합을 위해 딱 세 가지만 바꿨다:
//  1. 진실은 문서 모델(doc) — 초기값은 value로 시드하고 모든 변경을 onChange로 올린다 (H4).
//     외부 교체(AI 적용 등)는 부모가 key를 바꿔 리마운트하는 방식으로 처리한다.
//  2. 한 문서에 표가 여러 개 공존하므로 전역 키보드 리스너는 active(선택된 표)일 때만 붙인다.
//  3. localStorage 저장/불러오기 제거 — 문서 저장이 표 저장을 대체한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableCanvas } from "./components/TableCanvas";
import { PrimaryToolbar, StyleToolbar } from "./components/Toolbars";
import { HANDLE, HISTORY_LIMIT, MIN_COL_W, MIN_ROW_H, STEP } from "./table/constants";
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
import {
  makeNormalColumnHeights,
  makeNormalInsertedColumnWidth,
  makeNormalInsertedRowHeights,
  makeNormalRowWidths,
} from "./table/normalDimensions";
import { useBoundaryDrag } from "./hooks/useBoundaryDrag";

// ── 문서 모델 브리지 ─────────────────────────────
// AI/템플릿의 rows(문자열 2D) → table-king 스냅샷.
// 열 너비: 표가 본문 폭(maxWidth)을 넘지 않는 선에서 균등 분배 (기존 makeTableData와 동일한 근거).
export const makeTableKingData = (rows, maxWidth = 620) => {
  const nCols = rows[0].length;
  const w = Math.max(MIN_COL_W + 20, Math.floor(Math.min(maxWidth, 620) / nCols));
  return {
    cells: rows.map((r) => r.map((t) => makeCell(t))),
    widths: rows.map(() => Array(nCols).fill(w)),
    cellHeights: rows.map(() => Array(nCols).fill(30)),
    merges: [],
  };
};

// table-king 스냅샷 → AI 컨텍스트용 rows(문자열 2D). 스타일·병합은 텍스트 직렬화에서 제외.
export const tableDataToRows = (data) => data.cells.map((row) => row.map(getCellText));

const BASE_CELL_FONT_SIZE = 13;
const MIN_CELL_FONT_SIZE = 8;

const measureTextUnits = (value) =>
  [...String(value || "")].reduce((sum, char) => {
    if (char === " ") return sum + 0.35;
    return sum + (char.charCodeAt(0) > 127 ? 1 : 0.62);
  }, 0);

const fitCellTextMetrics = (value, width, height) => {
  const paddingX = Math.max(2, Math.min(10, width * 0.12));
  const availableWidth = Math.max(1, width - paddingX * 2);
  const availableHeight = Math.max(1, height - 6);
  const textWidthAtBase = measureTextUnits(value) * BASE_CELL_FONT_SIZE;
  const widthFontSize =
    textWidthAtBase > availableWidth
      ? (BASE_CELL_FONT_SIZE * availableWidth) / textWidthAtBase
      : BASE_CELL_FONT_SIZE;
  const heightFontSize = Math.min(BASE_CELL_FONT_SIZE, availableHeight / 1.2);
  const fontSize = Math.max(
    MIN_CELL_FONT_SIZE,
    Math.min(BASE_CELL_FONT_SIZE, widthFontSize, heightFontSize)
  );

  return {
    fontSize: `${fontSize}px`,
    lineHeight: `${Math.max(MIN_CELL_FONT_SIZE, fontSize * 1.2)}px`,
    paddingInline: `${paddingX}px`,
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

export function TableKingBlock({
  value,
  onChange,
  active,
  onActivate,
  showHandles,
  setShowHandles,
  themeVars,
}) {
  // value는 마운트 시드로만 쓴다 — 이후 진실은 내부 상태이며 onChange로 문서에 반영된다.
  const [cells, setCells] = useState(() => normalizeCells(value.cells));
  const [widths, setWidths] = useState(() => value.widths.map((row) => [...row]));
  const [cellHeights, setCellHeights] = useState(() =>
    value.cellHeights.map((row) => [...row])
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

  const selectingRef = useRef(false);
  const clipRef = useRef(null);
  const cellsRef = useRef(cells);
  const selectionRef = useRef(selection);
  const mergesRef = useRef(merges);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const isRestoringRef = useRef(false);

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

  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }

    const serialized = JSON.stringify(makeSnapshot());
    const history = historyRef.current;
    if (history[history.length - 1] === serialized) return;

    history.push(serialized);
    if (history.length > HISTORY_LIMIT) history.shift();
    redoRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, [makeSnapshot]);

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

  const colGroupWidths = useMemo(() => sizesFromBoundaries(xs), [xs]);

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

  const { startDrag } = useBoundaryDrag({
    cellHeights,
    cells,
    merges,
    rowHeights,
    setActiveBoundary,
    setCellHeights,
    setHoverBoundary,
    setRowHeights,
    setSaveMessage,
    setWidths,
    widths,
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

  const findBoundaryIndex = useCallback(
    (value) => findNearestBoundaryIndex(xs, value),
    [xs]
  );

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

  const coveredByMerge = useCallback(
    (row, col) =>
      merges.find(
        (merge) =>
          row >= merge.r &&
          row < merge.r + merge.rs &&
          col >= merge.c &&
          col < merge.c + merge.cs &&
          !(row === merge.r && col === merge.c)
      ),
    [merges]
  );

  const mergeAt = useCallback(
    (row, col) => merges.find((merge) => merge.r === row && merge.c === col),
    [merges]
  );

  const updateSelection = (anchorRow, anchorCol, focusRow, focusCol) => {
    setSelection({ anchorRow, anchorCol, focusRow, focusCol });
  };

  const startSelect = (event, row, col) => {
    if (event.button !== 0) return;
    selectingRef.current = true;
    updateSelection(row, col, row, col);
  };

  const extendSelect = (row, col) => {
    if (!selectingRef.current) return;
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
        const each = Math.max(MIN_ROW_H, total / (rect.r2 - rect.r1 + 1));
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
            mode === "ctrl" || (rowIndex >= rect.r1 && rowIndex <= rect.r2);
          if (!shouldAffectRow) return line;

          const next = [...line];
          const col = rect.c2;
          if (mode === "ctrl" || col === next.length - 1) {
            next[col] = Math.max(MIN_COL_W, next[col] + step);
            return next;
          }

          const grow = Math.min(
            Math.max(MIN_COL_W, next[col] + step) - next[col],
            next[col + 1] - MIN_COL_W
          );
          next[col] += grow;
          next[col + 1] -= grow;
          return next;
        })
      );
    },
    [expandRect]
  );

  const nudgeHeight = useCallback(
    (mode, step) => {
      const rect = expandRect(rectFromSelection(selectionRef.current));
      if (!rect) return;

      setCellHeights((currentHeights) =>
        currentHeights.map((line, rowIndex) => {
          const next = [...line];
          const shouldAffectCol = (colIndex) =>
            mode === "ctrl" || (colIndex >= rect.c1 && colIndex <= rect.c2);

          if (rowIndex === rect.r2) {
            next.forEach((height, colIndex) => {
              if (!shouldAffectCol(colIndex)) return;
              if (mode === "ctrl" || rowIndex === currentHeights.length - 1) {
                next[colIndex] = Math.max(MIN_ROW_H, height + step);
              } else {
                const bottom = currentHeights[rowIndex + 1][colIndex];
                const grow = Math.min(
                  Math.max(MIN_ROW_H, height + step) - height,
                  bottom - MIN_ROW_H
                );
                next[colIndex] += grow;
              }
            });
          }

          if (mode !== "ctrl" && rowIndex === rect.r2 + 1) {
            next.forEach((height, colIndex) => {
              if (!shouldAffectCol(colIndex)) return;
              const top = currentHeights[rect.r2][colIndex];
              const grow = Math.min(
                Math.max(MIN_ROW_H, top + step) - top,
                height - MIN_ROW_H
              );
              next[colIndex] -= grow;
            });
          }

          return next;
        })
      );
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

    for (let row = 0; row < oldRows; row += 1) {
      const splitRowCount = rowMultiplier(row);
      const splitWidthLines = Array.from({ length: splitRowCount }, () => []);
      const splitHeightLines = Array.from({ length: splitRowCount }, () => []);

      for (let col = 0; col < oldCols; col += 1) {
        const splitColCount = colMultiplier(col);
        const splitWidth = widths[row][col] / splitColCount;
        const splitHeight = cellHeights[row][col] / splitRowCount;

        for (let addRow = 0; addRow < splitRowCount; addRow += 1) {
          for (let addCol = 0; addCol < splitColCount; addCol += 1) {
            splitWidthLines[addRow].push(splitWidth);
            splitHeightLines[addRow].push(splitHeight);
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
      const tagName = event.target.tagName;
      const isTextEditing = tagName === "INPUT" || tagName === "TEXTAREA";
      const isCtrlShiftArrow =
        event.ctrlKey && event.shiftKey && event.key.startsWith("Arrow");
      if (isTextEditing && !isCtrlShiftArrow) return;

      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && key === "y") {
        event.preventDefault();
        redo();
      } else if ((event.metaKey || event.ctrlKey) && key === "c") {
        event.preventDefault();
        copyRange(false);
      } else if ((event.metaKey || event.ctrlKey) && key === "x") {
        event.preventDefault();
        copyRange(true);
      } else if ((event.metaKey || event.ctrlKey) && key === "v") {
        event.preventDefault();
        pasteAt();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        clearRange();
      } else if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("shift", STEP);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("shift", -STEP);
      } else if ((event.altKey || event.metaKey) && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("alt", STEP);
      } else if ((event.altKey || event.metaKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("alt", -STEP);
      } else if (event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        nudgeWidth("ctrl", STEP);
      } else if (event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeWidth("ctrl", -STEP);
      } else if ((event.shiftKey || event.altKey || event.metaKey) && event.key === "ArrowDown") {
        event.preventDefault();
        nudgeHeight("shift", STEP);
      } else if ((event.shiftKey || event.altKey || event.metaKey) && event.key === "ArrowUp") {
        event.preventDefault();
        nudgeHeight("shift", -STEP);
      } else if (event.ctrlKey && event.key === "ArrowDown") {
        event.preventDefault();
        nudgeHeight("ctrl", STEP);
      } else if (event.ctrlKey && event.key === "ArrowUp") {
        event.preventDefault();
        nudgeHeight("ctrl", -STEP);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, clearRange, copyRange, nudgeHeight, nudgeWidth, pasteAt, redo, undo]);

  const renderCell = (cellData, row, col) => {
    if (coveredByMerge(row, col)) return null;

    const value = getCellText(cellData);
    const merge = mergeAt(row, col);
    const logicalRowSpan = merge?.rs || 1;
    const logicalColSpan = merge?.cs || 1;
    const start = cellStartX(row, col);
    const end = start + cellWidth(row, col, logicalColSpan);
    const startIdx = findBoundaryIndex(start);
    const endIdx = findBoundaryIndex(end);
    const htmlColSpan = Math.max(1, endIdx - startIdx);
    const startY = cellStartY(row, col);
    const cellPixelWidth = cellWidth(row, col, logicalColSpan);
    const cellPixelHeight = cellHeight(row, col, logicalRowSpan);
    const endY = startY + cellPixelHeight;
    const startYIdx = findYBoundaryIndex(startY);
    const endYIdx = findYBoundaryIndex(endY);
    const htmlRowSpan = Math.max(1, endYIdx - startYIdx);
    const selected = active && isSelected(row, col);
    const style = getCellStyle(cellData);
    const Cell = row === 0 ? "th" : "td";
    const textMetrics = fitCellTextMetrics(value, cellPixelWidth, cellPixelHeight);
    const handlesVisible = active && showHandles;

    return (
      <Cell
        key={makeKey(row, col)}
        className={selected ? "selected" : ""}
        rowSpan={htmlRowSpan}
        colSpan={htmlColSpan}
        style={{
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
          <input
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
              textAlign: textAlignFromHAlign(style.hAlign),
            }}
          />
        </div>
        <div
          className="resize-handle col-handle"
          onMouseEnter={() =>
            setHoverBoundary({
              type: "col",
              items: [{ row, boundaryIndex: col + logicalColSpan - 1 }],
            })
          }
          onMouseLeave={() => setHoverBoundary(null)}
          onMouseDown={(event) => startDrag(event, "col", col + logicalColSpan - 1, row)}
          style={{ opacity: handlesVisible ? 1 : 0, width: HANDLE }}
        />
        <div
          className="resize-handle row-handle"
          onMouseEnter={() =>
            setHoverBoundary({
              type: "row",
              items: [{ boundaryIndex: row + logicalRowSpan - 1, col }],
            })
          }
          onMouseLeave={() => setHoverBoundary(null)}
          onMouseDown={(event) => startDrag(event, "row", row + logicalRowSpan - 1, null, col)}
          style={{ opacity: handlesVisible ? 1 : 0, height: HANDLE }}
        />
      </Cell>
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

  return (
    <div
      className={`tk-root${active ? " tk-active" : ""}`}
      style={themeVars}
      onMouseDown={(event) => {
        // 캔버스 배경 mousedown이 표 비활성화를 유발하므로 여기서 전파를 끊는다.
        event.stopPropagation();
        onActivate?.();
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
        colGroupWidths={colGroupWidths}
        getCellsForYRow={getCellsForYRow}
        hoverBoundary={hoverBoundary}
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
