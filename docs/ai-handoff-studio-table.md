# 다른 AI 작업 지침 — 새(/studio) 편집기의 표 UI 수정

> 이 파일을 작업 전 그 AI에게 그대로 읽히세요. 대상: `/studio` 라우트의 표.
> (기존 `/` 편집기 표가 아님 — 헷갈리면 안 됨)

## 0. 대전제

- 작업 **시작 전 반드시 `git status`가 깨끗한지 확인**하고, 아니면 커밋부터.
  (사고 나도 git으로 되돌리기 위함)
- dev 서버는 **하나만** 띄운다 (`npm run dev`, 포트 5173). 이미 떠 있으면 재사용.
- 표는 검증된 외부 엔진 **table-king**을 이식해 쓴다. 이 엔진 원본은 **건드리지 않는다.**

## 1. 신호등 — 어디를 만져도 되는가

### 🟢 자유롭게 수정 (여기서 작업하세요)
- `src/tailwind.css` 의 `.studio-root .tk-root ...` 블록
  → **/studio 표의 시각 스타일(테두리·간격·툴바 위치·색)은 전부 여기.**
  → 셀렉터를 반드시 `.studio-root`로 스코프할 것 (안 그러면 기존 편집기까지 바뀜)
- `src/modules/canvas/CanvasBlock.tsx` 의 `TK_THEME_VARS` (표 색 토큰),
  `TableKingContent`/`StaticResolvedTable` 함수 (표 주변 동작·병합 미리보기)
- `src/components/editor-shell/*` (좌/우 패널 UI)
- `src/routes/StudioEditor.tsx`, `src/routes/StudioHome.tsx` (셸·헤더)

### 🟡 주의해서 수정 (영향 범위 확인 후)
- `src/table-king/table-king.css` — **두 편집기(/와 /studio)가 공유**한다.
  여기를 바꾸면 기존 편집기 표도 바뀐다. /studio만 바꾸려면 🟢의 tailwind.css를 쓸 것.
- `src/modules/canvas/store.ts`, `src/modules/document/model.ts`,
  `src/modules/document/exportHwpx.ts` — 표 데이터 구조·내보내기. 구조를 바꾸면
  저장된 문서·병합·내보내기가 깨질 수 있음. 반드시 `npm run verify:hwpx` 통과 확인.

### 🔴 절대 수정 금지 (업스트림 이식본)
- `src/table-king/table/*.js` (boundaryGrid, boundaryResize, cellData, selection 등)
- `src/table-king/components/*.jsx` (TableCanvas, Toolbars)
- `src/table-king/hooks/useBoundaryDrag.js`
- `src/table-king/TableKingBlock.jsx` (우리 래퍼지만, 계약이 여기 고정됨 — 되도록 손대지 말 것)
- `src/hwpx/exportCore.js`, `src/hwpx/hwpxBase.js` (의존성 0 내보내기 코어·자동생성 봉투)
  → 이유: 외부 저장소와 diff 가능하게 원본 유지가 원칙. 여기 고치면 그 원칙이 깨지고,
    내보내기 코어는 한글 호환이 깨진다.

## 2. 반드시 지켜야 할 불변식 (모르면 버그)

1. **배율 SCALE = 96/25.4 ≈ 3.7795 px/mm** (`src/modules/canvas/geometry.ts`).
   이 값 때문에 "화면 표 크기 = 내보내기 크기"가 일치한다. 함부로 바꾸지 말 것.
2. **표의 진실은 `Block.data`** (table-king 스냅샷: cells/widths/cellHeights/merges).
   표 크기(w/h)는 `store.setTableData`가 스냅샷에서 파생한다 — w/h를 직접 쓰지 말 것.
3. **Tailwind `@theme`가 이 프로젝트에선 안 먹는다.** 새 브랜드 색은 `@theme`가 아니라
   `src/tailwind.css`의 plain CSS 클래스 방식으로 추가 (파일 상단 주석 참고).
4. **preflight 없음** — 전역 리셋을 켜면(=`@import "tailwindcss"` 전체) 기존 편집기의
   목록 불릿 등이 깨진다. utilities-only 유지.

## 3. 검증 (수정 후 필수)

```bash
npm run dev              # /studio 에서 눈으로 확인
npm run verify:hwpx      # 내보내기/구조를 건드렸다면 필수 — 7중 게이트 전부 통과해야 함
```
- 표를 수정했으면 최소 확인: 셀 타이핑 / 행·열 추가 / 병합 / 경계선 드래그가 여전히 되는지,
  데이터 탭에서 알약을 셀에 드롭했을 때 `{{열이름}}`이 박히는지.

## 4. 파일 지도 (새 편집기 표)

```
표가 걸쳐 있는 파일:
  src/modules/canvas/CanvasBlock.tsx   🟢 래퍼(TableKingContent) + 테마 토큰
  src/modules/canvas/store.ts          🟡 표 생성·스냅샷 동기화
  src/modules/canvas/geometry.ts       🟡 SCALE (불변식 2·1)
  src/modules/document/model.ts        🟡 TableKingData 타입
  src/modules/document/exportHwpx.ts   🟡 표→hwpx grid 매핑
  src/routes/StudioEditor.tsx          🟢 알약 드롭 라우팅
  src/tailwind.css                     🟢 .studio-root .tk-root 스타일
  src/table-king/**                    🔴 엔진 원본 (table-king.css만 🟡 공유 주의)
```
