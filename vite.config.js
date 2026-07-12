import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 의존성 스캔을 루트 index.html로만 제한한다. 기본값은 모든 **/*.html을 크롤해
  // rhwp-studio/index.html까지 물어(→ rhwp 소스의 @wasm/rhwp.js, 루트 문맥엔 별칭 없음)
  // optimizeDeps가 터지고 dev 서버가 죽었다. rhwp-studio는 독립 앱(7700)이라 스캔 대상 아님.
  optimizeDeps: { entries: ["index.html"] },
  // 파일 감시에서도 rhwp-studio 하위를 제외(불필요한 재최적화·부하 방지).
  server: { watch: { ignored: ["**/rhwp-studio/**"] } },
});
