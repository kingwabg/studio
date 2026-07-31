import test from 'node:test';
import assert from 'node:assert/strict';

import { canPolish, maskNames, unmaskNames } from '../src/ui/sentence-polish.ts';

/**
 * 「문장 다듬기」의 안전장치 잠금.
 * 이 기능은 **문서 텍스트가 밖으로 나가는 유일한 경로**라, 막는 쪽을 테스트로 고정한다.
 */

test('아동 기록에서는 허용하지 않는다', () => {
  assert.equal(canPolish('child-record'), false);
  assert.equal(canPolish('general'), true);
});

test('이름을 가리고 되돌린다', () => {
  const text = '김민수 선생님이 박지영 아동과 상담했습니다.';
  const m = maskNames(text, ['박지영']);
  assert.ok(!m.masked.includes('김민수'), `이름이 남았다: ${m.masked}`);
  assert.ok(!m.masked.includes('박지영'), `이름이 남았다: ${m.masked}`);
  // 돌아온 문장에 표시가 그대로 있으면 원래 이름으로 되꽂힌다
  assert.equal(unmaskNames(m.masked, m), text);
});

test('같은 이름은 같은 표시로 — 문장 안 일관성이 유지된다', () => {
  const m = maskNames('김민수 선생님과 김민수 선생님', []);
  const keys = m.masked.match(/〔사람\d+〕/g) ?? [];
  assert.equal(new Set(keys).size, 1, `같은 이름은 한 표시여야 한다: ${m.masked}`);
});

test('가릴 이름이 없으면 원문 그대로', () => {
  const text = '오늘 활동은 잘 됐습니다.';
  const m = maskNames(text, []);
  assert.equal(m.masked, text);
  assert.equal(m.table.size, 0);
});
