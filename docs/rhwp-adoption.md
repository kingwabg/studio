# rhwp 채택 목록 — 가져올 수 있는 것 전부 (2026-07-11)

`@rhwp/core` 0.7.17의 API 320개를 전수 분류해, 우리 시스템에 "무엇을·어떻게 가져와·어디에
쓸지" 정리한 실행 목록. 항목마다 통합 지점(파일)과 사용 방식을 못 박는다.

## 대원칙 (경계 — 어기면 아키텍처 붕괴)

- **진실은 캔버스 JSON 유지.** rhwp의 역할은 4가지뿐:
  ①가져오기(파서) ②미리보기/검증(파생 렌더) ③오라클(하네스 정답지) ④파생 계산 빌려쓰기.
- **제품 내보내기는 exportCore(의존성 0) 유지.** rhwp `exportHwpx`는 하네스의 참조 구현으로만.
- **편집 진실로 삼지 않는다** (2026-07-11 결정): rhwp는 키보드/IME/마우스 계층이 없고
  SVG/CanvasKit 렌더라 contentEditable·네이티브 IME를 잃는다. insertText 계열로 에디터를
  짓는 것 금지.
- 로딩은 [rhwpLoader.js](../src/hwpx/rhwpLoader.js) 공용(dynamic import, 1회 init).
  Node 하네스는 [hwpx-verify.mjs](../scripts/hwpx-verify.mjs)의 기존 rhwp 로딩 재사용.
  WASM 객체는 반드시 `doc.free()`.

## 현재 이미 사용 중 (7)

| 기능 | API | 위치 |
|---|---|---|
| hwpx 파싱→가져오기 | `new HwpDocument(bytes)` + 텍스트/표/병합 조회 | importCore.js |
| 열 너비/행 높이 복원 | `getCellProperties` | importCore.js |
| 한글 미리보기(페이지 SVG) | `renderPageSvg`, `pageCount` | hanPreview.js |
| 비표준 검증+자동보정 | `getValidationWarnings`, `reflowLinesegs` | hanPreview / HanPreviewModal |
| 조판 실측(진단) | `getPageTextLayout` | 세션 분석용 (미게이트) |
| 하이퍼링크 필드 역공학 | `getFieldList` | exportCore 필드 구조 확정에 사용됨 |
| hp:pic 역공학 | `insertPicture`+`exportHwpx` | 이미지 내보내기 구조 확정에 사용됨 |

## Tier 1 — 즉시 가치 (가져오기 완성 + 검증 자동화). 낮은 리스크

| # | 기능 | rhwp API | 통합 지점 | 사용 방식 |
|---|---|---|---|---|
| 1 | **셀 스타일 가져오기** (알려진 한계 #1 해소) | `getCellCharPropertiesAt` `getCellStyleAt` `getCellParaPropertiesAt` `getCellTextDirection` | importCore.js → hydrateImported / /studio 표 모델 | 셀 순회하며 배경·글자색·굵게·정렬을 table-king `cell.style`로 복원. 기존 `getCellProperties`(크기) 옆에 나란히 |
| 2 | **이미지 가져오기** (다음 과제 #4의 절반) | `getControlImageData` `getControlImageMime` `getPictureProperties` | importCore.js → assets.putAsset → 이미지 블록 | 컨트롤 순회 → 바이트+MIME → IndexedDB 자산 → `{type:"image", src, x,y,w,h}` 블록 |
| 3 | **구형 .hwp 열기** | `constructor(data)` 가 hwp/hwpx 겸용 (rhwpLoader 주석 확인됨) | 홈 "한글 문서 열기" 파일 accept | `.hwp` 확장자 허용 + 가져오기 왕복 검증 1회. 관공서 레거시 호환 — 코드 변경 최소 |
| 4 | **문서 썸네일** | `extractThumbnail(bytes)` (전역 함수, 전체 파싱 없이 경량) | 홈 대시보드 문서 카드 | 가져온/저장된 hwpx의 미리보기 이미지. WASM init만 필요 |
| 5 | **용지/여백 복원** | `getPageDef` `getSectionDef` `getDocumentInfo` | importCore.js → canvas.page | 가져올 때 A4 가정 대신 원본 용지 크기·방향 복원 |
| 6 | **표 기하 오라클 게이트** (이번 "표 4일"의 자동화) | `getTableCellBboxes` `getTableDimensions` `getTableBBox` | hwpx-verify.mjs ⑧ 신설 | 우리가 내보낸 표의 셀 bbox를 rhwp 조판에서 읽어 rowHeightsMm/colWidthsMm와 ±오차 비교. 표 회귀를 커밋 전에 잡는다 |
| 7 | **조판 게이트 승격** | `getPageTextLayout` (run별 x·y·w·charX) | hwpx-verify.mjs ⑤ 확장 | 지금 "페이지 수"만 보는 게이트에 줄 수·행 y좌표 검증 추가 |
| 8 | **rhwp 자체 왕복 검증** | `exportHwpVerify` (직렬화+자기 재로드 검증 JSON) | hwpx-verify.mjs 보조 게이트 | 우리 파일을 rhwp가 읽고→재직렬화→스스로 검증한 결과를 게이트에 |
| 9 | **전각 논쟁 판정** (미결 사안) | `measureWidthDiagnostic` | 1회성 진단 스크립트 | "실제 한글이 전각이냐 raw냐" 판단 보조 — CLAUDE.md 전각 불변식 유지/폐기 결정 자료 |

## Tier 2 — 기능 빌려쓰기 (제품 기능, 파생 계산만 위임)

| # | 기능 | rhwp API | 통합 지점 | 사용 방식 |
|---|---|---|---|---|
| 10 | **양식(누름틀) 리버스** — 로드맵 킬러기능 | `getFieldList` `getClickHereProps` `getFormValue`/`setFormValue` `getFieldValueByName` | importCore.js → 안내문(hint) 블록 | 관공서 양식의 누름틀·폼 필드를 읽어 우리 안내문/입력칸 블록으로 매핑. 내보내기 방향은 `insertClickHereField`→`exportHwpx`→XML diff로 역공학해 exportCore에 자체 구현 |
| 11 | **표 수식** | `evaluateTableFormula(Ex)` | 표 셀 "=SUM(...)" 입력 시 | 우리 표를 임시 rhwp 문서에 미러링 → 계산값만 회수(진실은 JSON, 계산만 위임). spreadsheet.jsx 수식엔진의 대안 |
| 12 | **수식(Equation) 블록** | `renderEquationPreview` `getEquationProperties` | 신규 블록 타입(후속) | 수식 스크립트 → 미리보기 이미지 파생 렌더. 내보내기 구조는 역공학 |
| 13 | **HTML 붙여넣기 파서 검증** | `pasteHtml` + `exportHwpx` | 클립보드 하네스 | Excel/웹 표 HTML을 rhwp가 어떻게 해석하는지 = 우리 클립보드 파서의 정답지 |
| 14 | **머리말/꼬리말·각주 가져오기** | `getHeaderFooterList` `getFootnoteInfo` 계열 | importCore.js (모델 기능 추가 시) | 해당 기능을 모델에 넣을 때 가져오기 즉시 지원 |
| 15 | **목록 정의 정밀 매핑** | `getNumberingList` `getBulletList` | importCore.js | 가져온 문서의 번호/글머리 정의를 우리 paraLists로 정확 매핑 |
| 16 | **찾기/바꾸기 (원본 뷰어용)** | `searchAllText` `replaceAll` | 가져오기 전 원본 미리보기 | 캔버스 자체 검색은 JSON이 더 쉬움 — 이건 "열기 전 원본에서 찾기" 전용 |

## Tier 3 — 미리보기/디버그 강화 (저우선)

| # | 기능 | rhwp API | 사용 방식 |
|---|---|---|---|
| 17 | 미리보기 클릭 → 블록 매핑 | `hitTest` 계열, `getPageOfPosition` | 미리보기에서 클릭한 위치의 캔버스 블록 하이라이트(검수 UX) |
| 18 | 렌더 백엔드 실험 | `renderPageHtml` `renderPageToCanvas(Filtered)` `getCanvasKitReplayPlan` | SVG 대비 성능/선명도 비교 |
| 19 | 미리보기 diff 고도화 | `getPageRenderTree` `getPageLayerTree` `getPageControlLayout` | 겹치기 모드에서 요소 단위 차이 표시 |
| 20 | 디버깅 | `getEventLog` `set_debug_overlay` `pendingTaskCount` | 조판 이슈 조사용 |

## 도입하지 않는 것 (결정 기록)

- `exportHwpx`/`exportHwp`를 **제품 내보내기로** — 의존성 0 코어 계약 위반. 하네스 참조용만.
- `insertText`/캐럿 API 기반 **에디터 재구축** — IME/상호작용 계층 부재, SVG 캐럿 재구현 비용,
  0.7.x 플랫폼 리스크, 캔바식 자유배치 사업 방향과 불일치 (2026-07-11 평가).
- `saveSnapshot`/`restoreSnapshot`를 우리 undo로 — 진실이 rhwp가 아니므로 무의미.

## rhwp-studio 입양 완료 (2026-07-11 — "캔버스 한컴" 작업환경)

- **소스**: `rhwp-studio/` (레포 최상위, MIT) — 업스트림(edwardkim/rhwp) diff 가능하게 무수정 유지.
  제외: node_modules·dist·public/samples(6.7MB 데모). 성장 게이트 자동 비대상(src/ 밖).
- **wasm 공급**: `/pkg`(생성물, gitignore) ← `npm run sync:rhwp`가 `@rhwp/core@0.7.18`에서 복사
  (postinstall 자동). rhwp-studio의 `@wasm` alias가 `../pkg`를 봄.
- **서버**: `.claude/launch.json` "rhwp-studio" = `npm run dev:rhwp` → vite dev 127.0.0.1:7700
  (HMR — 커스텀 작업환경). ⚠ base=/ 절대경로 빌드라 서브패스 서빙 불가 — 반드시 루트 서빙.
- **임베드**: `/studio/rhwp`(StudioRhwp.tsx)가 `@rhwp/editor`(공식 iframe 임베드)로 마운트.
  studioUrl 체인: `VITE_RHWP_STUDIO_URL`(Codespaces 포워딩용) → 127.0.0.1:7700 → github.io 폴백.
- 다음 = "합체": rhwp-studio 소스를 고쳐(HMR 즉시 반영) KRDS 룩 → 우리 킬러기능 명령 이식 →
  캔바식 자유배치 UX (HWP 개체 모델 + engine/input-handler 확장).

### 합체 로그 (포크 diff — 업스트림 대비 수정 내역, 수술식 유지)
- **1단계 KRDS 룩** ✅ (2026-07-11) — diff 3파일:
  `src/styles/krds-theme.css`(신규 — :root 변수 오버라이드 단일 파일, 라이트+다크),
  `src/style.css`(+2줄 — 마지막 @import), `src/ui/toast.ts`(1줄 — 액센트 하드코드 변수화).
  검증: 라이트 8변수 실측 일치(menuOpen #256ef4·border #cdd1d5·text #1e2124·selected #ecf2fe·
  toolbar 플랫·link·danger #de3412·bg #f4f5f6) + 다크 액센트 오버라이드 적용 + 렌더 텍스트 #1e2124.
  포크 수정은 반드시 `[캔버스 한컴 포크]` 주석 표기(업스트림 diff에서 식별).
- **4단계 캔버스 UX ①: 개체 이동 스냅 가이드** ✅ (2026-07-11) — diff 2파일:
  `src/engine/canvas-snap.ts`(신규 — 스냅 수학·타겟 수집·정렬선 오버레이 레이어, 컨테이너별
  싱글턴), `src/engine/input-handler-picture.ts`(updatePictureMoveDrag를 증분→절대 델타로
  재배선 + 스냅 보정 + 가이드 표시, finish에서 정리 1줄).
  동작: 개체(그림·도형·글상자) 드래그 시 지면 가장자리·여백선·중앙 + 같은 페이지 타 개체의
  좌/중/우·상/중/하에 ±5px 자석 + 정부 블루 정렬선. **Alt = 스냅 해제.** 스냅 타겟은 드래그당
  1회 수집(getPageControlLayout·getPageDef — 반환 계약은 표 스파이크에서 실측 확정).
  검증: 하네스 14/14(실코드 번들 — bbox 식별·자기 제외·여백/중앙 타겟·eps 경계·최근접·양축) +
  rhwp-studio tsc 클린. ⚠ UI 스모크(드래그 체감)는 자동화 불가(이 환경이 해당 페이지 레이아웃
  rect를 전부 0으로 보고) — **사용자 실사용 1회 확인 필요**. 다음 후보: 리사이즈 스냅·등간격
  배지·빈 지면 더블클릭=글상자.
- **4단계 캔버스 UX ②: 표 리사이즈 전면 가동** ✅ (2026-07-11, 사용자 보고 "높이·너비·아래·
  오른쪽·대각 늘리기 전부 무반응") — 4에이전트 워크플로 추적으로 원인 3중 확정:
  ①리사이즈 시작이 "셀 범위 선택 모드" 전용(캐시가 그때만 채워짐 — 캐럿만으론 경계 드래그 무시),
  ②호버 커서/마커가 pageHint 미설정 비교 버그로 사문화, ③표 8핸들은 리사이즈 커서만 바꾸고
  mousedown은 전부 '이동'으로 소비(대각 개념 부재). diff 3파일:
  - input-handler-mouse.ts: 캐럿이 표 안이면 콜드 캐시에서도 1회 조회로 경계 리사이즈 허용(한글
    규약), pageHint 비교를 설정 시에만, e/s/se 핸들 mousedown → 핸들 리사이즈 분기 + move/up 라우팅.
  - input-handler-table.ts: `startTableHandleResize/update/finish` 신설 — 마지막 행/열 셀들에
    이웃 보상 없는 delta(=표 성장, 키보드 리사이즈와 동일 wasm 계약), 최소 200HWPUNIT 클램프,
    병합 앵커 끝좌표 매칭, 스냅 가이드 레이어로 제안 우변/하변 프리뷰, snapshot undo.
  - input-handler.ts: 위임 3종 + 상태 필드.
  검증: mock-this 통합 하네스 **15/15**(셀 선정·delta HWPUNIT·클램프·병합·no-op·정리·캐시 무효화)
  + tsc 클린. UI 체감 스모크는 사용자 확인 필요(자동화 불가 환경).
- **4단계 캔버스 UX ③: 표 리사이즈 2종 명확 분리 + 경계선 스냅** ✅ (2026-07-11, 사용자 지시
  "명확히 구분"). 두 경로는 원래부터 코드상 분리(상태·마우스 라우팅 별개)돼 있고, 이번에
  ①에만 스냅을 추가해 역할을 못박음:
  - **① 내부 셀 경계선 조절**(표 크기 유지, 옆 셀 재분배) — startResizeDrag/update/finish에
    `applyBoundarySnap` 주입: 드래그 경계가 같은 축 다른 경계선(±4px, clamp 내)에 착 붙어
    어긋난 표 정렬, 전체 페이지 관통 accent 선으로 "캐치" 표시(표 범위만 도는 드래그 마커와
    구분), `Alt`=해제. diff = input-handler-table.ts만.
  - **② 외곽 핸들 리사이즈**(표 전체 성장/축소) — e(오른쪽 너비)·s(아래 높이)·se(대각 전체),
    늘리기/줄이기 모두. 줄이기는 최소 셀(200 HWPUNIT) 클램프. (지난 턴 구현 — shrink 이미 동작.)
  검증: 실코드 하네스 **11/11**(스냅 eps·clamp 밖 무시·Alt·최근접 + e/s/se 늘리기·줄이기·클램프)
  + rhwp-studio tsc 클린 + dev 서버 파싱 무오류. UI 체감은 사용자 확인 필요.
- **4단계 캔버스 UX ②-수정: 외곽 핸들 = 전체 "비례" 스케일** ✅ (2026-07-11, 사용자 보고 이미지
  — 표 늘리면 아래 행 하나만 거대해짐). 초판이 마지막 행/열에만 델타를 몰아넣은 게 근본 오류.
  전면 재작성: e(너비 전체)·s(높이 전체)·se(대각 전체) 모두 **모든 셀을 같은 비율 sx/sy로 스케일**
  → 열/행 비율 유지된 채 통째로 확대/축소. wasm 계약: 너비=widthDelta(목표모델폭−현재모델폭)+
  renderWidth(cell-width-equal 규약, getCellProperties로 모델폭 수집), 높이=heightDelta:0+
  renderHeight(현재표시높이 bbox.h×75 ×sy, cell-height-equal 규약). 셀 최소 200 HWPUNIT 클램프,
  병합 셀은 자기 폭 기준이라 비율 자동 유지. 검증: 하네스 **13/13**(9셀 전부 스케일·마지막 열
  아님·비율 유지[넓은 셀=좁은 셀×2]·늘리기/줄이기·s 높이만·극단 축소 클램프) + tsc 클린.
  내부 경계선 조절(개별 행/열 = "높이너비조절")은 캐럿-in-셀에서 getCellTableContext 반환으로
  이미 활성 — "셀 클릭 → 경계 드래그" 흐름.
- **4단계 ②-재수정: setCellProperties 진짜 비례 스케일 + 실제 마우스 검증** ✅ (2026-07-11).
  첫 재작성(resizeTableCells+localResize)은 실제 드래그에서 **재분배만 하고 표가 안 커짐**
  (실측: colW 재분배·마지막 열 흡수, 높이 무변). 라이브 프로브로 wasm 계약 규명 →
  **정답 = `setCellProperties({width,height})`로 각 셀 목표 크기 직접 설정**(실측: width=모델폭×1.4
  → 전 열 정확히 ×1.40, height=4500HWP → 전 행 60px). finish를 이 방식으로 교체
  (width=modelW×sx, height=dispHhwp×sy, 최소 200 클램프, reflowLinesegs).
  **⭐ 실제 마우스 드래그로 검증 완료** — se 핸들 드래그: 늘리기 전 열 ×1.32·전 행 ×3.35 균일,
  줄이기 전 열 ×0.84·전 행 ×0.56 균일, rhwp 렌더 SVG 9셀 전부 243×56 확인.
  ⚠ 검증 방법(재현용): rhwp-studio는 자동화 뷰포트가 0 → resize_window 필수. __wasm/
  __inputHandler 노출로 페이지→화면 좌표 매퍼 구성 후 **canvas에** MouseEvent 디스패치
  (window는 최상위라 버블 안 됨 — mousemove=container, mouseup=document 리스너에 안 닿음).
  문서는 파일메뉴(mousedown로 열림) 새로만들기 or __wasm.createTable+eventBus.emit. 자동저장
  (IndexedDB rhwpStudioAutosave)이 깨진 표를 저장하니 깨끗한 검증엔 초안 삭제 후 새 문서.
- **4단계 UX ④: 표 선택 호버 2모드(한컴독스식)** ✅ (2026-07-11). 이전엔 표 객체 선택 중
  hover가 핸들=크기커서·내부=move만이고 **경계선 줄 변경 호버가 1751행 return으로 사문화**.
  요구(사용자): 8핸들 위=전체 표 잡기, 그 외 경계선=줄 변경. diff 3파일:
  - canvas-snap.ts: `TableHoverLayer`/`tableHoverFor` 신설 — 전체 표 accent 사각 오버레이(z8,
    snap 가이드와 별도 레이어).
  - input-handler-mouse.ts: 객체선택 mousemove hover를 3분기로 — ①핸들=커서+전체 강조
    ②비핸들 경계선=캐시 워밍(선택 표 1회) 후 hitTestBorder→row/col-resize+마커 ③내부=move.
  - input-handler.ts: table-object-selection-changed(false)에서 전체 강조 clear.
  **⭐ 실제 마우스 호버로 검증**: 핸들(se)→nwse-resize+전체강조 ON, 내부 세로선→col-resize+마커,
  외곽 하변 1/4→row-resize+마커, 내부 가로선→row-resize+마커, 외곽 우변 1/4→col-resize+마커,
  내부→move. tsc 클린. (한컴독스는 로그인 벽 SPA라 직접 관찰 불가 — 사용자 스펙대로 구현.)
- **4단계 UX ④-확장: 선택 없이 순수 hover에서도 2모드** ✅ (2026-07-11). 이전엔 표 객체 선택 중에만
  2모드 hover가 났는데, 사용자 요구는 "선택 안 하고 마우스가 표 위로 가기만 해도". diff:
  input-handler-mouse.ts handleResizeHover에 — ①`handleZoneDir`(bbox의 4코너+4변 중점, tol=7/zoom)
  로 8핸들 구역 판정, hitTest가 표를 못 잡는 코너/외곽선은 `findTableBBoxNear`(getPageControlLayout,
  셀 미열거라 가벼움)로 근처 표 bbox 확보 → 전체 표 강조. ②경계선 hover가 선택 없이도 되도록
  캐시를 **hover 진입 시 1회 워밍**(프레임마다 아님 — 같은 표면 재사용, 대형 표 프리즈 회피).
  **⭐ 실제 마우스 hover 검증**(선택 안 함 유지): 코너 se→nwse+전체, 변중점 e→ew+전체,
  외곽 하변 1/4→row-resize+마커, 내부 세로/가로 경계→col/row-resize+마커, 내부→없음, 표밖→정리.
  ⚠ handleResizeHover는 RAF 스로틀이라 자동화 브라우저(RAF 미실행)에선 ih.resizeHoverRafId=0 후
  ih.handleResizeHover(evt) 직접 호출로 검증(실사용자 브라우저는 정상). tsc 클린.
- **4단계 UX ⑤: 셀 선택 중 Delete(한글 동작)** ✅ (2026-07-11). 이전엔 셀 선택(F5 phase 1~3·드래그)
  상태에서 Delete/Backspace가 미처리로 흘러감. 요구(사용자): 부분 선택=텍스트 삭제, 행/열 전체
  선택=삭제 모달→확인 시 삭제. diff 4파일:
  - ui/cell-clear-dialog.ts(신규): `showCellClearChoice()` 3지선다(예=내용·아니오=내용+셀모양·취소).
    ModalDialog가 2버튼 고정이라 이 케이스만 독립 구현(같은 CSS 클래스 재사용, Enter=내용/Esc=취소).
  - input-handler-table.ts: `handleCellSelectionDelete` — getSelectedCellRange+getTableDimensions로
    행전체(모든 열)=줄 삭제, 열전체(모든 행)=칸 삭제, 표 전체·부분=내용지우기 분기. 삭제는
    executeOperation snapshot 안에서 high→low 인덱스로 deleteTableRow/Column, 내용은 deleteTextInCell.
  - input-handler-keyboard.ts: 셀 선택 키 블록(M/S 앞)에 Delete/Backspace→handleCellSelectionDelete 배선.
  - input-handler.ts: 위임 메서드.
  **⭐ 실제 키보드 구동 검증**(ih.textarea에 F5/방향키/Delete keydown 디스패치 → 실제 모달 버튼 클릭):
  A 부분셀→3지선다·예→r1c1만 비고 3×3 유지, B 0열전체(F5×2+↓×2)→칸삭제·확인→3×2 좌시프트,
  C 0행전체(F5×2+→)→줄삭제·확인→2×2 상시프트, D 전체표(F5×3)→삭제 아닌 내용지우기+취소=무효,
  E 아니오(셀모양)→무오류. wasm getTableDimensions/getTextInCell 실측 일치. tsc 클린.
  ⚠ 자동화 브라우저 canvas 0높이·screenshot 타임아웃 → 좌표 마우스 클릭 불가라, 키보드 트리거
  기능은 실제 keydown 이벤트 디스패치로 구동(진짜 핸들러 경유). 셀 커서 배치는 cursor.moveToCellByIndex.
- **캔바식 좌/우 사이드바 이식** ✅ UI (2026-07-11). 사용자 요구: document-studio의 캔바 좌(삽입)·
  우(속성)·AI 패널을 rhwp에. 기존 React 컴포넌트는 캔버스 Block 모델 전용이라 로직 재사용 불가 →
  **rhwp-studio 안에 바닐라로 신설**(엔진 직결이 iframe 바깥 React보다 우월). 신규 6파일:
  - ui/canva-services.ts(서비스 핸들 타입) · canva-left-palette.ts(글상자/표/도형/그림 → 기존
    insert:*·table:create dispatch, 새 엔진 로직 0) · canva-right-inspector.ts(컨텍스트 배너 +
    글자 B/I/U·크기·정렬·색, Toolbar와 같은 cursor-format/para-changed 미러 + format-char/커맨드로
    적용) · canva-ai-panel.ts(채팅 UX + 삽입/복사) · canva-sidebars.ts(오케스트레이터: #editor-area를
    #canva-workspace로 감싸 3열 재배치, 탭·접기) · styles/canva-sidebars.css.
  - 배선: main.ts 부트스트랩에서 mountCanvaSidebars({wasm,eventBus,dispatcher,getInputHandler}).
    AI 삽입용 input-handler.ts에 insertPlainTextAtCursor(검증된 pastePlainText 경로 export 재사용).
  **⭐ 실제 구동 검증**: 레이아웃(좌176·편집840·우264, min-width:0로 축소) · 표 카드→픽커→표 생성 ·
  인스펙터 굵게 왕복(문서 char.bold=true+버튼 활성) · 정렬 para.alignment="center" · 탭 스왑 ·
  접기(840→1016→1280 풀폭, 손잡이 유지). tsc 클린.
  ⚠ **AI 라이브 모델 배선 완료(2026-07-12)**: dev 서버 프록시 방식으로 해결.
  vite.config server.proxy `/api/anthropic/*` → api.anthropic.com, `x-api-key`/`anthropic-version`을
  **서버측(Node)에서 주입**(키=loadEnv `ANTHROPIC_API_KEY`, process.env 우선 → .env.local). 브라우저는
  같은 출처만 호출 → 키가 번들에 안 나가고 CORS/CSP도 자연 해결. 패널 fetch를 `/api/anthropic/v1/messages`로
  변경. **검증**: 키 미설정 상태에서 프록시가 Anthropic 실제 401 `authentication_error`를 반환(=전달 성공,
  404·HTML 아님) + 패널이 ".env.local에 ANTHROPIC_API_KEY 넣고 재시작" 안내 표시. 라이브 응답은
  사용자가 .env.local에 키를 넣고 dev 서버 재시작 시 동작(키는 에이전트가 다루지 않음 — 보안 규칙).
  .env.example 추가, .env.local은 gitignore(`*.local`) 커버.
  **⭐ 실제 키로 파이프라인 완전 검증(2026-07-12)**: x-api-key 주입·인증 통과·Anthropic API 도달까지
  확인(응답은 계정 크레딧 부족 400 `invalid_request_error`에서 멈춤 = 코드 아닌 과금 이슈). 함정 2개:
  ① dev 서버 cwd가 부모(studio)라 `loadEnv(mode, process.cwd())`가 엉뚱한 .env를 읽음 → **`__dirname`**
  (=rhwp-studio) 기준으로 로드해야 함. ② `changeOrigin`만으론 브라우저 **Origin/Referer가 새어나가**
  Anthropic이 CORS(브라우저) 요청으로 취급 → "anthropic-dangerous-direct-browser-access 필요" 401.
  프록시 proxyReq에서 origin/referer 제거 + 그 헤더 주입으로 서버-서버 위장. 패널은 크레딧 부족·키 없음을
  각각 안내. **키 있고 크레딧 있으면 코드 수정 없이 바로 동작.**
  **⭐ MiniMax M3로 전환 + 실응답 검증(2026-07-12)**: 사용자가 Anthropic 크레딧 대신 MiniMax 키 사용.
  Anthropic 전용 경로라 안 됐던 것 → **프로바이더 전면 교체**. 프록시 `/api/ai` → `api.minimax.io`,
  인증 `Authorization: Bearer`(키=`MINIMAX_API_KEY || ANTHROPIC_API_KEY` 하위호환). 패널을 **OpenAI 호환**
  으로: `/v1/chat/completions`, system도 messages 항목, `max_completion_tokens`, `thinking:{type:'disabled'}`
  (사고 태그 방지), 응답=`choices[0].message.content`(혹시 남은 `<think>` 스트립), 모델 `MiniMax-M3`.
  에러는 OpenAI `error` + MiniMax 네이티브 `base_resp.status_code` 둘 다 방어. **검증**: 프록시 직접
  호출 200·finish_reason "stop"·base_resp.code 0 / 패널 실응답 "환영합니다…"·배지 MiniMax M3 /
  "본문에 삽입"→문단0 getTextRange 일치. tsc 클린·콘솔 에러 0. (Anthropic 전용 함정 2개는 위 참조.)
- **캔버스식 AI 문서 생성** ✅ (2026-07-12, 사용자: "캔버스탭일 땐 캔버스식 문서작성법 —
  inline-ai.com/feature/hwp 처럼"). inline-ai의 핵심(AI가 문서·표를 만들어 채움)을 캔버스 문법으로:
  M3가 A4 배치 계획 JSON(`{elements:[{type:'text',x,y,w,text}|{type:'table',x,y,rows}]}`, mm)을
  설계 → 패널에 계획 요약 + **[캔버스에 배치] 승인** → 지면에 실체화. 신규 ui/canva-ai-layout.ts
  (parseAiLayout 관대 파싱 + applyAiLayout), 패널에 [문서 생성]↔[일반] 칩(LAYOUT_PROMPT 분기).
  적용은 executeOperation 단일 snapshot — Ctrl+Z 한 번에 일괄 취소.
  - 텍스트 → createShapeControl 글상자(클릭점=좌상단과 동일 규약) + 줄마다 insertTextInCell/
    splitParagraphInCell. 표 → createTableEx(treatAsChar:false) + bbox row/col로 셀 채움.
  ⚠ **표 위치 함정 3중**(재발견 방지): ①생성→즉시 이동 반복 금지 — 인라인 삽입이 앞 표의 흐름
  위치를 밀어 어긋남(2-phase: 전부 생성 후 위치 해결) ②moveTableOffset(Para 기준 상대)은 앵커
  자연 위치·restrictInPage에 클램프되어 **위쪽 이동이 무시**됨(ok:true인데 렌더 불변, vertOffset만
  음수 누적 — 실측) ③정답은 **setTableProperties({vertRelTo:'Paper', horzRelTo:'Paper',
  horzOffset, vertOffset})** 절대 지정 + 렌더 잔차(표 바깥여백 ≈1mm) 스캔 보정 패스. 표 재발견은
  getPageControlLayout(type:'table')의 paraIdx/controlIdx + 크기·헤더셀 매칭(생성 시 기록한
  인덱스는 뒤 생성이 밀어 stale).
  **⭐ 실측 검증**: "주간 회의록 만들어줘" → M3가 텍스트 5·표 3(참석자 6×4/안건/결정) 설계 →
  배치 후 8개 좌표 **계획=실측 완전 일치**(mm), 표 내용 실데이터 채움("김민서, 마케팅팀" 등),
  제목 글상자 "주간 회의록". tsc 클린·콘솔 에러 0.
- **글상자 우클릭 "AI에게 수정하기"** ✅ (2026-07-12, 사용자 시나리오: 우클릭→모달→"이 영역을
  어떻게 수정하시겠습니까?"→지시→수정). inline-ai의 "골라서 수정+한눈에 비교"를 개체 단위로.
  - 신규: ui/canva-ai-client.ts(M3 공용 클라이언트 — 패널과 대화상자 공유, 중복 2회 룰 추출),
    ui/canva-ai-edit-dialog.ts(현재 내용→지시 입력→수정 전/후 비교→적용/다시 요청/취소.
    적용=replaceShapeText: 뒤 문단부터 delete+mergeParagraphInCell로 1문단화→새 줄 insert+split,
    executeOperation 단일 snapshot=Ctrl+Z 복원), command/commands/ai.ts('ai:edit-shape' —
    개체 선택 ref 우선, 없으면 커서의 글상자로 해결; main.ts registerAll).
  - 진입점 2곳: ①글상자 텍스트 편집 중 우클릭(기본 메뉴 첫 항목 — onContextMenu에 isInTextBox
    분기) ②글상자 개체 선택 상태 우클릭(picture 메뉴 첫 항목). 1-depth 글상자만(cellPath 제외).
  **⭐ 실측 검증**: "예를 들어서" → 지시(격식·"예시로서"·한 문장) → M3 "예시로서, 다음 사항을
  참고하시기 바랍니다." → 적용=글상자 교체(wasm 실측) → Ctrl+Z=원문 복원. tsc 클린·콘솔 에러 0.
  ⚠ 자동화 관찰: 리로드 직후 첫 더블클릭 시퀀스는 부팅 타이밍으로 무시될 수 있음(생성 확인 후
  재시도로 우회 — 실사용자 속도에선 미발생 추정, 미검증).
  ⚠ 함정(재발견 방지): 레일 접힘이 안 되던 건 content div의 **인라인 display:flex**가 스타일시트
  `.is-collapsed > *{display:none}`을 못 이겨 콘텐츠 min-content가 폭을 붙잡은 것 — content를
  클래스(.canva-rail-content)로 옮기고 접힘에 min-width/flex-basis:0 부여해 해결.
- **시작 시 자동 A4 + Alt+클릭 표 잡기 + 글상자 이동 검증** ✅ (2026-07-11, 사용자 요구 3종).
  - 자동 A4: main.ts 부트 async — loadFromUrlParam→offerAutosaveRecoveryIfIdle을 **await로 직렬화**
    후 `pageCount===0 && !dirty`면 createNewDocument(). 복구 다이얼로그가 있으면 복구 우선,
    "나중에"를 눌러도 A4가 뜬다. initializeDocument 끝에 `command-state-changed` emit 추가
    (새 문서/열기엔 dirty 이벤트가 없어 캔바 인스펙터 배너가 안 깨어나던 것 해결).
    검증: 리로드→상호작용 0회→pageCount=1·캔버스 794×1123px(=A4@96dpi)·배너 "본문 편집".
  - Alt+클릭 표 전체 선택: input-handler-mouse.ts onClick의 hitTest 직후 —
    `e.altKey && 셀 hit && !isTextBox`면 moveTo(hit)+selectTableObject(기존 헬퍼 재사용).
    표 객체 선택 중 다른 표 Alt+클릭도 기존 "밖 클릭=해제 후 계속 진행" 흐름을 타고 자연 동작.
    검증: 일반 클릭=셀 커서(inTable=true·obj=false) 보존, Alt=obj=true·ref 정확, 밖=해제, 재선택 OK.
  - 글상자(팔레트) 생성→이동: 드래그 배치 150×70 @(150,150) 정확, 경계 클릭 객체 선택,
    내부 드래그 이동 오프셋 (11239,11250)→(18510,18750) HWPUNIT=+97/+100px 커밋.
    ⚠ 이동 드래그 갱신도 RAF 스로틀(dragRafId) — 자동화 브라우저에선 mousemove 디스패치 후
    `ih.dragRafId=0; ih.updatePictureMoveDrag(evt)` 직접 호출로 검증(hover와 같은 관례).
    mousemove는 반드시 canvas에 디스패치(리스너가 container 상시 등록 — document에 쏘면 안 닿음).
- **캔버스 모드 1단계: 포인터 기본값 뒤집기** ✅ (2026-07-12, "한글=텍스트 기반 vs 캔바=요소 배치"
  방향 결정 후 착수). 원칙: 엔진·문서 모델 무변경 — **입력 해석만 모드로 전환**. 메뉴바 우측
  [캔버스|문서] 토글(기본=캔버스, localStorage `rhwpCanvasMode`), 문서 모드는 기존 한글 동작 그대로.
  - 상태: InputHandler.canvasMode + **canvasEditingRef**(편집 컨텍스트 {kind:'table'|'shape'|'body'}).
    캔버스 모드 규칙: 클릭=개체 선택 → 재클릭(이동 없이)=텍스트 편집 진입 → Esc=편집→선택→해제.
    편집 컨텍스트 안 클릭은 일반 커서로 통과, 다른 개체 클릭은 컨텍스트 종료+새 선택.
  - diff: input-handler.ts(상태·setCanvasMode: 켤 때 셀/글상자 편집 중이면 컨텍스트 승계),
    input-handler-mouse.ts(Alt분기→`e.altKey||canvasMode` 일반화·글상자 내부 클릭=개체 선택·
    본문 클릭=전체 해제·본문 더블클릭=편집 진입·isCanvasEditingHit 헬퍼),
    input-handler-picture.ts(finishPictureMoveDrag zero-move 재클릭=글상자 편집 진입 — 표
    pendingEnterCellHit와 대칭), input-handler-table.ts(zero-move 셀 진입 시 컨텍스트 기록),
    input-handler-keyboard.ts(Esc에서 컨텍스트 종료+본문 편집 Esc·컨텍스트 없는 Backspace/Delete/
    Enter 무시), input-handler-text.ts(onInput·onCompositionStart 타이핑/IME 가드),
    canva-sidebars.ts+css(토글 UI).
  **⭐ 실제 이벤트 구동 검증** (전 시나리오): 표 클릭=선택→재클릭=셀 편집("AB" 입력)→Esc=표 객체→
  Esc=해제 / 글상자 내부 클릭=선택→재클릭=편집("하이" Δ+2) / 본문 클릭=해제·타이핑 무시(pos 불변)→
  더블클릭=편집 진입(Δ+1) / 문서 모드 토글=기존 동작 보존(셀 클릭=커서·본문 즉시 타이핑)+persist.
  tsc 클린. 다음: 2단계(새 문서 여백 0)~6단계(템플릿 갤러리) — 대화 로드맵 참조.
- **캔버스 모드 1단계 보정: 빈 지면 더블클릭 = 그 자리에 텍스트** ✅ (2026-07-12, 사용자 지적
  "본문 프레임 편집 진입은 캔바식이 아니다 — 어디든 더블클릭하면 마우스 위치 기반 텍스트 입력창").
  이전 /studio 캔버스의 insertTextAt 시맨틱을 rhwp로 이식:
  - input-handler.ts: `createCanvasTextboxAt(clientX, clientY, anchor)` — 클릭점=글상자 **좌상단**
    (0.01mm 감각 보존), 기본 80×12mm(이전 BLOCK_DEFAULTS.text), 페이지 안 클램프,
    createShapeControl(textbox·floating·InFrontOfText) 후 개체 선택 없이 **바로 편집**(enterTextboxEditing).
    `maybeRemoveEmptyCanvasTextbox()` — 더블클릭 생성분(newCanvasTextboxRef)이 빈 채로 편집을
    벗어나면 deleteShapeControl로 소멸(이전 "blur에서 스스로 사라진다" 이식).
  - mouse: 본문 더블클릭 분기를 body 편집 진입→텍스트 생성으로 교체. 빈 박스 정리는 편집 이탈
    지점(본문 클릭·다른 표/글상자 선택·Esc·모드 토글·연속 더블클릭)에 배선 — 삭제 시 컨트롤
    인덱스 시프트로 hit가 표류하므로 **그 클릭은 정리로 소비하고 return**.
  **⭐ 실측 검증**: 더블클릭 (250,400)→좌상단 (249.9,400)·302×45px·즉시 캐럿·"안녕" 입력 /
  내용 있으면 밖 클릭에도 유지 / 빈 채 밖 클릭·Esc=소멸(2→1) / 기존 상자 클릭=선택·재클릭=편집
  회귀 없음 / 문서 모드 더블클릭=생성 안 함. tsc 클린·콘솔 에러 0.
- **캔버스 모드: 새로고침 시 본문 캐럿 숨김** ✅ (2026-07-12, 사용자 "새로고침하면 커서만 깜빡임").
  원인: initializeDocument→`activateWithCaretPosition()`가 로드 시 무조건 `caret.show()` 호출.
  캔버스 모드는 본문이 프레임이라 편집 컨텍스트(canvasEditingRef) 없으면 커서가 없어야 함.
  fix: `shouldShowBodyCaret() = !canvasMode || !!canvasEditingRef` 가드를 activateWithCaretPosition
  두 분기 + setCanvasMode(모드 전환 시 표시/숨김)에 적용. 캐럿은 문서 로드 때 scroll-content가
  재생성되며 DOM에서 빠지고 show()에서만 재부착되므로, show를 스킵하면 아예 요소가 없다.
  **⭐ 실측(.caret display)**: 새로고침 캔버스=no-el / 새 문서=no-el / 문서모드=block /
  캔버스복귀=none / 더블클릭 텍스트 편집=block(과잉 억제 X) / 빈 채 이탈=none. tsc 클린.
- **문서 전체 검토 AI (P1)** ✅ (2026-07-12, 병렬 체제 2번째 배치 — 기반 나 + 코어·UI 에이전트 2).
  글상자 전체 텍스트를 모아 M3에 표현·오탈자 검토 → findings 리스트 → 개별 적용(단일 스냅샷).
  파일: `canva-ai-doc.ts`(계약+헬퍼 추출) · `canva-ai-review.ts`(수집·프롬프트·파싱·적용,
  코어 에이전트) · `canva-ai-review-ui.ts`(전송 동의·findings 리스트·jsdiff 단어 diff, UI
  에이전트) · `canva-ai-panel.ts`(검토 버튼·흐름 배선, 나). 원칙 2 예외의 첫 사례(전송 동의 카드).
  **⭐ 실측(실구동)**: 글상자 2개(오류문) → "글상자 2개·62자" 동의 카드 → M3 4초 응답 →
  발견 2건(띄어쓰기) → [적용] "진행 하겠"→"진행하겠"(box2 불변=선택 적용) → 행 "적용됨" →
  **Ctrl+Z로 원복**(단일 스냅샷 HIL 확인). tsc 0 · 185/185 · npm10/11 lock 양립.
  ⚠ 글상자 열거 = getPageControlLayout(pg).controls type:'shape'만, ref={sec:secIdx??0,
  ppi:paraIdx, ci:controlIdx}. ⚠ Vite에 새 npm 의존성(diff) 추가 시 dev 서버 재시작 필요
  (실행 중이면 "Failed to resolve import diff"). v2 후보: 표 셀 검토·누락 항목 점검·일관성.
- **캔버스 모드 ② 새 문서 기본 여백 0 (P0-1)** — **보류** (2026-07-12 사용자 지시).
  일단 여백 0 구현·커밋했으나, 준하 님: "캔버스 모드도 여백은 문서모드처럼 동일해야해"로
  방향 수정. 코드 롤백(main.ts setPageDef 제거) → 새 문서 여백 30/30/20/15 유지. 
  P0-2 우선순위 재검토 필요.
- **캔버스 모드 보정: 표 = 셀 편집 우선(객체 잡기는 Alt 전용)** ✅ (2026-07-12, 사용자 피드백
  "표가 Alt 없이 객체로 잡힘 / 텍스트 있는 셀 빈공간 클릭도 글영역이 잡혀야 / 셀 드래그 안 먹힘").
  원인: 1단계에서 넣은 "캔버스 모드 일반 클릭=표 객체 선택" 분기가 셀 클릭을 가로채 일반 클릭
  (커서+셀 드래그 후보)에 도달 못함. 표는 '글 넣는 그릇'이라 셀 편집이 우선이어야 함.
  fix(input-handler-mouse.ts onClick): ①표 객체 잡기를 `e.altKey` 전용으로 되돌림(canvasMode
  자동 잡기 삭제) ②'본문 프레임 해제'를 빈 지면(`parentParaIndex===undefined && !isTextBox`)에만
  적용해 표 셀은 통과 ③일반 클릭에서 표 셀이면 canvasEditingRef={kind:'table'} 설정(타이핑 허용)
  ④빈 새 텍스트 정리를 상단 1곳으로 일원화(`!isCanvasEditingHit && maybeRemove → return`, 인덱스
  시프트 표류 방지). 셀 드래그는 기존 cellSelectionDragCandidate→promote가 그대로 작동.
  **⭐ 실측**: 셀 일반클릭 tableObj=false·inTable=true·타이핑 4→5 / 텍스트셀 빈공간 클릭=그 셀 잡힘 /
  드래그 r0c0→r1c1={0,0,1,1} / Alt+클릭=표 객체 유지 / 빈 지면=해제. tsc 클린·콘솔 에러 0.

## rhwp-studio 표 기능 전수 감사 — table-king 기본능력 대조 (2026-07-11, 소스 기반)

방법: 명령 정의(command/commands/table.ts 25종 — stub 사용처 0 = 전부 실구현)·입력 핸들러
(input-handler-table.ts 1,504줄)·다이얼로그 소스 전수. UI 실동작은 자동화 불가(레이아웃 API 0
보고) — 사용자 스모크 권장.

| 기본능력 (우리 스펙 기준) | table-king (우리) | rhwp-studio | 비고 |
|---|---|---|---|
| 표 삽입(행×열) | ✅ | ✅ table:create (Ex: colWidths까지) | |
| 셀 텍스트 편집(캐럿·IME) | ✅ textarea | ✅ 네이티브 캐럿+IME 합성 | rhwp가 상위(셀 내 다문단) |
| 셀 범위 드래그 선택 | ✅ | ✅ cellSelectionDragState + 렌더러 | |
| 행/열 추가·삭제 | ✅ 4버튼 | ✅ 4방향 + 줄/칸 다이얼로그(N개) | |
| 셀 병합/나누기 | ✅ 2×2 | ✅ 합치기 + 나누기 다이얼로그(N×M) | |
| 경계 드래그 크기조절 | ✅ 그룹·스냅·하한 | ✅ + **Shift 국소(어긋남)**·외곽 판정·이력 | 동급 이상 |
| Shift 국소(한컴식 어긋남) | ✅ | ✅ promoteResizeDragToSingleCell | |
| 표 객체 이동/선택 | ✅ | ✅ table-object-renderer + moveTableOffset | |
| W같게/H같게 | ✅ | ✅ cell-width/height-equal | |
| 셀 배경·테두리 | ✅ 배경만 | ✅ **3탭 다이얼로그(테두리/배경/대각선)** | rhwp 상위 |
| 셀 서식(굵게·색·정렬) | ✅ | ✅ charFormat/paraFormat in cell | |
| 셀 안 여백 | ✅ 인스펙터 | ✅ 표/셀 속성 다이얼로그 | UI 방식 차이 |
| Tab/방향키 셀 이동 | ✅ | ✅ + **마지막 셀 Tab=행 자동 추가**(한글 시그니처) | rhwp 상위 |
| 클립보드(TSV/HTML) | ✅ | ✅ + **행/열 바꿈 복사·붙여넣기** | rhwp 상위 |
| 실행취소/다시실행 | ✅ | ✅ command 패턴 전반 | |
| 캡션 | ⚠ 상태만(렌더 X) | ✅ table:caption-toggle | rhwp 상위 |
| 계산식 | ✗ (spreadsheet.jsx 참고용) | ✅ 계산식·블록 계산식·천단위 쉼표·자릿점 | rhwp 상위 |
| 표 페이지 나눔 | ✗ (최대 한계) | ✅ tableProps.pageBreak·repeatHeader(머리글 반복) | rhwp 상위 |
| 표 스타일 프리셋(줄무늬 등) | ⚠ 상태만 | ✗ 없음 | 우리 이식 후보 |
| 인스펙터(우측 패널) UX | ✅ | ✗ 다이얼로그 중심 | 우리 이식 후보 |

**결론**: 기본능력은 전 항목 충족 + 우리가 못 가진 6개(계산식·캡션·행/열바꿈·대각선 테두리·
머리글 반복·표 페이지 나눔)를 보유. 격차는 반대 방향 — 우리 캔버스 감각(스냅✅ 완료·인스펙터·
프리셋)을 이식하는 것이 합체의 남은 일.

## rhwp 표 vs table-king 비교분석 — 중복 기능의 rhwp 이관 (2026-07-11 스파이크 2차)

기준: 한컴독스/한글 표 UX(docs/table-editing-rules.md가 스펙). "중복 = 우리가 재구현했던 표 로직" →
rhwp 표 블록에서는 전부 rhwp 엔진 호출로 대체(재구현 0). table-king 표는 병행 유지(사용자 결정 대기).

| 기능 (한컴 표준) | table-king (자체 구현) | rhwp 표 블록 | 검증 |
|---|---|---|---|
| 표 삽입 | makeTableKingData | `createTable` | ✅ 3×3 조판 |
| 셀 텍스트 편집 | textarea 셀 | `insert/deleteTextInCell` + 오버레이 입력 | ✅ 왕복 |
| 셀 범위 드래그 선택 | 자체 selection | UI만 자체(파란 하이라이트), 좌표는 rhwp bbox | ✅ 4셀 |
| 행/열 추가·삭제 | 자체 grid 조작 | `insert/deleteTableRow/Column` | ✅ |
| 셀 병합/나누기 | merges 배열 + 자체 로직 | `mergeTableCells`/`splitTableCellInto` | ✅ 12→9→12 |
| 경계 드래그 크기 조절 | useBoundaryDrag(그룹·스냅·하한) | `resizeTableCells`(±델타, 표 폭 유지) | ✅ 302/222/262 |
| 굵게/기울임/밑줄 | cell.style | `applyCharFormatInCell` | ✅ bold 왕복 |
| 문단 정렬 | cell.style.hAlign | `applyParaFormatInCell {alignment}` ⚠ 키=alignment | ✅ center 왕복 |
| 셀 배경 | cell.style.backgroundColor | 2단계: 문단 fill로 borderFill 생성 → `setCellProperties {borderFillId}` | ✅ SVG #fef08a |
| Tab/Shift+Tab 셀 이동 | 자체 내비 | UI 자체(오버레이 이동), 셀 좌표는 rhwp | ✅ |
| 줄바꿈/조판/최소높이 | HANGUL_MIN_ROW_H 등 자체 공식 | **rhwp 조판이 통째로 담당** (재구현 불필요) | ✅ bbox |
| 저장/복원 | JSON(TableKingData) | 미니 HWPX 바이트(base64) 왕복 | ✅ 전 서식 생존 |

### 스파이크에서 확정한 rhwp 통합 지식 (재발견 방지)
- `createEmpty()` 금지 — 기본 스타일(id 0) 미등록으로 직렬화 실패. **우리 exportCore 봉투로 시드.**
- 로드 후 `convertToEditable()` + `reflowLinesegs()` 필수 — 없으면 bbox/셀 좌표 높이 0.
- (para, ctrl) 주소는 저장 왕복에서 표류 — `getTableDimensions` 스캔으로 재해결.
- 문단 서식 키는 `alignment`(align 아님) — getCellParaPropertiesAt 읽기로 키 확인 후 쓸 것.
- 셀 배경 직접 API 없음 — 문단 fill(side effect로 borderFill 생성) → id 회수 → 셀에 지정.
- `resizeTableCells` 델타 단위 = HWPUNIT (px×75).

### rhwp 표 블록의 남은 한계 (다음 라운드 후보)
- 내보내기: 본문서 HWPX에 합류 미지원(가드) — rhwp 미니 문서의 `<hp:tbl>`을 추출해 exportCore
  섹션에 이식하는 방안이 유력.
- 실행취소: 블록 rhwpx 갱신이 캔버스 히스토리에 얹히므로 Ctrl+Z가 통째 스냅샷 단위로 동작
  (셀 단위 아님). rhwp `saveSnapshot/restoreSnapshot` 연동 검토.
- 셀 안 커서(캐럿) 없음 — 오버레이 input이라 셀 내 부분 서식·여러 문단 미지원.
- 글자색/크기/글꼴 리본 미배선(API는 확정: textColor/fontSize/fontFamily 키).

## 실행 순서 제안

1주차: **#1 셀 스타일 + #2 이미지 가져오기** (가져오기 한계 일괄 해소, importCore 한 파일)
→ **#6 표 기하 게이트** (표 회귀 자동 방어) → **#3 .hwp 허용 + #4 썸네일** (반나절, 사용자 체감 큼).
이후 #10 양식 리버스(킬러기능 스파이크) → #5, #7~9는 틈틈이.
