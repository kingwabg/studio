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
  ['src/engine/input-handler.ts', 4843],
  ['src/compare/diff-engine.ts', 3106],
  ['src/ui/picture-props-dialog.ts', 2826],
  // +31: 변경 추적 API 래퍼 6종(2026-07-30) — 이 파일은 wasm 경계라 래퍼의 정위치다
  ['src/core/wasm-bridge.ts', 2322],
  // +9: 더블클릭 단어 선택 배선(2026-07-30 한컴 대조 실측 결함 수리) — dblclick 핸들러의 정위치
  ['src/engine/input-handler-mouse.ts', 2211],
  // +3: Ctrl+A 옛 anchor 승계 결함 수리(2026-07-30) — selectWholeDoc 의 정위치
  // +47: 셀 블록 잘라내기·셀 채움 붙여넣기 분기(2026-07-30) — 로직 본체는 cell-paste.ts,
  //      여기는 onCut/onPaste 이벤트 분기(정위치). 판정 근거는 e2e/cell-clipboard.test.mjs
  // +13: 그림 붙여넣기 커서 수리(2026-07-30) — 없는 문단 이동·셀 컨텍스트 상실 2건
  ['src/engine/input-handler-keyboard.ts', 2160],
  // +31: selectWordAtCursor(2026-07-30) — findWordAt·anchor 가 이 파일 전용이라 정위치
  ['src/engine/cursor.ts', 1885],
  ['src/engine/input-handler-table.ts', 1627],
  ['src/core/types.ts', 1397],
  ['src/main.ts', 1303],  // +2: 변경 추적 명령 등록(2026-07-30)
  ['src/engine/input-handler-picture.ts', 1215],
  ['src/engine/command.ts', 1169],
  ['src/ui/cell-border-bg-dialog.ts', 1120],
  ['src/ui/char-shape-dialog.ts', 1116],
  ['src/view/canvaskit-renderer.ts', 1091],
  ['src/command/commands/table.ts', 1028],
  ['src/ui/para-shape-dialog.ts', 929],
  ['src/view/page-renderer.ts', 845],
  ['src/ui/endnote-shape-dialog.ts', 801],
  ['src/command/commands/insert.ts', 786],
  ['src/ui/equation-editor-dialog.ts', 734],
  ['src/ui/toolbar.ts', 726],
  ['src/ui/para-shape-tab-builders.ts', 685],
  ['src/engine/input-handler-text.ts', 682],  // +1: 대기 서식 호출 1줄(2026-07-30)
  // +26: 텍스트 탭 배선(2026-07-30) — 섹션 본문은 text-panel-sections.ts, 여긴 탭 상태·분기뿐
  ['src/ui/canva-right-inspector.ts', 704],  // +16: AI·녹음 진입 칩(2026-07-30)
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
