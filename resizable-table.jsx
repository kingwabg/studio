import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// 설정값
// ─────────────────────────────────────────────
const MIN_COL_W = 30;
const MIN_ROW_H = 24;
const HANDLE = 6;
const STEP = 5; // 방향키 미세조정 단위(px)
const EPS = 0.6; // 세로 경계선을 같은 선으로 볼 허용 오차(px)

const HEADERS = ["캐릭터", "방향", "프레임 수", "상태"];
const ROWS = [
  ["슬라임", "8방향", "6", "대기"],
  ["기사", "8방향", "8", "이동"],
  ["마법사", "4방향", "4", "공격"],
  ["궁수", "8방향", "6", "대기"],
];

const BG_SWATCHES = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];
const TEXT_SWATCHES = ["#0f172a", "#dc2626", "#2563eb", "#16a34a"];

export default function ResizableTable() {
  // ── 크기 상태 ──
  // widths[r][c]: 행마다 독립적인 셀 너비 (한글처럼 세로 선이 어긋날 수 있음)
  const [widths, setWidths] = useState(() =>
    Array.from({ length: ROWS.length + 1 }, () => [120, 100, 100, 100])
  );
  const [rowHeights, setRowHeights] = useState(
    Array(ROWS.length + 1).fill(40)
  );
  const [showHandles, setShowHandles] = useState(true);

  // ── 데이터 / 스타일 / 병합 / 선택 상태 ──
  const [cells, setCells] = useState([HEADERS, ...ROWS]);
  const [cellStyles, setCellStyles] = useState({});
  const [merges, setMerges] = useState([]); // {r, c, rs, cs}
  const [sel, setSel] = useState(null); // {ar, ac, fr, fc}
  const [editing, setEditing] = useState(null);
  const [splitDialog, setSplitDialog] = useState(null);

  const dragRef = useRef(null);
  const selectingRef = useRef(false);
  const clipRef = useRef(null);
  const cellsRef = useRef(cells);
  const selRef = useRef(sel);
  const mergesRef = useRef(merges);
  cellsRef.current = cells;
  selRef.current = sel;
  mergesRef.current = merges;

  const numRows = cells.length;
  const numCols = cells[0].length;

  // ─────────────────────────────────────────
  // 서브 컬럼 격자: 모든 행의 세로 경계선(x좌표)을 모아
  // 하나의 <colgroup>을 만들고 각 셀은 colSpan으로 자기 구간을 차지
  // ─────────────────────────────────────────
  const xs = useMemo(() => {
    const raw = [0];
    for (const rowW of widths) {
      let acc = 0;
      for (const w of rowW) {
        acc += w;
        raw.push(acc);
      }
    }
    raw.sort((a, b) => a - b);
    // EPS 이내의 경계선은 같은 선으로 병합
    const out = [raw[0]];
    for (const v of raw) {
      if (v - out[out.length - 1] > EPS) out.push(v);
    }
    return out;
  }, [widths]);

  const findIdx = useCallback(
    (v) => {
      // v와 가장 가까운 경계선 인덱스 (EPS 허용)
      let lo = 0,
        hi = xs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < v - EPS) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [xs]
  );

  // ── useMemo: 경계선 마지막 값 = 표 전체 너비 / 높이 합산 ──
  const totalWidth = useMemo(() => xs[xs.length - 1], [xs]);
  const totalHeight = useMemo(
    () => rowHeights.reduce((s, h) => s + h, 0),
    [rowHeights]
  );

  // 행 r에서 논리 열 c의 시작 x좌표
  const cellStartX = useCallback(
    (r, c) => {
      let acc = 0;
      for (let i = 0; i < c; i++) acc += widths[r][i];
      return acc;
    },
    [widths]
  );

  // ─────────────────────────────────────────
  // 선택 범위 유틸
  // ─────────────────────────────────────────
  const normRect = (s) =>
    s && {
      r1: Math.min(s.ar, s.fr),
      c1: Math.min(s.ac, s.fc),
      r2: Math.max(s.ar, s.fr),
      c2: Math.max(s.ac, s.fc),
    };

  const expandRect = useCallback((rect, mergeList) => {
    if (!rect) return null;
    let { r1, c1, r2, c2 } = rect;
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of mergeList) {
        const mr2 = m.r + m.rs - 1;
        const mc2 = m.c + m.cs - 1;
        if (m.r <= r2 && mr2 >= r1 && m.c <= c2 && mc2 >= c1) {
          if (m.r < r1) (r1 = m.r), (changed = true);
          if (m.c < c1) (c1 = m.c), (changed = true);
          if (mr2 > r2) (r2 = mr2), (changed = true);
          if (mc2 > c2) (c2 = mc2), (changed = true);
        }
      }
    }
    return { r1, c1, r2, c2 };
  }, []);

  const selRect = useMemo(
    () => expandRect(normRect(sel), merges),
    [sel, merges, expandRect]
  );

  const isSelected = (r, c) =>
    selRect &&
    r >= selRect.r1 &&
    r <= selRect.r2 &&
    c >= selRect.c1 &&
    c <= selRect.c2;

  const coveredBy = (r, c) =>
    merges.find(
      (m) =>
        !(m.r === r && m.c === c) &&
        r >= m.r &&
        r < m.r + m.rs &&
        c >= m.c &&
        c < m.c + m.cs
    );

  const mergeAnchorAt = (r, c) => merges.find((m) => m.r === r && m.c === c);

  // ─────────────────────────────────────────
  // 크기 조절 (열 / 행 / 대각선 드래그)
  // ─────────────────────────────────────────
  const startDrag = useCallback((e, type, index) => {
    e.preventDefault();
    e.stopPropagation();
    const isCol = type === "col";
    const isDiag = type === "diag";
    dragRef.current = {
      type,
      index,
      startX: e.clientX,
      startY: e.clientY,
      startWidths: null,
      startRows: null,
      startSize: undefined,
    };
    setWidths((w) => {
      if (isCol || isDiag)
        dragRef.current.startWidths = w.map((row) => [...row]);
      return w;
    });
    setRowHeights((rh) => {
      if (type === "row") dragRef.current.startSize = rh[index];
      if (isDiag) dragRef.current.startRows = [...rh];
      return rh;
    });

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (d.type === "col") {
        // 해당 논리 열의 세로 선을 모든 행에서 평행 이동 (표 전체 크기 변화)
        setWidths(
          d.startWidths.map((row) => {
            const next = [...row];
            next[d.index] = Math.max(MIN_COL_W, row[d.index] + dx);
            return next;
          })
        );
      } else if (d.type === "row") {
        setRowHeights((rh) => {
          const next = [...rh];
          next[d.index] = Math.max(MIN_ROW_H, d.startSize + dy);
          return next;
        });
      } else if (d.type === "diag") {
        const nCols = d.startWidths[0].length;
        const perCol = dx / nCols;
        const perRow = dy / d.startRows.length;
        setWidths(
          d.startWidths.map((row) =>
            row.map((w) => Math.max(MIN_COL_W, w + perCol))
          )
        );
        setRowHeights(d.startRows.map((h) => Math.max(MIN_ROW_H, h + perRow)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = isCol
      ? "col-resize"
      : isDiag
      ? "nwse-resize"
      : "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  // ─────────────────────────────────────────
  // 셀 선택
  // ─────────────────────────────────────────
  const onCellMouseDown = (e, r, c) => {
    if (e.button !== 0) return;
    selectingRef.current = true;
    setEditing(null);
    setSel({ ar: r, ac: c, fr: r, fc: c });
  };
  const onCellMouseEnter = (r, c) => {
    if (!selectingRef.current) return;
    setSel((s) => (s ? { ...s, fr: r, fc: c } : s));
  };
  useEffect(() => {
    const up = () => (selectingRef.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ─────────────────────────────────────────
  // 지우기 / 복사 / 잘라내기 / 붙여넣기
  // ─────────────────────────────────────────
  const clearRange = useCallback((rect) => {
    if (!rect) return;
    setCells((prev) =>
      prev.map((row, r) =>
        row.map((t, c) =>
          r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2
            ? ""
            : t
        )
      )
    );
  }, []);

  const copyRange = useCallback(
    (cut) => {
      const rect = expandRect(normRect(selRef.current), mergesRef.current);
      if (!rect) return;
      const data = [];
      for (let r = rect.r1; r <= rect.r2; r++) {
        const row = [];
        for (let c = rect.c1; c <= rect.c2; c++)
          row.push(cellsRef.current[r][c]);
        data.push(row);
      }
      clipRef.current = { data, cut, rect };
      try {
        navigator.clipboard?.writeText(
          data.map((row) => row.join("\t")).join("\n")
        );
      } catch {}
    },
    [expandRect]
  );

  const pasteAt = useCallback(() => {
    const clip = clipRef.current;
    const s = selRef.current;
    if (!clip || !s) return;
    const start = { r: Math.min(s.ar, s.fr), c: Math.min(s.ac, s.fc) };
    setCells((prev) => {
      const next = prev.map((row) => [...row]);
      if (clip.cut) {
        const { r1, c1, r2, c2 } = clip.rect;
        for (let r = r1; r <= r2; r++)
          for (let c = c1; c <= c2; c++) next[r][c] = "";
      }
      clip.data.forEach((row, dr) =>
        row.forEach((t, dc) => {
          const r = start.r + dr;
          const c = start.c + dc;
          if (r < next.length && c < next[0].length) next[r][c] = t;
        })
      );
      return next;
    });
    if (clip.cut) clipRef.current = { ...clip, cut: false };
  }, []);

  // ─────────────────────────────────────────
  // W: 셀 너비 같게 — 한글처럼 "드래그한 행들"에만 적용
  // 각 행에서 선택 열들의 총너비를 유지한 채 1/N 균등 분할.
  // 일부 행만 선택하면 그 행들만 바뀌어 세로 선이 어긋난다.
  // ─────────────────────────────────────────
  const equalizeWidths = useCallback(() => {
    const rect = expandRect(normRect(selRef.current), mergesRef.current);
    if (!rect || rect.c1 === rect.c2) return;
    setWidths((prev) =>
      prev.map((row, r) => {
        if (r < rect.r1 || r > rect.r2) return row; // 선택 밖 행은 그대로
        const next = [...row];
        let total = 0;
        for (let c = rect.c1; c <= rect.c2; c++) total += row[c];
        const each = total / (rect.c2 - rect.c1 + 1);
        for (let c = rect.c1; c <= rect.c2; c++) next[c] = each;
        return next;
      })
    );
  }, [expandRect]);

  // H: 셀 높이 같게 — 선택된 행들의 높이 합 유지, 균등 분배
  const equalizeHeights = useCallback(() => {
    const rect = expandRect(normRect(selRef.current), mergesRef.current);
    if (!rect || rect.r1 === rect.r2) return;
    setRowHeights((prev) => {
      const next = [...prev];
      let total = 0;
      for (let r = rect.r1; r <= rect.r2; r++) total += prev[r];
      const each = total / (rect.r2 - rect.r1 + 1);
      for (let r = rect.r1; r <= rect.r2; r++) next[r] = each;
      return next;
    });
  }, [expandRect]);

  // ─────────────────────────────────────────
  // Shift / Alt / Ctrl + 방향키 미세조정 (한글 방식)
  //  · Shift+←→ : 선택한 칸(행)만 오른쪽 경계선 이동, 옆 칸이 보정 → 표 크기 불변
  //  · Alt+←→   : 그 세로 선 전체(모든 행)가 이동, 옆 칸 보정 → 표 크기 불변
  //  · Ctrl+←→  : 선택 열이 늘어나며 표 전체가 커짐/작아짐
  //  · ↑↓는 행 높이에 동일 원리 적용 (Shift는 Alt와 동일하게 동작)
  // ─────────────────────────────────────────
  const nudgeWidth = useCallback(
    (mode, step) => {
      const rect = expandRect(normRect(selRef.current), mergesRef.current);
      if (!rect) return;
      const cEdge = rect.c2; // 이동시킬 세로 선 = 선택 범위의 오른쪽 경계
      setWidths((prev) => {
        const nCols = prev[0].length;
        const hasNeighbor = cEdge + 1 < nCols;
        return prev.map((row, r) => {
          const inRows = r >= rect.r1 && r <= rect.r2;
          const apply =
            mode === "shift" ? inRows : true; // alt/ctrl은 모든 행
          if (!apply) return row;
          const next = [...row];
          if (mode === "ctrl") {
            // 표가 함께 커짐: 보정 없음
            next[cEdge] = Math.max(MIN_COL_W, row[cEdge] + step);
          } else {
            // shift/alt: 옆 칸이 보정 → 표 크기 불변
            if (!hasNeighbor) return row;
            const grow = Math.min(
              Math.max(MIN_COL_W, row[cEdge] + step) - row[cEdge],
              row[cEdge + 1] - MIN_COL_W
            );
            next[cEdge] = row[cEdge] + grow;
            next[cEdge + 1] = row[cEdge + 1] - grow;
          }
          return next;
        });
      });
    },
    [expandRect]
  );

  const nudgeHeight = useCallback(
    (mode, step) => {
      const rect = expandRect(normRect(selRef.current), mergesRef.current);
      if (!rect) return;
      const rEdge = rect.r2;
      setRowHeights((prev) => {
        const next = [...prev];
        if (mode === "ctrl") {
          next[rEdge] = Math.max(MIN_ROW_H, prev[rEdge] + step);
        } else {
          if (rEdge + 1 >= prev.length) return prev;
          const grow = Math.min(
            Math.max(MIN_ROW_H, prev[rEdge] + step) - prev[rEdge],
            prev[rEdge + 1] - MIN_ROW_H
          );
          next[rEdge] = prev[rEdge] + grow;
          next[rEdge + 1] = prev[rEdge + 1] - grow;
        }
        return next;
      });
    },
    [expandRect]
  );

  // ─────────────────────────────────────────
  // S: 셀 나누기 — 선택된 각 셀을 m줄 × n칸으로 분할
  // ─────────────────────────────────────────
  const doSplit = (mRows, nCols) => {
    if (!selRect) return;
    const m = Math.max(1, Math.floor(mRows));
    const n = Math.max(1, Math.floor(nCols));
    setSplitDialog(null);
    if (m === 1 && n === 1) return;

    const { r1, c1, r2, c2 } = selRect;
    const oldRows = cells.length;
    const oldCols = cells[0].length;
    const rowMul = (r) => (r >= r1 && r <= r2 ? m : 1);
    const colMul = (c) => (c >= c1 && c <= c2 ? n : 1);

    const rowStart = [];
    let acc = 0;
    for (let r = 0; r < oldRows; r++) {
      rowStart[r] = acc;
      acc += rowMul(r);
    }
    const newNumRows = acc;
    const colStart = [];
    acc = 0;
    for (let c = 0; c < oldCols; c++) {
      colStart[c] = acc;
      acc += colMul(c);
    }
    const newNumCols = acc;

    const insideSel = (r, c) => r >= r1 && r <= r2 && c >= c1 && c <= c2;

    const keptMerges = merges.filter(
      (mg) =>
        !(
          mg.r >= r1 &&
          mg.r + mg.rs - 1 <= r2 &&
          mg.c >= c1 &&
          mg.c + mg.cs - 1 <= c2
        )
    );
    const newMerges = keptMerges.map((mg) => {
      const nr = rowStart[mg.r];
      const endR = mg.r + mg.rs;
      const nrEnd = endR < oldRows ? rowStart[endR] : newNumRows;
      const nc = colStart[mg.c];
      const endC = mg.c + mg.cs;
      const ncEnd = endC < oldCols ? colStart[endC] : newNumCols;
      return { r: nr, c: nc, rs: nrEnd - nr, cs: ncEnd - nc };
    });

    const newCells = Array.from({ length: newNumRows }, () =>
      Array(newNumCols).fill("")
    );
    const newStyles = {};

    for (let r = 0; r < oldRows; r++) {
      for (let c = 0; c < oldCols; c++) {
        const nr = rowStart[r];
        const nc = colStart[c];
        newCells[nr][nc] = cells[r][c];
        const st = cellStyles[`${r}-${c}`];
        if (st) {
          for (let dr = 0; dr < rowMul(r); dr++)
            for (let dc = 0; dc < colMul(c); dc++)
              newStyles[`${nr + dr}-${nc + dc}`] = { ...st };
        }
        if (
          !insideSel(r, c) &&
          !coveredBy(r, c) &&
          !mergeAnchorAt(r, c) &&
          (rowMul(r) > 1 || colMul(c) > 1)
        ) {
          newMerges.push({ r: nr, c: nc, rs: rowMul(r), cs: colMul(c) });
        }
      }
    }

    // 행별 너비 / 행 높이도 분할
    const newWidths = [];
    for (let r = 0; r < oldRows; r++) {
      const rowW = [];
      for (let c = 0; c < oldCols; c++) {
        const k = colMul(c);
        for (let i = 0; i < k; i++) rowW.push(widths[r][c] / k);
      }
      for (let i = 0; i < rowMul(r); i++) newWidths.push([...rowW]);
    }
    const newRowHeights = [];
    for (let r = 0; r < oldRows; r++) {
      const k = rowMul(r);
      for (let i = 0; i < k; i++) newRowHeights.push(rowHeights[r] / k);
    }

    setCells(newCells);
    setCellStyles(newStyles);
    setMerges(newMerges);
    setWidths(newWidths);
    setRowHeights(newRowHeights);
    setSel({
      ar: rowStart[r1],
      ac: colStart[c1],
      fr: rowStart[r2] + rowMul(r2) - 1,
      fc: colStart[c2] + colMul(c2) - 1,
    });
  };

  // ─────────────────────────────────────────
  // 키보드 단축키
  // ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (editing || splitDialog) return;
      const s = selRef.current;
      if (!s) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const arrow = ["arrowleft", "arrowright", "arrowup", "arrowdown"];

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        clearRange(expandRect(normRect(s), mergesRef.current));
      } else if (mod && key === "c") {
        copyRange(false);
      } else if (mod && key === "x") {
        copyRange(true);
      } else if (mod && key === "v") {
        e.preventDefault();
        pasteAt();
      } else if (!mod && key === "s") {
        e.preventDefault();
        setSplitDialog({ rows: 2, cols: 2 });
      } else if (!mod && key === "w") {
        e.preventDefault();
        equalizeWidths();
      } else if (!mod && key === "h") {
        e.preventDefault();
        equalizeHeights();
      } else if (arrow.includes(key) && (e.shiftKey || e.altKey || mod)) {
        e.preventDefault();
        const mode = e.shiftKey ? "shift" : e.altKey ? "alt" : "ctrl";
        if (key === "arrowleft") nudgeWidth(mode, -STEP);
        else if (key === "arrowright") nudgeWidth(mode, STEP);
        else if (key === "arrowup")
          nudgeHeight(mode === "shift" ? "alt" : mode, -STEP);
        else if (key === "arrowdown")
          nudgeHeight(mode === "shift" ? "alt" : mode, STEP);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editing,
    splitDialog,
    clearRange,
    copyRange,
    pasteAt,
    expandRect,
    equalizeWidths,
    equalizeHeights,
    nudgeWidth,
    nudgeHeight,
  ]);

  // ─────────────────────────────────────────
  // 셀 병합 / 해제
  // ─────────────────────────────────────────
  const canMerge =
    selRect && (selRect.r1 !== selRect.r2 || selRect.c1 !== selRect.c2);
  const hasMergeInSel =
    selRect &&
    merges.some(
      (m) =>
        m.r <= selRect.r2 &&
        m.r + m.rs - 1 >= selRect.r1 &&
        m.c <= selRect.c2 &&
        m.c + m.cs - 1 >= selRect.c1
    );

  const mergeSelection = () => {
    if (!canMerge) return;
    const { r1, c1, r2, c2 } = selRect;
    // 병합될 열들의 세로 선을 첫 행 기준으로 정렬(너비 통일)
    setWidths((prev) => {
      const template = prev[r1].slice(c1, c2 + 1);
      return prev.map((row, r) => {
        if (r < r1 || r > r2) return row;
        const next = [...row];
        for (let c = c1; c <= c2; c++) next[c] = template[c - c1];
        return next;
      });
    });
    setMerges((prev) => [
      ...prev.filter(
        (m) =>
          !(
            m.r >= r1 &&
            m.r + m.rs - 1 <= r2 &&
            m.c >= c1 &&
            m.c + m.cs - 1 <= c2
          )
      ),
      { r: r1, c: c1, rs: r2 - r1 + 1, cs: c2 - c1 + 1 },
    ]);
    setCells((prev) =>
      prev.map((row, r) =>
        row.map((t, c) =>
          r >= r1 && r <= r2 && c >= c1 && c <= c2 && !(r === r1 && c === c1)
            ? ""
            : t
        )
      )
    );
  };

  const unmergeSelection = () => {
    if (!selRect) return;
    setMerges((prev) =>
      prev.filter(
        (m) =>
          !(
            m.r <= selRect.r2 &&
            m.r + m.rs - 1 >= selRect.r1 &&
            m.c <= selRect.c2 &&
            m.c + m.cs - 1 >= selRect.c1
          )
      )
    );
  };

  // ─────────────────────────────────────────
  // 스타일 일괄 적용
  // ─────────────────────────────────────────
  const applyStyle = (patch) => {
    if (!selRect) return;
    setCellStyles((prev) => {
      const next = { ...prev };
      for (let r = selRect.r1; r <= selRect.r2; r++)
        for (let c = selRect.c1; c <= selRect.c2; c++) {
          const key = `${r}-${c}`;
          next[key] = { ...next[key], ...patch };
        }
      return next;
    });
  };
  const toggleBold = () => {
    if (!selRect) return;
    const key = `${selRect.r1}-${selRect.c1}`;
    const cur = cellStyles[key]?.fontWeight === 700;
    applyStyle({ fontWeight: cur ? 400 : 700 });
  };
  const clearStyles = () => {
    if (!selRect) return;
    setCellStyles((prev) => {
      const next = { ...prev };
      for (let r = selRect.r1; r <= selRect.r2; r++)
        for (let c = selRect.c1; c <= selRect.c2; c++)
          delete next[`${r}-${c}`];
      return next;
    });
  };

  // ─────────────────────────────────────────
  // 편집
  // ─────────────────────────────────────────
  const commitEdit = (r, c, value) => {
    setCells((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = value;
      return next;
    });
    setEditing(null);
  };

  // ─────────────────────────────────────────
  // 공통 UI
  // ─────────────────────────────────────────
  const handleStyle = (visible) => ({
    position: "absolute",
    background: visible ? "rgba(59,130,246,0.35)" : "transparent",
    zIndex: 10,
    transition: "background 0.15s",
  });

  const btn =
    "px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-300 bg-white hover:bg-slate-100 active:scale-95 transition disabled:opacity-40 disabled:pointer-events-none";

  const renderResizeHandles = (rEnd, cEnd) => (
    <>
      <div
        onMouseDown={(e) => startDrag(e, "col", cEnd)}
        style={{
          ...handleStyle(showHandles),
          top: 0,
          right: 0,
          width: HANDLE,
          height: "100%",
          cursor: "col-resize",
        }}
      />
      <div
        onMouseDown={(e) => startDrag(e, "row", rEnd)}
        style={{
          ...handleStyle(showHandles),
          left: 0,
          bottom: 0,
          width: "100%",
          height: HANDLE,
          cursor: "row-resize",
        }}
      />
    </>
  );

  const selCount = selRect
    ? (selRect.r2 - selRect.r1 + 1) * (selRect.c2 - selRect.c1 + 1)
    : 0;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-start py-8 px-8 font-sans">
      <h1 className="text-xl font-bold text-slate-800 mb-1">
        한글(HWP) 스타일 표 편집기
      </h1>
      <p className="text-sm text-slate-500 mb-1">
        드래그 선택 · Delete 지우기 · Ctrl+C/X/V · <b>S</b> 나누기 · <b>W</b>{" "}
        너비 같게(선택 행만) · <b>H</b> 높이 같게 · 더블클릭 편집
      </p>
      <p className="text-xs text-slate-400 mb-3">
        미세조정: <b>Shift</b>+←→ 그 칸만 · <b>Alt</b>+←→ 세로 선 전체(표 크기
        고정) · <b>Ctrl</b>+←→ 표와 함께 확대 · ↑↓는 행 높이
      </p>

      {/* ── 툴바 ── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4 p-2 rounded-lg bg-white border border-slate-200 shadow-sm">
        <button className={btn} onClick={() => setShowHandles((v) => !v)}>
          핸들 {showHandles ? "숨기기" : "보이기"}
        </button>
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button className={btn} disabled={!canMerge} onClick={mergeSelection}>
          셀 합치기
        </button>
        <button
          className={btn}
          disabled={!hasMergeInSel}
          onClick={unmergeSelection}
        >
          병합 해제
        </button>
        <button
          className={btn}
          disabled={!selRect}
          onClick={() => setSplitDialog({ rows: 2, cols: 2 })}
        >
          셀 나누기 (S)
        </button>
        <button
          className={btn}
          disabled={!selRect || selRect.c1 === selRect.c2}
          onClick={equalizeWidths}
        >
          너비 같게 (W)
        </button>
        <button
          className={btn}
          disabled={!selRect || selRect.r1 === selRect.r2}
          onClick={equalizeHeights}
        >
          높이 같게 (H)
        </button>
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button
          className={btn + " font-bold"}
          disabled={!selRect}
          onClick={toggleBold}
        >
          B
        </button>
        <button
          className={btn}
          disabled={!selRect}
          onClick={() => applyStyle({ textAlign: "left" })}
        >
          ⯇
        </button>
        <button
          className={btn}
          disabled={!selRect}
          onClick={() => applyStyle({ textAlign: "center" })}
        >
          ⯀
        </button>
        <button
          className={btn}
          disabled={!selRect}
          onClick={() => applyStyle({ textAlign: "right" })}
        >
          ⯈
        </button>
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <span className="text-[11px] text-slate-400">글자</span>
        {TEXT_SWATCHES.map((color) => (
          <button
            key={color}
            disabled={!selRect}
            onClick={() => applyStyle({ color })}
            className="w-5 h-5 rounded border border-slate-300 disabled:opacity-40"
            style={{ background: color }}
            title={`글자색 ${color}`}
          />
        ))}
        <span className="text-[11px] text-slate-400 ml-1">배경</span>
        {BG_SWATCHES.map((color, i) => (
          <button
            key={i}
            disabled={!selRect}
            onClick={() => applyStyle({ background: color })}
            className="w-5 h-5 rounded border border-slate-300 disabled:opacity-40"
            style={{
              background:
                color ||
                "repeating-linear-gradient(45deg,#fff,#fff 3px,#e2e8f0 3px,#e2e8f0 6px)",
            }}
            title={color ? `배경색 ${color}` : "배경 없음"}
          />
        ))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button className={btn} disabled={!selRect} onClick={clearStyles}>
          서식 지우기
        </button>
      </div>

      {/* ── 래퍼 div: 경계선 격자 기반 크기와 동기화 ── */}
      <div
        style={{
          position: "relative",
          width: totalWidth,
          height: totalHeight,
          boxSizing: "border-box",
          border: "2px solid #1e293b",
          borderRadius: 8,
          overflow: "hidden",
          background: "white",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        }}
      >
        <div
          onMouseDown={(e) => startDrag(e, "diag")}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            zIndex: 20,
            background: showHandles
              ? "linear-gradient(135deg, transparent 50%, rgba(59,130,246,0.7) 50%)"
              : "transparent",
            transition: "background 0.15s",
          }}
        />

        <table
          style={{
            tableLayout: "fixed",
            borderCollapse: "collapse",
            width: totalWidth,
            height: totalHeight,
            userSelect: "none",
          }}
        >
          {/* 서브 컬럼 격자: 모든 행의 경계선 위치를 합친 것 */}
          <colgroup>
            {xs.slice(1).map((x, i) => (
              <col key={i} style={{ width: x - xs[i] }} />
            ))}
          </colgroup>
          <tbody>
            {cells.map((row, r) => (
              <tr key={r} style={{ height: rowHeights[r] }}>
                {row.map((text, c) => {
                  if (coveredBy(r, c)) return null;
                  const m = mergeAnchorAt(r, c);
                  const isHeader = r === 0;
                  const st = cellStyles[`${r}-${c}`] || {};
                  const selected = isSelected(r, c);
                  const isEditing =
                    editing && editing.r === r && editing.c === c;
                  const Tag = isHeader ? "th" : "td";

                  // 이 셀이 차지하는 x 구간 → 서브 컬럼 span 계산
                  const startX = cellStartX(r, c);
                  let cellW = 0;
                  const spanCols = m ? m.cs : 1;
                  for (let i = 0; i < spanCols; i++)
                    cellW += widths[r][c + i];
                  const colSpan =
                    findIdx(startX + cellW) - findIdx(startX);

                  return (
                    <Tag
                      key={c}
                      rowSpan={m ? m.rs : undefined}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      onMouseDown={(e) => onCellMouseDown(e, r, c)}
                      onMouseEnter={() => onCellMouseEnter(r, c)}
                      onDoubleClick={() => setEditing({ r, c })}
                      style={{
                        position: "relative",
                        boxSizing: "border-box",
                        border: isHeader
                          ? "1px solid #cbd5e1"
                          : "1px solid #e2e8f0",
                        fontSize: 13,
                        padding: "0 10px",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        cursor: "cell",
                        fontWeight: isHeader ? 600 : 400,
                        color: isHeader ? "white" : "#334155",
                        background: isHeader
                          ? "#1e293b"
                          : r % 2
                          ? "#f8fafc"
                          : "white",
                        textAlign: isHeader ? "center" : "left",
                        ...st,
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          defaultValue={text}
                          onBlur={(e) => commitEdit(r, c, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              commitEdit(r, c, e.target.value);
                            if (e.key === "Escape") setEditing(null);
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            width: "100%",
                            height: "100%",
                            border: "none",
                            outline: "2px solid #3b82f6",
                            outlineOffset: -2,
                            fontSize: 13,
                            padding: "0 4px",
                            background: "white",
                            color: "#0f172a",
                            boxSizing: "border-box",
                          }}
                        />
                      ) : (
                        text
                      )}

                      {selected && !isEditing && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(59,130,246,0.22)",
                            boxShadow: "inset 0 0 0 1px rgba(37,99,235,0.55)",
                            pointerEvents: "none",
                            zIndex: 5,
                          }}
                        />
                      )}

                      {renderResizeHandles(
                        m ? r + m.rs - 1 : r,
                        m ? c + m.cs - 1 : c
                      )}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 셀 나누기 대화상자 ── */}
      {splitDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15,23,42,0.4)" }}
          onMouseDown={() => setSplitDialog(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-64"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-bold text-slate-800 mb-3">
              셀 나누기
            </h2>
            <label className="block text-xs text-slate-600 mb-1">
              줄 수 (가로로 나누기)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={splitDialog.rows}
              onChange={(e) =>
                setSplitDialog((d) => ({ ...d, rows: Number(e.target.value) }))
              }
              className="w-full mb-3 px-2 py-1.5 border border-slate-300 rounded-md text-sm"
            />
            <label className="block text-xs text-slate-600 mb-1">
              칸 수 (세로로 나누기)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={splitDialog.cols}
              onChange={(e) =>
                setSplitDialog((d) => ({ ...d, cols: Number(e.target.value) }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  doSplit(splitDialog.rows, splitDialog.cols);
              }}
              className="w-full mb-4 px-2 py-1.5 border border-slate-300 rounded-md text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button className={btn} onClick={() => setSplitDialog(null)}>
                취소
              </button>
              <button
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 active:scale-95 transition"
                onClick={() => doSplit(splitDialog.rows, splitDialog.cols)}
              >
                나누기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상태 표시 */}
      <div className="mt-3 text-xs text-slate-500 font-mono flex gap-4">
        <span>
          전체 크기: {Math.round(totalWidth)}px × {Math.round(totalHeight)}px
        </span>
        {selRect && (
          <span className="text-blue-600">
            선택: {selCount}개 셀 (행 {selRect.r1 + 1}~{selRect.r2 + 1} / 열{" "}
            {selRect.c1 + 1}~{selRect.c2 + 1})
          </span>
        )}
      </div>
    </div>
  );
}
