# 리팩토링 계획 — 리치텍스트 코어 추출 + CanvasBlock 분할

> 2026-07-10 계측 기준. 아무 세션이나 이 문서만 보고 실행할 수 있게 쓴다.
> **대원칙: 이동만 한다. 로직 수정과 이동을 한 커밋에 섞지 않는다.**

## 왜 (계측)

| 지표 | 값 | 문제 |
|---|---|---|
| `src/modules/canvas/CanvasBlock.tsx` | **2,551줄** · 컴포넌트 32 + 헬퍼 31 | god file — 전체 src(테이블킹 제외 13k줄)의 20% |
| `EmbedEditor` → `canvas/CanvasBlock` import | 편집 코어 15개 함수 | **판매용 임베드가 캔버스 내부 파일에 결합** — npm 패키징 불가 구조 |
| TextContent ↔ EmbedTextBlock | 히스토리·IME 가드·클립보드·Enter 배선 ~200줄 중복 | 편집 버그를 두 곳에서 고쳐야 함 |

## 목표 구조

```
src/modules/richtext/            ← 새 모듈 (캔버스·임베드가 공유하는 편집 코어)
  core.ts        순수 DOM/모델 함수 (React 없음·스토어 없음)
  render.tsx     읽기 렌더 (RichRead·RunSpan·ScriptText·TokenText·runCssObj·textStyle)
  measure.ts     실측 (getMeasureCtx·splitRunsIntoLines·measureNaturalWidthPx)
  useRichText.ts 공유 편집 배선 훅 (히스토리·IME·flush·applyStyle/Para·클립보드 핸들러)
  index.ts       배럴 export

src/modules/canvas/              ← 분할 후
  CanvasBlock.tsx  셸만(선택·드래그·리사이즈·액션바) — 목표 500줄대
  TextContent.tsx  캔버스 텍스트 블록 (useRichText 소비)
  ImageContent.tsx
  TableContent.tsx (구 TableKingContent + 표 리본 아이콘들)
  InlineToolbar.tsx
```

## 1단계 — 코어 추출 (가치 최대·리스크 최소, 반나절)

### 이동 인벤토리 (CanvasBlock.tsx → richtext/)

**core.ts** (전부 순수 함수 — React import 불필요):
`seedEditable` `domToRuns` `readRunStyle` `runToSpanEl` `collectEmissions`(private)
`textOffsetOf`(private) `locateOffset`(private) `selectionOffsets` `setSelectionRange`
`paraAlignsFromDom` `paraListsFromDom` `paraIdxAt` `spliceAligns` `splitParagraphAtCaret`
`splitRunsToParas` `markerTextAt` `markerSpanEl`(private)
`placeCaretEnd` `placeCaretFromPoint` `insertTextAtCaret`
`runsToClipboardHtml` `runsFromClipboardHtml` `cssColorToHex`(private) `escHtml`(private)
`normalizeUrl` `LINK_COLOR`
상수: `TEXT_INK` `TEXT_SURFACE` `TEXT_BORDER`(스타일 상수는 render 쪽이 더 맞으면 거기로)

**render.tsx**:
`textStyle` `runCssObj` `RichRead` `RunSpan`(private) `splitRunsToParasView`(→ core의 splitRunsToParas와 중복 — **하나로 통일**, 유일하게 허용되는 "정리")
`ScriptText` `TokenText`(merge 칩 — useMergeStore 의존 유지 OK)
`normalizeTextColor`(현 위치 확인 후)

**measure.ts**:
`getMeasureCtx` `splitRunsIntoLines` `measureNaturalWidthPx`

### 호환 유지 (병렬 세션 안전)
CanvasBlock.tsx 상단에 re-export를 남긴다:
```ts
export { seedEditable, domToRuns, /* …기존 export 전부 */ } from "../richtext";
```
→ 기존 `from "../canvas/CanvasBlock"` import(EmbedEditor·PageSnapshot·병렬 작업)가 **그대로 컴파일**된다.
EmbedEditor는 이 단계에서 `from "../richtext"`로 즉시 전환(결합 제거가 목적이므로).

### 검증 게이트 (각 커밋마다)
1. `npx tsc --noEmit` 0
2. `npm run verify:hwpx` 7게이트
3. 브라우저 스모크: 캔버스 텍스트 편집(타이핑·굵게·목록·undo) + 임베드 페이지(/studio/embed) 타이핑·표삽입·HWPX 바이트
4. `git diff --stat` — 이동 커밋에 로직 diff가 섞였는지 눈으로 확인 (이동은 ±동일 줄수여야)

## 2단계 — useRichText 훅 (중복 200줄 소멸)

TextContent(1451행~)와 EmbedTextBlock(embed)의 공통 배선을 훅으로:
- 입력: `{ getBlockLike, onCommit(runs, aligns, lists), onCaretPoint? }`
- 소유: histRef(700ms 코얼레싱)·composingRef·selRef·flush·applyStyle·applyParaAlign/List·undo/redo·onCopy/Cut/Paste·onKeyDown(Ctrl+Z/Y/B/I/U·Enter 분할)·onBeforeInput(historyUndo)
- 반환: contentEditable에 스프레드할 props + 명령 핸들 객체
- ⚠ 캔버스 특유(캐럿 포인트 초기 배치·auto-height syncEditH·스토어 setRichText)는 **콜백으로 주입** — 훅은 스토어를 모른다
- 완료 판정: EmbedTextBlock에서 자체 배선 삭제, TextContent에서 동일 삭제, 둘 다 훅 소비

## 3단계 — CanvasBlock 파일 분할 (god file 해소)

`TextContent` `ImageContent`(+imageDims) `TableKingContent`(+표 리본 아이콘 6종+TABLE_BG_SWATCHES+StaticResolvedTable) `InlineToolbar`(+INLINE_COLORS/HIGHLIGHTS) `MiniBoxPositionIcon` 을 각 파일로.
- CanvasBlock.tsx에는 셸(memo 블록·선택·드래그·리사이즈·플로팅바·이동 오버레이)만 남김
- ⚠ **병렬 세션이 CanvasBlock을 만지고 있지 않은 시점에만** (git status로 CanvasBlock 클린 확인 후) — 충돌 최다 지점
- 순서: 1·2단계 완료 후. re-export 배럴은 이 단계 끝나고 한 세션 뒤에 제거

## 4단계 ✅ 완료 — exportHwpx 51줄 파사드 + export/{elements(171)·measure(54)·assets(31)}.
초기 순환(elements↔measure)을 textExportHeightMm 이동으로 해소(타입만 단방향). 콜사이트 0 변경.

## 하지 말 것
- 이동 커밋에 동작 변경 섞기 (splitRunsToParas 통일만 예외로 명시)
- richtext/가 zustand·canvas geometry를 import (SCALE 필요하면 인자로 받기)
- 병렬 세션이 CanvasBlock 수정 중일 때 3단계 착수
- re-export 제거를 1단계와 같은 커밋에 (한 세션 유예)

## 착수 체크리스트
- [x] 재수출 제거 ✅ — PageSnapshot→richtext 직접 전환, CanvasBlock export* 삭제(셸 실사용 4심볼만 import)
- [x] 1단계 ✅ 완료 (994d354) — 실제 구성은 성장 예산에 맞춰 7분할: style/dom/emission/caret/clipboard/render/measure. 감사 3종(순수성 byte-동일·의존 DAG·호환 tsc 0) 통과. 잔여: EmbedEditor→canvas/geometry(SCALE) 결합은 2단계에서 정리
- [x] 2단계 ✅ 완료 — useRichText 훅(377줄), CanvasBlock 1499줄·EmbedEditor 397줄(예산 안). 의도된 수렴: 캔버스 Ctrl+B/I/U, 임베드 onCut
- [x] 3단계 ✅ 완료 — CanvasBlock 578줄(셸만). Text/Image/Table/InlineToolbar 각 파일(전부 예산 안). 기계 슬라이싱 1커밋(감사로 대체). 남은 일: richtext 재수출 제거(한 세션 유예 — CanvasStage·PageSnapshot의 ./CanvasBlock import를 직접 경로로 바꾼 뒤)
- [ ] 각 커밋: tsc·하네스·브라우저 스모크
