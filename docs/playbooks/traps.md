# 함정 사전 (traps) — 증상으로 grep해서 찾는 용도

전부 **실측으로 확정된 것만** 수록. 새 함정을 확정하면 여기 "증상 → 원인 → 해법" 3줄로 추가하고,
서사(어떻게 찾았나)는 docs/rhwp-adoption.md 로그에 남긴다.
작업 전 이 파일을 증상 키워드로 grep하는 것이 규칙 (M/L 티어 — agent-protocol §1-0 티어 라우팅 참조).

## rhwp-studio 엔진/API

- **표를 이동했는데 렌더가 안 움직임 (ok:true인데 불변)**
  → `moveTableOffset`은 Para 기준 상대라 앵커 자연 위치·restrictInPage에 클램프됨(특히 위쪽 이동).
  → 해법: `setTableProperties({vertRelTo:'Paper', horzRelTo:'Paper', horzOffset, vertOffset})` 절대
    지정 + 렌더 잔차(표 바깥여백 ≈1mm=283HWPUNIT) 스캔 보정 1회.

- **셀 경계를 모델로 옮겼는데 그 셀만 화면이 안 따라옴 (getCellProperties.width는 +로 바뀜)**
  → 그 셀에 예전 `localResize`(renderWidth/Height override)가 wasm에 남아, 순수 모델 `widthDelta`를
    화면이 무시(override가 이김). 실사고 2026-07-14: Shift 단일셀 localResize 후 Alt 모델 통째가 그
    행만 빼먹음. 흡착으로 표시상 정렬돼도 override는 살아있음.
  → 해법: 가로 단일셀 리사이즈는 **순수 모델**(target +delta/neighbor −delta, 셀별 독립 → 자국 안
    남김·Alt와 합성). 세로 행높이는 반대로 renderHeight만 먹힘(모델 높이=자동확장 최소값). ⚠ 검증은
    반드시 **모델·표시 둘 다** 측정(숫자가 모델만 맞을 수 있다).

- **표 여러 개를 좌표대로 만들었는데 위치가 서로 밀림**
  → 인라인 컨트롤 삽입이 앞 표의 흐름 위치를 민다(생성→즉시 이동 반복 금지).
  → 해법: 2-phase — 전부 생성·채움 후, getPageControlLayout(type:'table')로 재발견(크기+헤더셀
    매칭)해서 일괄 위치 지정. 생성 때 기록한 paraIdx는 뒤 생성이 밀어 stale.

- **글상자/표에 프로그램으로 텍스트 넣기**
  → 글상자 = `insertTextInCell(sec, ppi, ci, 0, cpi, off, text)` (cellIdx 0). 여러 줄 = 줄 insert 후
    `splitParagraphInCell`. 통째 교체 = 뒤 문단부터 delete+`mergeParagraphInCell`로 1문단화 후 재삽입.

- **단위 혼동**: 1mm = 283.465 HWPUNIT · 1px = 75 HWPUNIT · bbox/레이아웃 좌표는 px(96dpi).

- **wasm API가 없다고 단정하지 말 것** — wasm-bridge.ts에 320+ 메서드. grep 먼저
  (예: getPageControlLayout·getTableBBox·getCellParagraphCount·deleteShapeControl·createShapeControl).

## rhwp-studio 브라우저 자동화 (검증 시 필수 지식 — 상세는 browser-drive.md)

- **RAF 스로틀**: hover·이동·리사이즈 드래그 갱신이 requestAnimationFrame 스로틀 — 자동화
  브라우저는 RAF가 안 돌아 갱신 함수가 실행 안 됨. → `ih.dragRafId=0; ih.updateXxx(evt)` 직접 호출.
- **mousemove는 canvas 요소에 디스패치** — 리스너가 container에 등록돼 있어 document에 쏘면 안 닿음.
  mouseup은 document(once 리스너). mousedown도 canvas에.
- **리로드 직후 첫 더블클릭 시퀀스가 무시될 수 있음**(부팅 타이밍) — 생성 결과 확인 후 재시도.
- **자동저장 복구 다이얼로그가 부팅을 잡음** — 자동 A4는 복구 선택 후 진행됨. 자동화는 "나중에"
  클릭 처리 필요. 깨끗한 시작 = IndexedDB `rhwpStudioAutosave` 삭제.
- **stale rect 캐시**: 변경된 기존 노드의 getBoundingClientRect가 옛 값 — 검사는 wasm API·fiber·
  elementFromPoint로.
- **synthetic keydown dispatch가 리로드 누적 후 사망**(실사고 2026-07-14: 방금 붙인 spy 리스너에도
  무반응) + **스크린샷·`computer` 입력 30초 타임아웃**(CanvasKit 렌더러 미응답). → keydown 검증 전
  spy로 dispatch 도달을 먼저 확인, 죽으면 하드 리로드/미검증. `ih.resizeXxx()` 직접 호출은 로직만
  (실이벤트 아님). 인스펙터·사이드바 등 **일반 DOM은 정상 측정 가능**. 계층별 규칙 = verify.md §4.

## dev 서버/설정

- **loadEnv는 cwd가 아니라 `__dirname` 기준** — dev 서버 cwd가 부모(studio)면 엉뚱한 .env를 읽는다.
- **프록시 changeOrigin만으론 부족** — 브라우저 Origin/Referer가 새어나가 API가 CORS(브라우저)
  요청으로 취급. proxyReq에서 origin/referer 제거(서버-서버 위장).
- **.env.local만 gitignore(*.local)** — .env.example에 실키 넣는 사고 발생했음(회수). 예시 파일엔
  플레이스홀더만.
- **vite.config 수정 = 서버 자동 재시작이지만 env는 시작 시 1회 로드** — 키 추가 후 재시작 필수.
- **문서편집기(root 5173) dev가 "@wasm/rhwp.js could not be resolved"로 죽음** — root vite의
  optimizeDeps 기본 스캔이 모든 `**/*.html`을 크롤해 `rhwp-studio/index.html`까지 물고, 거기
  딸린 rhwp 소스의 `@wasm` 별칭(rhwp-studio 설정 전용)을 root 문맥에서 못 풀어 최적화가 터진다
  (재최적화 트리거 시 = 캐시 무효화·config 변경). → 해법: root `vite.config.js`에
  `optimizeDeps.entries: ['index.html']`로 스캔을 루트 진입점만으로 제한 +
  `server.watch.ignored: ['**/rhwp-studio/**']`. 캐시 오염 시 `node_modules/.vite` 삭제 후 재시작.
- **vite 6 dev 서버는 TTY(대화형 터미널) 없이 실행하면 시작 직후 종료** — 백그라운드·분리
  프로세스·일부 미리보기 도구로 띄우면 "VITE ready" 후 에러 없이 사라진다(CI=true로 단축키를
  꺼도 동일). vite 8은 무관. 실터미널(포그라운드)에선 유지. 자동화 검증 시 bash 세션 안
  `npm run dev & sleep N; curl` 로 그 호출 동안 붙여서 확인.
- **devcontainer.json은 JSONC**(주석 허용) — 도구로 파싱 검증 시 주석 제거 후 JSON.parse.
- **npm 11 lock을 npm 10 `npm ci`가 거부** (실사고 2026-07-12: CI 첫 4런 전멸, "Missing: X from
  lock file") — 로컬 npm 11이 일부 전이 의존성(@types/node·@emnapi 등)을 lock에서 생략, CI의
  node22+npm 10은 필수로 요구. → 해법: `npx npm@10 install --package-lock-only`로 lock 재생성 +
  `npx npm@10 ci --dry-run`으로 CI 시뮬레이션. lock 갱신 커밋 전 npm 10 dry-run이 규칙.

## 포크/테스트

- **업스트림에 소스 계약 테스트 존재** (tests/*.test.ts가 코드 텍스트를 정규식 검사) — 포크가
  조용히 계약을 깬다. 포크 수정 후 `npm test` 필수. 의도된 완화면 테스트를 [캔버스 한컴 포크]
  태그와 함께 갱신하되 원 계약의 본질(예: 성능 가드)은 게이트 검사로 유지.

## /studio·공용 프론트

- **Tailwind 유틸리티명과 클래스 충돌** (`table-row`·`table-cell`·`grid`·`hidden` 등) — display가
  덮여 레이아웃 파손. 접두사(tk-, canva-)로 격리.
- **폼 요소는 레이어 없는 font:inherit 리셋이 Tailwind 유틸을 이김** — 래퍼 div에 크기/굵기 주고
  상속시킬 것.
- **CSV는 UTF-8→EUC-KR 폴백 디코딩** — SheetJS에 바이트 직접 주면 한글 깨짐.
- **인라인 style이 스타일시트를 이김** — 접힘 등 클래스 규칙이 안 먹으면 대상 요소의 인라인
  display부터 의심(실사고: 레일 접힘 — .is-collapsed>*{display:none}을 인라인 flex가 이김).
- **flex 자식 width:0이 안 먹으면 min-width:auto** — min-width:0(+flex-basis:0) 부여.

## HWPX (핵심 — CLAUDE.md "검증 완료된 HWPX 매핑"이 정본, 여기는 사고 방지 요약)

- IDRef는 리더에 따라 배열 인덱스 — 새 id는 기존 itemCnt에 연속으로만.
- 문단 여백 hh:margin은 반단위 해석 — HWPUNIT ×2로 기록.
- 굵게/기울임은 속성 + 빈 자식 요소(`<hh:bold/>`) 병기.
- exportCore/importCore 수정 후 `npm run verify:hwpx` 7게이트 필수.
