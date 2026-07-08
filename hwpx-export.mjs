// hwpx-export.mjs — 캔바식 캔버스 모델 → HWPX 내보내기 어댑터
//
// 아키텍처: [진실] 캔버스 JSON → (이 어댑터) → [직렬화] HWPX
// 매핑 표:
//   캔버스 요소            → HWPX 개체
//   ─────────────────────────────────────────────────────
//   { type:"text", x,y,w,h, text }   → 무테두리 1×1 표 (borderFill=1), 종이 기준 절대 위치
//   { type:"table", x,y,w,h, rows }  → hp:tbl (borderFill=2), 종이 기준 절대 위치
//   x, y, w, h (mm)                  → hp:pos horzOffset/vertOffset, hp:sz (HWPUNIT)
//   vertRelTo/horzRelTo="PAPER" + treatAsChar="0"  ← 절대 배치의 핵심
//
// 사용법:  npm install kordoc jszip
//   import { canvasToHwpx } from './hwpx-export.mjs'
//   const buf = await canvasToHwpx(canvasJson)   // → .hwpx Buffer

import { markdownToHwpx } from "kordoc";
import JSZip from "jszip";

const MM = 283.465; // 1mm = 7200/25.4 HWPUNIT
const mm = (v) => Math.round(v * MM);
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let idSeq = 2000;

// ── 개체 공통: 종이 기준 절대 위치 + 크기 ──
const szPos = (el) =>
  `<hp:sz width="${mm(el.w)}" widthRelTo="ABSOLUTE" height="${mm(el.h)}" heightRelTo="ABSOLUTE" protect="0"/>` +
  `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" ` +
  `vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" ` +
  `vertOffset="${mm(el.y)}" horzOffset="${mm(el.x)}"/>` +
  `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`;

// ── 셀 하나 ──
const cell = (text, r, c, wU, hU, borderFill) =>
  `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="${borderFill}">` +
  `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
  `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
  `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>` +
  `</hp:subList>` +
  `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
  `<hp:cellSz width="${wU}" height="${hU}"/>` +
  `<hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;

// ── 표 요소 → hp:tbl ──
function tableXml(el, borderFill = "2") {
  const rows = el.rows;
  const rc = rows.length, cc = rows[0].length;
  const cw = Math.round(mm(el.w) / cc), ch = Math.round(mm(el.h) / rc);
  const trs = rows
    .map((row, r) =>
      `<hp:tr>${row.map((t, c) => cell(t, r, c, cw, ch, borderFill)).join("")}</hp:tr>`)
    .join("");
  return (
    `<hp:tbl id="${++idSeq}" zOrder="${idSeq}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
    `pageBreak="CELL" repeatHeader="0" rowCnt="${rc}" colCnt="${cc}" cellSpacing="0" ` +
    `borderFillIDRef="${borderFill}" noShading="0">` + szPos(el) + trs + `</hp:tbl>`
  );
}

// ── 텍스트 요소 → 무테두리 1×1 표 ──
const textXml = (el) =>
  tableXml({ ...el, rows: [[el.text]] }, "1");

// ── 캔버스 → section0.xml 본문 ──
function buildSection(refSectionXml, canvas) {
  // 검증된 봉투 재사용: 첫 문단(용지 설정 포함)까지 유지, 본문만 교체
  const headEnd = refSectionXml.indexOf("</hp:p>") + "</hp:p>".length;
  const head = refSectionXml.slice(0, headEnd);
  const controls = canvas.elements
    .map((el) => (el.type === "table" ? tableXml(el) : textXml(el)))
    .join("");
  // 모든 절대 위치 개체를 담는 호스트 문단 하나
  const host =
    `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">` +
    controls + `<hp:t></hp:t></hp:run></hp:p>`;
  return head + host + `</hs:sec>`;
}

// ── 공개 API ──
export async function canvasToHwpx(canvas) {
  // 1) kordoc으로 유효한 기본 패키지(헤더·폰트·테두리 정의 포함) 생성
  const base = await markdownToHwpx(" ");
  const zip = await JSZip.loadAsync(Buffer.from(base));
  // 2) 본문 교체
  const refSection = await zip.file("Contents/section0.xml").async("string");
  zip.file("Contents/section0.xml", buildSection(refSection, canvas));
  // 3) 미리보기 텍스트 갱신
  const preview = canvas.elements
    .map((el) => (el.type === "text" ? el.text : el.rows.map((r) => r.join(" ")).join("\n")))
    .join("\n");
  if (zip.file("Preview/PrvText.txt")) zip.file("Preview/PrvText.txt", preview);
  // 4) 재압축 (mimetype은 무압축 저장이 관례)
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    // mimetype 파일만 STORE
    streamFiles: false,
  });
}

// ═══════════════ 데모 + 왕복 검증 ═══════════════
if (import.meta.url === `file://${process.argv[1]}`) {
  const { validateHwpx, parse, renderHwpxToSvg, blocksToMarkdown } = await import("kordoc");
  const fs = await import("fs");

  // [진실] 캔바식 자유 배치 캔버스 (A4, mm 좌표)
  const canvas = {
    page: { w: 210, h: 297 },
    elements: [
      { type: "text",  x: 55,  y: 25,  w: 100, h: 12, text: "스프라이트 명세서" },
      { type: "table", x: 20,  y: 50,  w: 120, h: 30,
        rows: [["캐릭터", "방향", "상태"], ["슬라임", "8방향", "대기"], ["기사", "8방향", "이동"]] },
      { type: "text",  x: 150, y: 55,  w: 45,  h: 20, text: "우측 여백의 메모 상자 — 캔버스 좌표 그대로 배치됨" },
      { type: "table", x: 60,  y: 120, w: 90,  h: 20,
        rows: [["항목", "값"], ["프레임 수", "6"]] },
    ],
  };

  const buf = await canvasToHwpx(canvas);
  fs.writeFileSync("/mnt/user-data/outputs/canvas-sample.hwpx", buf);
  console.log("① 내보내기 완료:", buf.length, "bytes");

  // ② 구조 검증
  const v = await validateHwpx(buf);
  console.log("② validateHwpx:", JSON.stringify(v).slice(0, 200));

  // ③ 되읽기(파싱) — 내용이 살아있는가
  const parsed = await parse(buf, { filename: "canvas-sample.hwpx" });
  console.log("③ 되읽은 내용 (마크다운 변환):");
  const md = blocksToMarkdown(parsed.blocks);
  md.split("\n").filter(Boolean).slice(0, 12).forEach((l) => console.log("   ", l.slice(0, 90)));

  // ④ 시각 렌더링 — 절대 좌표가 실제로 반영됐는가 (reflow: 합성 조판)
  try {
    const r = await renderHwpxToSvg(buf, { page: 0, reflow: true });
    const svgStr = r.svg; // { svg, width, height, pageCount, warnings, stats }
    fs.writeFileSync("/mnt/user-data/outputs/canvas-sample.svg", svgStr);
    console.log("④ SVG 렌더링 저장 완료 (", svgStr.length, "chars,", r.pageCount, "페이지 )");
  } catch (e) {
    console.log("④ SVG 렌더링 건너뜀:", e.message?.slice(0, 120));
  }
}
