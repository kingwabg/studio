#!/usr/bin/env node
/**
 * 파일 크기 래칫 — sc- 게이트(scripts/check-file-size.mjs)의 studio 판.
 *
 * 규칙:
 *  - 신규/일반 파일: 경고 400, 실패 600 (물리 줄 수)
 *  - legacyBaselines 의 파일: 현재 크기가 상한 — **줄이기만 허용**. 줄였으면 이 Map 을
 *    수동으로 낮춰 고정한다(자동 하향 없음). 늘어나면 실패.
 *  - 의도: input-handler.ts(4,796줄) 같은 거대 파일이 더 자라는 것을 기계로 막고,
 *    새 기능은 새 모듈로 태어나게 한다. ⚠ 우회·완화는 에이전트 자가 판정 금지.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WARN = 400;
const FAIL = 600;

// 현재 크기 스냅샷(2026-07-30 실측 생성) — 늘어나면 실패, 줄이면 수동 갱신
const legacyBaselines = new Map([
  // +10 대기 서식, +16 변경 추적(오버레이 필드·갱신 훅·승격 지점) — 둘 다 본문은
  // pending-format.ts / track-review.ts 에 있고 여긴 배선뿐. 기능 코드 반입 금지.
  // +20: 커서 정합 수리(2026-07-30) — document-changed 캐럿 재조회 + rect 실패 시 캐럿 숨김.
  //      둘 다 이벤트 핸들러/updateCaret 본체라 이 파일이 정위치. 판정 = e2e/paper-cursor-sweep
  // +2: applyStyle(styleId, overwrite) 스레딩(2026-07-30)
  // +15: 모양 복사 반복 적용(소진 제거)·해제 공개 메서드·apply-first 주석(2026-07-30 스윕)
  // +33: 표 걸친 선택 삭제 분기 + selectionSpansInlineControl(2026-07-30, 한컴 O8) —
  //      deleteSelection 본체가 이 파일이라 정위치. 판정 = e2e/table-cursor-parity ⑤
  ['src/engine/input-handler.ts', 4893],
  ['src/compare/diff-engine.ts', 3106],
  ['src/ui/picture-props-dialog.ts', 2826],
  // +31: 변경 추적 API 래퍼 6종(2026-07-30) — 이 파일은 wasm 경계라 래퍼의 정위치다
  // +2: applyStyle 에 overwrite 인자(2026-07-30) — wasm 경계 래퍼라 이 파일이 정위치
  // +30: 논리 좌표계 래퍼 5종(2026-07-30, TAC 신고③) — getLogicalLength·logical↔text
  //      변환·insertTextLogical·getInlineControlIndexAtLogical, wasm 경계라 정위치
  // +6: deleteRangeLogical 래퍼(2026-07-30, 표 걸친 선택 삭제 O8)
  // +6: getTables 래퍼(2026-07-31, 서식 규정 검사) — wasm 경계 래퍼라 이 파일이 정위치
  ['src/core/wasm-bridge.ts', 2366],
  // +9: 더블클릭 단어 선택 배선(2026-07-30 한컴 대조 실측 결함 수리) — dblclick 핸들러의 정위치
  ['src/engine/input-handler-mouse.ts', 2211],
  // +3: Ctrl+A 옛 anchor 승계 결함 수리(2026-07-30) — selectWholeDoc 의 정위치
  // +47: 셀 블록 잘라내기·셀 채움 붙여넣기 분기(2026-07-30) — 로직 본체는 cell-paste.ts,
  //      여기는 onCut/onPaste 이벤트 분기(정위치). 판정 근거는 e2e/cell-clipboard.test.mjs
  // +13: 그림 붙여넣기 커서 수리(2026-07-30) — 없는 문단 이동·셀 컨텍스트 상실 2건
  // +2: 그림 붙여넣기 캐럿 클램프를 논리 길이로(2026-07-30, TAC 신고③) — 주석 포함
  // +7: Esc 모양복사 해제 + Alt+V chord code 폴백(2026-07-30 한컴 패리티 스윕)
  ['src/engine/input-handler-keyboard.ts', 2169],
  // +31: selectWordAtCursor(2026-07-30) — findWordAt·anchor 가 이 파일 전용이라 정위치
  // +25: moveTo 오프셋 클램프(2026-07-30) — 모든 커서 이동이 지나는 단일 관문이라 정위치.
  //      유령 캐럿(문단 길이 초과 오프셋) 차단. 판정 = e2e/paper-cursor-sweep D축
  // +31: moveOutOfSelectedPicture 컨테이너 복귀(2026-07-30) — 셀·머리말 안 개체에서 나갈 때
  //      표 밖으로 튀던 결함. selectedPictureRef 가 이 파일 전용이라 정위치. 판정 = 스윕 E축
  // +3: 커서 좌표계를 논리 길이로 통일(2026-07-30, TAC 신고③) — 주석 2줄 포함,
  //     판정 = e2e/table-cursor-parity
  ['src/engine/cursor.ts', 1944],
  // -9: TAC 문단 교환 커서 보정 제거(2026-07-30 사용자 결정 — 한컴에 없는 기능)
  ['src/engine/input-handler-table.ts', 1628],
  // +2: tabStops 단위 주석(2026-07-30, 2×HWPUNIT 재발 방지)
  ['src/core/types.ts', 1399],
  // +2: 변경 추적 명령 등록 · +14: 자 마커 드래그 배선(2026-07-30, 로직은 view/ruler-drag.ts)
  // +4: 리본 글자색·형광펜 슬롯 입양 2종(2026-07-30 스윕)
  // +5: 인라인 검사 배선(2026-07-31) — 기능은 전부 src/lint/overlay.ts, 여긴 import·전역
  //     선언·attachLinter 호출·e2e 전역뿐. 기능 코드 반입 금지.
  // +1: 명령 디스패치 e2e 전역(2026-07-31)
  // +2: 상태바 배포 표식 배선(2026-07-31) — 본문은 ui/build-stamp.ts, 여긴 import·호출 각 1줄
  // +1: 사전 e2e 전역(2026-07-31)
  ['src/main.ts', 1330],
  ['src/engine/input-handler-picture.ts', 1215],
  // +28: 논리↔텍스트 좌표 변환(2026-07-30, TAC 신고③) — 모든 편집 명령이 지나는
  //      doInsertText/doDeleteText/doGetTextRange 3헬퍼 + 선택삭제·서식·병합·분할의
  //      변환 지점이 전부 이 파일이라 정위치. 판정 = e2e/table-cursor-parity
  // +12: charLen() 도입(2026-07-31) — 커서 오프셋은 글자 수인데 str.length 는 UTF-16
  //      단위라 이모지에서 두 칸씩 밀렸다. 근거 주석 9줄 + 함수 3줄.
  ['src/engine/command.ts', 1209],
  ['src/ui/cell-border-bg-dialog.ts', 1120],
  // +18: 양각/음각 진입점 5종(2026-07-30 스윕) — ATTR_ICONS·상호배타·현재값 반영
  ['src/ui/char-shape-dialog.ts', 1134],
  ['src/view/canvaskit-renderer.ts', 1091],
  ['src/command/commands/table.ts', 1028],
  ['src/ui/para-shape-dialog.ts', 929],
  ['src/view/page-renderer.ts', 845],
  ['src/ui/endnote-shape-dialog.ts', 801],
  // +13: 이모지 넣기 명령 배선(2026-07-31) — 피커 본문은 ui/emoji-picker.ts,
  //      여긴 명령 등록 12줄 + import 1줄. 기능 코드 반입 금지.
  ['src/command/commands/insert.ts', 799],
  ['src/ui/equation-editor-dialog.ts', 734],
  // +36: 글머리표 팝업 앵커 일반화 + open-bullet-popup 수신(2026-07-30 스윕)
  ['src/ui/toolbar.ts', 762],
  // +1: 탭 위치 2×HWPUNIT 저장 수리(2026-07-30 스윕)
  ['src/ui/para-shape-tab-builders.ts', 686],
  // +1: 대기 서식 호출 1줄(2026-07-30)
  // +25: 인라인 표 삭제 확인 라우팅(2026-07-30, 한컴 O5 오라클 "[표] 를 지울까요?") —
  //      Backspace/Delete 본체가 이 파일이라 정위치. 판정 = e2e/table-cursor-parity ④
  // +3: 확인 대화상자 닫은 뒤 편집기 포커스 복귀(2026-07-30 e2e 실측 결함 — 키 입력 먹통)
  ['src/engine/input-handler-text.ts', 711],
  // +26: 텍스트 탭 배선(2026-07-30) — 섹션 본문은 text-panel-sections.ts, 여긴 탭 상태·분기뿐
  // +16: AI·녹음 진입 칩(2026-07-30)
  // +9: 「지금 서식」 견본 배선(2026-07-31 디자인 3a) — 본문은 ui/format-specimen.ts,
  //     여긴 mount 1줄 + reflectChar/reflectPara 위임 2줄 + 근거 주석. 기능 코드 반입 금지.
  // +6: 선택 요약·서식 조각 칩 배선(2026-07-31) — 스캔·문구·구간 선택 로직은 전부
  //     ui/selection-summary.ts, 여긴 호출 6줄. 기능 코드 반입 금지.
  // +3: 견본에 실제 문단 글자 채우기(2026-07-31) — 구간 스캔은 selection-summary.ts,
  //     렌더는 format-specimen.ts, 여긴 호출 3줄. 기능 코드 반입 금지.
  // +23: 「수정본」 배선(2026-07-31) — 문장 재구성은 ui/fix-preview.ts, 렌더는
  //      format-specimen.ts. 여긴 lint:items 구독 + paintCorrections 위임. 기능 반입 금지.
  // +32: 「확인할 낱말」 배선(2026-07-31) — 사전 검사는 ui/para-proofread.ts,
  //      후보 팝오버는 ui/word-pop.ts. 여긴 위임 + 교체 명령. 기능 반입 금지.
  // +35: 「문장 다듬기」 배선(2026-07-31) — 호출·이름 가리기는 ui/sentence-polish.ts,
  //      팝오버는 ui/polish-pop.ts. 여긴 아동 기록 차단 판정 + 문단 교체. 기능 반입 금지.
  ['src/ui/canva-right-inspector.ts', 812],
  ['src/ui/page-border-dialog.ts', 654],
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) yield p;
  }
}

let failed = 0;
const warns = [];
for (const abs of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, abs).replaceAll('\\', '/');
  const lines = readFileSync(abs, 'utf8').split('\n').length;
  const base = legacyBaselines.get(rel);
  if (base !== undefined) {
    if (lines > base) {
      console.error(`FAIL ${rel}: ${lines}줄 > baseline ${base} — 새 코드는 새 모듈로`);
      failed++;
    }
    continue;
  }
  if (lines > FAIL) {
    console.error(`FAIL ${rel}: ${lines}줄 > ${FAIL}`);
    failed++;
  } else if (lines > WARN) {
    warns.push(`${rel}: ${lines}줄 (권장 ${WARN})`);
  }
}

if (warns.length) {
  console.log('File size warnings:');
  for (const w of warns) console.log(`- ${w}`);
}
if (failed) {
  console.error(`\n${failed}개 파일이 래칫을 초과했습니다.`);
  process.exit(1);
}
console.log('OK: file size limits passed.');
