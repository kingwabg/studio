# CLAUDE.md — document-studio (문서 편집기)

## 프로젝트 개요
캔바(Canva)식 자유 배치 UI를 가진 한국어 문서 편집기.
사용자(준하)는 React/TypeScript 프론트엔드 개발자이며, 최종 목표는
"AI가 통합된, HWPX(한글) 호환 문서 도구"다. 사업 방향은 월 구독 + 템플릿 마켓.
**현재 주력: rhwp-studio 입양본 위에 "캔버스 한컴"을 만드는 것** (아래 전용 섹션 참조).
(별도 프로젝트 junha-ai/ 에서 데스크탑 AI 에이전트를 병행 개발 중 — 이 저장소와 섞지 말 것)

## 작업 환경 (2026-07 확정)
- **주 작업장 = GitHub main + Codespaces.** 로컬 클론들은 동결 — pull/push 기준을 main으로 통일.
  devcontainer가 postCreate에서 root+rhwp-studio 의존성, /pkg(WASM, sync:rhwp), Claude Code CLI까지
  자동 설치. 포트: **5175**(문서편집기, 자동 실행) · **7700**(rhwp 캔버스 한컴, `npm run dev:rhwp`).
- **AI 키**: Codespaces Secret `MINIMAX_API_KEY` — vite 프록시(rhwp-studio/vite.config.ts)가
  process.env를 우선 읽으므로 파일 없이 동작. 로컬은 rhwp-studio/.env.local(gitignore).
- **세션 시작 추천**: 이 파일과 `docs/rhwp-adoption.md`(캔버스 한컴 융합 로그 — 함정·검증법의
  정본)를 먼저 읽을 것.

## 편집 표면 구조 (Strangler Fig — 2단계 진화 중)
라우팅: `/` = 기존 앱(DocumentStudio, 무손상) · `/studio` = 모듈형 캔버스 · rhwp-studio = 독립
앱(7700, `/studio/rhwp`에서 iframe 임베드). 스택: Vite+react-router / TS(점진) / Tailwind(신규만) /
Zustand / dnd-kit / Supabase(Phase 2~) / Vercel.
- **1단계(완료)**: 흐름 에디터(`/`) → 모듈형 자유배치 캔버스(`/studio`). 블록이 mm 좌표(x/y/w/h)
  직접 소유. `src/modules/document/model.ts` · `src/modules/canvas/` · `src/components/editor-shell/`.
  검증된 HWPX 내보내기/가져오기 파이프라인(`src/hwpx/`)이 여기 있음 — **영구 자산**.
- **2단계(진행 중)**: rhwp-studio 입양본이 차기 제품 표면. `/studio` 캔버스의 UX 자산(팔레트·
  인스펙터·스냅·텍스트 도구)을 rhwp 위로 이식하는 중. `src/hwpx/` 지식(매핑·검증)은 그대로 유효.
- **데이터 병합**(`src/modules/merge/`, `/studio` 소속): 진실은 {{열이름}} 토큰, 화면은 칩.
  엑셀/CSV 업로드(CSV는 UTF-8→EUC-KR 폴백 디코딩 필수 — SheetJS에 바이트로 주면 한글 깨짐) →
  열 알약 드롭 → 일괄 생성(개별 ZIP / 한 파일 N쪽=el.page). rhwp 쪽 이식은 로드맵 후보.
- Tailwind는 **utilities만**(preflight 제외) — 기존 앱 스타일 보호. TS는 `allowJs`+`checkJs:false`.

## rhwp-studio = "캔버스 한컴" (현 주력)
입양본(MIT, 6만 줄 vanilla TS HWP/HWPX 에디터). 원칙과 규약:
- **포크 규약**: 업스트림 diff 가능하게 유지. 우리가 고친 곳은 반드시 `[캔버스 한컴 포크]` 주석.
  포크 수정 후 `npx tsc --noEmit` + **`npm test` 필수** — 업스트림에 소스 계약 테스트(코드 텍스트
  정규식 검사)가 있어 포크가 조용히 계약을 깰 수 있다(실사고 2026-07-12: #1491 성능 가드 계약을
  캐시 폴백 포크가 깨뜨린 걸 test 미실행으로 못 봄). 의도된 완화면 테스트를 포크 태그와 함께 갱신.
- **대원칙: 엔진·문서 모델 무변경.** rhwp의 HWP 문서 모델이 진실이고, floating 개체(오프셋)가
  곧 캔버스 좌표다. 캔버스다움은 **입력 해석 레이어(캔버스 모드)**로만 구현 — 별도 JSON 캔버스
  모델을 이식하지 말 것(진실 2개 = H4 위반).
- **캔버스 모드** (InputHandler.canvasMode + canvasEditingRef, 메뉴바 토글·기본 ON·localStorage):
  클릭=개체 선택 → 재클릭(이동 없이)/더블클릭=텍스트 편집 → Esc=편집→선택→해제 계층.
  빈 지면 더블클릭=그 자리에 새 글상자+바로 편집(빈 채 이탈 시 소멸). 무편집 시 본문 캐럿 숨김.
  **표는 예외 — 글 넣는 그릇**: 셀 클릭=글영역 편집, 드래그=셀 범위 선택, 개체 잡기는 Alt+클릭.
  문서 모드 토글 시 기존 한글 동작 완전 보존.
- **AI 통합** (MiniMax M3, OpenAI 호환): 브라우저는 같은 출처 `/api/ai/*`만 호출, dev 프록시가
  Bearer 키를 서버측 주입(vite.config — 키 번들 노출 0). 기능: AI 패널 [문서 생성](A4 배치 JSON
  → 승인 → 글상자/표 실체화, 단일 스냅샷=Ctrl+Z 일괄 취소) / [일반](텍스트 → 커서 삽입) /
  글상자 우클릭 "AI에게 수정하기"(수정 전후 비교 → 적용). 공용 클라이언트 ui/canva-ai-client.ts.
  ⚠ 프록시는 dev 전용 — Vercel 배포 시 서버리스 함수로 이관 필요.
- **실측으로 확정한 함정** (재발견 금지 — 상세·검증법은 docs/rhwp-adoption.md):
  - 표 위치 지정은 `setTableProperties({vertRelTo:'Paper', horzRelTo:'Paper', ...})` 절대 오프셋
    + 렌더 잔차(바깥여백 ≈1mm) 보정 패스. `moveTableOffset`(Para 상대)은 위쪽 이동이 조용히
    클램프됨(ok:true인데 렌더 불변). 여러 표는 전부 생성 후 위치 해결(2-phase).
  - hover/드래그 갱신은 RAF 스로틀 — 자동화 브라우저(RAF 미실행)에선 내부 함수 직접 호출로 검증.
  - mousemove는 canvas 요소에 디스패치(리스너가 container 등록 — document에 쏘면 안 닿음).
- **로드맵**: ①모드 토글+포인터 기본값 ✅ → ②새 문서 여백 0(내보내기 원점 일치) → ③다중
  선택·정렬·복제 → ④크롬 다이어트(컨텍스트 툴바) → ⑤레이어 패널+z순서 → ⑥템플릿 갤러리.

## 핵심 아키텍처 (변경 시 반드시 사용자와 상의)
`/studio` 모듈형 캔버스의 구조 (rhwp-studio는 위 섹션의 원칙을 따름):
```
[진실]   캔버스 JSON 모델  ← 사용자가 조작하는 유일한 상태 (mm 단위, A4 210×297)
           요소 = { id, type: "text"|"table", x, y, w, h, ... }
[파생]   화면 렌더링       ← 진실에서 매번 계산 (React)
[직렬화] HWPX 파일         ← 내보내기 어댑터로만 생성 (저장/공유 시점)
[검증]   rhwp / 한글       ← 우리가 만든 HWPX를 여는 외부 렌더러
```
- **rhwp** (github.com/edwardkim/rhwp, MIT): 조판·렌더링·파싱 담당. 우리는 재발명하지 않는다.
  쓰임 셋: ①`/studio` "한글 미리보기"(@rhwp/core WASM ~5.7MB, dynamic import) ②가져오기 파서
  ③rhwp-studio 입양본(에디터 전체). 내보내기 경로에는 관여하지 않는다.
- **kordoc** (npm): 개발용 비계(스키마 학습·검증 도구). **최종 제품에 포함 금지.**
- 제품의 내보내기 코어는 **의존성 0** (자체 CRC32 + STORE ZIP + 내장 템플릿).

## 검증 완료된 HWPX 매핑 (건드릴 때 주의)
- 단위: 1mm = 283.465 HWPUNIT
- 절대 배치: `hp:pos treatAsChar="0" vertRelTo="PAPER" horzRelTo="PAPER"` + `vertOffset/horzOffset`
- 내보내기 용지 여백은 **전부 0** (크기는 canvas.page에서 파생) — 좌표가 종이 원점 기준이므로,
  절대배치를 여백/앵커 문단 원점으로 해석하는 렌더러(rhwp)에서도 같은 자리에 찍히게 원점을 통일.
  봉투 기본 여백(좌20·위30·머리말10mm)을 그대로 두면 그만큼 밀린다.
- 텍스트 요소 = 무테두리 1×1 표 (`borderFillIDRef="1"`), 표 요소 = `borderFillIDRef="2"`
- 셀 내 줄바꿈 = 여러 `<hp:p>` 문단
- 다중 페이지: 요소에 `page`(0부터)와 페이지 로컬 y를 부여 → 페이지마다 앵커 문단 1개,
  2페이지부터 `<hp:p pageBreak="1">`. rhwp·한글은 존중하지만 **kordoc 렌더러는 미지원**
  (페이지 수 게이트는 verify ⑤ rhwp 단계가 담당).
- ⚠ 한글/HWP 조판은 한글 글자를 **전각(1em) 고정폭**으로 계산한다 (rhwp 실측: 선언
  폰트와 무관하게 advance=1em). 화면 줄바꿈을 일치시키려면 지면 폰트도 전각이어야 함.
  ⚠ **폰트 시스템 = 레지스트리**(`src/modules/document/fonts.ts`): OFL 12종(나눔고딕/명조·
  본고딕/명조·고운·고딕A1·IBM플렉스·도현·검은고딕·송명·나눔펜) 전부 npm self-host —
  저작권 100% 안전(폰트 저작권 시비 방어). 기본 폰트(나눔고딕)만 정적 로드, 나머지는
  선택 시 지연 로딩. **전각 보정은 폰트별 런타임 실측**(canvas measureText → letter-spacing
  em 계산, useFontStore 캐시)이라 어떤 폰트든 1em/글자가 되어 줄바꿈 정합이 유지된다.
  Block.font(레지스트리 key) → 화면 fontCss() / 내보내기 charPr fontRef(exportCore가
  다중 fontface를 기존 fontCnt에 연속 id로 등록). 맑은 고딕(MS 상용·윈도우 전용)은 폴백만.
  캔버스 텍스트 패딩(px-2/py-1)은 내보내기에서 좌표/셀여백(cellMarginU)으로 보정 —
  검증: 240자 반복문에서 캔버스 44자/줄·6줄 = rhwp 44자/줄·6줄 정확 일치.
  (Pretendard 0.86em은 UI 셸 전용.)
  - **안심글꼴**(category:"safe"): KoPub 바탕/돋움·나눔스퀘어/라운드 등 상업·웹 무료 폰트를
    `public/fonts/*.woff2`로 self-host, FontDef.localSrc로 @font-face 런타임 주입
    (ensureFont). 추가 방법은 `public/fonts/README.md`. KoPub는 전 글리프(본문용),
    나눔스퀘어는 웹 서브셋(제목용).
  - **호환 폰트**(category:"compat", compat:true): webFamily(닮은꼴 OFL)와 hwpxName(상용
    원명, 예 휴먼명조·HY견고딕·윤고딕)을 분리. 화면은 안전한 닮은꼴, 파일엔 원명 선언 →
    관공서 한글에서 정품 렌더. 이름 선언은 폰트 파일 배포가 아니라 합법. 둘 다 1em이라 정합 유지.
- 흐름 본문(flowText): 캔버스의 flow 텍스트 블록은 절대배치 개체가 아니라 진짜 hp:p
  문단으로 — 배치는 문단 마진(좌=x, 우=종이폭−x−폭, 첫 앞간격=y−6mm).
  ⚠ 문단 여백(hh:margin) 값은 렌더러가 반단위로 해석 → **HWPUNIT ×2로 기록** (rhwp 실측).
  ⚠ 앵커(호스트) 문단은 0.1pt로 줄여도 최소 줄높이 ≈6mm가 남음 → HOST_LINE_MM=6 차감.
  검증 오차 ±0.6mm. 여러 flow 블록은 y순으로 이어 붙고, 캔버스 실측 h로 간격 근사.
- 스타일: makeStyleRegistry가 화면 실측 스타일(pt·굵기·기울임·색·정렬·줄간격·셀 배경·글꼴)을
  charPr/paraPr/borderFill/fontface로 동적 생성해 header.xml에 주입.
  ⚠ IDRef는 리더에 따라 "배열 인덱스"로 해석된다(rhwp) — 새 id는 반드시 기존 itemCnt에
  연속으로 이어 붙일 것. ⚠ 굵게/기울임은 표준상 빈 자식 요소(`<hh:bold/>`) — 속성과 병기.
- 내보내기는 kordoc `validateHwpx(ok)` + 내용 왕복 + SVG 렌더 + rhwp 조판(페이지 수)
  + 스타일 조판(크기·굵기·배경·글꼴) + 가져오기 왕복(구조 복원) 7중 검증을 통과한 상태
- 패키지 항목 순서: mimetype → META-INF/container.xml → Contents/content.hpf
  → Contents/header.xml → Contents/section0.xml → Preview/PrvText.txt

## 파일 인벤토리
- `rhwp-studio/` — **현 주력.** 입양 에디터 + 캔버스 한컴 포크. 길잡이:
  `src/engine/input-handler*.ts`(입력 해석 — 캔버스 모드·표·마우스·키보드) ·
  `src/ui/canva-*.ts`(사이드바·팔레트·인스펙터·AI 패널/클라이언트/배치/수정 대화상자) ·
  `src/command/commands/`(커맨드 25종+, ai.ts 포함) · `vite.config.ts`(AI 프록시 /api/ai).
  진행 로그·함정·검증법의 정본: `docs/rhwp-adoption.md`.
- `src/routes/StudioRhwp.tsx` — rhwp-studio iframe 임베드(@rhwp/editor, 7700 프로브→github.io 폴백).
- `src/DocumentStudio.jsx` — 레거시 메인 앱(동결). 홈 대시보드 → 캔버스 워크스페이스.
- `src/table-king/` — `/studio` 캔버스의 표 엔진 (github.com/kingwabg/table-king-Custom 이식본).
  `TableKingBlock.jsx`만 우리 래퍼, `table/`·`hooks/`·`components/`는 원본 그대로.
  표 데이터 모델: { cells:[[{text,style}]], widths(행별), cellHeights(셀별), merges }.
  문서를 통째로 갈아끼울 땐(AI 적용) key(docRev)로 리마운트해 시드를 갱신한다.
- `src/hwpx/exportCore.js` — 제품 내보내기 코어 (의존성 0: 자체 CRC32 + STORE ZIP + 내장 봉투).
  검증된 매핑 + table-king 확장(병합 cellSpan, 행별 열 너비, 셀 내 줄바꿈=여러 hp:p).
- `src/hwpx/hwpxBase.js` — 자동 생성(수정 금지). 재생성: `npm run gen:hwpx-base`.
- `src/hwpx/rhwpLoader.js` — @rhwp/core WASM 공용 로더 (미리보기·가져오기 공유, 1회 초기화).
  measureTextWidth는 init 전 등록 필수(rhwp 요구). Vite 전용 — Node(하네스)에서 import 금지.
- `src/hwpx/hanPreview.js` — "한글 미리보기": hwpx 바이트 → 페이지 SVG 배열.
- `src/hwpx/importCore.js` — 가져오기: HwpDocument → 문서 JSON (순수 — Node 하네스 공용).
- `scripts/hwpx-verify.mjs` — 검증 하네스(kordoc devDependency). 코어 수정 시 필수 실행.
- `scripts/sync-rhwp-pkg.mjs` — /pkg(WASM)를 @rhwp/core에서 공급(postinstall 자동).
- `hwpx-export.mjs`·`spreadsheet.jsx`·`resizable-table.jsx` — 초기 실험 자산(참고용).

## 설계 휴리스틱 (thinking-protocol 부록 요약 — 코드 결정 시 적용)
- H1: 막히면 "현재 데이터 모델로 목표 상태를 직렬화할 수 있는가?" 못 하면 구조를 바꾼다.
- H2: 요구사항이 도구의 불변식과 충돌하면 버그가 아니라 도구 미스매치다.
- H4: 진실은 한 곳, 나머지는 파생(useMemo). 동기화 코드가 보이면 설계를 의심.
- H5: 모든 조작이 핵심 불변식을 보존하게 설계 (예: "요소는 페이지 밖으로 못 나감").
- H6: 매직 넘버는 상한·하한 근거를 모두 적는다 (예: EPS 0.6px).

## 코딩 규칙
- 디자인 토큰은 `T` 객체 하나로 통일 (잉크 #1A2233, 문서 블루 #2B5CE6, 헤어라인 #E4E8EF).
  에디터 신규 UI는 KRDS 룩(정부 블루 #256EF4·플랫+보더) — rhwp-studio는 krds-theme.css.
- 아이콘은 이모지 금지, 인라인 SVG(1.4px 스트로크)만.
- 클래스명은 Tailwind 유틸리티명과 겹치면 안 됨(`table-row`·`table-cell`·`grid`·`hidden` 등) —
  utilities-only 주입이라 display가 덮여 레이아웃이 깨진다. 접두사(tk-, canva- 등)로 격리.
- 한국어 UI/주석. 주석은 "왜"를 설명.
- 파괴적 작업(파일 덮어쓰기, 대량 삭제)은 실행 전 사용자 확인.
- **커밋·푸시는 사용자가 지시/승인했을 때만.** 에이전트가 작업 완료 후 임의로 커밋하지 않는다
  (검증까지 마친 뒤 "커밋할까요?"로 묻거나 지시를 기다린다). 비밀값(.env.local·키)은 어떤 경우에도
  커밋 금지 — 예시 파일(.env.example)에 실키를 넣지 말 것(실사고 2026-07-12 회수).
- **완료 선언 전 증거 먼저**: "완료/고쳤다"고 말하기 전에 증명하는 실행 결과(실측 수치·테스트
  출력)를 먼저 보여준다. 검증 안 된 항목은 얼버무리지 말고 "미검증"이라고 명시 — 실패한
  검증을 추정("타이밍 문제일 것")으로 덮고 완료 선언 금지.
- **UI·동작 변경은 "이전/이후" 비교로 검증 보고** (사용자 지시, 상시 규칙): 무엇이 어떻게
  바뀌었는지 이전·이후를 나란히 + 실제 측정값(좌표·크기·상태값·API 실응답)으로 보여준다.
  시각 위젯(show_widget)이 가능한 환경이면 위젯으로, 아니면(예: Codespaces CLI) 표·수치로.
  검증은 실제 구동(진짜 이벤트 디스패치·wasm 실측) 기준 — 코드만 읽고 "될 것"이라 선언 금지.

## 코드 성장 규칙 (게이트: commit-msg 훅 → `scripts/check-size.mjs`)
새 기능이 파일을 무한히 불리지 않게 하는 래칫. baseline 파일 없음 — 진실은 git(HEAD)뿐.
- **파일 예산 500 유효줄** (유효줄 = 물리 줄수 + 120자 초과분 환산 — 한 줄 뭉치기 무효).
  새 파일은 예산 초과로 태어날 수 없다.
- **래칫**: 예산 초과 기존 파일은 HEAD보다 커질 수 없다(배선 여유 +10줄). 줄이는 것만 허용 —
  기능을 붙이려면 **먼저 분리**(docs/refactoring-plan.md). rename은 `-M` 검출로 래칫 승계.
- **새 기능 = 새 파일 우선.** 기존 파일엔 배선(import·렌더 분기·프롭)만. 한 기능이 한 파일에
  +100줄 넘게 붙는 설계면 새 모듈로 재고.
- **중복 2회 룰**: 같은 로직 2번째 등장 = 같은 작업 단위에서 **별도 커밋으로** 공유 모듈 추출
  (기능 diff와 분리 — 병렬 세션 충돌 최소화). 두 사용처의 변경 사유가 다르면 "의도적 중복"
  상호 참조 주석으로 면제, 3번째 등장은 무조건 추출.
- **예외**: `src/table-king/{table,hooks,components}/`(업스트림 원본)·`hwpxBase.js`(생성물)·CSS.
  `rhwp-studio/`(rhwp 에디터 입양본 — src/ 밖이라 게이트 자동 비대상, 업스트림 diff 가능하게 유지)·
  `/pkg`(생성물 — `npm run sync:rhwp`가 @rhwp/core에서 공급).
  우리 래퍼(TableKingBlock.jsx)는 래칫 대상. 예외 디렉터리 안이라도 **신규 파일은 예산 적용**.
  단 rhwp-studio 안에서도 우리가 새로 만드는 파일은 예산 정신(500줄)을 지킬 것.
- **`[size-override]`는 사용자가 그 커밋에서 명시적으로 지시했을 때만.** 에이전트가 "불가피"를
  자가 판정해 붙이는 것 금지. 레거시(DocumentStudio.jsx)는 분리 대상이 아니라 동결.
  ⚠ 현재 예산 초과 부채 6종(2026-07-12 [size-override]로 반입): TableKingBlock.jsx·
  CanvasBlock.tsx·LeftPanel.tsx·exportCore.js·CanvasStage.tsx·store.ts — 분리 리팩토링 대기.

## 다음 과제 (우선순위 순)
**rhwp 캔버스 한컴 트랙 (주력)** — 로드맵은 위 rhwp-studio 섹션:
1. 캔버스 모드 ② 새 문서 기본 여백 0 (화면 좌표 = 내보내기 봉투 원점 일치)
2. ③ 다중 선택·정렬·복제 (마퀴 드래그, Ctrl+D — rhwp에 다중 그림 선택 이미 있음, 표까지 확장)
3. ④ 크롬 다이어트 (캔버스 모드에서 한컴 메뉴/툴바 접고 선택 컨텍스트 툴바)
4. ⑤ 레이어 패널 + z순서 · ⑥ 템플릿 갤러리 (사업 목표 직결)
5. AI 확장: 표 셀 선택에도 우클릭 AI 수정 · 수정 전/후 단어 diff · 자료(엑셀/CSV) 읽어 채우기
6. Vercel 배포 시 AI 프록시를 서버리스 함수로 이관 (현재 dev 전용)

**`/studio` 캔버스 트랙 (완료분 유지·이관 판단)**: 한글 미리보기 ✅ · 다중 페이지 ✅ ·
스타일 반영 ✅ · HWPX 가져오기 ✅ (셀 크기 HWPUNIT÷75, 행별 반올림 금지 — 1px 유령 열).
이미지 요소·Undo/Redo는 rhwp 트랙이 자체 보유하므로 신규 투자 전 이관 여부 판단.

## 실행/검증 명령
- 문서편집기: `npm run dev` (로컬 5173 / Codespaces는 postAttach가 5175로 자동 실행)
- rhwp 캔버스 한컴: `npm run dev:rhwp` (7700)
- rhwp-studio 타입 체크: `cd rhwp-studio && npx tsc --noEmit` (포크 수정 후 필수)
- rhwp-studio 단위 테스트: `cd rhwp-studio && npm test`
- HWPX 검증: `npm run verify:hwpx` (validateHwpx ok + 왕복 + SVG — exportCore 수정 시 필수)
- 봉투 재생성(봉투 스키마 바뀔 때만): `npm run gen:hwpx-base`
- WASM 재공급(필요시): `npm run sync:rhwp` (postinstall이 자동 수행)
