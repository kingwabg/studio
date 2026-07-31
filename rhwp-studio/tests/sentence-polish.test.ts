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

/**
 * 추론(thinking) 모델 대비 — 사용자가 보내 준 NVIDIA 예제에서 확인한 응답 형태.
 * 생각을 reasoning_content 에 따로 담는 모델이 있어, content 가 비면 거기서 찾아야 한다.
 */
test('요청에 thinking 끄기가 들어간다', async () => {
  const seen: { body?: string } = {};
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    seen.body = init?.body;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"versions":["가","나","다"]}' } }] }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const { polishParagraph } = await import('../src/ui/sentence-polish.ts');
    const r = await polishParagraph('테스트 문장입니다');
    assert.deepEqual(r.versions, ['가', '나', '다']);
    const body = JSON.parse(seen.body ?? '{}') as { chat_template_kwargs?: { enable_thinking?: boolean } };
    assert.equal(body.chat_template_kwargs?.enable_thinking, false, 'thinking 을 꺼서 보내야 한다');
  } finally {
    globalThis.fetch = orig;
  }
});

test('content 가 비면 reasoning_content 에서 찾는다', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '', reasoning_content: '음… {"versions":["하나"]} 이렇게' } }],
    }),
  } as unknown as Response)) as typeof fetch;
  try {
    const { polishParagraph } = await import('../src/ui/sentence-polish.ts');
    const r = await polishParagraph('테스트');
    assert.deepEqual(r.versions, ['하나']);
  } finally {
    globalThis.fetch = orig;
  }
});
