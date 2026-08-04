# 프로젝트 구조 (document-studio)

한눈에 보는 폴더 지도. 규칙·이력은 `CLAUDE.md`와 `docs/playbooks/`가 정본이고,
이 문서는 **어디에 무엇이 있는지**만 다룬다.

⚠ 파일 개수는 변한다 — 숫자는 "규모 감"을 주기 위한 실측 스냅샷이지 계약이 아니다.

```
studio/
│
├── rhwp-studio/                          # ★ 현 주력 — "캔버스 한컴" (독립 앱, 포트 7700)
│   │                                     #   입양본(MIT, edwardkim/rhwp) 위의 포크.
│   │                                     #   우리가 고친 곳은 반드시 [캔버스 한컴 포크] 주석.
│   ├── src/
│   │   ├── engine/                       # 입력 해석 · 개체 조작 (30개)
│   │   │   ├── input-handler.ts          #   입력 진입점 — 캔버스 모드 상태 소유
│   │   │   ├── input-handler-mouse.ts    #   마우스: 선택·드래그·리사이즈 라우팅
│   │   │   ├── input-handler-table.ts    #   표: 셀 범위·경계선·핸들 리사이즈
│   │   │   ├── input-handler-picture.ts  #   개체 이동 + 스냅 가이드
│   │   │   ├── input-handler-keyboard.ts #   키보드·단축키(한글 IME 포함)
│   │   │   └── canvas-snap.ts            #   스냅 수학 · 정렬선 오버레이
│   │   ├── ui/                           # 화면 조각 (110개)
│   │   │   ├── ribbon-header.ts          #   리본 헤더(2행) — 화면에 보이는 유일한 헤더
│   │   │   ├── ribbon-tabs.ts            #   리본 탭 정의(홈·편집·삽입·레이아웃·도구·검토)
│   │   │   ├── canva-sidebars.ts         #   좌/우 레일 · 캔버스↔문서 모드 토글
│   │   │   ├── canva-right-inspector.ts  #   속성 인스펙터(글자·문단·표·셀)
│   │   │   ├── canva-ai-*.ts             #   AI 패널 · 클라이언트 · 배치 · 수정 대화상자 · 검토
│   │   │   └── canva-record-panel.ts     #   녹음 → 회의록
│   │   ├── command/                      # 명령 계층
│   │   │   ├── registry.ts               #   명령 등록부 (data-cmd 가 이걸 가리킨다)
│   │   │   ├── dispatcher.ts             #   실행
│   │   │   ├── shortcut-map.ts           #   단축키 표
│   │   │   └── commands/                 #   명령 구현 12묶음(file·edit·table·ai 등)
│   │   ├── core/                         # 문서 상태 · 폰트 · 이벤트 버스
│   │   ├── view/                         # 렌더 — canvas-view · 눈금자 · 가상 스크롤 · CanvasKit
│   │   ├── hwpctl/                       # HWP 컨트롤 액션(파라미터 세트)
│   │   ├── compare/                      # 문서 비교 · diff 엔진
│   │   ├── history/ · recovery/          # 실행 취소 저장소 · 자동 저장/복구
│   │   ├── media/                        # 사진·템플릿·타임머신 저장소
│   │   ├── lint/                         # 맞춤법·서식 검사 오버레이
│   │   └── styles/                       # CSS (krds-theme.css = 정부 KRDS 룩)
│   ├── e2e/                              # 실구동 검증 127개 (puppeteer — 진짜 이벤트 디스패치)
│   ├── tests/                            # 단위 44개 ⚠ 업스트림 소스 계약 테스트 포함
│   ├── vite.config.ts                    # dev 서버(7700) + AI 프록시(/api/ai · /api/nv)
│   └── public/ · pkg/                    # 정적 자산 · WASM(@rhwp/core에서 공급)
│
├── src/                                  # root 앱 (포트 5173/5175) — 판매용 임베드 에디터 사이트
│   ├── routes/
│   │   ├── StudioEmbed.tsx               #   `/` = 임베드 에디터 제품 페이지(히어로+라이브 데모)
│   │   ├── StudioRhwp.tsx                #   `/studio/rhwp` = rhwp-studio iframe 임베드
│   │   └── StudioTheme.tsx               #   테마 미리보기
│   ├── modules/
│   │   ├── embed/EmbedEditor.tsx         #   판매용 임베드 리치텍스트 에디터(블록 스택형)
│   │   ├── richtext/                     #   에디터 코어(캐럿·클립보드·측정·렌더)
│   │   ├── document/                     #   문서 모델 · 폰트 레지스트리 · 자산 · 내보내기
│   │   ├── merge/                        #   데이터 병합 — {{열이름}} 토큰 ↔ 화면 칩
│   │   │                                 #   ⚠ 삭제 금지: richtext 칩 렌더가 값으로 묶여 있다
│   │   └── canvas/ · ui/                 #   기하 헬퍼 · 테마
│   ├── hwpx/                             # ★ HWPX 내보내기 코어 — 영구 자산, 의존성 0
│   │   ├── exportCore.js                 #   자체 CRC32 + STORE ZIP + 내장 봉투
│   │   ├── hwpxBase.js                   #   자동 생성물(수정 금지 — npm run gen:hwpx-base)
│   │   ├── importCore.js                 #   가져오기(순수 — Node 하네스 공용)
│   │   ├── hanPreview.js                 #   "한글 미리보기" — hwpx 바이트 → 페이지 SVG
│   │   └── rhwpLoader.js                 #   @rhwp/core WASM 공용 로더(1회 init)
│   └── table-king/                       # 표 엔진 이식본 ⚠ table/·hooks/·components/ 는 업스트림 원본
│
├── scripts/                              # 게이트 · 생성기
│   ├── check-size.mjs                    #   코드 성장 래칫(파일 500 유효줄 · commit-msg 훅)
│   ├── hwpx-verify.mjs                   #   HWPX 7중 검증 하네스(kordoc — 개발용 비계)
│   ├── gen-hwpx-base.mjs                 #   봉투 재생성
│   └── sync-rhwp-pkg.mjs                 #   /pkg WASM 공급(postinstall 자동)
│
├── docs/                                 # 문서 — 각 주제의 정본은 하나씩
│   ├── product-spec.md                   #   제품 방향·로드맵 정본
│   ├── tech-choices.md                   #   기술 선택(라이브러리) 정본
│   ├── rhwp-adoption.md                  #   ★ rhwp 채택·포크 이력 + 실측 함정 사전
│   ├── refactoring-plan.md               #   크기 초과 파일 분리 계획
│   ├── saas-gates.md                     #   배포 전 보안·운영 게이트
│   ├── playbooks/                        #   운영 절차서
│   │   ├── agent-protocol.md             #     세션 부팅 순서(모든 모델 공통)
│   │   ├── traps.md                      #     함정 사전 — 증상으로 grep
│   │   ├── verify.md                     #     검증 매트릭스 + 완료 게이트
│   │   ├── browser-drive.md              #     rhwp 실구동 레시피
│   │   ├── debugging.md                  #     낯선 버그 = 창의적 디버깅 절차서
│   │   ├── parity-audit.md               #     "경쟁 제품과 동일하게" 갭 감사
│   │   └── CHANGELOG.md                  #     규칙 변경 이력(초보자용)
│   └── design/ · parity/ · plans/        #   디자인 노트 · 대조표 · 작업 계획
│
├── design/                               # 디자인 정본
│   ├── tokens.md                         #   ★ 디자인 값 정본(팔레트·사용처 지도·알려진 표류)
│   └── *.html                            #   컴포넌트 카탈로그 카드
│
├── pkg/                                  # WASM 생성물(gitignore — sync:rhwp가 공급)
├── vendor/ · public/ · output/           # 벤더 · 정적 자산 · 검증 산출물(e2e 리포트)
├── samples/                              # 샘플 문서(심볼릭 링크)
├── CLAUDE.md                             # ★ 작업 규칙 정본 — 세션은 여기서 시작
└── package.json                          # dev · dev:rhwp · verify:hwpx · sync:rhwp
```

## 이 구조를 지탱하는 규칙 5가지

1. **엔진·문서 모델 무변경** — rhwp의 HWP 문서 모델이 진실이고, floating 개체 오프셋이 곧
   캔버스 좌표다. 캔버스다움은 **입력 해석 레이어**로만 구현한다(진실 2개 = H4 위반).
2. **포크는 diff 가능하게** — 업스트림 대비 우리가 고친 곳은 `[캔버스 한컴 포크]` 주석.
   포크 수정 후 `npx tsc --noEmit` + `npm test` 필수(업스트림 소스 계약 테스트가 있다).
3. **내보내기 코어는 의존성 0** — `src/hwpx/exportCore.js`. rhwp는 검증·미리보기·가져오기에만
   쓰고 내보내기 경로에는 관여하지 않는다. kordoc은 개발용 비계로 제품에 넣지 않는다.
4. **코드 성장 래칫** — 파일 500 유효줄 예산, 초과 파일은 HEAD보다 커질 수 없다.
   새 기능은 새 파일 우선, 기존 파일엔 배선만.
5. **완료 선언 전 증거 먼저** — 실행 결과(실측 수치·테스트 출력)를 보인 뒤 완료를 말한다.
   미검증은 "미검증"이라 적는다. 검증은 실제 구동 기준(코드만 읽고 선언 금지).

## 실행

```bash
npm run dev          # root 앱 (5173 / Codespaces 5175)
npm run dev:rhwp     # 캔버스 한컴 (7700)
npm run verify:hwpx  # HWPX 내보내기 7중 검증 — exportCore 수정 시 필수
cd rhwp-studio && npx tsc --noEmit && npm test   # 포크 수정 후 필수
```
