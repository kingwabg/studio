// exportCore.js — 캔버스 JSON → HWPX 내보내기 코어 (제품용, 의존성 0)
//
// 아키텍처: [진실] 캔버스 JSON → (이 코어) → [직렬화] .hwpx Uint8Array
// hwpx-export.mjs(kordoc 기반 검증 어댑터)에서 검증된 매핑을 그대로 옮겼다:
//   - 1mm = 283.465 HWPUNIT
//   - 절대 배치: hp:pos treatAsChar="0" vertRelTo/horzRelTo="PAPER" + vertOffset/horzOffset
//   - 텍스트 요소 = 무테두리 1×1 표(borderFillIDRef="1"), 표 요소 = borderFillIDRef="2"
//   - 셀 내 줄바꿈 = 여러 <hp:p>
// 여기에 table-king 표 모델을 위해 병합(cellSpan)·행별 열 너비·셀별 높이를 확장했다.
// ZIP은 자체 CRC32 + STORE(무압축) — 한글의 zip 리더는 STORE를 항상 읽고,
// mimetype을 첫 항목으로 요구하는 관례를 HWPX_BASE_ORDER가 보장한다.

import { HWPX_BASE, HWPX_BASE_ORDER } from "./hwpxBase.js";

const HWPUNIT_PER_MM = 283.465; // 7200/25.4
const mmToUnit = (v) => Math.round(v * HWPUNIT_PER_MM);
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ── 개체 공통: 종이 기준 절대 위치 + 크기 (검증된 형식 그대로) ──
const szPos = (el) =>
  `<hp:sz width="${mmToUnit(el.w)}" widthRelTo="ABSOLUTE" height="${mmToUnit(el.h)}" heightRelTo="ABSOLUTE" protect="0"/>` +
  `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" ` +
  `vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" ` +
  `vertOffset="${mmToUnit(el.y)}" horzOffset="${mmToUnit(el.x)}"/>` +
  `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`;

// 셀 내 줄바꿈 = 여러 hp:p (검증된 매핑)
const paras = (text) =>
  String(text)
    .split("\n")
    .map(
      (line) =>
        `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${esc(line)}</hp:t></hp:run></hp:p>`
    )
    .join("");

// ── 셀 하나 (병합 스팬 확장) ──
const cellXml = (text, r, c, wU, hU, borderFill, colSpan = 1, rowSpan = 1) =>
  `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="${borderFill}">` +
  `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
  `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
  paras(text) +
  `</hp:subList>` +
  `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>` +
  `<hp:cellSz width="${wU}" height="${hU}"/>` +
  `<hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;

let idSeq = 2000;

// ── 표 요소 → hp:tbl ──
// grid: { cellsText: string[][], merges: [{r,c,rs,cs}], colWidthsMm: number[][](행별), rowHeightsMm: number[][](셀별) }
// grid가 없으면 el.rows(균등 격자)로 폴백 — 검증 하네스의 단순 캔버스와 호환.
function tableXml(el, borderFill = "2") {
  const grid = el.grid ?? gridFromRows(el);
  const { cellsText, merges, colWidthsMm, rowHeightsMm } = grid;
  const rc = cellsText.length;
  const cc = cellsText[0].length;

  const coveredBy = (r, c) =>
    merges.some(
      (m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c)
    );
  const mergeAt = (r, c) => merges.find((m) => m.r === r && m.c === c);

  const trs = [];
  for (let r = 0; r < rc; r++) {
    const tcs = [];
    for (let c = 0; c < cc; c++) {
      if (coveredBy(r, c)) continue; // 병합에 덮인 셀은 앵커가 대표한다
      const m = mergeAt(r, c);
      const cs = m?.cs ?? 1;
      const rs = m?.rs ?? 1;
      // 병합 앵커의 크기 = 스팬 구간 합 (같은 행의 너비 합, 같은 열의 높이 합)
      let wMm = 0;
      for (let i = c; i < c + cs; i++) wMm += colWidthsMm[r][i];
      let hMm = 0;
      for (let i = r; i < r + rs; i++) hMm += rowHeightsMm[i][c];
      tcs.push(cellXml(cellsText[r][c], r, c, mmToUnit(wMm), mmToUnit(hMm), borderFill, cs, rs));
    }
    if (tcs.length) trs.push(`<hp:tr>${tcs.join("")}</hp:tr>`);
  }

  return (
    `<hp:tbl id="${++idSeq}" zOrder="${idSeq}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
    `pageBreak="CELL" repeatHeader="0" rowCnt="${rc}" colCnt="${cc}" cellSpacing="0" ` +
    `borderFillIDRef="${borderFill}" noShading="0">` +
    szPos(el) +
    trs.join("") +
    `</hp:tbl>`
  );
}

// el.rows(문자열 2D) → 균등 격자 grid
function gridFromRows(el) {
  const rows = el.rows;
  const rc = rows.length;
  const cc = rows[0].length;
  return {
    cellsText: rows,
    merges: [],
    colWidthsMm: rows.map(() => Array(cc).fill(el.w / cc)),
    rowHeightsMm: rows.map(() => Array(cc).fill(el.h / rc)),
  };
}

// ── 텍스트 요소 → 무테두리 1×1 표 (검증된 매핑) ──
const textXml = (el) => tableXml({ ...el, rows: [[el.text]], grid: undefined }, "1");

// ── 캔버스 → section0.xml ──
// 검증된 봉투의 첫 문단(용지 설정 포함)까지 유지하고 본문만 교체한다.
// 용지 설정만은 봉투(kordoc 기본: 좌20·위30·머리말10mm)가 아니라 캔버스가 진실이다:
//  - 크기: canvas.page (A4 210×297)
//  - 여백: 전부 0 — 우리 좌표는 종이 원점 기준인데, 렌더러에 따라 절대배치를
//    여백/앵커 문단 원점으로 해석하는 경우(rhwp)가 있다. 여백이 0이면 두 원점이
//    일치해 어느 해석에서도 같은 자리에 찍힌다. (0 초과 값은 그만큼 밀릴 수 있고,
//    흐름 텍스트가 없는 자유 배치 문서라 여백의 의미도 없다)
function buildSection(refSectionXml, canvas) {
  const headEnd = refSectionXml.indexOf("</hp:p>") + "</hp:p>".length;
  let head = refSectionXml.slice(0, headEnd);
  head = head.replace(
    /(<hp:pagePr[^>]*\bwidth=")\d+(" height=")\d+(")/,
    `$1${mmToUnit(canvas.page?.w ?? 210)}$2${mmToUnit(canvas.page?.h ?? 297)}$3`
  );
  head = head.replace(
    /<hp:margin [^/]*\/>/,
    `<hp:margin header="0" footer="0" gutter="0" left="0" right="0" top="0" bottom="0"/>`
  );
  const controls = canvas.elements
    .map((el) => (el.type === "table" ? tableXml(el) : textXml(el)))
    .join("");
  const host =
    `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">` +
    controls +
    `<hp:t></hp:t></hp:run></hp:p>`;
  return head + host + `</hs:sec>`;
}

const previewText = (canvas) =>
  canvas.elements
    .map((el) =>
      el.type === "text"
        ? el.text
        : (el.grid?.cellsText ?? el.rows).map((r) => r.join(" ")).join("\n")
    )
    .join("\n");

// ═════════════════ 자체 ZIP (STORE 전용) ═════════════════

// CRC-32 (IEEE 802.3) — 테이블 방식
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const enc = new TextEncoder();

// 고정 타임스탬프 — 같은 문서는 항상 같은 바이트 (재현 가능한 출력)
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

function writeU16(arr, v) {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}
function writeU32(arr, v) {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

// entries: [{ name, data(Uint8Array) }] — 주어진 순서 그대로 기록 (mimetype 첫 항목 관례)
function buildStoreZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  let totalSize = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = [];
    writeU32(local, 0x04034b50); // local file header
    writeU16(local, 20); // version needed
    writeU16(local, 0x0800); // UTF-8 이름 플래그
    writeU16(local, 0); // method: STORE
    writeU16(local, DOS_TIME);
    writeU16(local, DOS_DATE);
    writeU32(local, crc);
    writeU32(local, data.length); // compressed = raw (STORE)
    writeU32(local, data.length);
    writeU16(local, nameBytes.length);
    writeU16(local, 0); // extra len
    const localBytes = new Uint8Array(local.length + nameBytes.length + data.length);
    localBytes.set(local, 0);
    localBytes.set(nameBytes, local.length);
    localBytes.set(data, local.length + nameBytes.length);
    chunks.push(localBytes);

    const cen = [];
    writeU32(cen, 0x02014b50); // central directory header
    writeU16(cen, 20); // version made by
    writeU16(cen, 20); // version needed
    writeU16(cen, 0x0800);
    writeU16(cen, 0); // STORE
    writeU16(cen, DOS_TIME);
    writeU16(cen, DOS_DATE);
    writeU32(cen, crc);
    writeU32(cen, data.length);
    writeU32(cen, data.length);
    writeU16(cen, nameBytes.length);
    writeU16(cen, 0); // extra
    writeU16(cen, 0); // comment
    writeU16(cen, 0); // disk
    writeU16(cen, 0); // internal attrs
    writeU32(cen, 0); // external attrs
    writeU32(cen, offset);
    const cenBytes = new Uint8Array(cen.length + nameBytes.length);
    cenBytes.set(cen, 0);
    cenBytes.set(nameBytes, cen.length);
    central.push(cenBytes);

    offset += localBytes.length;
    totalSize += localBytes.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c);
    centralSize += c.length;
    totalSize += c.length;
  }

  const eocd = [];
  writeU32(eocd, 0x06054b50); // end of central directory
  writeU16(eocd, 0);
  writeU16(eocd, 0);
  writeU16(eocd, entries.length);
  writeU16(eocd, entries.length);
  writeU32(eocd, centralSize);
  writeU32(eocd, centralStart);
  writeU16(eocd, 0);
  const eocdBytes = new Uint8Array(eocd);
  chunks.push(eocdBytes);
  totalSize += eocdBytes.length;

  const out = new Uint8Array(totalSize);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// ═════════════════ 공개 API ═════════════════

// canvas: { page:{w,h}, elements:[...] } → .hwpx Uint8Array
export function buildHwpx(canvas) {
  const files = { ...HWPX_BASE };
  files["Contents/section0.xml"] = buildSection(HWPX_BASE["Contents/section0.xml"], canvas);
  if (files["Preview/PrvText.txt"] !== undefined)
    files["Preview/PrvText.txt"] = previewText(canvas);

  const entries = HWPX_BASE_ORDER.map((name) => ({ name, data: enc.encode(files[name]) }));
  return buildStoreZip(entries);
}
