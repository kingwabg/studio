import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultShortcuts, matchShortcut } from '../src/command/shortcut-map.ts';

function key(input: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: input.key ?? '',
    code: input.code ?? '',
    shiftKey: input.shiftKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    altKey: input.altKey ?? false,
  } as KeyboardEvent;
}

function command(input: Partial<KeyboardEvent>, platform: 'mac' | 'other' = 'other'): string | null {
  return matchShortcut(key(input), defaultShortcuts, platform);
}

test('한컴 호환 장평 단축키를 영문 키로 매핑한다', () => {
  assert.equal(command({ key: 'j', code: 'KeyJ', altKey: true, shiftKey: true }), 'format:char-ratio-decrease');
  assert.equal(command({ key: 'k', code: 'KeyK', altKey: true, shiftKey: true }), 'format:char-ratio-increase');
});

test('한컴 호환 자간 단축키를 영문 키로 매핑한다', () => {
  assert.equal(command({ key: 'n', code: 'KeyN', altKey: true, shiftKey: true }), 'format:char-spacing-decrease');
  assert.equal(command({ key: 'w', code: 'KeyW', altKey: true, shiftKey: true }), 'format:char-spacing-increase');
});

test('한글 입력 모드 장평/자간 단축키를 매핑한다', () => {
  assert.equal(command({ key: 'ㅓ', altKey: true, shiftKey: true }), 'format:char-ratio-decrease');
  assert.equal(command({ key: 'ㅏ', altKey: true, shiftKey: true }), 'format:char-ratio-increase');
  assert.equal(command({ key: 'ㅜ', altKey: true, shiftKey: true }), 'format:char-spacing-decrease');
  assert.equal(command({ key: 'ㅈ', altKey: true, shiftKey: true }), 'format:char-spacing-increase');
});

test('IME pending 상태처럼 key가 Process여도 code로 장평/자간 단축키를 판별한다', () => {
  assert.equal(command({ key: 'Process', code: 'KeyJ', altKey: true, shiftKey: true }), 'format:char-ratio-decrease');
  assert.equal(command({ key: 'Process', code: 'KeyK', altKey: true, shiftKey: true }), 'format:char-ratio-increase');
  assert.equal(command({ key: 'Process', code: 'KeyN', altKey: true, shiftKey: true }), 'format:char-spacing-decrease');
  assert.equal(command({ key: 'Process', code: 'KeyW', altKey: true, shiftKey: true }), 'format:char-spacing-increase');
});

test('표 줄/칸 추가·지우기 단축키는 대화상자 명령으로 매핑한다', () => {
  assert.equal(command({ key: 'Enter', altKey: true }, 'mac'), 'table:insert-row-col');
  assert.equal(command({ key: 'enter', altKey: true }, 'mac'), 'table:insert-row-col');
  assert.equal(command({ key: 'Enter', altKey: true }, 'other'), 'table:insert-row-col');
  assert.equal(command({ key: 'enter', altKey: true }, 'other'), 'table:insert-row-col');
  assert.equal(command({ key: 'Insert', altKey: true }, 'mac'), null);
  assert.equal(command({ key: 'Help', altKey: true }, 'mac'), null);
  assert.equal(command({ key: 'Insert', altKey: true }, 'other'), null);
  assert.equal(command({ key: 'insert', altKey: true }, 'other'), null);
  assert.equal(command({ key: 'Help', altKey: true }, 'other'), null);
  assert.equal(command({ key: 'Process', code: 'Insert', altKey: true }, 'other'), null);
  assert.equal(command({ key: 'Process', code: 'Help', altKey: true }, 'other'), null);
  assert.equal(command({ key: 'Delete', altKey: true }), 'table:delete-row-col');
  assert.equal(command({ key: 'delete', altKey: true }), 'table:delete-row-col');
});

// [한컴 패리티 2026-07-30] 수준 증감·mac 글자모양·Option 특수문자 폴백
test('Ctrl+Num −/+ 는 수준 증감, 본자리 -/= 는 줌 유지', () => {
  assert.equal(command({ key: '-', code: 'NumpadSubtract', ctrlKey: true }), 'format:level-increase');
  assert.equal(command({ key: '+', code: 'NumpadAdd', ctrlKey: true }), 'format:level-decrease');
  assert.equal(command({ key: '-', code: 'Minus', ctrlKey: true }), 'view:zoom-out');
  assert.equal(command({ key: '=', code: 'Equal', ctrlKey: true }), 'view:zoom-in');
});

test('mac Cmd+L 은 글자 모양, 그 외 플랫폼 Ctrl+L 은 다시 찾기', () => {
  assert.equal(command({ key: 'l', code: 'KeyL', metaKey: true }, 'mac'), 'format:char-shape');
  assert.equal(command({ key: 'l', code: 'KeyL', ctrlKey: true }, 'other'), 'edit:find-again');
});

test('mac Option 특수문자에도 code 폴백으로 단축키를 잡는다', () => {
  assert.equal(command({ key: '˜', code: 'KeyN', altKey: true }, 'mac'), 'file:new-doc');
  assert.equal(command({ key: '¬', code: 'KeyL', altKey: true }, 'mac'), 'format:char-shape');
  assert.equal(command({ key: '†', code: 'KeyT', altKey: true }, 'mac'), 'format:para-shape');
  assert.equal(command({ key: '©', code: 'KeyG', altKey: true }, 'mac'), 'edit:goto');
  assert.equal(command({ key: 'å', code: 'KeyA', altKey: true, shiftKey: true }, 'mac'), 'format:line-spacing-decrease');
});
