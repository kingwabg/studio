import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ═════════════════════════════════════════════
// 디자인 토큰
// ═════════════════════════════════════════════
const T = {
  ink: "#1A2233",
  inkSoft: "#5B6577",
  inkFaint: "#98A2B3",
  paper: "#F6F7FA",
  canvas: "#EDF0F5",
  surface: "#FFFFFF",
  line: "#E4E8EF",
  lineStrong: "#CBD2DE",
  accent: "#2B5CE6",
  accentSoft: "#EDF2FE",
  accentLine: "#C4D4F9",
  font: "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace",
};

const MM = 3.7795;
const PAGE_W = Math.round(210 * MM);
const PAGE_H = Math.round(297 * MM);
const MARGIN = Math.round(10 * MM);
const CONTENT_W = PAGE_W - MARGIN * 2 - 20;
const MIN_COL_W = 30;
const MIN_ROW_H = 24;
const HANDLE = 6;

// ═════════════════════════════════════════════
// 섹션 번호 자동 할당 (명세 [3.2])
// ═════════════════════════════════════════════
const ROMANS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"];
const HANGULS = "가나다라마바사아자차카타파하";
const toRoman = (n) => ROMANS[n - 1] || String(n);
const toHangul = (n) => HANGULS[n - 1] || String(n);

function assignNumbers(sections) {
  const counters = [0, 0, 0];
  return sections.map((s) => {
    const idx = s.level - 1;
    counters[idx] += 1;
    for (let i = idx + 1; i < 3; i++) counters[i] = 0;
    const number =
      s.level === 1
        ? toRoman(counters[0])
        : s.level === 2
        ? String(counters[1])
        : toHangul(counters[2]);
    return { ...s, number };
  });
}

// ═════════════════════════════════════════════
// 표 데이터 팩토리: rows 배열 → 격리 엔진용 데이터
// ═════════════════════════════════════════════
const makeTableData = (rows) => {
  const nCols = rows[0].length;
  const w = Math.max(MIN_COL_W + 20, Math.floor(Math.min(CONTENT_W, 620) / nCols));
  return {
    cells: rows.map((r) => [...r]),
    widths: rows.map(() => Array(nCols).fill(w)),
    heights: rows.map(() => 30),
    vAligns: {},
  };
};
const DEFAULT_ROWS = [
  ["구분", "내용", "비고"],
  ["", "", ""],
  ["", "", ""],
];

// ═════════════════════════════════════════════
// 게이트웨이 검증 (명세 [5]) — AI 응답 JSON 검사
// ═════════════════════════════════════════════
function validateDocJson(obj) {
  if (!obj || typeof obj !== "object") return "응답이 객체가 아닙니다.";
  if (typeof obj.title !== "string" || !obj.title.trim())
    return "title이 없습니다.";
  if (!Array.isArray(obj.sections) || obj.sections.length === 0)
    return "sections 배열이 비어 있습니다.";
  for (let i = 0; i < obj.sections.length; i++) {
    const s = obj.sections[i];
    if (typeof s.heading !== "string" || !s.heading.trim())
      return `섹션 ${i}: heading이 없습니다.`;
    if (![1, 2, 3].includes(s.level)) return `섹션 ${i}: level은 1|2|3이어야 합니다.`;
    if (!Array.isArray(s.blocks) || s.blocks.length === 0)
      return `섹션 ${i}: blocks가 비어 있습니다.`;
    for (let j = 0; j < s.blocks.length; j++) {
      const b = s.blocks[j];
      if (b.type === "para") {
        if (typeof b.text !== "string") return `섹션 ${i} 블록 ${j}: para에 text가 없습니다.`;
      } else if (b.type === "list") {
        if (!Array.isArray(b.items) || b.items.length === 0)
          return `섹션 ${i} 블록 ${j}: list의 items가 비어 있습니다.`;
      } else if (b.type === "table") {
        if (!Array.isArray(b.rows) || b.rows.length === 0)
          return `섹션 ${i} 블록 ${j}: table의 rows가 비어 있습니다.`;
        const nCols = b.rows[0].length;
        if (nCols < 1 || nCols > 10)
          return `섹션 ${i} 블록 ${j}: 표는 1~10열이어야 합니다.`;
        for (const row of b.rows)
          if (row.length !== nCols)
            return `섹션 ${i} 블록 ${j}: 표의 모든 행은 같은 열 수여야 합니다.`;
      } else {
        return `섹션 ${i} 블록 ${j}: 알 수 없는 블록 타입 "${b.type}"`;
      }
    }
  }
  return null;
}

// AI JSON → 내부 상태
const hydrateDoc = (json) => ({
  title: json.title.trim(),
  sections: json.sections.map((s) => ({
    heading: s.heading.trim(),
    level: s.level,
    blocks: s.blocks.map((b) =>
      b.type === "table" ? { type: "table", data: makeTableData(b.rows) } : { ...b }
    ),
  })),
});
// 내부 상태 → AI 컨텍스트용 JSON
const serializeDoc = (doc) => ({
  title: doc.title,
  sections: doc.sections.map((s) => ({
    heading: s.heading,
    level: s.level,
    blocks: s.blocks.map((b) =>
      b.type === "table" ? { type: "table", rows: b.data.cells } : b
    ),
  })),
});

// ═════════════════════════════════════════════
// SVG 아이콘
// ═════════════════════════════════════════════
const Icon = ({ d, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {d}
  </svg>
);
const IcTable = (p) => <Icon {...p} d={<><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M1.5 6.5h13M6.5 2.5v11M11 6.5v7" /></>} />;
const IcText = (p) => <Icon {...p} d={<path d="M3 3.5h10M8 3.5v9M5.5 12.5h5" />} />;
const IcImage = (p) => <Icon {...p} d={<><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><circle cx="5.5" cy="6" r="1.2" /><path d="M14 10.5l-3.5-3L5 13" /></>} />;
const IcFolder = (p) => <Icon {...p} d={<path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 2h6.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" />} />;
const IcLayers = (p) => <Icon {...p} d={<path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3" />} />;
const IcSearch = (p) => <Icon {...p} d={<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>} />;
const IcUndo = (p) => <Icon {...p} d={<path d="M3 6h7a3.5 3.5 0 0 1 0 7H6M3 6l3-3M3 6l3 3" />} />;
const IcRedo = (p) => <Icon {...p} d={<path d="M13 6H6a3.5 3.5 0 0 0 0 7h4M13 6l-3-3M13 6l-3 3" />} />;
const IcBack = (p) => <Icon {...p} d={<path d="M10 3L5 8l5 5" />} />;
const IcVTop = (p) => <Icon {...p} d={<><path d="M2 2.5h12" /><rect x="5.5" y="5" width="5" height="8" rx="0.5" /></>} />;
const IcVMid = (p) => <Icon {...p} d={<><path d="M2 8h2.5M11.5 8H14" /><rect x="5.5" y="4" width="5" height="8" rx="0.5" /></>} />;
const IcVBottom = (p) => <Icon {...p} d={<><path d="M2 13.5h12" /><rect x="5.5" y="3" width="5" height="8" rx="0.5" /></>} />;
const IcSpark = (p) => <Icon {...p} d={<><path d="M8 1.5l1.4 3.6L13 6.5l-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5z" /><path d="M12.8 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z" /></>} />;
const IcSend = (p) => <Icon {...p} d={<path d="M2 8l12-5.5L11 13l-3-3.5L2 8z" />} />;
const IcRestore = (p) => <Icon {...p} d={<><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v3h3" /></>} />;

// ═════════════════════════════════════════════
// 종이 모형 (홈 카드 시그니처)
// ═════════════════════════════════════════════
function PaperDoc({ kind, w = 88, h = 116 }) {
  const line = T.lineStrong;
  return (
    <div style={{ width: w, height: h, background: "white", border: `1px solid ${T.line}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(26,34,51,0.06), 0 8px 20px rgba(26,34,51,0.08)", padding: 9, boxSizing: "border-box", position: "relative", overflow: "hidden" }}>
      {kind === "doc" && (
        <>
          <div style={{ height: 5, width: "55%", background: T.ink, borderRadius: 1, marginBottom: 5 }} />
          <div style={{ height: 2.5, width: "90%", background: T.line, borderRadius: 1, marginBottom: 3 }} />
          <div style={{ height: 2.5, width: "75%", background: T.line, borderRadius: 1, marginBottom: 8 }} />
          <div style={{ border: `1px solid ${line}`, borderRadius: 1.5 }}>
            {[0, 1, 2].map((r) => (
              <div key={r} style={{ display: "flex", borderTop: r ? `1px solid ${line}` : "none", height: 11, background: r === 0 ? T.accentSoft : "white" }}>
                {[38, 26, 36].map((fw, c) => (
                  <div key={c} style={{ flex: fw, borderLeft: c ? `1px solid ${line}` : "none" }} />
                ))}
              </div>
            ))}
          </div>
          <div style={{ height: 2.5, width: "82%", background: T.line, borderRadius: 1, marginTop: 8 }} />
          <div style={{ height: 2.5, width: "60%", background: T.line, borderRadius: 1, marginTop: 3 }} />
        </>
      )}
      {kind === "sheet" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridTemplateRows: "repeat(7,1fr)" }}>
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} style={{ borderRight: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, background: i < 4 ? T.paper : i === 9 ? T.accentSoft : "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {i === 9 && <span style={{ fontSize: 7, fontFamily: T.mono, color: T.accent, fontWeight: 600 }}>=SUM</span>}
            </div>
          ))}
        </div>
      )}
      {kind === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, height: "100%" }}>
          <div style={{ background: T.accentSoft, borderRadius: 2, border: `1px solid ${T.accentLine}` }} />
          <div style={{ background: T.paper, borderRadius: 2, border: `1px solid ${T.line}` }} />
          <div style={{ gridColumn: "1 / -1", background: T.paper, borderRadius: 2, border: `1px solid ${T.line}`, display: "flex", alignItems: "flex-end", gap: 3, padding: 5 }}>
            {[40, 65, 30, 80, 55].map((hp, i) => (
              <div key={i} style={{ flex: 1, height: `${hp}%`, background: i === 3 ? T.accent : T.lineStrong, borderRadius: 1 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════
// 표 블록 (격리 엔진 + 세로 정렬)
// ═════════════════════════════════════════════
function TableBlock({ tableId, data, update, focus, setFocus, showGuides }) {
  const dragRef = useRef(null);
  const [editing, setEditing] = useState(null);

  const xs = useMemo(() => {
    const raw = [0];
    for (const rowW of data.widths) {
      let acc = 0;
      for (const w of rowW) raw.push((acc += w));
    }
    raw.sort((a, b) => a - b);
    const out = [raw[0]];
    for (const v of raw) if (v - out[out.length - 1] > 0.6) out.push(v);
    return out;
  }, [data.widths]);
  const findIdx = (v) => {
    let lo = 0, hi = xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < v - 0.6) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const totalW = xs[xs.length - 1];
  const totalH = data.heights.reduce((s, h) => s + h, 0);

  const startDrag = useCallback(
    (e, type, index) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        type, index,
        startX: e.clientX, startY: e.clientY,
        startWidths: data.widths.map((r) => [...r]),
        startHeights: [...data.heights],
      };
      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        if (d.type === "col") {
          update((t) => ({
            ...t,
            widths: d.startWidths.map((row) => {
              const next = [...row];
              next[d.index] = Math.max(MIN_COL_W, row[d.index] + dx);
              return next;
            }),
          }));
        } else {
          update((t) => {
            const next = [...d.startHeights];
            next[d.index] = Math.max(MIN_ROW_H, d.startHeights[d.index] + dy);
            return { ...t, heights: next };
          });
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
      document.body.style.cursor = type === "col" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [data, update]
  );

  const commitEdit = (r, c, value) => {
    update((t) => {
      const cells = t.cells.map((row) => [...row]);
      cells[r][c] = value;
      return { ...t, cells };
    });
    setEditing(null);
  };
  const cellStartX = (r, c) => {
    let acc = 0;
    for (let i = 0; i < c; i++) acc += data.widths[r][i];
    return acc;
  };

  return (
    <div style={{ position: "relative", width: totalW, height: totalH, margin: "10px auto" }}>
      <table style={{ tableLayout: "fixed", borderCollapse: "collapse", width: totalW, height: totalH, userSelect: "none" }}>
        <colgroup>
          {xs.slice(1).map((x, i) => (
            <col key={i} style={{ width: x - xs[i] }} />
          ))}
        </colgroup>
        <tbody>
          {data.cells.map((row, r) => (
            <tr key={r} style={{ height: data.heights[r] }}>
              {row.map((text, c) => {
                const startX = cellStartX(r, c);
                const w = data.widths[r][c];
                const colSpan = findIdx(startX + w) - findIdx(startX);
                const focused = focus && focus.tableId === tableId && focus.r === r && focus.c === c;
                const isEd = editing && editing.r === r && editing.c === c;
                const vAlign = data.vAligns[`${r}-${c}`] || "middle";
                const isHeader = r === 0;
                return (
                  <td
                    key={c}
                    colSpan={colSpan > 1 ? colSpan : undefined}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      setFocus({ tableId, r, c });
                    }}
                    onDoubleClick={() => setEditing({ r, c })}
                    style={{
                      position: "relative", boxSizing: "border-box",
                      border: `1px solid ${T.lineStrong}`, padding: 0,
                      overflow: "hidden", cursor: "cell",
                      background: isHeader ? T.paper : "white",
                      fontWeight: isHeader ? 600 : 400,
                      fontSize: 12.5, color: T.ink, verticalAlign: "top",
                    }}
                  >
                    <div
                      style={{
                        height: "100%", display: "flex", flexDirection: "column",
                        justifyContent: vAlign === "top" ? "flex-start" : vAlign === "bottom" ? "flex-end" : "center",
                        padding: "3px 8px", boxSizing: "border-box",
                        textAlign: isHeader ? "center" : "left",
                      }}
                    >
                      {isEd ? (
                        <input
                          autoFocus
                          defaultValue={text}
                          onBlur={(e) => commitEdit(r, c, e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") commitEdit(r, c, e.target.value);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{ width: "100%", border: "none", outline: `1.5px solid ${T.accent}`, fontSize: 12.5, padding: "1px 2px", fontFamily: T.font, boxSizing: "border-box" }}
                        />
                      ) : (
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
                      )}
                    </div>
                    {focused && !isEd && (
                      <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 0 2px ${T.accent}`, background: "rgba(43,92,230,0.06)", pointerEvents: "none", zIndex: 5 }} />
                    )}
                    <div
                      onMouseDown={(e) => startDrag(e, "col", c)}
                      style={{ position: "absolute", top: 0, right: 0, width: HANDLE, height: "100%", cursor: "col-resize", zIndex: 10, background: showGuides ? "rgba(43,92,230,0.14)" : "transparent" }}
                    />
                    <div
                      onMouseDown={(e) => startDrag(e, "row", r)}
                      style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: HANDLE, cursor: "row-resize", zIndex: 10, background: showGuides ? "rgba(43,92,230,0.14)" : "transparent" }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════
// AI 문서 도우미 (명세의 Agent→Gateway→Service 이식)
// ═════════════════════════════════════════════
const AI_SYSTEM_PROMPT = `당신은 한국어 공식 문서(보고서·사업계획서·제안서·공문·회의록) 작성 AI입니다.
사용자의 요청과 '현재 문서'를 바탕으로 완성된 문서 전체를 아래 JSON 형식으로만 출력하세요.

{"title":"문서 제목","sections":[{"heading":"섹션 제목","level":1,"blocks":[{"type":"para","text":"..."},{"type":"list","items":["...","..."],"ordered":false},{"type":"table","rows":[["헤더1","헤더2"],["값1","값2"]]}]}]}

규칙:
1. JSON 외 어떤 텍스트도 출력 금지 (마크다운 백틱, 설명, 인사 모두 금지)
2. level은 1(Ⅰ.) | 2(1.) | 3(가.) — 섹션 번호는 시스템이 자동 부여하므로 heading에 번호를 쓰지 말 것
3. 표의 모든 행은 같은 열 수, 첫 행은 헤더, 최대 10열
4. 객관적 공문체 (~하고자 함, ~를 목적으로 함). 1인칭·구어체 금지
5. 모르는 수치는 [○○]로 표기하고 지어내지 말 것
6. 예산·일정·현황은 표, 항목 나열은 목록, 설명은 산문(para)
7. 전체는 간결하게: 섹션 3~6개, 응답 JSON이 지나치게 길지 않게
8. 사용자가 부분 수정을 요청하면 나머지는 유지한 채 해당 부분만 바꾼 '문서 전체'를 반환`;

function AiPanel({ doc, setDoc }) {
  const [messages, setMessages] = useState([
    { role: "ai", text: "어떤 문서를 만들까요? 요청하면 캔버스의 문서를 새로 작성하거나 수정해 드립니다." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeModel, setActiveModel] = useState(null); // 마지막으로 성공한 모델
  const scrollRef = useRef(null);

  // Fable 5를 우선 시도, 미지원이면 Sonnet 4.6으로 폴백
  const MODEL_CANDIDATES = ["claude-fable-5", "claude-sonnet-4-6"];
  const workingModelRef = useRef(null); // 성공한 모델 기억 → 다음부턴 바로 사용

  const callModel = async (prompt) => {
    const candidates = workingModelRef.current
      ? [workingModelRef.current]
      : MODEL_CANDIDATES;
    let lastErr = null;
    for (const model of candidates) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 1000,
            system: AI_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const apiData = await response.json();
        // 모델 미지원 등 API 에러면 다음 후보로
        if (apiData.type === "error" || apiData.error || !apiData.content) {
          lastErr = new Error(apiData.error?.message || `${model} 호출 실패`);
          continue;
        }
        workingModelRef.current = model;
        setActiveModel(model);
        return apiData;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("모든 모델 호출에 실패했습니다.");
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setBusy(true);
    try {
      const prompt = `현재 문서(JSON):\n${JSON.stringify(serializeDoc(doc))}\n\n요청: ${msg}`;
      const apiData = await callModel(prompt);
      const raw = (apiData.content || [])
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .replace(/```json|```/g, "")
        .trim();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("AI 응답을 JSON으로 해석하지 못했습니다. 다시 시도해 주세요.");
      }
      const err = validateDocJson(json); // 게이트웨이 검증 (명세 [5])
      if (err) throw new Error(`검증 실패: ${err}`);
      const prevDoc = doc; // 되돌리기 스냅샷
      setDoc(hydrateDoc(json));
      setMessages((m) => [
        ...m,
        { role: "ai", text: `문서를 갱신했어요 — 「${json.title}」, 섹션 ${json.sections.length}개`, prevDoc },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: e.message || "요청에 실패했습니다." }]);
    } finally {
      setBusy(false);
    }
  };

  const chips = ["게임 개발 주간 보고서", "스프라이트 제작 사업계획서", "팀 회의록 양식"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <span style={{ color: T.accent, display: "flex" }}><IcSpark size={16} /></span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>AI 문서 도우미</span>
        {activeModel && (
          <span
            style={{
              marginLeft: "auto", fontSize: 9, fontWeight: 600,
              fontFamily: T.mono, color: activeModel === "claude-fable-5" ? T.accent : T.inkFaint,
              background: activeModel === "claude-fable-5" ? T.accentSoft : T.paper,
              border: `1px solid ${activeModel === "claude-fable-5" ? T.accentLine : T.line}`,
              borderRadius: 5, padding: "2px 6px",
            }}
            title={`현재 응답 모델: ${activeModel}`}
          >
            {activeModel === "claude-fable-5" ? "Fable 5" : "Sonnet 4.6"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
        {chips.map((c) => (
          <button
            key={c}
            disabled={busy}
            onClick={() => send(`${c} 초안을 작성해줘`)}
            style={{ fontSize: 10.5, fontWeight: 600, color: T.accent, background: T.accentSoft, border: `1px solid ${T.accentLine}`, borderRadius: 99, padding: "4px 9px", cursor: busy ? "default" : "pointer", fontFamily: T.font, opacity: busy ? 0.5 : 1 }}
          >
            {c}
          </button>
        ))}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2, minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
            <div
              style={{
                fontSize: 11.5, lineHeight: 1.55, padding: "8px 11px",
                borderRadius: m.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                background: m.role === "user" ? T.accent : m.role === "error" ? "#FEF1F1" : T.paper,
                color: m.role === "user" ? "white" : m.role === "error" ? "#C0392B" : T.ink,
                border: m.role === "user" ? "none" : `1px solid ${m.role === "error" ? "#F5C9C9" : T.line}`,
              }}
            >
              {m.text}
            </div>
            {m.prevDoc && (
              <button
                onClick={() => setDoc(m.prevDoc)}
                style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: T.inkSoft, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontFamily: T.font }}
              >
                <IcRestore size={11} /> 이전 문서로 되돌리기
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: "flex-start", display: "flex", gap: 4, padding: "10px 12px", background: T.paper, border: `1px solid ${T.line}`, borderRadius: "12px 12px 12px 3px" }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: T.inkFaint, animation: `aiDot 1s ${i * 0.18}s infinite ease-in-out` }} />
            ))}
            <style>{`@keyframes aiDot { 0%,100% { opacity:.25; transform: translateY(0);} 50% { opacity:1; transform: translateY(-2px);} }`}</style>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") send();
          }}
          placeholder={busy ? "작성 중…" : "예: 분기 보고서 만들어줘"}
          style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.line}`, padding: "0 11px", fontSize: 12, fontFamily: T.font, outline: "none", background: busy ? T.paper : "white", color: T.ink }}
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          style={{ width: 34, height: 34, borderRadius: 9, border: "none", background: busy || !input.trim() ? T.line : T.accent, color: "white", cursor: busy || !input.trim() ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <IcSend size={14} />
        </button>
      </div>
      <p style={{ fontSize: 10, color: T.inkFaint, margin: "7px 0 0", lineHeight: 1.5 }}>
        생성 시 캔버스의 문서가 교체됩니다. 각 응답의 '되돌리기'로 복구할 수 있어요.
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════
// 홈 대시보드
// ═════════════════════════════════════════════
function Home({ onOpenDoc }) {
  const [hovered, setHovered] = useState(null);
  const cards = [
    { key: "doc", title: "문서", desc: "A4 위에 표와 텍스트를 배치하는 편집기", ready: true },
    { key: "sheet", title: "시트", desc: "수식으로 계산하는 격자 편집기", ready: false },
    { key: "board", title: "대시보드", desc: "위젯으로 요약하는 한 장짜리 보드", ready: false },
  ];
  const recents = [
    { title: "스프라이트 명세서", time: "2시간 전 수정", kind: "doc" },
    { title: "프레임 용량 계산", time: "어제 수정", kind: "sheet" },
    { title: "게임 기획 보고서", time: "3일 전 수정", kind: "doc" },
    { title: "마일스톤 현황", time: "지난주 수정", kind: "board" },
  ];
  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: T.font, color: T.ink }}>
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "0 32px", height: 60, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: T.accent, position: "relative", boxShadow: "0 2px 6px rgba(43,92,230,0.35)" }}>
            <div style={{ position: "absolute", top: 0, right: 0, width: 9, height: 9, background: "white", opacity: 0.9, borderRadius: "0 7px 0 4px" }} />
          </div>
          <span style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: "-0.02em" }}>문서 스튜디오</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, background: T.paper, border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 12px", width: 300, color: T.inkFaint }}>
          <IcSearch size={15} />
          <input placeholder="프로젝트 검색" style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, fontFamily: T.font, flex: 1, color: T.ink }} />
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "56px 32px 80px" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: T.accent, letterSpacing: "0.08em", margin: "0 0 10px" }}>새로 만들기</p>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 6px", lineHeight: 1.25 }}>
          오늘 어떤 문서를<br />만드실 건가요?
        </h1>
        <p style={{ fontSize: 14, color: T.inkSoft, margin: "0 0 36px" }}>편집기를 선택하면 바로 새 문서가 열립니다.</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginBottom: 72 }}>
          {cards.map((card) => {
            const hov = hovered === card.key;
            return (
              <button
                key={card.key}
                onClick={card.ready ? onOpenDoc : undefined}
                onMouseEnter={() => setHovered(card.key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  textAlign: "left", background: T.surface,
                  border: `1px solid ${hov && card.ready ? T.accentLine : T.line}`,
                  borderRadius: 16, padding: 0,
                  cursor: card.ready ? "pointer" : "not-allowed",
                  overflow: "hidden", fontFamily: T.font,
                  transition: "border-color .18s, box-shadow .18s, transform .18s",
                  boxShadow: hov && card.ready ? "0 12px 32px rgba(26,34,51,0.10)" : "0 1px 2px rgba(26,34,51,0.04)",
                  transform: hov && card.ready ? "translateY(-3px)" : "none",
                }}
              >
                <div style={{ height: 150, background: `linear-gradient(180deg, ${T.paper} 0%, #EDF0F6 100%)`, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${T.line}`, filter: card.ready ? "none" : "grayscale(0.35)", opacity: card.ready ? 1 : 0.75 }}>
                  <div style={{ transform: hov && card.ready ? "translateY(-4px) rotate(-1.2deg)" : "none", transition: "transform .22s" }}>
                    <PaperDoc kind={card.key} />
                  </div>
                </div>
                <div style={{ padding: "14px 16px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>{card.title}</span>
                    {!card.ready && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: T.inkFaint, border: `1px solid ${T.line}`, borderRadius: 99, padding: "2px 7px", background: T.paper }}>준비 중</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>{card.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>최근 문서</h2>
          <span style={{ fontSize: 12, color: T.inkFaint }}>{recents.length}개</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {recents.map((doc) => (
            <button
              key={doc.title}
              onClick={onOpenDoc}
              style={{ textAlign: "left", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: 0, cursor: "pointer", overflow: "hidden", fontFamily: T.font, transition: "border-color .15s, box-shadow .15s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.accentLine;
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(26,34,51,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.line;
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div style={{ height: 96, background: T.paper, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${T.line}` }}>
                <PaperDoc kind={doc.kind} w={58} h={76} />
              </div>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.title}</div>
                <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 3 }}>{doc.time}</div>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════
// 템플릿 선택 팝업
// ═════════════════════════════════════════════
function TemplateDialog({ onStart, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(26,34,51,0.42)", fontFamily: T.font, backdropFilter: "blur(2px)" }} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 18, width: 460, padding: 26, boxShadow: "0 24px 60px rgba(26,34,51,0.28)", color: T.ink }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 4px" }}>어떻게 시작할까요?</h2>
        <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 18px" }}>빈 문서 또는 템플릿으로 시작할 수 있어요.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <button onClick={onStart} style={{ padding: 16, borderRadius: 14, textAlign: "left", border: `1.5px solid ${T.accent}`, background: T.accentSoft, cursor: "pointer", fontFamily: T.font }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <PaperDoc kind="doc" w={62} h={80} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>새 문서 만들기</div>
            <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 3 }}>빈 A4 + 기본 표 1개</div>
          </button>
          <button disabled style={{ padding: 16, borderRadius: 14, textAlign: "left", border: `1px solid ${T.line}`, background: T.paper, cursor: "not-allowed", opacity: 0.6, fontFamily: T.font }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, filter: "grayscale(0.5)" }}>
              <PaperDoc kind="doc" w={62} h={80} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.inkSoft }}>보고서 양식</div>
            <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 3 }}>준비 중</div>
          </button>
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: "9px 0", borderRadius: 10, border: "none", background: "transparent", fontSize: 12.5, color: T.inkSoft, cursor: "pointer", fontFamily: T.font }}>
          취소
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════
// A4 워크스페이스 (문서 모델 + AI 탭)
// ═════════════════════════════════════════════
function Workspace({ onHome }) {
  const [doc, setDoc] = useState({
    title: "스프라이트 명세서",
    sections: [
      {
        heading: "캐릭터 목록",
        level: 1,
        blocks: [
          {
            type: "table",
            data: makeTableData([
              ["캐릭터", "방향", "프레임", "상태"],
              ["슬라임", "8방향", "6", "대기"],
              ["기사", "8방향", "8", "이동"],
            ]),
          },
        ],
      },
    ],
  });
  const [focus, setFocus] = useState(null); // {tableId:"sec-blk", r, c}
  const [zoom, setZoom] = useState(100);
  const [showGuides, setShowGuides] = useState(true);
  const [rightTab, setRightTab] = useState("props"); // "props" | "ai"

  const numbered = useMemo(() => assignNumbers(doc.sections), [doc.sections]);

  // 주소 기반 표 데이터 업데이트 (명세 원칙 7)
  const updateTableAt = (secIdx, blkIdx) => (fn) =>
    setDoc((prev) => ({
      ...prev,
      sections: prev.sections.map((s, si) =>
        si !== secIdx
          ? s
          : { ...s, blocks: s.blocks.map((b, bi) => (bi !== blkIdx ? b : { ...b, data: fn(b.data) })) }
      ),
    }));

  const parseFocusId = (id) => id.split("-").map(Number);
  const focusedData = useMemo(() => {
    if (!focus) return null;
    const [si, bi] = parseFocusId(focus.tableId);
    return doc.sections[si]?.blocks[bi]?.data ?? null;
  }, [focus, doc]);
  const focusedVAlign = focusedData?.vAligns[`${focus?.r}-${focus?.c}`] || "middle";

  const setVAlign = (v) => {
    if (!focus) return;
    const [si, bi] = parseFocusId(focus.tableId);
    updateTableAt(si, bi)((t) => ({ ...t, vAligns: { ...t.vAligns, [`${focus.r}-${focus.c}`]: v } }));
  };

  const addTable = () =>
    setDoc((prev) => {
      const sections = [...prev.sections];
      if (sections.length === 0)
        return { ...prev, sections: [{ heading: "새 섹션", level: 1, blocks: [{ type: "table", data: makeTableData(DEFAULT_ROWS) }] }] };
      const last = sections.length - 1;
      sections[last] = { ...sections[last], blocks: [...sections[last].blocks, { type: "table", data: makeTableData(DEFAULT_ROWS) }] };
      return { ...prev, sections };
    });

  const iconBtn = (active, disabled) => ({
    width: 28, height: 28, borderRadius: 7,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none",
    background: active ? T.accentSoft : "transparent",
    color: disabled ? T.inkFaint : active ? T.accent : T.inkSoft,
    cursor: disabled ? "default" : "pointer",
    transition: "background .12s, color .12s",
  });
  const selectStyle = { height: 28, borderRadius: 7, border: `1px solid ${T.line}`, background: T.surface, fontSize: 12, color: T.ink, fontFamily: T.font, padding: "0 6px", outline: "none" };
  const Divider = () => <span style={{ width: 1, height: 18, background: T.line, margin: "0 6px", flexShrink: 0 }} />;

  const sideItems = [
    { icon: <IcSpark size={18} />, label: "AI", action: () => setRightTab((t) => (t === "ai" ? "props" : "ai")), active: rightTab === "ai" },
    { icon: <IcTable size={18} />, label: "표", action: addTable },
    { icon: <IcText size={18} />, label: "텍스트", disabled: true },
    { icon: <IcImage size={18} />, label: "이미지", disabled: true },
    { icon: <IcFolder size={18} />, label: "프로젝트", disabled: true },
    { icon: <IcLayers size={18} />, label: "레이어", disabled: true },
  ];

  const headingStyle = (level) =>
    level === 1
      ? { fontSize: 16.5, fontWeight: 800, letterSpacing: "-0.02em", margin: "18px 0 8px", paddingBottom: 5, borderBottom: `2px solid ${T.ink}` }
      : level === 2
      ? { fontSize: 14, fontWeight: 700, margin: "14px 0 6px 8px" }
      : { fontSize: 13, fontWeight: 600, margin: "10px 0 5px 18px" };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.canvas, fontFamily: T.font, color: T.ink, overflow: "hidden" }}>
      {/* ── 상단 툴바 ── */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "0 10px", height: 46, display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 5, height: 30, padding: "0 11px 0 7px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.surface, fontSize: 12, fontWeight: 600, color: T.inkSoft, cursor: "pointer", fontFamily: T.font, marginRight: 4 }}>
          <IcBack size={14} /> 홈
        </button>
        <button style={iconBtn(false)} title="실행 취소"><IcUndo /></button>
        <button style={iconBtn(false)} title="다시 실행"><IcRedo /></button>
        <Divider />
        <select style={selectStyle}><option>바탕글</option></select>
        <select style={{ ...selectStyle, marginLeft: 4 }}><option>함초롬바탕</option></select>
        <select style={{ ...selectStyle, marginLeft: 4, width: 68 }}><option>16.0 pt</option></select>
        <Divider />
        <button style={{ ...iconBtn(false), fontWeight: 800, fontSize: 13 }}>B</button>
        <button style={{ ...iconBtn(false), fontStyle: "italic", fontSize: 13, fontWeight: 600 }}>I</button>
        <button style={{ ...iconBtn(false), textDecoration: "underline", fontSize: 13, fontWeight: 600 }}>U</button>
        <Divider />
        <span style={{ fontSize: 11, color: T.inkFaint, margin: "0 4px 0 2px" }}>세로 정렬</span>
        <div style={{ display: "inline-flex", gap: 1, padding: 2, background: T.paper, borderRadius: 9, border: `1px solid ${T.line}` }}>
          {[
            { v: "top", icon: <IcVTop />, label: "상단 정렬" },
            { v: "middle", icon: <IcVMid />, label: "가운데 정렬" },
            { v: "bottom", icon: <IcVBottom />, label: "하단 정렬" },
          ].map((o) => {
            const active = focus && focusedVAlign === o.v;
            return (
              <button
                key={o.v}
                title={o.label}
                disabled={!focus}
                onClick={() => setVAlign(o.v)}
                style={{
                  width: 26, height: 22, borderRadius: 6, border: "none",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: active ? T.surface : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(26,34,51,0.15)" : "none",
                  color: !focus ? T.inkFaint : active ? T.accent : T.inkSoft,
                  cursor: focus ? "pointer" : "default", transition: "all .12s",
                }}
              >
                {o.icon}
              </button>
            );
          })}
        </div>
        <Divider />
        <button
          onClick={() => setShowGuides((v) => !v)}
          style={{ height: 28, padding: "0 10px", borderRadius: 8, border: `1px solid ${showGuides ? T.accentLine : T.line}`, background: showGuides ? T.accentSoft : T.surface, color: showGuides ? T.accent : T.inkSoft, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}
        >
          핸들 가이드
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── 좌측 사이드바 ── */}
        <div style={{ width: 58, background: T.surface, borderRight: `1px solid ${T.line}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 2, flexShrink: 0 }}>
          {sideItems.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              disabled={item.disabled}
              title={item.disabled ? `${item.label} (준비 중)` : item.label}
              style={{
                width: 46, padding: "8px 0", borderRadius: 10, border: "none",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                background: item.active ? T.accentSoft : "transparent",
                color: item.disabled ? T.inkFaint : item.active ? T.accent : T.inkSoft,
                cursor: item.disabled ? "default" : "pointer",
                opacity: item.disabled ? 0.55 : 1,
                fontFamily: T.font, transition: "background .12s, color .12s",
              }}
              onMouseEnter={(e) => {
                if (item.disabled || item.active) return;
                e.currentTarget.style.background = T.accentSoft;
                e.currentTarget.style.color = T.accent;
              }}
              onMouseLeave={(e) => {
                if (item.active) return;
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = item.disabled ? T.inkFaint : T.inkSoft;
              }}
            >
              {item.icon}
              <span style={{ fontSize: 9.5, fontWeight: 600 }}>{item.label}</span>
            </button>
          ))}
        </div>

        {/* ── 중앙 캔버스 ── */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", padding: "36px 0" }} onMouseDown={() => setFocus(null)}>
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{ position: "relative", width: PAGE_W, minHeight: PAGE_H, background: "white", boxShadow: "0 1px 3px rgba(26,34,51,0.10), 0 16px 48px rgba(26,34,51,0.14)", borderRadius: 2 }}
            >
              <div style={{ position: "absolute", inset: MARGIN, border: `1px dashed ${T.accentLine}`, pointerEvents: "none" }} />
              {[
                { text: "위 10mm", style: { top: -24, left: "50%", transform: "translateX(-50%)" } },
                { text: "아래 10mm", style: { bottom: -24, left: "50%", transform: "translateX(-50%)" } },
                { text: "좌 10mm", style: { left: -10, top: "50%", transform: "translate(-100%, -50%)" } },
                { text: "우 10mm", style: { right: -10, top: "50%", transform: "translate(100%, -50%)" } },
              ].map((l) => (
                <span key={l.text} style={{ position: "absolute", ...l.style, fontSize: 10, fontWeight: 600, color: T.accent, background: T.accentSoft, border: `1px solid ${T.accentLine}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>
                  {l.text}
                </span>
              ))}

              {/* 본문: 제목 + 섹션(자동 번호 Ⅰ/1/가) + 블록 */}
              <div style={{ padding: MARGIN + 10, boxSizing: "border-box", minHeight: PAGE_H }}>
                <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", textAlign: "center", margin: "6px 0 20px" }}>
                  {doc.title}
                </h1>
                {numbered.map((sec, si) => (
                  <div key={si}>
                    <div style={headingStyle(sec.level)}>
                      {sec.number}. {sec.heading}
                    </div>
                    {sec.blocks.map((blk, bi) => {
                      if (blk.type === "para")
                        return (
                          <p key={bi} style={{ fontSize: 12.5, lineHeight: 1.75, margin: "6px 0 10px", paddingLeft: sec.level > 1 ? 8 : 0, textAlign: "justify" }}>
                            {blk.text}
                          </p>
                        );
                      if (blk.type === "list") {
                        const ListTag = blk.ordered ? "ol" : "ul";
                        return (
                          <ListTag key={bi} style={{ fontSize: 12.5, lineHeight: 1.8, margin: "4px 0 10px", paddingLeft: 26 }}>
                            {blk.items.map((it, k) => (
                              <li key={k}>{it}</li>
                            ))}
                          </ListTag>
                        );
                      }
                      return (
                        <TableBlock
                          key={bi}
                          tableId={`${si}-${bi}`}
                          data={blk.data}
                          update={updateTableAt(si, bi)}
                          focus={focus}
                          setFocus={setFocus}
                          showGuides={showGuides}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── 우측 패널: 속성 또는 AI ── */}
        <div style={{ width: 260, background: T.surface, borderLeft: `1px solid ${T.line}`, padding: 16, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {rightTab === "ai" ? (
            <AiPanel doc={doc} setDoc={setDoc} />
          ) : focus ? (
            <div style={{ fontSize: 12, color: T.inkSoft }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 12 }}>셀 속성</div>
              <div style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: 10, padding: 12, fontFamily: T.mono, fontSize: 11.5, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 7, columnGap: 12 }}>
                <span style={{ color: T.inkFaint }}>rowIndex</span>
                <span style={{ color: T.ink }}>{focus.r}</span>
                <span style={{ color: T.inkFaint }}>colIndex</span>
                <span style={{ color: T.ink }}>{focus.c}</span>
                <span style={{ color: T.inkFaint }}>vAlign</span>
                <span style={{ color: T.accent }}>"{focusedVAlign}"</span>
                <span style={{ color: T.inkFaint }}>width</span>
                <span style={{ color: T.ink }}>{Math.round(focusedData?.widths[focus.r][focus.c] ?? 0)}px</span>
              </div>
              <p style={{ fontSize: 11, color: T.inkFaint, lineHeight: 1.6, marginTop: 12 }}>
                세로 정렬 버튼은 이 셀의 vAlign만 바꿉니다.
              </p>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.inkFaint }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: T.paper, border: `1px solid ${T.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IcTable size={18} />
              </div>
              <span style={{ fontSize: 12 }}>선택된 항목이 없습니다.</span>
              <span style={{ fontSize: 11, textAlign: "center", lineHeight: 1.5 }}>
                셀을 클릭하면 속성이,
                <br />
                AI 탭을 누르면 도우미가 열립니다.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── 하단 상태바 ── */}
      <div style={{ background: T.surface, borderTop: `1px solid ${T.line}`, padding: "0 14px", height: 34, display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: T.inkSoft, flexShrink: 0 }}>
        <span>문서 노트</span>
        <span>섹션 {doc.sections.length}개</span>
        <span style={{ margin: "0 auto", background: T.paper, border: `1px solid ${T.line}`, borderRadius: 6, padding: "2px 10px", fontWeight: 600, color: T.ink }}>1</span>
        <input type="range" min={50} max={200} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110, accentColor: T.accent }} />
        <span style={{ width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{zoom}%</span>
        <span>페이지 1/1</span>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════
// 앱 루트
// ═════════════════════════════════════════════
export default function DocumentStudio() {
  const [view, setView] = useState("home");
  const [dialog, setDialog] = useState(false);
  return (
    <>
      {view === "home" && <Home onOpenDoc={() => setDialog(true)} />}
      {view === "editor" && <Workspace onHome={() => setView("home")} />}
      {dialog && (
        <TemplateDialog
          onStart={() => {
            setDialog(false);
            setView("editor");
          }}
          onClose={() => setDialog(false)}
        />
      )}
    </>
  );
}
