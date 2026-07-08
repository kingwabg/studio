import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// 시트 설정
// ─────────────────────────────────────────────
const NUM_ROWS = 20;
const NUM_COLS = 8;
const MIN_COL_W = 40;
const MIN_ROW_H = 22;
const ROW_HEADER_W = 44;
const HANDLE = 5;

// 열 인덱스 → "A", "B", ... "Z", "AA" ...
const colName = (c) => {
  let s = "";
  c += 1;
  while (c > 0) {
    s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
};
// "A1" → {r, c}
const parseRef = (str) => {
  const m = /^([A-Z]+)([0-9]+)$/.exec(str);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
};

// ─────────────────────────────────────────────
// 수식 엔진: =A1+B2, =SUM(A1:B3), 사칙연산, 괄호 지원
// ─────────────────────────────────────────────
const FUNCS = {
  SUM: (vs) => vs.reduce((s, v) => s + v, 0),
  AVERAGE: (vs) => (vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0),
  AVG: (vs) => (vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0),
  MIN: (vs) => (vs.length ? Math.min(...vs) : 0),
  MAX: (vs) => (vs.length ? Math.max(...vs) : 0),
  COUNT: (vs) => vs.length,
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = src.toUpperCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === " ") {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
    } else if (/[A-Z]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Z0-9]/.test(s[j])) j++;
      const word = s.slice(i, j);
      tokens.push(
        parseRef(word) ? { t: "ref", v: word } : { t: "func", v: word }
      );
      i = j;
    } else if ("+-*/():,".includes(ch)) {
      tokens.push({ t: ch });
      i++;
    } else {
      throw new Error("bad char");
    }
  }
  return tokens;
}

// data와 순환참조 방문 집합을 받아 셀 값을 계산
function makeEvaluator(data) {
  const cache = new Map();

  const cellNumber = (r, c, visiting) => {
    const raw = evalCell(r, c, visiting);
    if (typeof raw === "number") return raw;
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  };

  function evalFormula(src, visiting) {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (t) => {
      if (!tokens[pos] || tokens[pos].t !== t) throw new Error("syntax");
      return tokens[pos++];
    };

    const rangeValues = (a, b) => {
      const p1 = parseRef(a);
      const p2 = parseRef(b);
      const vals = [];
      for (let r = Math.min(p1.r, p2.r); r <= Math.max(p1.r, p2.r); r++)
        for (let c = Math.min(p1.c, p2.c); c <= Math.max(p1.c, p2.c); c++) {
          if (r < NUM_ROWS && c < NUM_COLS) vals.push(cellNumber(r, c, visiting));
        }
      return vals;
    };

    function factor() {
      const tk = peek();
      if (!tk) throw new Error("syntax");
      if (tk.t === "num") {
        pos++;
        return tk.v;
      }
      if (tk.t === "-") {
        pos++;
        return -factor();
      }
      if (tk.t === "(") {
        pos++;
        const v = expr();
        eat(")");
        return v;
      }
      if (tk.t === "ref") {
        pos++;
        const p = parseRef(tk.v);
        return cellNumber(p.r, p.c, visiting);
      }
      if (tk.t === "func") {
        pos++;
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error("unknown func");
        eat("(");
        const vals = [];
        if (peek() && peek().t !== ")") {
          for (;;) {
            // 인수: 범위(A1:B3) 또는 일반 식
            if (
              peek()?.t === "ref" &&
              tokens[pos + 1]?.t === ":" &&
              tokens[pos + 2]?.t === "ref"
            ) {
              const a = tokens[pos].v;
              const b = tokens[pos + 2].v;
              pos += 3;
              vals.push(...rangeValues(a, b));
            } else {
              vals.push(expr());
            }
            if (peek()?.t === ",") pos++;
            else break;
          }
        }
        eat(")");
        return fn(vals);
      }
      throw new Error("syntax");
    }
    function term() {
      let v = factor();
      while (peek() && (peek().t === "*" || peek().t === "/")) {
        const op = tokens[pos++].t;
        const rhs = factor();
        v = op === "*" ? v * rhs : v / rhs;
      }
      return v;
    }
    function expr() {
      let v = term();
      while (peek() && (peek().t === "+" || peek().t === "-")) {
        const op = tokens[pos++].t;
        const rhs = term();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }
    const result = expr();
    if (pos !== tokens.length) throw new Error("syntax");
    return result;
  }

  function evalCell(r, c, visiting = new Set()) {
    const key = `${r}-${c}`;
    if (cache.has(key)) return cache.get(key);
    if (visiting.has(key)) return "#순환!";
    const raw = data[r]?.[c] ?? "";
    let out;
    if (typeof raw === "string" && raw.startsWith("=")) {
      visiting.add(key);
      try {
        out = evalFormula(raw.slice(1), visiting);
        if (typeof out === "number" && !isFinite(out)) out = "#DIV/0!";
        else if (typeof out === "number")
          out = Math.round(out * 1e10) / 1e10; // 부동소수점 잡음 제거
      } catch {
        out = "#오류!";
      }
      visiting.delete(key);
    } else {
      out = raw;
    }
    cache.set(key, out);
    return out;
  }

  return evalCell;
}

// ─────────────────────────────────────────────
// 초기 데이터: 수식 데모 포함
// ─────────────────────────────────────────────
const initialData = () => {
  const d = Array.from({ length: NUM_ROWS }, () => Array(NUM_COLS).fill(""));
  d[0] = ["캐릭터", "프레임 수", "폭(px)", "높이(px)", "용량(KB)", "", "", ""];
  d[1] = ["슬라임", "6", "32", "32", "=B2*C2*D2*4/1024", "", "", ""];
  d[2] = ["기사", "8", "48", "48", "=B3*C3*D3*4/1024", "", "", ""];
  d[3] = ["마법사", "4", "48", "64", "=B4*C4*D4*4/1024", "", "", ""];
  d[4] = ["궁수", "6", "32", "48", "=B5*C5*D5*4/1024", "", "", ""];
  d[5] = ["합계", "=SUM(B2:B5)", "", "", "=SUM(E2:E5)", "", "", ""];
  d[6] = ["평균", "=AVERAGE(B2:B5)", "", "", "=AVERAGE(E2:E5)", "", "", ""];
  return d;
};

export default function Spreadsheet() {
  const [data, setData] = useState(initialData);
  const [colWidths, setColWidths] = useState(Array(NUM_COLS).fill(92));
  const [rowHeights, setRowHeights] = useState(Array(NUM_ROWS).fill(26));
  const [active, setActive] = useState({ r: 0, c: 0 }); // 활성 셀
  const [sel, setSel] = useState({ ar: 0, ac: 0, fr: 0, fc: 0 });
  const [editing, setEditing] = useState(null); // {r, c, value}
  const [styles, setStyles] = useState({}); // "r-c" → {fontWeight, background}

  const dragRef = useRef(null);
  const selectingRef = useRef(false);
  const clipRef = useRef(null);
  const dataRef = useRef(data);
  const selRefState = useRef(sel);
  const activeRef = useRef(active);
  dataRef.current = data;
  selRefState.current = sel;
  activeRef.current = active;

  // 수식 계산 (data가 바뀔 때마다 캐시 새로 구성)
  const evalCell = useMemo(() => makeEvaluator(data), [data]);

  const rect = useMemo(
    () => ({
      r1: Math.min(sel.ar, sel.fr),
      c1: Math.min(sel.ac, sel.fc),
      r2: Math.max(sel.ar, sel.fr),
      c2: Math.max(sel.ac, sel.fc),
    }),
    [sel]
  );
  const isSelected = (r, c) =>
    r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

  // ─────────────────────────────────────────
  // 편집
  // ─────────────────────────────────────────
  const startEdit = (r, c, initialValue = null) => {
    setEditing({
      r,
      c,
      value: initialValue !== null ? initialValue : dataRef.current[r][c],
    });
  };
  const commitEdit = useCallback((move = null) => {
    setEditing((ed) => {
      if (ed) {
        setData((prev) => {
          const next = prev.map((row) => [...row]);
          next[ed.r][ed.c] = ed.value;
          return next;
        });
      }
      return null;
    });
    if (move) moveActive(move.dr, move.dc);
  }, []);

  const moveActive = (dr, dc) => {
    setActive((a) => {
      const r = Math.max(0, Math.min(NUM_ROWS - 1, a.r + dr));
      const c = Math.max(0, Math.min(NUM_COLS - 1, a.c + dc));
      setSel({ ar: r, ac: c, fr: r, fc: c });
      return { r, c };
    });
  };

  // ─────────────────────────────────────────
  // 선택 (셀 / 행 헤더 / 열 헤더 / 전체)
  // ─────────────────────────────────────────
  const onCellMouseDown = (e, r, c) => {
    if (e.button !== 0) return;
    if (editing) commitEdit();
    selectingRef.current = true;
    setActive({ r, c });
    if (e.shiftKey) setSel((s) => ({ ...s, fr: r, fc: c }));
    else setSel({ ar: r, ac: c, fr: r, fc: c });
  };
  const onCellMouseEnter = (r, c) => {
    if (!selectingRef.current) return;
    setSel((s) => ({ ...s, fr: r, fc: c }));
  };
  const selectCol = (c) => {
    if (editing) commitEdit();
    setActive({ r: 0, c });
    setSel({ ar: 0, ac: c, fr: NUM_ROWS - 1, fc: c });
  };
  const selectRow = (r) => {
    if (editing) commitEdit();
    setActive({ r, c: 0 });
    setSel({ ar: r, ac: 0, fr: r, fc: NUM_COLS - 1 });
  };
  const selectAll = () => {
    if (editing) commitEdit();
    setActive({ r: 0, c: 0 });
    setSel({ ar: 0, ac: 0, fr: NUM_ROWS - 1, fc: NUM_COLS - 1 });
  };
  useEffect(() => {
    const up = () => (selectingRef.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ─────────────────────────────────────────
  // 리사이징 (열/행 헤더 가장자리 드래그)
  // ─────────────────────────────────────────
  const startResize = (e, type, index) => {
    e.preventDefault();
    e.stopPropagation();
    const startPos = type === "col" ? e.clientX : e.clientY;
    const startSize =
      type === "col" ? colWidths[index] : rowHeights[index];
    const onMove = (ev) => {
      const delta = (type === "col" ? ev.clientX : ev.clientY) - startPos;
      if (type === "col")
        setColWidths((prev) => {
          const next = [...prev];
          next[index] = Math.max(MIN_COL_W, startSize + delta);
          return next;
        });
      else
        setRowHeights((prev) => {
          const next = [...prev];
          next[index] = Math.max(MIN_ROW_H, startSize + delta);
          return next;
        });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = type === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  // ─────────────────────────────────────────
  // 지우기 / 복사 / 잘라내기 / 붙여넣기
  // ─────────────────────────────────────────
  const clearSelection = useCallback(() => {
    const s = selRefState.current;
    const r1 = Math.min(s.ar, s.fr),
      r2 = Math.max(s.ar, s.fr),
      c1 = Math.min(s.ac, s.fc),
      c2 = Math.max(s.ac, s.fc);
    setData((prev) =>
      prev.map((row, r) =>
        row.map((t, c) => (r >= r1 && r <= r2 && c >= c1 && c <= c2 ? "" : t))
      )
    );
  }, []);

  const copySelection = useCallback((cut) => {
    const s = selRefState.current;
    const r1 = Math.min(s.ar, s.fr),
      r2 = Math.max(s.ar, s.fr),
      c1 = Math.min(s.ac, s.fc),
      c2 = Math.max(s.ac, s.fc);
    const grid = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) row.push(dataRef.current[r][c]);
      grid.push(row);
    }
    clipRef.current = { grid, cut, rect: { r1, c1, r2, c2 } };
    try {
      navigator.clipboard?.writeText(
        grid.map((row) => row.join("\t")).join("\n")
      );
    } catch {}
  }, []);

  const pasteClip = useCallback(() => {
    const clip = clipRef.current;
    if (!clip) return;
    const a = activeRef.current;
    setData((prev) => {
      const next = prev.map((row) => [...row]);
      if (clip.cut) {
        const { r1, c1, r2, c2 } = clip.rect;
        for (let r = r1; r <= r2; r++)
          for (let c = c1; c <= c2; c++) next[r][c] = "";
      }
      clip.grid.forEach((row, dr) =>
        row.forEach((t, dc) => {
          const r = a.r + dr,
            c = a.c + dc;
          if (r < NUM_ROWS && c < NUM_COLS) next[r][c] = t;
        })
      );
      return next;
    });
    if (clip.cut) clipRef.current = { ...clip, cut: false };
  }, []);

  // ─────────────────────────────────────────
  // 스타일
  // ─────────────────────────────────────────
  const applyStyle = (patch) => {
    setStyles((prev) => {
      const next = { ...prev };
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++)
          next[`${r}-${c}`] = { ...next[`${r}-${c}`], ...patch };
      return next;
    });
  };
  const toggleBold = () => {
    const cur = styles[`${rect.r1}-${rect.c1}`]?.fontWeight === 700;
    applyStyle({ fontWeight: cur ? 400 : 700 });
  };

  // ─────────────────────────────────────────
  // 키보드
  // ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (editing) return; // 편집은 input이 처리
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        clearSelection();
      } else if (mod && key.toLowerCase() === "c") {
        copySelection(false);
      } else if (mod && key.toLowerCase() === "x") {
        copySelection(true);
      } else if (mod && key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClip();
      } else if (key === "Enter" || key === "F2") {
        e.preventDefault();
        const a = activeRef.current;
        startEdit(a.r, a.c);
      } else if (key.startsWith("Arrow")) {
        e.preventDefault();
        const d = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1],
        }[key];
        if (e.shiftKey) {
          // 선택 확장
          setSel((s) => ({
            ...s,
            fr: Math.max(0, Math.min(NUM_ROWS - 1, s.fr + d[0])),
            fc: Math.max(0, Math.min(NUM_COLS - 1, s.fc + d[1])),
          }));
        } else moveActive(d[0], d[1]);
      } else if (key === "Tab") {
        e.preventDefault();
        moveActive(0, e.shiftKey ? -1 : 1);
      } else if (!mod && key.length === 1) {
        // 문자를 누르면 그 문자로 바로 입력 시작 (엑셀 방식)
        e.preventDefault();
        const a = activeRef.current;
        startEdit(a.r, a.c, key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, clearSelection, copySelection, pasteClip]);

  // ─────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────
  const activeRaw = editing ? editing.value : data[active.r][active.c];
  const btn =
    "px-2.5 py-1 rounded-md text-xs font-medium border border-slate-300 bg-white hover:bg-slate-100 active:scale-95 transition";

  const formatValue = (v) => {
    if (typeof v === "number") {
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    }
    return v;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-start py-6 px-6 font-sans">
      <h1 className="text-xl font-bold text-slate-800 mb-1">시트</h1>
      <p className="text-xs text-slate-500 mb-3">
        =수식 지원: 셀 참조(A1), 사칙연산, SUM · AVERAGE · MIN · MAX ·
        COUNT(범위 A1:B3) · 헤더 클릭으로 행/열 선택 · 헤더 경계 드래그로
        크기 조절
      </p>

      {/* ── 툴바 + 수식 입력줄 ── */}
      <div className="flex items-center gap-1.5 mb-2">
        <button className={btn + " font-bold"} onClick={toggleBold}>
          B
        </button>
        {["#fef08a", "#bbf7d0", "#bfdbfe", ""].map((color, i) => (
          <button
            key={i}
            onClick={() => applyStyle({ background: color })}
            className="w-5 h-5 rounded border border-slate-300"
            style={{
              background:
                color ||
                "repeating-linear-gradient(45deg,#fff,#fff 3px,#e2e8f0 3px,#e2e8f0 6px)",
            }}
          />
        ))}
      </div>
      <div
        className="flex items-stretch mb-3 rounded-md overflow-hidden border border-slate-300 bg-white shadow-sm"
        style={{ width: ROW_HEADER_W + colWidths.reduce((s, w) => s + w, 0) }}
      >
        <div className="px-3 flex items-center text-xs font-bold text-slate-500 bg-slate-50 border-r border-slate-200 font-mono">
          {colName(active.c)}
          {active.r + 1}
        </div>
        <span className="px-2 flex items-center text-slate-400 text-xs italic border-r border-slate-200">
          fx
        </span>
        <input
          value={activeRaw}
          onChange={(e) => {
            const v = e.target.value;
            if (editing) setEditing((ed) => ({ ...ed, value: v }));
            else setEditing({ r: active.r, c: active.c, value: v });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitEdit({ dr: 1, dc: 0 });
            } else if (e.key === "Escape") setEditing(null);
          }}
          className="flex-1 px-2 py-1.5 text-sm outline-none font-mono"
          placeholder="값 또는 =수식 입력"
        />
      </div>

      {/* ── 그리드 ── */}
      <div
        className="overflow-auto rounded-lg border border-slate-300 bg-white shadow"
        style={{ maxHeight: 480, maxWidth: "90vw" }}
      >
        <table
          style={{
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
            userSelect: "none",
          }}
        >
          <colgroup>
            <col style={{ width: ROW_HEADER_W }} />
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {/* 전체 선택 코너 */}
              <th
                onClick={selectAll}
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 30,
                  height: 26,
                  background: "#e2e8f0",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
                title="전체 선택"
              />
              {colWidths.map((w, c) => {
                const colSel = rect.c1 <= c && c <= rect.c2;
                return (
                  <th
                    key={c}
                    onMouseDown={() => selectCol(c)}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                      height: 26,
                      fontSize: 12,
                      fontWeight: 600,
                      color: colSel ? "#1d4ed8" : "#475569",
                      background: colSel ? "#dbeafe" : "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {colName(c)}
                      <div
                        onMouseDown={(e) => startResize(e, "col", c)}
                        style={{
                          position: "absolute",
                          right: -HANDLE / 2 - 4,
                          top: 0,
                          width: HANDLE + 4,
                          height: "100%",
                          cursor: "col-resize",
                          zIndex: 25,
                        }}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => {
              const rowSel = rect.r1 <= r && r <= rect.r2;
              return (
                <tr key={r} style={{ height: rowHeights[r] }}>
                  {/* 행 번호 헤더 */}
                  <th
                    onMouseDown={() => selectRow(r)}
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 15,
                      fontSize: 11,
                      fontWeight: 600,
                      color: rowSel ? "#1d4ed8" : "#64748b",
                      background: rowSel ? "#dbeafe" : "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {r + 1}
                      <div
                        onMouseDown={(e) => startResize(e, "row", r)}
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: -HANDLE / 2 - 2,
                          width: "100%",
                          height: HANDLE + 2,
                          cursor: "row-resize",
                          zIndex: 25,
                        }}
                      />
                    </div>
                  </th>
                  {row.map((raw, c) => {
                    const isActive = active.r === r && active.c === c;
                    const selected = isSelected(r, c);
                    const isEd = editing && editing.r === r && editing.c === c;
                    const st = styles[`${r}-${c}`] || {};
                    const value = evalCell(r, c);
                    const isNum =
                      typeof value === "number" ||
                      (value !== "" && !isNaN(parseFloat(value)) && isFinite(value));
                    const isError =
                      typeof value === "string" && value.startsWith("#");
                    return (
                      <td
                        key={c}
                        onMouseDown={(e) => onCellMouseDown(e, r, c)}
                        onMouseEnter={() => onCellMouseEnter(r, c)}
                        onDoubleClick={() => startEdit(r, c)}
                        style={{
                          position: "relative",
                          boxSizing: "border-box",
                          border: "1px solid #e2e8f0",
                          fontSize: 12.5,
                          padding: "0 6px",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          cursor: "cell",
                          fontFamily: isNum
                            ? "ui-monospace, monospace"
                            : "inherit",
                          textAlign: isNum ? "right" : "left",
                          color: isError ? "#dc2626" : "#1e293b",
                          background:
                            selected && !isActive
                              ? "rgba(59,130,246,0.13)"
                              : "white",
                          outline: isActive
                            ? "2px solid #2563eb"
                            : "none",
                          outlineOffset: -2,
                          ...st,
                        }}
                      >
                        {isEd ? (
                          <input
                            autoFocus
                            value={editing.value}
                            onChange={(e) =>
                              setEditing((ed) => ({
                                ...ed,
                                value: e.target.value,
                              }))
                            }
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter")
                                commitEdit({ dr: 1, dc: 0 });
                              else if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
                              } else if (e.key === "Escape") setEditing(null);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              height: "100%",
                              border: "none",
                              outline: "none",
                              fontSize: 12.5,
                              padding: "0 6px",
                              fontFamily: "ui-monospace, monospace",
                              background: "white",
                              boxSizing: "border-box",
                            }}
                          />
                        ) : (
                          formatValue(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 상태 표시줄 */}
      <div className="mt-2 text-xs text-slate-500 font-mono flex gap-4">
        <span>
          {colName(rect.c1)}
          {rect.r1 + 1}
          {(rect.r1 !== rect.r2 || rect.c1 !== rect.c2) &&
            `:${colName(rect.c2)}${rect.r2 + 1}`}
        </span>
        {(() => {
          // 선택 범위의 숫자들에 대한 합계/평균 (엑셀 하단 상태줄처럼)
          const nums = [];
          for (let r = rect.r1; r <= rect.r2; r++)
            for (let c = rect.c1; c <= rect.c2; c++) {
              const v = evalCell(r, c);
              const n = typeof v === "number" ? v : parseFloat(v);
              if (!isNaN(n) && v !== "") nums.push(n);
            }
          if (nums.length < 2) return null;
          const sum = nums.reduce((s, v) => s + v, 0);
          return (
            <span className="text-blue-600">
              합계: {Math.round(sum * 100) / 100} · 평균:{" "}
              {Math.round((sum / nums.length) * 100) / 100} · 개수:{" "}
              {nums.length}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
