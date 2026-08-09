// sync-rhwp-pkg.mjs — rhwp-studio가 기대하는 ../pkg(wasm-pack 산출물)를 공급.
// 우선순위: vendor/rhwp-pkg(포크 엔진 패치판, 출처 정본 = 그 안의 OFFICEX-PATCH.md)
//          → 없으면 npm @rhwp/core (진실 = package.json 버전).
// sc- 의 vendor/rhwp-core 패턴과 동일 — postinstall이 pkg/를 덮으므로 포크 엔진은
// 반드시 vendor 로 커밋해야 재현된다.
// 사용: npm run sync:rhwp (postinstall에서 자동)
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorSrc = join(root, "vendor", "rhwp-pkg");
const npmSrc = join(root, "node_modules", "@rhwp", "core");
const useVendor = existsSync(join(vendorSrc, "rhwp_bg.wasm"));
const src = useVendor ? vendorSrc : npmSrc;
const dst = join(root, "pkg");

if (!existsSync(src)) {
  console.error("[sync-rhwp-pkg] @rhwp/core가 없습니다 — npm install 먼저");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ["rhwp.js", "rhwp.d.ts", "rhwp_bg.wasm", "rhwp_bg.wasm.d.ts"]) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log(
  "[sync-rhwp-pkg] pkg/ ← " + (useVendor ? "vendor/rhwp-pkg(포크 엔진)" : "@rhwp/core") + " 동기화 완료",
);
