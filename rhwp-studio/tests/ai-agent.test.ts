import test from 'node:test';
import assert from 'node:assert/strict';

import { parseToolCall, runAgentTurn, AGENT_PROMPT } from '../src/ui/canva-ai-agent.ts';

/**
 * AI 문서 에이전트 잠금 — 채팅으로 문서를 읽고 고치는 루프.
 * 도구 목록·안전 규칙이 흔들리면 모델이 엉뚱한 함수를 부르거나, 채워진 셀을 말없이 덮는다.
 */

// ── parseToolCall ──

test('도구 호출 JSON 을 코드펜스·사족 사이에서도 뽑는다', () => {
  const r = parseToolCall('알겠습니다.\n```json\n{"tool":"read_table","table":0}\n```');
  assert.equal(r?.tool, 'read_table');
  assert.equal(r?.args.table, 0);
});

test('tool 필드가 없으면 null — 일반 답변으로 취급한다', () => {
  assert.equal(parseToolCall('안녕하세요, 무엇을 도와드릴까요?'), null);
  assert.equal(parseToolCall('{"fills":[{"cell":1}]}'), null);
});

// ── runAgentTurn — wasm 없이 목 서비스로 루프 계약만 잠근다 ──

function mockServices(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const wasm = {
    getTables: () => [{ para: 0, controlIdx: 0, rowCount: 2, colCount: 2 }],
    getParagraphCount: () => 3,
    getParagraphLength: () => 10,
    getTextRange: () => '본문',
    getTextInCell: (_s: number, _p: number, _c: number, cell: number) => (cell === 0 ? '이미 값' : ''),
    insertTextInCell: (...a: unknown[]) => { calls.push(`insert:${a[3]}`); return 'ok'; },
    deleteTextInCell: (...a: unknown[]) => { calls.push(`delete:${a[3]}`); return 'ok'; },
    insertText: () => 'ok',
    ...overrides,
  };
  const ih = { executeOperation: (op: { operation: () => void }) => op.operation() };
  return { services: { wasm, getInputHandler: () => ih } as never, calls };
}

test('done 이 오면 보고문으로 끝나고 wrote=false', async () => {
  const { services } = mockServices();
  const r = await runAgentTurn(services, '요청', async () => '{"tool":"done","report":"할 일이 없습니다"}');
  assert.equal(r.finalText, '할 일이 없습니다');
  assert.equal(r.wrote, false);
  assert.equal(r.steps.length, 1);
});

test('fill_cells 는 빈 칸만 쓰고, 값 있는 칸은 건너뛰어 모델에 알린다', async () => {
  const { services, calls } = mockServices();
  const replies = [
    '{"tool":"fill_cells","table":0,"fills":[{"cell":0,"text":"덮기시도"},{"cell":1,"text":"새값"}]}',
    '{"tool":"done","report":"1칸 채움"}',
  ];
  let fed = '';
  const r = await runAgentTurn(services, '표 채워줘', async (_s, u) => { fed = u; return replies.shift()!; });
  assert.equal(r.wrote, true);
  assert.deepEqual(calls, ['insert:1']);                  // cell 0 은 덮지 않았다
  assert.match(fed, /건너뜀.*0.*replace_cell/);            // 이유가 모델에 전달됐다
});

test('replace_cell 은 지우고 다시 쓴다(명시된 덮어쓰기)', async () => {
  const { services, calls } = mockServices();
  const replies = [
    '{"tool":"replace_cell","table":0,"cell":0,"text":"새값"}',
    '{"tool":"done","report":"교체 완료"}',
  ];
  const r = await runAgentTurn(services, '0번 칸 고쳐줘', async () => replies.shift()!);
  assert.equal(r.wrote, true);
  assert.deepEqual(calls, ['delete:0', 'insert:0']);
});

test('없는 도구·범위 밖 표는 ERROR 로 모델에 돌아가고 문서는 안 다친다', async () => {
  const { services, calls } = mockServices();
  const replies = [
    '{"tool":"hack_the_planet"}',
    '{"tool":"read_table","table":9}',
    '{"tool":"done","report":"포기"}',
  ];
  let lastFed = '';
  await runAgentTurn(services, '요청', async (_s, u) => { lastFed = u; return replies.shift()!; });
  assert.equal(calls.length, 0);
  assert.match(lastFed, /ERROR: 없는 도구/);
  assert.match(lastFed, /ERROR: 표 9 없음/);
});

test('루프 상한에서 멈춘다 — 같은 도구를 무한 반복해도 폭주하지 않는다', async () => {
  const { services } = mockServices();
  let rounds = 0;
  const r = await runAgentTurn(services, '요청', async () => { rounds++; return '{"tool":"doc_outline"}'; });
  assert.equal(rounds, 6);                                 // MAX_ROUNDS
  assert.match(r.finalText, /상한/);
});

test('프롬프트가 수치 지어내기 금지와 done 규약을 담는다(계약 잠금)', () => {
  assert.match(AGENT_PROMPT, /지어내지 마세요/);
  assert.match(AGENT_PROMPT, /"tool":"done"/);
  assert.match(AGENT_PROMPT, /빈 칸/);
});
