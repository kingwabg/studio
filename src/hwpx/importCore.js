// importCore.js — rhwp 파서로 외부 hwp/hwpx → 문서 JSON (가져오기)
//
// 아키텍처상 위치: [가져오기]. rhwp가 파싱을 담당하고(재발명하지 않는다),
// 이 모듈은 rhwp의 저수준 읽기 API를 우리 문서 JSON(title/sections/blocks)으로 접는다.
// table-king 등 UI 모델은 모른다 — 표는 중립 형태 { rows, merges }로 반환하고
// DocumentStudio가 자기 표 모델로 변환한다.
//
// 매핑 규칙:
//  - 1×1 표 = 텍스트 블록. 우리 내보내기가 텍스트를 1×1 무테두리 표로 싣는
//    검증된 매핑의 역방향이라, 우리 파일은 손실 없이 왕복한다.
//  - 머리글 감지: 한국 공문서 번호 패턴 (Ⅰ. / 1. / 가.) → 섹션 (번호는 벗겨서 저장 —
//    편집기가 assignNumbers로 다시 매기므로 이중 번호를 막는다)
//  - 제목: 첫 텍스트 블록이 번호 없는 한 줄 짧은 글이면 제목으로 승격
//  - 글머리표(• / 1.) 여러 줄 텍스트 → list 블록
//
// 이 파일은 순수 로직(HwpDocument → JSON)만 담아 Node 검증 하네스에서도 돌 수 있다.
// WASM 로딩(rhwpLoader, Vite 전용 ?url)은 importHwpx 안의 dynamic import로만 닿는다.

const ROMAN_RE = /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ])\s*\.\s*(.+)$/;
const NUM_RE = /^(\d{1,2})\s*\.\s*(.+)$/;
const HANGUL_RE = /^([가-하])\s*\.\s*(.+)$/;
const HANGUL_ORDER = "가나다라마바사아자차카타파하";

// 텍스트 한 줄 → 머리글이면 { level, heading }, 아니면 null
function headingOf(line) {
  const roman = ROMAN_RE.exec(line);
  if (roman) return { level: 1, heading: roman[2].trim() };
  const num = NUM_RE.exec(line);
  if (num) return { level: 2, heading: num[2].trim() };
  const hangul = HANGUL_RE.exec(line);
  if (hangul && HANGUL_ORDER.includes(hangul[1])) return { level: 3, heading: hangul[2].trim() };
  return null;
}

// 여러 줄 텍스트 → list 블록이 자연스러우면 { items, ordered }, 아니면 null
function listOf(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (lines.every((l) => /^[•·-]\s+/.test(l)))
    return { items: lines.map((l) => l.replace(/^[•·-]\s+/, "")), ordered: false };
  if (lines.every((l, i) => new RegExp(`^${i + 1}\\.\\s+`).test(l)))
    return { items: lines.map((l) => l.replace(/^\d+\.\s+/, "")), ordered: true };
  return null;
}

// 문서에서 읽기 순서대로 원시 블록을 뽑는다: {kind:"text"|"table", ...}
function collectRaw(doc) {
  const raw = [];
  const secCount = doc.getSectionCount();
  for (let s = 0; s < secCount; s++) {
    const paraCount = doc.getParagraphCount(s);
    for (let p = 0; p < paraCount; p++) {
      // 본문 문단 텍스트 (우리 내보내기 파일은 비어 있고, 한글제 문서는 여기가 본문)
      const len = doc.getParagraphLength(s, p);
      if (len > 0) {
        const text = doc.getTextRange(s, p, 0, len).trim();
        if (text) raw.push({ kind: "text", text });
      }
      // 문단에 앵커된 컨트롤 중 표를 순서대로 (표가 아닌 컨트롤은 조회가 실패하므로 건너뜀)
      let controls = [];
      try {
        controls = JSON.parse(doc.getControlTextPositions(s, p)) ?? [];
      } catch {
        controls = [];
      }
      for (let c = 0; c < controls.length; c++) {
        let dims;
        try {
          dims = JSON.parse(doc.getTableDimensions(s, p, c));
        } catch {
          continue; // 그림·수식 등 표가 아닌 컨트롤
        }
        const { rowCount, colCount, cellCount } = dims;
        const rows = Array.from({ length: rowCount }, () => Array(colCount).fill(""));
        const merges = [];
        // 원본 셀 크기 복원 — HWPUNIT ÷ 75 = px (283.465unit/mm ÷ 3.7795px/mm).
        // 병합 앵커의 크기는 스팬 전체 합이므로 덮인 칸에 균등 분배해 둔다.
        const widthsPx = Array.from({ length: rowCount }, () => Array(colCount).fill(0));
        const heightsPx = Array.from({ length: rowCount }, () => Array(colCount).fill(0));
        for (let ci = 0; ci < cellCount; ci++) {
          const info = JSON.parse(doc.getCellInfo(s, p, c, ci));
          const cellParas = doc.getCellParagraphCount(s, p, c, ci);
          const lines = [];
          for (let cp = 0; cp < cellParas; cp++) {
            const cl = doc.getCellParagraphLength(s, p, c, ci, cp);
            lines.push(cl > 0 ? doc.getTextInCell(s, p, c, ci, cp, 0, cl) : "");
          }
          rows[info.row][info.col] = lines.join("\n").replace(/\s+$/, "");
          if (info.rowSpan > 1 || info.colSpan > 1)
            merges.push({ r: info.row, c: info.col, rs: info.rowSpan, cs: info.colSpan });
          try {
            const props = JSON.parse(doc.getCellProperties(s, p, c, ci));
            if (props.width > 0 && props.height > 0) {
              for (let rr = info.row; rr < info.row + info.rowSpan; rr++)
                for (let cc = info.col; cc < info.col + info.colSpan; cc++) {
                  widthsPx[rr][cc] = props.width / 75 / info.colSpan;
                  heightsPx[rr][cc] = props.height / 75 / info.rowSpan;
                }
            }
          } catch {
            // 크기 조회 실패 시 0으로 남음 — 소비자가 균등 폭으로 폴백
          }
        }
        if (rowCount === 1 && colCount === 1) {
          // 1×1 표 = 텍스트 블록 (우리 내보내기 매핑의 역방향)
          const text = rows[0][0].trim();
          if (text) raw.push({ kind: "text", text });
        } else {
          // 크기 배열은 전부 채워졌을 때만 신뢰 (일부 실패 시 균등 폭이 안전)
          const complete = widthsPx.every((r) => r.every((v) => v > 0));
          raw.push({
            kind: "table",
            rows,
            merges,
            widthsPx: complete ? widthsPx : undefined,
            heightsPx: complete ? heightsPx : undefined,
          });
        }
      }
    }
  }
  return raw;
}

// 원시 블록 → 문서 JSON { title, sections:[{heading, level, blocks}] }
function fold(raw, fallbackTitle) {
  let title = fallbackTitle;
  let i = 0;
  // 제목 승격: 첫 블록이 번호 없는 한 줄 짧은 텍스트일 때
  if (raw.length && raw[0].kind === "text") {
    const t = raw[0].text;
    if (!t.includes("\n") && t.length <= 60 && !headingOf(t)) {
      title = t;
      i = 1;
    }
  }

  const sections = [];
  // 머리글 앞에 놓인 내용의 거처 — 실제 머리글을 만나기 전까지만 쓰인다
  const openSection = (heading, level) => {
    sections.push({ heading, level, blocks: [] });
    return sections[sections.length - 1];
  };
  let cur = null;

  for (; i < raw.length; i++) {
    const b = raw[i];
    if (b.kind === "text") {
      const h = !b.text.includes("\n") && headingOf(b.text);
      if (h) {
        cur = openSection(h.heading, h.level);
        continue;
      }
      if (!cur) cur = openSection("본문", 1);
      const list = listOf(b.text);
      cur.blocks.push(list ? { type: "list", ...list } : { type: "para", text: b.text });
    } else {
      if (!cur) cur = openSection("본문", 1);
      cur.blocks.push({
        type: "table",
        rows: b.rows,
        merges: b.merges,
        widthsPx: b.widthsPx,
        heightsPx: b.heightsPx,
      });
    }
  }

  // 편집기 불변식: 섹션 ≥ 1, 각 섹션 블록 ≥ 1
  const nonEmpty = sections.filter((s) => s.blocks.length > 0 || s.heading !== "본문");
  for (const s of nonEmpty) if (s.blocks.length === 0) s.blocks.push({ type: "para", text: "" });
  if (nonEmpty.length === 0)
    nonEmpty.push({ heading: "본문", level: 1, blocks: [{ type: "para", text: "" }] });
  return { title, sections: nonEmpty };
}

// 이미 열린 HwpDocument → 문서 JSON (순수 — Node 하네스가 직접 호출)
export function importFromDocument(doc, fallbackTitle = "가져온 문서") {
  return fold(collectRaw(doc), fallbackTitle);
}

// hwp/hwpx 바이트 → 문서 JSON. fallbackTitle은 보통 파일 이름. (브라우저 전용 경로)
export async function importHwpx(bytes, fallbackTitle = "가져온 문서") {
  const { openDocument } = await import("./rhwpLoader.js");
  const doc = await openDocument(bytes);
  try {
    return importFromDocument(doc, fallbackTitle);
  } finally {
    doc.free(); // wasm 힙 명시 해제
  }
}
