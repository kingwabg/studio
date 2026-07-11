import { defineConfig, loadEnv } from 'vite';
import { resolve, extname, join } from 'path';
import { readFileSync, readFile } from 'fs';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  // [캔버스 한컴 포크] AI 프록시용 키 — .env.local의 ANTHROPIC_API_KEY(또는 셸 환경변수).
  // 이 값은 dev 서버(Node)에서만 읽혀 프록시 요청 헤더로 주입되고, 브라우저 번들엔 절대 나가지 않는다.
  // .env.local의 AI 키는 서버 시작 시 1회 로드된다 (키 추가/변경 후 dev 서버 재시작 필요).
  // ⚠ dev 서버 cwd는 부모(studio)일 수 있으므로 반드시 __dirname(=rhwp-studio) 기준으로 읽는다.
  // MINIMAX_API_KEY 우선, 기존 ANTHROPIC_API_KEY에 넣어둔 값도 그대로 인정(하위호환).
  const env = loadEnv(mode, __dirname, '');
  const aiKey = process.env.MINIMAX_API_KEY || env.MINIMAX_API_KEY
    || process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
  console.log(`[ai-proxy] MiniMax API key ${aiKey ? '로드됨' : '없음 — rhwp-studio/.env.local 에 MINIMAX_API_KEY 설정'}`);

  return {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@wasm': resolve(__dirname, '..', 'pkg'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 7700,
    fs: {
      // [Task #741 후속] 외부 file path 그림 영역 영역 samples/ dir 영역 영역 fetch 가능 영역.
      allow: [__dirname, resolve(__dirname, '..', 'pkg'), resolve(__dirname, '..', 'samples')],
    },
    proxy: {
      // [캔버스 한컴 포크] AI 패널 프록시 — 브라우저는 같은 출처 /api/ai/* 로 부르고,
      // dev 서버가 api.minimax.io 로 전달하며 Authorization: Bearer 를 서버측에서 주입.
      // 키가 번들에 노출되지 않고, 브라우저 CORS/CSP 우회도 자연 해결. MiniMax는 OpenAI 호환.
      '/api/ai': {
        target: 'https://api.minimax.io',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/ai/, ''),
        configure: (proxy: { on: (ev: string, cb: (req: { setHeader: (k: string, v: string) => void; removeHeader: (k: string) => void }) => void) => void }) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (aiKey) proxyReq.setHeader('Authorization', `Bearer ${aiKey}`);
            // 브라우저 Origin/Referer 제거 → 서버-서버 호출로 위장(CORS 취급 회피).
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
  plugins: [
    // [Task #741 후속] dev 서버 영역 영역 /samples/* 경로 영역 영역 parent samples/ dir 영역
    // 영역 정적 serve 영역 — wasm-bridge.ts 영역 영역 외부 image fetch 영역 영역 영역.
    {
      name: 'serve-samples-dir',
      configureServer(server) {
        const samplesDir = resolve(__dirname, '..', 'samples');
        server.middlewares.use('/samples', (req, res, next) => {
          if (!req.url) return next();
          // URL decode + sanitize (path traversal 차단)
          const reqPath = decodeURIComponent(req.url.split('?')[0]);
          const relPath = reqPath.replace(/^\/+/, '');
          if (relPath.includes('..')) { res.statusCode = 403; return res.end(); }
          const full = join(samplesDir, relPath);
          if (!full.startsWith(samplesDir)) { res.statusCode = 403; return res.end(); }
          readFile(full, (err: NodeJS.ErrnoException | null, data: Buffer) => {
            if (err) { res.statusCode = 404; return res.end(); }
            const ext = extname(full).toLowerCase();
            const mime: Record<string, string> = {
              '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
              '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp',
            };
            res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
            // [Task #741 후속] OS 영역 절대 경로 영역 영역 response header 영역 노출 — JS
            // 영역 영역 dialog 영역 영역 한컴 viewer 정합 (D:\\... 영역 영역 영역 의 영역 영역) 영역.
            res.setHeader('X-File-Path', encodeURI(full));
            res.setHeader('Access-Control-Expose-Headers', 'X-File-Path');
            res.end(data);
          });
        });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'rhwp-studio',
        short_name: 'rhwp',
        description: 'HWP/HWPX 뷰어·에디터 — 알(R), 모두의 한글',
        lang: 'ko',
        theme_color: '#2b6cb0',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/rhwp/',
        scope: '/rhwp/',
        file_handlers: [
          {
            action: '/rhwp/',
            accept: {
              'application/x-hwp': ['.hwp'],
              'application/hwp+zip': ['.hwpx'],
            },
          },
        ],
        icons: [
          { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // WASM (~12 MB) is kept out of precache to avoid blocking SW installation;
        // CacheFirst at runtime still gives offline access after the first load.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2,ttf,otf}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  };
});
