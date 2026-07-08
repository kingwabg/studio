// gen-hwpx-base.mjs — kordoc(개발용 비계)으로 검증된 HWPX 봉투를 한 번 생성해
// src/hwpx/hwpxBase.js 에 문자열로 내장한다.
// 제품 번들에는 kordoc이 들어가지 않는다 — 이 스크립트는 봉투가 바뀔 때만 다시 돌린다.
import { markdownToHwpx } from "kordoc";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/hwpx/hwpxBase.js"
);

const base = await markdownToHwpx(" ");
const zip = await JSZip.loadAsync(Buffer.from(base));

// HWPX 패키지 항목 순서는 검증된 순서를 따른다 (CLAUDE.md).
// 봉투에 그 외 파일(version.xml, settings.xml 등)이 있으면 뒤에 이어붙인다.
const CANONICAL_ORDER = [
  "mimetype",
  "META-INF/container.xml",
  "Contents/content.hpf",
  "Contents/header.xml",
  "Contents/section0.xml",
  "Preview/PrvText.txt",
];

const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
const ordered = [
  ...CANONICAL_ORDER.filter((n) => names.includes(n)),
  ...names.filter((n) => !CANONICAL_ORDER.includes(n)),
];

const entries = {};
for (const name of ordered) {
  entries[name] = await zip.file(name).async("string");
}

const js = `// hwpxBase.js — 자동 생성 파일. 수정 금지: scripts/gen-hwpx-base.mjs 로 재생성.
// kordoc markdownToHwpx(" ")가 만든 유효 HWPX 봉투(헤더·폰트·테두리 정의 포함)를 통째로 내장.
// 이 봉투 덕분에 제품 내보내기 코어는 의존성 0으로 유효한 패키지를 만들 수 있다.
export const HWPX_BASE_ORDER = ${JSON.stringify(ordered, null, 2)};

export const HWPX_BASE = ${JSON.stringify(entries, null, 2)};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, js);
console.log("생성 완료:", outPath);
console.log("봉투 파일 목록:", ordered.join(", "));
console.log("총 크기:", js.length, "chars");
