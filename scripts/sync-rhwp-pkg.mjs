// sync-rhwp-pkg.mjs — rhwp-studio가 기대하는 ../pkg(wasm-pack 산출물)를 npm @rhwp/core에서 공급.
// pkg/는 생성물(gitignore) — 진실은 package.json의 @rhwp/core 버전.
// 사용: npm run sync:rhwp (postinstall에서 자동)
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@rhwp", "core");
const dst = join(root, "pkg");

if (!existsSync(src)) {
  console.error("[sync-rhwp-pkg] @rhwp/core가 없습니다 — npm install 먼저");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ["rhwp.js", "rhwp.d.ts", "rhwp_bg.wasm", "rhwp_bg.wasm.d.ts"]) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log("[sync-rhwp-pkg] pkg/ ← @rhwp/core 동기화 완료");
