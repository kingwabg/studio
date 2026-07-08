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
  elements: [
    { type: "text", x: 55, y: 25, w: 100, h: 12, text: "스프라이트 명세서" },
    // 균등 격자 폴백 경로 (el.rows)
    {
      type: "table", x: 20, y: 50, w: 120, h: 30,
      rows: [["캐릭터", "방향", "상태"], ["슬라임", "8방향", "대기"], ["기사", "8방향", "이동"]],
    },
    // 줄바꿈(여러 hp:p) 경로
    { type: "text", x: 150, y: 55, w: 45, h: 20, text: "우측 메모 상자\n둘째 줄" },
    // table-king 확장 경로: 병합(1행 1~2열) + 행별로 다른 열 너비
    {
      type: "table", x: 30, y: 120, w: 90, h: 24,
      grid: {
        cellsText: [["병합 헤더", "", "비고"], ["a", "b", "c"]],
        merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
        colWidthsMm: [[30, 30, 30], [40, 20, 30]], // 2행은 경계 어긋남
        rowHeightsMm: [[12, 12, 12], [12, 12, 12]],
      },
    },
  ],
};

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
  console.log("④ SVG 렌더링 저장:", r.svg.length, "chars,", r.pageCount, "페이지");
} catch (e) {
  console.log("④ SVG 렌더링 실패:", e.message?.slice(0, 160));
  process.exitCode = 1;
}
