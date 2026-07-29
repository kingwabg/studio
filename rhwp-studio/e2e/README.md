# e2e — 실행 방법과 환경 요구

## 기본 실행

```bash
# dev 서버가 떠 있어야 한다 (기본 http://localhost:7700)
npm run dev &

# 헤드리스 (권장 — CI·로컬 공통)
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node e2e/<이름>.test.mjs --mode=headless

# 호스트 크롬 CDP 모드 (기본): CHROME_CDP 로 디버그 포트 연결
```

환경 변수 (`e2e/helpers.mjs`):

| 변수 | 기본값 | 용도 |
|---|---|---|
| `CHROME_PATH` | (없음 — headless 모드 필수) | 헤드리스 크롬 실행 파일 |
| `CHROME_CDP` | `http://172.21.192.1:19222` | 호스트 크롬 디버그 포트(WSL 기본값 — mac 은 headless 권장) |
| `VITE_URL` | `http://localhost:7700` | dev 서버 주소 |
| `CHROME_EXTRA_ARGS` | (없음) | 크롬 추가 플래그(공백 구분) |

## 환경 요구가 있는 테스트 (없으면 스킵/실패 — 결함 아님)

| 테스트 | 요구 | 비고 |
|---|---|---|
| `tac-inline-table` | 전용 샘플 `tac-case-001.hwp` | `samples/` → rhwp/samples 심링크가 있어야 로드됨 |
| `right-panel` 등 loadHwpFile 계열 | rhwp/samples 심링크 | 2026-07-28 심링크 배선으로 48종 초록 전환 |
| `edit-pipeline` | text-ir 지원 문서 | 미지원 문서면 명시 스킵 로그를 낸다 |
| `copy-paste` | 클립보드 권한 | headless 는 helpers 가 오리진에 명시 부여(2026-07-26) |
| `pdf-render-diff` | 크롬 플래그(`CHROME_EXTRA_ARGS`) | PDF 뷰어 관련 플래그 필요 시 |

## 규약

- 판정은 **값·픽셀 실측**으로 한다. "그려졌다/열렸다"만 보면 무동작 회귀를 놓친다
  (실사고: dataset.cmd 만 있고 리스너 없던 조작 칩, 볼드가 모델엔 저장되고 화면엔 무시).
- 엔진 API 는 wasm-bridge 를 거치거나 `window.__wasm` 로 직접 — **이름 드리프트 주의**:
  사라진 API 를 부르는 테스트는 그 지점에서 즉사한다. 2026-07-30 수리 사례:
  `getParaText` → `getTextRange(sec,para,0,len)` · `renderPageToSvg(p,scale)` → `renderPageSvg(p)`.
- 디버그 전역(`__inputHandler`·`__wasm`·`__eventBus`)은 **dev 모드 전용**(main.ts) —
  배포본 검증 스크립트에서는 쓸 수 없다(UI 경로로 조작할 것).
