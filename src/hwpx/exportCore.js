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

// 셀 내 줄바꿈 = 여러 hp:p (검증된 매핑) — charPr/paraPr 참조로 글자·문단 스타일 적용
const paras = (text, charRef = "0", paraRef = "0") =>
  String(text)
    .split("\n")
    .map(
      (line) =>
        `<hp:p paraPrIDRef="${paraRef}" styleIDRef="0"><hp:run charPrIDRef="${charRef}"><hp:t>${esc(line)}</hp:t></hp:run></hp:p>`
    )
    .join("");

// 인라인 리치 텍스트 — 한 문단(줄) 안에 런마다 <hp:run>. lines = [{paraRef?, segs:[{text,charRef}]}]
// (charRef/paraRef는 refsAt이 미리 발급 — paraRef가 줄마다 다르면 문단별 정렬).
// 빈 줄도 문단 하나로 유지한다.
// 하이퍼링크 필드 id 카운터 (fieldBegin/End 매칭용, 문서 내 고유)
let fieldSeq = 0;
// 세그먼트 하나 → hp:run(들). href가 있으면 fieldBegin 컨트롤 run + 텍스트 run + fieldEnd
// 컨트롤 run으로 감싼다(rhwp 역공학 검증: getFieldList가 command=URL로 되읽음).
// command 형식 = "URL;0"(뒤 0 = 링크 대상/프레임). 인접 동일 href는 이미 한 세그먼트로 병합됨.
const segRun = (s) => {
  const textRun = `<hp:run charPrIDRef="${s.charRef}"><hp:t>${esc(s.text)}</hp:t></hp:run>`;
  if (!s.href) return textRun;
  const id = ++fieldSeq;
  const begin =
    `<hp:run charPrIDRef="${s.charRef}"><hp:ctrl>` +
    `<hp:fieldBegin id="${id}" type="HYPERLINK" name="" editable="1" dirty="0" zorder="0" fieldid="0">` +
    `<hp:parameters count="1"><hp:stringParam name="Command">${esc(s.href)};0</hp:stringParam></hp:parameters>` +
    `</hp:fieldBegin></hp:ctrl></hp:run>`;
  const end = `<hp:run charPrIDRef="${s.charRef}"><hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="0"/></hp:ctrl></hp:run>`;
  return begin + textRun + end;
};
const richParasFromRefs = (lines, fallbackParaRef = "0") =>
  lines
    .map((line) => {
      const segs = Array.isArray(line) ? line : line.segs; // 구형(segs 배열 직접) 호환
      const paraRef = (Array.isArray(line) ? null : line.paraRef) ?? fallbackParaRef;
      return (
        `<hp:p paraPrIDRef="${paraRef}" styleIDRef="0">` +
        (segs.length ? segs.map(segRun).join("") : `<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>`) +
        `</hp:p>`
      );
    })
    .join("");

// ═════════════════ 스타일 레지스트리 ═════════════════
// 화면에서 실측한 스타일(크기·굵기·기울임·색·정렬·줄간격·셀 배경·글꼴)을
// hwpx의 charPr/paraPr/borderFill 항목으로 바꿔 id를 발급한다. 같은 스타일은
// 같은 id로 합쳐지고, 쌓인 항목은 patchHeader가 header.xml에 주입한다.
// "화면 = 진실" 원칙의 스타일판 — 봉투의 고정 항목을 고르는 게 아니라
// 화면에 존재하는 스타일 조합을 그대로 문서 규격으로 옮긴다.
// ⚠ id는 반드시 기존 목록에 "연속으로" 이어야 한다: rhwp 등 일부 리더는
// IDRef를 id 속성이 아니라 배열 인덱스로 해석한다. 봉투가 id=인덱스를 지키므로
// 우리도 (기존 itemCnt)부터 이어 붙이면 두 해석 모두에서 같은 항목이 잡힌다.
const H_ALIGN = { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFY" };
const V_ALIGN = { top: "TOP", center: "CENTER", bottom: "BOTTOM" };

export function makeStyleRegistry(baseHeaderXml) {
  // 봉투의 현재 개수 = 새 항목의 시작 id (id가 0부터 연속이라는 봉투 불변식에 의존)
  const countOf = (tag) => Number(new RegExp(`<hh:${tag} itemCnt="(\\d+)"`).exec(baseHeaderXml)?.[1] ?? 0);
  const charBase = countOf("charProperties");
  const paraBase = countOf("paraProperties");
  // borderFill은 id가 1부터라 개수+1이 다음 id (봉투: itemCnt=2, id 1·2)
  const fillBase = countOf("borderFills") + 1;

  const chars = new Map();
  const parasReg = new Map();
  const fills = new Map();
  // 글꼴 레지스트리 — 문서 기본 + 요소별 글꼴을 모두 fontface로 등록하고 id를 배분한다.
  // (id는 봉투 기존 fontCnt에 연속으로 이어 붙임 — IDRef=배열 인덱스 해석 리더 호환)
  const fontIds = new Map(); // 글꼴 이름 → id (patchHeader에서 확정)
  const wantFont = (name) => {
    if (name && !fontIds.has(name)) fontIds.set(name, null);
  };
  let fontIdx = null; // 문서 기본 글꼴 id (미지정 charPr가 참조)

  const charId = (s) => {
    if (!s) return "0";
    const pt = s.pt ?? 10;
    const bold = !!s.bold;
    const italic = !!s.italic;
    const underline = !!s.underline;
    const strike = !!s.strike;
    const color = s.color ?? "#000000";
    const shade = s.shade ?? null; // 형광펜(글자 배경) — charPr shadeColor
    const font = s.font ?? null; // 요소별 글꼴 이름 (없으면 문서 기본)
    wantFont(font);
    const key = `${pt}|${bold}|${italic}|${underline}|${strike}|${color}|${shade ?? ""}|${font ?? ""}`;
    if (!chars.has(key))
      chars.set(key, { id: charBase + chars.size, pt, bold, italic, underline, strike, color, shade, font });
    return String(chars.get(key).id);
  };
  const paraId = (s) => {
    if (!s) return "0";
    const align = H_ALIGN[s.align] ?? "LEFT";
    const ls = Math.min(500, Math.max(100, Math.round(s.lineSpacing ?? 160))); // % — 비정상 실측값 방어
    const list = s.list === "num" || s.list === "bullet" ? s.list : null; // 목록 문단(번호/글머리)
    // 흐름 문단(본문) 배치용 마진 — 좌/우 들여쓰기와 앞 간격(mm → HWPUNIT).
    // ⚠ ×2: 문단 여백 값은 렌더러가 "반단위(HWPUNIT/2)"로 해석한다 — rhwp 실측으로
    // 캘리브레이션(50mm 지정 → 25mm에 찍힘). HWP 바이너리의 문단 여백 2배 저장 관례와 일치.
    const ml = Math.max(0, Math.round((s.marginLeftMm ?? 0) * HWPUNIT_PER_MM * 2));
    const mr = Math.max(0, Math.round((s.marginRightMm ?? 0) * HWPUNIT_PER_MM * 2));
    const mp = Math.max(0, Math.round((s.marginPrevMm ?? 0) * HWPUNIT_PER_MM * 2));
    const key = `${align}|${ls}|${ml}|${mr}|${mp}|${list ?? ""}`;
    if (!parasReg.has(key)) parasReg.set(key, { id: paraBase + parasReg.size, align, ls, ml, mr, mp, list });
    return String(parasReg.get(key).id);
  };
  const fillId = (bg) => {
    if (!bg) return null;
    if (!fills.has(bg)) fills.set(bg, { id: fillBase + fills.size, bg });
    return String(fills.get(bg).id);
  };

  // header.xml에 실효 글꼴 fontface + 쌓인 charPr/paraPr/borderFill을 주입.
  // itemCnt도 함께 갱신 — 검증기(validateHwpx)가 개수 불일치를 잡는다.
  const patchHeader = (headerXml, fontName) => {
    let xml = headerXml;

    // 등록할 글꼴 목록: 문서 기본(첫 번째) + 요소별 글꼴들 — 전부 fontface로 추가.
    // HANGUL/LATIN 두 목록에 같은 인덱스로 추가 → charPr fontRef가 한 값으로 참조.
    const names = [...new Set([...(fontName ? [fontName] : []), ...fontIds.keys()])];
    if (names.length) {
      for (const lang of ["HANGUL", "LATIN"]) {
        const re = new RegExp(`(<hh:fontface lang="${lang}" fontCnt=")(\\d+)(">)([\\s\\S]*?)(</hh:fontface>)`);
        xml = xml.replace(re, (m, p1, cnt, p3, body, close) => {
          const base = Number(cnt); // 다음 id = 기존 개수 (연속 배분 — 배열 인덱스 해석 호환)
          const added = names
            .map((name, i) => {
              fontIds.set(name, base + i);
              return (
                `<hh:font id="${base + i}" face="${esc(name)}" type="TTF" isEmbedded="0">` +
                `<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>` +
                `</hh:font>`
              );
            })
            .join("");
          return `${p1}${base + names.length}${p3}${body}${added}${close}`;
        });
      }
      if (fontName) fontIdx = fontIds.get(fontName);
    }
    const fh = fontIdx ?? 0; // 글꼴 미지정 시 봉투 기본(함초롬바탕)

    if (chars.size) {
      const entries = [...chars.values()]
        .map(
          (c) =>
            // 굵게/기울임은 OWPML 표준상 "빈 자식 요소"(<hh:bold/>)다. kordoc 계열은 속성도
            // 읽으므로 둘 다 기록 — 어떤 리더에서도 같은 결과가 나오게 한다.
            `<hh:charPr id="${c.id}" height="${Math.round(c.pt * 100)}" textColor="${c.color}" shadeColor="${c.shade ?? "none"}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"${c.bold ? ` bold="1"` : ""}${c.italic ? ` italic="1"` : ""}>` +
            `<hh:fontRef hangul="${c.font != null ? fontIds.get(c.font) ?? fh : fh}" latin="${c.font != null ? fontIds.get(c.font) ?? fh : fh}" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
            `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
            `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
            `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
            `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
            (c.italic ? `<hh:italic/>` : "") +
            (c.bold ? `<hh:bold/>` : "") +
            // 밑줄/취소선 — OWPML 자식 요소. 색은 글자색을 따른다(한글 기본 동작과 동일)
            (c.underline ? `<hh:underline type="BOTTOM" shape="SOLID" color="${c.color}"/>` : "") +
            (c.strike ? `<hh:strikeout shape="SOLID" color="${c.color}"/>` : "") +
            `</hh:charPr>`
        )
        .join("");
      xml = xml
        .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (m, p1, n, p3) => `${p1}${Number(n) + chars.size}${p3}`)
        .replace("</hh:charProperties>", entries + "</hh:charProperties>");
    }

    if (parasReg.size) {
      const entries = [...parasReg.values()]
        .map(
          (p) =>
            `<hh:paraPr id="${p.id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="AUTO">` +
            `<hh:align horizontal="${p.align}" vertical="BASELINE"/>` +
            // 목록 문단 — 번호는 봉투 내장 numbering(id=1), 글머리는 patchHeader가 주입하는 bullet(id=1)
            (p.list === "num"
              ? `<hh:heading type="NUMBER" idRef="1" level="0"/>`
              : p.list === "bullet"
                ? `<hh:heading type="BULLET" idRef="1" level="0"/>`
                : `<hh:heading type="NONE" idRef="0" level="0"/>`) +
            `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
            `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
            `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="${p.ml ?? 0}" unit="HWPUNIT"/><hc:right value="${p.mr ?? 0}" unit="HWPUNIT"/><hc:prev value="${p.mp ?? 0}" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>` +
            `<hh:lineSpacing type="PERCENT" value="${p.ls}"/>` +
            `<hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>` +
            `</hh:paraPr>`
        )
        .join("");
      xml = xml
        .replace(/(<hh:paraProperties itemCnt=")(\d+)(")/, (m, p1, n, p3) => `${p1}${Number(n) + parasReg.size}${p3}`)
        .replace("</hh:paraProperties>", entries + "</hh:paraProperties>");
    }

    // 글머리(bullet) 사용 시 — 봉투에 bullets가 없으므로 정의를 주입한다.
    // OWPML: numberings 다음에 bullets. paraHead는 봉투 numbering의 것과 같은 형태.
    if ([...parasReg.values()].some((p) => p.list === "bullet") && !xml.includes("<hh:bullets")) {
      const bullets =
        `<hh:bullets itemCnt="1"><hh:bullet id="1" char="•" checkedChar="" useImage="0">` +
        `<hh:paraHead start="1" level="1" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0"/>` +
        `</hh:bullet></hh:bullets>`;
      xml = xml.replace("</hh:numberings>", "</hh:numberings>" + bullets);
    }

    if (fills.size) {
      // 봉투 borderFill 2(사방 실선)와 같은 테두리에 채우기 색만 더한 항목
      const entries = [...fills.values()]
        .map(
          (f) =>
            `<hh:borderFill id="${f.id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
            `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
            `<hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
            `<hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
            `<hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
            `<hc:fillBrush><hc:winBrush faceColor="${f.bg}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` +
            `</hh:borderFill>`
        )
        .join("");
      xml = xml
        .replace(/(<hh:borderFills itemCnt=")(\d+)(")/, (m, p1, n, p3) => `${p1}${Number(n) + fills.size}${p3}`)
        .replace("</hh:borderFills>", entries + "</hh:borderFills>");
    }

    return xml;
  };

  return { charId, paraId, fillId, patchHeader };
}

// ── 셀 하나 (병합 스팬 확장) ──
// refs: { charRef, paraRef, vertAlign, fill, cm } — 스타일 레지스트리가 발급한 참조. 없으면 기본값.
// cm: { lr, tb } HWPUNIT — 셀 안쪽 여백 오버라이드 (텍스트 상자를 화면 패딩과 정합할 때)
const cellXml = (text, r, c, wU, hU, borderFill, colSpan = 1, rowSpan = 1, refs = {}) =>
  `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="${refs.fill ?? borderFill}">` +
  `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${refs.vertAlign ?? "CENTER"}" ` +
  `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
  (refs.richRefs
    ? richParasFromRefs(refs.richRefs, refs.paraRef ?? "0")
    : paras(text, refs.charRef ?? "0", refs.paraRef ?? "0")) +
  `</hp:subList>` +
  `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>` +
  `<hp:cellSz width="${wU}" height="${hU}"/>` +
  `<hp:cellMargin left="${refs.cm?.lr ?? 141}" right="${refs.cm?.lr ?? 141}" top="${refs.cm?.tb ?? 141}" bottom="${refs.cm?.tb ?? 141}"/></hp:tc>`;

let idSeq = 2000;

// ── 표 요소 → hp:tbl ──
// grid: { cellsText: string[][], merges: [{r,c,rs,cs}], colWidthsMm: number[][](행별), rowHeightsMm: number[][](셀별) }
// grid가 없으면 el.rows(균등 격자)로 폴백 — 검증 하네스의 단순 캔버스와 호환.
function tableXml(el, reg, borderFill = "2") {
  const grid = el.grid ?? gridFromRows(el);
  const { cellsText, merges, colWidthsMm, rowHeightsMm, cellStyles } = grid;
  const rc = cellsText.length;
  const cc = cellsText[0].length;

  const coveredBy = (r, c) =>
    merges.some(
      (m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c)
    );
  const mergeAt = (r, c) => merges.find((m) => m.r === r && m.c === c);

  // 셀 스타일 → 레지스트리 참조. cellStyles가 없으면(구형 캔버스) 전부 기본값.
  const cm = el.cellMarginU; // 셀 안쪽 여백 오버라이드 (텍스트 상자 정합용)
  const refsAt = (r, c) => {
    // 인라인 리치 텍스트: 세그먼트 스타일마다 charPr, 줄(문단)마다 paraPr 발급 —
    // 문단별 정렬(cellRichAligns)이 있으면 그 줄만 다른 정렬로 나간다.
    const rich = grid.cellRich?.[r]?.[c];
    const richAligns = grid.cellRichAligns?.[r]?.[c];
    const richLists = grid.cellRichLists?.[r]?.[c]; // 문단별 목록(번호/글머리)
    const s = cellStyles?.[r]?.[c];
    const richRefs =
      rich && reg
        ? rich.map((line, li) => ({
            paraRef: reg.paraId({
              align: richAligns?.[li] ?? s?.hAlign ?? "left",
              lineSpacing: s?.lineSpacing,
              list: richLists?.[li] ?? undefined,
            }),
            segs: line.map((seg) => ({ text: seg.text, charRef: reg.charId(seg.style), href: seg.href })),
          }))
        : undefined;
    if (!s || !reg) return { cm, richRefs };
    return {
      charRef: reg.charId(s),
      paraRef: reg.paraId({ align: s.hAlign ?? "center", lineSpacing: s.lineSpacing }),
      vertAlign: V_ALIGN[s.vAlign] ?? "CENTER",
      fill: s.backgroundColor ? reg.fillId(s.backgroundColor) : undefined,
      cm,
      richRefs,
    };
  };

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
      tcs.push(cellXml(cellsText[r][c], r, c, mmToUnit(wMm), mmToUnit(hMm), borderFill, cs, rs, refsAt(r, c)));
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
// el.style(화면 실측: pt·bold·italic·color·align·lineSpacing)을 1×1 셀의 스타일로 옮긴다.
const textXml = (el, reg) => {
  const grid = gridFromRows({ ...el, rows: [[el.text]] });
  // ⚠ vAlign은 top — 화면 텍스트 상자는 위 기준으로 흐른다. center로 내보내면 셀
  // 높이(exportH: 최소 8mm+여유)가 내용보다 클 때 글이 아래로 밀려 겹치기 비교에서
  // 세로 ~2mm 어긋남(실측 rhwp glyph 199.3 vs 화면 top 179.9+ascent).
  if (el.style) grid.cellStyles = [[{ ...el.style, hAlign: el.style.align, vAlign: "top" }]];
  // 인라인 리치 텍스트: 런 세그먼트 줄을 1×1 셀에 실어 richParas로 내보낸다
  if (el.richLines) grid.cellRich = [[el.richLines]];
  if (el.paraAligns) grid.cellRichAligns = [[el.paraAligns]]; // 문단별 정렬 (줄 index 대응)
  if (el.paraLists) grid.cellRichLists = [[el.paraLists]]; // 문단별 목록 (번호/글머리)
  return tableXml({ ...el, grid }, reg, "1");
};

// ── 이미지 요소 → hp:pic (절대배치) ──
// 구조는 rhwp exportHwpx 실물에서 역공학 — rhwp·한글이 그대로 되읽는 형태.
// el: { x,y,w,h(mm), binId("image1"), natW, natH(px) }.
// imgClip의 right/bottom은 원본 픽셀 ×75(HWPUNIT/px @96dpi = 7200/96).
function picXml(el) {
  const wU = mmToUnit(el.w);
  const hU = mmToUnit(el.h);
  const xU = mmToUnit(el.x);
  const yU = mmToUnit(el.y);
  const clipR = Math.round((el.natW ?? el.w * 3.7795) * 75);
  const clipB = Math.round((el.natH ?? el.h * 3.7795) * 75);
  return (
    `<hp:pic id="${++idSeq}" zOrder="${idSeq}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="0" reverse="0">` +
    `<hp:offset x="${xU}" y="${yU}"/>` +
    `<hp:orgSz width="${wU}" height="${hU}"/>` +
    `<hp:curSz width="${wU}" height="${hU}"/>` +
    `<hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="0" centerY="0" rotateimage="0"/>` +
    `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${wU}" y="0"/><hc:pt2 x="${wU}" y="${hU}"/><hc:pt3 x="0" y="${hU}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${clipR}" top="0" bottom="${clipB}"/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:imgDim dimwidth="0" dimheight="0"/>` +
    `<hc:img binaryItemIDRef="${el.binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:effects></hp:effects>` +
    szPos(el) +
    `</hp:pic>`
  );
}

// ── 캔버스 → section0.xml ──
// 검증된 봉투의 첫 문단(용지 설정 포함)까지 유지하고 본문만 교체한다.
// 용지 설정만은 봉투(kordoc 기본: 좌20·위30·머리말10mm)가 아니라 캔버스가 진실이다:
//  - 크기: canvas.page (A4 210×297)
//  - 여백: 전부 0 — 우리 좌표는 종이 원점 기준인데, 렌더러에 따라 절대배치를
//    여백/앵커 문단 원점으로 해석하는 경우(rhwp)가 있다. 여백이 0이면 두 원점이
//    일치해 어느 해석에서도 같은 자리에 찍힌다. (0 초과 값은 그만큼 밀릴 수 있고,
//    흐름 텍스트가 없는 자유 배치 문서라 여백의 의미도 없다)
function buildSection(refSectionXml, canvas, reg) {
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
  // 다중 페이지: 요소를 el.page(0부터)로 그룹핑해 페이지마다 앵커 문단을 하나씩 둔다.
  // 2페이지부터는 pageBreak="1"로 새 종이에서 시작 — 절대배치(vertRelTo="PAPER")는
  // 앵커 문단이 놓인 페이지의 종이 원점을 기준으로 찍히므로, 로컬 y 좌표가 그대로 통한다.
  const byPage = new Map();
  for (const el of canvas.elements) {
    const p = el.page ?? 0;
    if (!byPage.has(p)) byPage.set(p, []);
    byPage.get(p).push(el);
  }
  const lastPage = Math.max(0, ...byPage.keys());
  const pageW = canvas.page?.w ?? 210;
  const hosts = [];
  for (let p = 0; p <= lastPage; p++) {
    const els = byPage.get(p) ?? [];
    // 흐름 본문(flowText)은 절대배치 개체가 아니라 "진짜 문단" — 한글에서 커서가
    // 흐르고, 이어 쓰면 밀리고, 길면 페이지를 넘는다. 배치는 문단 마진으로:
    //   좌 들여쓰기 = x, 우 들여쓰기 = 종이폭−x−폭, 첫 문단 앞 간격 = y
    // (용지 여백이 0이므로 앞 간격 y가 곧 종이 위 시작 위치가 된다)
    const flows = els.filter((el) => el.type === "flowText").sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const abs = els.filter((el) => el.type !== "flowText");
    const controls = abs
      .map((el) =>
        el.type === "table" ? tableXml(el, reg) : el.type === "image" ? picXml(el) : textXml(el, reg)
      )
      .join("");
    // 흐름 문단이 있으면 앵커(호스트) 문단의 줄 높이를 0.1pt로 소거 — 안 그러면
    // 빈 줄 하나만큼 본문이 아래로 밀린다. 절대배치 개체는 PAPER 기준이라 영향 없음.
    const hostChar = flows.length ? reg.charId({ pt: 0.1 }) : "0";
    const hostPara = flows.length ? reg.paraId({ align: "left", lineSpacing: 100 }) : "0";
    hosts.push(
      `<hp:p paraPrIDRef="${hostPara}" styleIDRef="0"${p > 0 ? ` pageBreak="1"` : ""}><hp:run charPrIDRef="${hostChar}">` +
        controls +
        `<hp:t></hp:t></hp:run></hp:p>`
    );
    // 호스트(앵커) 문단을 0.1pt로 줄여도 렌더러 최소 줄높이 ≈6mm가 남는다 —
    // rhwp 실측 캘리브레이션(y=0 지정 시 첫 줄 top이 ~6mm에서 시작). 첫 간격에서 차감.
    const HOST_LINE_MM = 6;
    let cursorY = HOST_LINE_MM; // 흐름 커서 추정치(mm) — 다음 본문 블록과의 간격 계산용
    for (const f of flows) {
      const gap = Math.max(0, (f.y ?? 0) - cursorY);
      // 리치 텍스트면 세그먼트 줄(각 줄 = [{text, style}]), 아니면 균일 텍스트를 줄 단위로.
      const richLines =
        f.richLines ??
        String(f.text ?? "")
          .split("\n")
          .map((line) => (line ? [{ text: line, style: f.style }] : []));
      const paraXml = richLines
        .map((segs, i) => {
          const paraRef = reg.paraId({
            align: f.paraAligns?.[i] ?? f.style?.align ?? "left",
            list: f.paraLists?.[i] ?? undefined,
            lineSpacing: f.style?.lineSpacing ?? 160,
            marginLeftMm: f.x ?? 0,
            marginRightMm: Math.max(0, pageW - (f.x ?? 0) - (f.w ?? pageW)),
            marginPrevMm: i === 0 ? gap : 0,
          });
          const runsXml = segs.length
            ? segs.map((s) => segRun({ text: s.text, charRef: reg.charId(s.style), href: s.href })).join("")
            : `<hp:run charPrIDRef="${reg.charId(f.style)}"><hp:t></hp:t></hp:run>`;
          return `<hp:p paraPrIDRef="${paraRef}" styleIDRef="0">${runsXml}</hp:p>`;
        })
        .join("");
      hosts.push(paraXml);
      // 캔버스에서 실측된 블록 높이(auto-height)로 커서 전진 — 한글 조판과 근사
      cursorY = (f.y ?? 0) + (f.h ?? 0);
    }
  }
  return head + hosts.join("") + `</hs:sec>`;
}

const previewText = (canvas) =>
  canvas.elements
    .map((el) =>
      el.type === "text" || el.type === "flowText"
        ? el.text
        : el.type === "image"
          ? "" // 이미지는 미리보기 텍스트 없음
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

// canvas: { page:{w,h}, font?, elements:[...], images?: [{binId, ext, mime, data:Uint8Array}] }
// → .hwpx Uint8Array. canvas.font = 화면의 실효 글꼴 이름.
// images: 이미지 요소(hp:pic)가 참조하는 바이너리 — BinData/ ZIP 항목 + content.hpf
// 매니페스트 등록 (rhwp exportHwpx 실물 역공학: header 등록은 불필요, 매니페스트만).
export function buildHwpx(canvas) {
  const files = { ...HWPX_BASE };
  const reg = makeStyleRegistry(HWPX_BASE["Contents/header.xml"]);
  // 순서 중요: 섹션을 먼저 만들어 레지스트리에 스타일이 쌓인 뒤 헤더를 패치한다
  files["Contents/section0.xml"] = buildSection(HWPX_BASE["Contents/section0.xml"], canvas, reg);
  files["Contents/header.xml"] = reg.patchHeader(HWPX_BASE["Contents/header.xml"], canvas.font);
  if (files["Preview/PrvText.txt"] !== undefined)
    files["Preview/PrvText.txt"] = previewText(canvas);

  const images = canvas.images ?? [];
  if (images.length) {
    // content.hpf 매니페스트에 바이너리 항목 등록
    const items = images
      .map(
        (im) =>
          `<opf:item id="${im.binId}" href="BinData/${im.binId}.${im.ext}" media-type="${im.mime}" isEmbeded="1"/>`
      )
      .join("");
    files["Contents/content.hpf"] = files["Contents/content.hpf"].replace(
      "</opf:manifest>",
      items + "</opf:manifest>"
    );
  }

  const entries = HWPX_BASE_ORDER.map((name) => ({ name, data: enc.encode(files[name]) }));
  for (const im of images) entries.push({ name: `BinData/${im.binId}.${im.ext}`, data: im.data });
  return buildStoreZip(entries);
}
