# CLAUDE.md — document-studio (문서 편집기)

## 프로젝트 개요
캔바(Canva)식 자유 배치 UI를 가진 한국어 문서 편집기.
사용자(준하)는 React/TypeScript 프론트엔드 개발자이며, 최종 목표는
"AI가 통합된, HWPX(한글) 호환 문서 도구"다.
(별도 프로젝트 junha-ai/ 에서 데스크탑 AI 에이전트를 병행 개발 중 — 이 저장소와 섞지 말 것)

## 핵심 아키텍처 (변경 시 반드시 사용자와 상의)
```
[진실]   캔버스 JSON 모델  ← 사용자가 조작하는 유일한 상태 (mm 단위, A4 210×297)
           요소 = { id, type: "text"|"table", x, y, w, h, ... }
[파생]   화면 렌더링       ← 진실에서 매번 계산 (React)
[직렬화] HWPX 파일         ← 내보내기 어댑터로만 생성 (저장/공유 시점)
[검증]   rhwp / 한글       ← 우리가 만든 HWPX를 여는 외부 렌더러
```
- **rhwp** (github.com/rhwp-rs/rhwp, MIT): 조판·렌더링·파싱 담당. 우리는 재발명하지 않는다.
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
- 내보내기는 kordoc `validateHwpx(ok)` + 내용 왕복 + SVG 렌더 3중 검증을 통과한 상태
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
1. HWPX 내보내기에 글꼴 크기/굵기 반영 (header.xml에 charPr 추가 + charPrIDRef 매핑)
2. 다중 페이지 지원 (요소 y > 297mm → 다음 페이지 / section 분할)
3. HWPX 가져오기 (rhwp @rhwp/core 파서로 외부 문서 → 캔버스 블록 삽입)
4. 이미지 요소 타입 추가 (캔버스 + hp:pic 매핑)
5. Undo/Redo (요소 배열 스냅샷 히스토리)

## 실행/검증 명령
- 웹 앱: `npm run dev` (Vite, 127.0.0.1:5173)
- HWPX 검증: `npm run verify:hwpx` (validateHwpx ok + 왕복 + SVG 3중 확인)
- 봉투 재생성(봉투 스키마 바뀔 때만): `npm run gen:hwpx-base`
- 앱에서 내보내기: 에디터 상단 "HWPX 내보내기" 버튼 → 화면 배치를 mm로 실측해 다운로드
