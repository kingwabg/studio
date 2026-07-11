// hwpx-verify.mjs — 제품 내보내기 코어(exportCore.js, 의존성 0)의 3중 검증 하네스.
// kordoc은 여기(개발)에서만 쓴다: ① validateHwpx ② 내용 왕복(parse) ③ SVG 렌더.
// 실행: node scripts/hwpx-verify.mjs
import { validateHwpx, parse, renderHwpxToSvg, blocksToMarkdown } from "kordoc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHwpx } from "../src/hwpx/exportCore.js";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.verify");
fs.mkdirSync(outDir, { recursive: true });

// [진실] 표본 캔버스 — 검증된 어댑터의 표본 + table-king 확장(병합·행별 너비·줄바꿈) 포함
const canvas = {
  page: { w: 210, h: 297 },
  font: "Pretendard", // 실효 글꼴 선언 경로 (fontface 추가 + charPr fontRef)
  elements: [
    // 스타일 실측 경로: 제목 15.8pt 굵게 가운데
    {
      type: "text", x: 55, y: 25, w: 100, h: 12, text: "스프라이트 명세서",
      style: { pt: 15.8, bold: true, align: "center", color: "#1A2233", lineSpacing: 150 },
    },
    // 균등 격자 폴백 경로 (el.rows)
    {
      type: "table", x: 20, y: 50, w: 120, h: 30,
      rows: [["캐릭터", "방향", "상태"], ["슬라임", "8방향", "대기"], ["기사", "8방향", "이동"]],
    },
    // 줄바꿈(여러 hp:p) 경로
    { type: "text", x: 150, y: 55, w: 45, h: 20, text: "우측 메모 상자\n둘째 줄" },
    // table-king 확장 경로: 병합(1행 1~2열) + 행별로 다른 열 너비 + 셀 스타일(배경·굵게·정렬)
    {
      type: "table", x: 30, y: 120, w: 90, h: 24,
      grid: {
        cellsText: [["병합 헤더", "", "비고"], ["a", "b", "c"]],
        merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
        colWidthsMm: [[30, 30, 30], [40, 20, 30]], // 2행은 경계 어긋남
        rowHeightsMm: [[12, 12, 12], [12, 12, 12]],
        cellStyles: [
          [
            { pt: 9.4, bold: true, hAlign: "center", vAlign: "center", backgroundColor: "#fef08a" },
            null,
            { pt: 9.4, bold: true, hAlign: "center", vAlign: "center" },
          ],
          [
            { pt: 9.4, color: "#DC2626" },
            { pt: 9.4, italic: true, hAlign: "right" },
            { pt: 9.4, vAlign: "bottom" },
          ],
        ],
      },
    },
    // 테두리 범위(borderScope) 경로: outer — 셀별 4변 SOLID/NONE + borderFill itemCnt 검증
    {
      type: "table", x: 130, y: 120, w: 50, h: 20,
      grid: {
        cellsText: [["외", "곽"], ["테", "두"]],
        merges: [],
        colWidthsMm: [[25, 25], [25, 25]],
        rowHeightsMm: [[10, 10], [10, 10]],
        borderScope: "outer",
      },
    },
    // 다중 페이지 경로: page=1 → 앵커 문단 pageBreak="1" + 페이지 로컬 y
    { type: "text", page: 1, x: 55, y: 25, w: 100, h: 12, text: "둘째 페이지 제목" },
    {
      type: "table", page: 1, x: 20, y: 50, w: 120, h: 20,
      rows: [["항목", "값"], ["페이지", "2"]],
    },
  ],
};
const EXPECT_PAGES = 2;

const bytes = buildHwpx(canvas);
const buf = Buffer.from(bytes);
fs.writeFileSync(path.join(outDir, "verify-sample.hwpx"), buf);
console.log("① 내보내기 완료:", buf.length, "bytes (STORE ZIP, 의존성 0)");

const v = await validateHwpx(buf);
console.log("② validateHwpx:", JSON.stringify(v).slice(0, 300));

const parsed = await parse(buf, { filename: "verify-sample.hwpx" });
const md = blocksToMarkdown(parsed.blocks);
console.log("③ 되읽은 내용:");
md.split("\n").filter(Boolean).slice(0, 14).forEach((l) => console.log("   ", l.slice(0, 90)));

try {
  const r = await renderHwpxToSvg(buf, { page: 0, reflow: true });
  fs.writeFileSync(path.join(outDir, "verify-sample.svg"), r.svg);
  // kordoc 렌더러는 hp:p pageBreak를 아직 구현하지 않아 페이지 수가 1로 나온다 —
  // 페이지 수 게이트는 ⑤(rhwp)가 담당하고, 여기서는 렌더 성공만 확인한다.
  console.log("④ SVG 렌더링 저장:", r.svg.length, "chars (kordoc은 pageBreak 미지원 — 페이지 수는 ⑤에서 검증)");
} catch (e) {
  console.log("④ SVG 렌더링 실패:", e.message?.slice(0, 160));
  process.exitCode = 1;
}

// ⑤ rhwp 조판 검증 — 제품 미리보기와 같은 엔진으로 페이지 수를 게이트한다.
// rhwp는 브라우저용 wasm-bindgen 출력이지만 Node(18+)의 fetch/TextDecoder로 동작한다.
try {
  globalThis.measureTextWidth = (font, text) => {
    // 대략치 스텁 — 페이지 수 판정에는 글자 폭 정밀도가 필요 없다
    const size = parseFloat(font) || 10;
    let w = 0;
    for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55;
    return w;
  };
  const rhwp = await import("@rhwp/core");
  const wasmPath = fileURLToPath(import.meta.resolve("@rhwp/core/rhwp_bg.wasm"));
  await rhwp.default({ module_or_path: fs.readFileSync(wasmPath) });
  const doc = new rhwp.HwpDocument(bytes);
  const pages = doc.pageCount();
  const firstSvg = doc.renderPageSvg(0);
  const lastSvg = doc.renderPageSvg(pages - 1);

  // 가져오기 왕복용 파싱 — doc 해제 전에 수행, 판정은 ⑦에서
  const { importFromDocument } = await import("../src/hwpx/importCore.js");
  const imported = importFromDocument(doc, "왕복 표본");
  doc.free();
  const hasP2Text = lastSvg.includes("둘");
  console.log(`⑤ rhwp 조판: ${pages}페이지, 마지막 페이지에 2페이지 내용 ${hasP2Text ? "있음" : "없음"}`);
  if (pages !== EXPECT_PAGES || !hasP2Text) {
    console.log(`   ✗ 다중 페이지 실패: 기대 ${EXPECT_PAGES}페이지+내용, 실제 ${pages}페이지`);
    process.exitCode = 1;
  }
  // ⑥ 스타일 반영 게이트 — 제목 크기(15.8pt ≈ 21px)·굵기, 셀 배경색, 글꼴이 조판에 나타나는지
  const checks = [
    ["제목 글자 크기(≈21px)", /font-size="2[01][\d.]*"/.test(firstSvg) || firstSvg.includes("15.8pt")],
    ["굵은 글자", /font-weight="(bold|700|800)"/.test(firstSvg)],
    ["셀 배경색 #fef08a", /fef08a/i.test(firstSvg)],
    ["글꼴 Pretendard", /Pretendard/.test(firstSvg)],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  console.log(`⑥ 스타일 조판: ${checks.map(([n, ok]) => `${ok ? "✓" : "✗"} ${n}`).join(" · ")}`);
  if (failed.length) process.exitCode = 1;

  // ⑦ 가져오기 왕복 — 내보낸 파일을 importCore로 되읽어 구조가 복원되는지
  const flat = JSON.stringify(imported);
  // 병합 표(원본 2행: 40/20/30mm)의 열 너비가 px로 복원됐는지 — 40mm = 151.2px
  const mergedTable = imported.sections
    .flatMap((s) => s.blocks)
    .find((b) => b.type === "table" && b.merges?.length);
  const w2 = mergedTable?.widthsPx?.[1] ?? [];
  const widthOk = Math.abs(w2[0] - 151.2) < 1 && Math.abs(w2[1] - 75.6) < 1;
  const roundtrip = [
    ["제목 승격", imported.title === "스프라이트 명세서"],
    ["표 내용", flat.includes("슬라임") && flat.includes("8방향")],
    ["병합 보존", flat.includes('"cs":2') && flat.includes("병합 헤더")],
    ["열 너비 복원", widthOk],
    ["줄바꿈 텍스트", flat.includes("우측 메모 상자")],
    ["2페이지 내용", flat.includes("둘째 페이지 제목")],
  ];
  const rtFailed = roundtrip.filter(([, ok]) => !ok);
  console.log(`⑦ 가져오기 왕복: ${roundtrip.map(([n, ok]) => `${ok ? "✓" : "✗"} ${n}`).join(" · ")}`);
  if (rtFailed.length) process.exitCode = 1;
} catch (e) {
  console.log("⑤ rhwp 조판 실패:", e.message?.slice(0, 160));
  process.exitCode = 1;
}
