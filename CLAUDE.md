# CLAUDE.md — document-studio (문서 편집기)

## 프로젝트 개요
캔바(Canva)식 자유 배치 UI를 가진 한국어 문서 편집기.
사용자(준하)는 React/TypeScript 프론트엔드 개발자이며, 최종 목표는
"AI가 통합된, HWPX(한글) 호환 문서 도구"다.
(별도 프로젝트 junha-ai/ 에서 데스크탑 AI 에이전트를 병행 개발 중 — 이 저장소와 섞지 말 것)

## 두 편집 표면 공존 (Strangler Fig 마이그레이션)
기존 흐름 에디터를 갈아엎지 않고, 새 모듈형 캔버스를 옆에 신설해 점진 이관한다.
라우팅: `/` = 기존 앱(DocumentStudio, 무손상), `/studio` = 새 모듈형 캔버스.
둘 다 `src/hwpx/` 코어를 공유. 목표 스택: Vite+react-router / TS(점진) / Tailwind(신규만) /
Zustand / dnd-kit / Supabase(Phase 2~) / Vercel.
- **기존(흐름 에디터)**: sections→blocks, 브라우저가 배치 → 실측 내보내기. JS.
- **신규(자유배치 캔버스)**: 블록이 mm 좌표(x/y/w/h) 직접 소유. TS + Zustand + dnd-kit.
  `src/modules/document/model.ts`(타입) · `src/modules/canvas/`(store·Stage·Block·geometry) ·
  `src/components/editor-shell/`(L/C/R) · `src/routes/`(StudioHome/StudioEditor).
- **데이터 병합**(`src/modules/merge/`): 하이브리드 전략 — 저장·엔진의 진실은 {{열이름}}
  토큰(정규식), 화면은 칩. 좌측 데이터 탭에서 엑셀/CSV 업로드(CSV는 UTF-8→EUC-KR 폴백
  디코딩 필수 — SheetJS에 바이트로 주면 한글 깨짐) → 열 알약을 텍스트/셀에 드롭 →
  레코드 미리보기 → 일괄 생성(개별 ZIP / 한 파일 N쪽=el.page).
  `exportHwpx.ts`: CanvasDoc은 모델이 곧 mm라 실측 없이 exportCore로 직변환.
- Tailwind는 **utilities만**(preflight 제외, tailwind.css 주석 참고) — 기존 앱 스타일 보호.
- TS는 `allowJs`+`checkJs:false` — 기존 JS와 공존, table-king·hwpx는 JS 유지(불가침).

## 핵심 아키텍처 (변경 시 반드시 사용자와 상의)
```
[진실]   캔버스 JSON 모델  ← 사용자가 조작하는 유일한 상태 (mm 단위, A4 210×297)
           요소 = { id, type: "text"|"table", x, y, w, h, ... }
[파생]   화면 렌더링       ← 진실에서 매번 계산 (React)
[직렬화] HWPX 파일         ← 내보내기 어댑터로만 생성 (저장/공유 시점)
[검증]   rhwp / 한글       ← 우리가 만든 HWPX를 여는 외부 렌더러
```
- **rhwp** (github.com/edwardkim/rhwp, MIT): 조판·렌더링·파싱 담당. 우리는 재발명하지 않는다.
  제품 의존성 `@rhwp/core`(WASM ~5.7MB)로 통합됨 — 단, "한글 미리보기"(파생) 전용.
  dynamic import로 지연 로딩하므로 편집 화면 첫 로딩에는 영향 없음.
- **kordoc** (npm): 개발용 비계(스키마 학습·검증 도구). **최종 제품에 포함 금지.**
- 제품의 내보내기 코어는 **의존성 0** (자체 CRC32 + STORE ZIP + 내장 템플릿).
  rhwp는 내보내기 경로에 관여하지 않는다 — exportCore가 만든 바이트를 소비만 한다.

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
  폰트와 무관하게 advance=1em). 화면 줄바꿈을 일치시키려면 지면 폰트도 전각이어야 함 —
  맑은 고딕이 정확히 1em (Pretendard 0.86em, Noto Sans KR 0.92em은 어긋남).
  새 캔버스 지면(.canvas-dots)은 맑은 고딕, 내보내기도 "맑은 고딕" 선언. 캔버스 텍스트
  패딩(px-2/py-1)은 내보내기에서 좌표/셀여백(cellMarginU)으로 보정 — 검증: 240자
  반복문에서 캔버스 44자/줄·6줄 = rhwp 44자/줄·6줄 정확 일치.
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
- `src/DocumentStudio.jsx` — 메인 앱. 홈 대시보드 → 템플릿 팝업 → 캔버스 워크스페이스.
  내장: HWPX_BASE(검증된 봉투 템플릿), 내보내기 코어, AI 패널(Fable 5 우선 → Sonnet 4.6 폴백).
- `src/table-king/` — 표 엔진 (github.com/kingwabg/table-king-Custom 이식본).
  한컴식 경계선 어긋남 편집·병합/나누기·셀 스타일·클립보드·실행취소.
  `TableKingBlock.jsx`만 우리 래퍼(문서 모델 시드 + onChange + active 게이팅),
  `table/`·`hooks/`·`components/`는 원본 그대로 — 업스트림과 diff 가능하게 유지.
  표 데이터 모델: { cells:[[{text,style}]], widths(행별), cellHeights(셀별), merges }.
  문서를 통째로 갈아끼울 땐(AI 적용) key(docRev)로 리마운트해 시드를 갱신한다.
- `src/hwpx/exportCore.js` — 제품 내보내기 코어 (의존성 0: 자체 CRC32 + STORE ZIP + 내장 봉투).
  검증된 매핑 + table-king 확장(병합 cellSpan, 행별 열 너비, 셀 내 줄바꿈=여러 hp:p).
- `src/hwpx/hwpxBase.js` — 자동 생성(수정 금지). kordoc이 만든 유효 봉투를 내장.
  재생성: `npm run gen:hwpx-base`.
- `src/hwpx/rhwpLoader.js` — @rhwp/core WASM 공용 로더 (미리보기·가져오기 공유, 1회 초기화).
  measureTextWidth는 init 전 등록 필수(rhwp 요구). WASM은 Vite `?url` 임포트로 배포.
  Vite 전용이므로 Node(하네스)에서 import 금지 — 순수 로직과 분리하는 이유.
- `src/hwpx/hanPreview.js` — "한글 미리보기": hwpx 바이트 → 페이지 SVG 배열.
- `src/hwpx/importCore.js` — 가져오기: HwpDocument → 문서 JSON (순수 — Node 하네스 공용).
  1×1 표=텍스트 블록(우리 매핑의 역방향), 머리글 패턴(Ⅰ/1/가)은 번호를 벗겨 저장,
  표는 중립형 {rows, merges}로 반환(테이블 모델 변환은 DocumentStudio hydrateImported).
- `scripts/hwpx-verify.mjs` — 3중 검증 하네스 (kordoc devDependency 사용).
  `npm run verify:hwpx` → validateHwpx ok + 내용 왕복 + SVG 렌더 확인. 코어 수정 시 필수 실행.
- `hwpx-export.mjs` — 초기 kordoc 기반 어댑터(참고용). 제품 경로는 src/hwpx/가 대체.
  ⚠ 표 모델이 table-king으로 바뀜 — 셀 텍스트는 cells[r][c].text (tableDataToRows 참고).
- `spreadsheet.jsx`, `resizable-table.jsx` — 이전 실험 자산(수식 엔진, HWP식 표 격리 엔진).
  격리 엔진은 table-king으로 대체되어 참고용으로만 남음.

## 설계 휴리스틱 (thinking-protocol 부록 요약 — 코드 결정 시 적용)
- H1: 막히면 "현재 데이터 모델로 목표 상태를 직렬화할 수 있는가?" 못 하면 구조를 바꾼다.
- H2: 요구사항이 도구의 불변식과 충돌하면 버그가 아니라 도구 미스매치다.
- H4: 진실은 한 곳, 나머지는 파생(useMemo). 동기화 코드가 보이면 설계를 의심.
- H5: 모든 조작이 핵심 불변식을 보존하게 설계 (예: "요소는 페이지 밖으로 못 나감").
- H6: 매직 넘버는 상한·하한 근거를 모두 적는다 (예: EPS 0.6px).

## 코딩 규칙
- 디자인 토큰은 `T` 객체 하나로 통일 (잉크 #1A2233, 문서 블루 #2B5CE6, 헤어라인 #E4E8EF).
- 아이콘은 이모지 금지, 인라인 SVG(1.4px 스트로크)만.
- 한국어 UI/주석. 주석은 "왜"를 설명.
- 파괴적 작업(파일 덮어쓰기, 대량 삭제)은 실행 전 사용자 확인.

## 다음 과제 (우선순위 순)
0. ~~한글 미리보기~~ ✅ 완료 — 툴바 "한글 미리보기" 버튼 → rhwp 조판 페이지 SVG 모달
1. ~~다중 페이지 지원~~ ✅ 완료 — 에디터: 블록 단위 페이지 넘김(스페이서, 자연 위치
   불변량으로 1회 수렴) + 페이지 구분선/여백 가이드. 내보내기: el.page + pageBreak 앵커.
   한계: 한 페이지보다 큰 블록은 밀지 않고 걸친 채 둔다(표 행 분할은 나중 과제).
2. ~~스타일 반영~~ ✅ 완료 — 화면 실측(computed style + table-king 셀 모델 + 실효 글꼴 감지)
   → 스타일 레지스트리 → header.xml. 화면 px = 미리보기 px 일치 확인.
3. ~~HWPX 가져오기~~ ✅ 완료 — 홈 "한글 문서 열기" → importCore(rhwp 파서) → 편집기.
   verify ⑦ 왕복 게이트(내보내기→가져오기 구조 복원 + 열 너비 복원).
   셀 크기는 getCellProperties(HWPUNIT÷75=px)로 복원 — 행별 반올림 금지(1px 유령 열).
   한계: 셀 스타일·이미지·중첩표는 미지원. 표 기능 전수 점검: docs/table-features.md.
4. 이미지 요소 타입 추가 (캔버스 + hp:pic 매핑 — rhwp getControlImageData로 가져오기도 가능)
5. Undo/Redo (요소 배열 스냅샷 히스토리)

## 실행/검증 명령
- 웹 앱: `npm run dev` (Vite, 127.0.0.1:5173)
- HWPX 검증: `npm run verify:hwpx` (validateHwpx ok + 왕복 + SVG 3중 확인)
- 봉투 재생성(봉투 스키마 바뀔 때만): `npm run gen:hwpx-base`
- 앱에서 내보내기: 에디터 상단 "HWPX 내보내기" 버튼 → 화면 배치를 mm로 실측해 다운로드
