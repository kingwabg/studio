import test from 'node:test';
import assert from 'node:assert/strict';

import { aiErrorHint } from '../src/ui/ai-error.ts';

/**
 * 실패 안내 문구 잠금 — 사용자가 **엉뚱한 곳을 뒤지지 않게** 사유를 갈라준다.
 * (2026-08-05: 공급자 혼잡인데 "키를 확인하세요"가 떠서 설정만 뒤지던 실사고)
 */

test('공급자 혼잡은 키 문제로 안내하지 않는다', () => {
  const busy = 'ResourceExhausted: Worker local total request limit reached (77/32)';
  const hint = aiErrorHint(busy);
  assert.match(hint, /붐빕니다/);
  assert.doesNotMatch(hint, /API 키를 확인/);
});

test('키 없음은 키 안내로 간다', () => {
  assert.match(aiErrorHint('API key is invalid (401 unauthorized)'), /API 키를 확인/);
});

test('크레딧 부족은 크레딧 안내로 간다', () => {
  assert.match(aiErrorHint('insufficient credit balance'), /크레딧/);
});

test('알 수 없는 사유엔 억지 안내를 붙이지 않는다', () => {
  assert.equal(aiErrorHint('알 수 없는 오류'), '');
});
