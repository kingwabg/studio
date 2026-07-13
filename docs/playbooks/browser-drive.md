# rhwp-studio 실구동 레시피 — 브라우저 자동화로 "진짜로" 검증하는 법

UI 검증은 코드 읽기가 아니라 실구동이 규칙. 이 레시피는 전부 실사용으로 확정된 방법이다.

## 0. 부팅 시퀀스

1. dev 서버: `npm run dev:rhwp` (7700). Codespaces는 포워딩 URL 사용.
2. 페이지 로드 후 **복구 다이얼로그** 처리: `.modal-overlay`에 "복구" 텍스트 있으면 "나중에" 클릭.
   깨끗한 시작이 필요하면 IndexedDB `rhwpStudioAutosave` 삭제 후 리로드.
3. 자동 A4 대기(~2초): `window.__wasm.pageCount === 1` 확인.
4. 전역 핸들: `window.__inputHandler`(=ih) · `window.__wasm`(=wasm) · `window.rhwpDev`.
5. ⚠ 뷰포트가 0×0으로 잡히면 `resize_window`(예: 1280×1320) 후 리로드.

## 1. 좌표 변환 (paper mm/px ↔ 화면 클릭 좌표)

```js
const sc = document.querySelector('#scroll-content');
const cr = sc.getBoundingClientRect();
const zoom = ih.viewportManager.getZoom();
const pl = ih.virtualScroll.getPageLeftResolved(0, sc.clientWidth);
const po = ih.virtualScroll.getPageOffset(0);
// paper px → 화면: client = { x: cr.left + pl + px*zoom, y: cr.top + po + py*zoom }
// mm → paper px: px = mm * 96/25.4 (=3.7795)
```

## 2. 이벤트 디스패치 규칙 (어기면 조용히 무시됨)

- `mousedown`/`mousemove` → **canvas 요소에** (`#scroll-content canvas`) — 리스너가 container 등록.
- `mouseup` → document에 (once 리스너).
- 키보드 → `ih.textarea`에 keydown 디스패치 (focus 먼저). ⚠ **dispatch가 리로드 누적 후 죽는다**
  (실사고 2026-07-14: 방금 붙인 spy 리스너에도 안 닿음) — keydown으로 검증하기 전 `spy` 리스너로
  **dispatch 도달을 먼저 확인**, 죽었으면 하드 리로드, 그래도 죽으면 그 경로 "미검증"(verify.md §4
  L0). `ih.resizeXxx()` 직접 호출은 **로직 확인이지 실이벤트 검증이 아니다.**
- ⚠ **스크린샷·`computer` 클릭/키 입력이 30초 타임아웃**(CanvasKit 렌더러 미응답)이면 시각·실입력
  검증 불가 — §3 wasm 실측으로 대체하고 남는 건 "미검증"으로 명시(verify.md §4 L4). 단 인스펙터·
  사이드바 등 **일반 DOM은 정상 측정 가능**(getBoundingClientRect·computed style로 레이아웃 실증).
- 더블클릭 = mousedown/up ×2 + `dblclick` 이벤트. ⚠ 리로드 직후 첫 시퀀스는 무시될 수 있음 —
  결과(개체 수) 확인 후 재시도.
- 드래그 갱신이 안 먹으면 RAF 스로틀: `ih.dragRafId = 0; ih.updatePictureMoveDrag(evt)` 처럼
  스로틀 내부 함수를 mousemove마다 직접 호출 (hover는 `ih.resizeHoverRafId=0; ih.handleResizeHover(evt)`).

## 3. 상태 실측 API (스크린샷 대신 — 이것이 증거)

| 알고 싶은 것 | 호출 |
|---|---|
| 페이지 수/문서 존재 | `wasm.pageCount` |
| 페이지 위 개체(글상자/표/그림) | `wasm.getPageControlLayout(pg).controls` — {type,x,y,w,h,paraIdx,controlIdx} (px) |
| 표 크기/셀 | `wasm.getTableDimensions(0,ppi,ci)` · `wasm.getTableCellBboxes(0,ppi,ci)` (cellIdx 중복 제거 후 사용) |
| 셀 **모델** 크기(vs 표시 bbox) | `wasm.getCellProperties(0,ppi,ci,cellIdx).width/height` (모델 HWPUNIT) — bbox(표시 px)와 **따로** 재라(모델만 바뀌고 화면 고정인 localResize 함정 잡기, verify.md §4 L1) |
| 셀/글상자 텍스트 | `wasm.getCellParagraphLength(0,ppi,ci,cellIdx,cpi)` → `wasm.getTextInCell(0,ppi,ci,cellIdx,cpi,0,len)` |
| 본문 텍스트 | `wasm.getTextRange(0, para, 0, count)` |
| 표 속성(위치·treatAsChar 등) | `wasm.getTableProperties(0,ppi,ci)` / 도형: `wasm.getShapeProperties(0,ppi,ci)` |
| 커서/선택 상태 | `ih.cursor.getPosition()` · `ih.isInTable()` · `ih.isInTableObjectSelection()` · `ih.isInPictureObjectSelection()` · `ih.cursor.getSelectedCellRange()` |
| 캔버스 모드 | `ih.canvasMode` · `ih.canvasEditingRef` |
| 캐럿 표시 여부 | `#scroll-content .caret`의 computed display (no-el/none=숨김, block=표시) |

- 문서/표 프로그램 생성: `bus.emit('create-new-document')` 후 `wasm.createTable(0,para,off,r,c)` /
  `wasm.createTableEx({...treatAsChar:false})`, 변경 후 `ih.eventBus.emit('document-changed')`.
- ⚠ DOM rect는 변경된 기존 노드에 stale — 측정은 위 wasm API·`document.elementFromPoint`로.
- 콘솔 오류 확인 시 HMR 잔재 주의: 스택의 `?t=타임스탬프`가 현재 로드와 다르면 과거 것.

## 4. 보고 양식

verify.md의 완료 게이트 + UI 변경이면 이전/이후 비교(위젯 가능하면 위젯, CLI면 표).
수치는 이 레시피로 실측한 값만 쓴다.
