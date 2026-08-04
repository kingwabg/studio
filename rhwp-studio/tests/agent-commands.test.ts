import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedCommands, describeCommands, isAllowed } from '../src/ui/agent-commands.ts';

/**
 * 에이전트에게 여는 명령 목록 잠금.
 * 편집기 명령 190개를 채팅에 열어주되(2026-08-05), 저장·인쇄·대화상자·클립보드는 사람 몫으로 남긴다.
 */

const ALL = [
  { id: 'format:bold', label: '진하게' },
  { id: 'format:align-center', label: '가운데 정렬' },
  { id: 'format:char-shape', label: '글자 모양' },      // 대화상자
  { id: 'table:cell-merge', label: '셀 합치기' },
  { id: 'table:delete', label: '표 지우기' },            // 큰 삭제
  { id: 'insert:footnote', label: '각주' },
  { id: 'insert:image', label: '그림 넣기' },            // 파일 선택 대화상자
  { id: 'edit:copy', label: '복사하기' },                // 클립보드
  { id: 'edit:undo', label: '되돌리기' },
  { id: 'file:save', label: '저장' },                    // 접두사부터 제외
  { id: 'view:zoom-in', label: '확대' },                 // 접두사부터 제외
];

test('저장·보기 같은 앱 상태 명령은 접두사부터 안 연다', () => {
  const ids = allowedCommands(ALL).map((c) => c.id);
  assert.ok(!ids.includes('file:save'));
  assert.ok(!ids.includes('view:zoom-in'));
});

test('대화상자·클립보드·큰 삭제는 막는다', () => {
  for (const id of ['format:char-shape', 'insert:image', 'edit:copy', 'table:delete']) {
    assert.equal(isAllowed(ALL, id), false, `${id} 가 열려 있다`);
  }
});

test('되돌릴 수 있는 편집은 연다', () => {
  for (const id of ['format:bold', 'format:align-center', 'table:cell-merge', 'insert:footnote', 'edit:undo']) {
    assert.equal(isAllowed(ALL, id), true, `${id} 가 막혀 있다`);
  }
});

test('키워드로 좁혀 보여준다 — 전부 주면 프롬프트가 터진다', () => {
  const out = describeCommands(ALL, '정렬');
  assert.match(out, /format:align-center/);
  assert.doesNotMatch(out, /format:bold/);
});

test('없는 키워드는 ERROR 로 알린다(빈 목록으로 침묵하지 않는다)', () => {
  assert.match(describeCommands(ALL, '존재하지않는것'), /^ERROR/);
});
