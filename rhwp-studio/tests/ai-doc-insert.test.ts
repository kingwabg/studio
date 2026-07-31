import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyLines } from '../src/ui/ai-doc-insert.ts';

/**
 * AI 초안을 문서에 넣을 때의 줄 분류 잠금.
 * 분류가 틀리면 제목이 본문 크기로 들어가 사용자가 한 줄씩 다시 고쳐야 한다.
 */

const DRAFT = [
  '사업 계획서',
  '',
  '1. 사업 개요',
  '가. 사업명: [사업명]',
  '본 사업은 [사업 목적]을 목표로 추진됩니다.',
  '2. 시장 환경 분석',
  '나. 경쟁사 분석',
].join('\n');

test('제목·대제목·소제목·본문을 구분한다', () => {
  const got = classifyLines(DRAFT);
  assert.deepEqual(got.map((l) => l.kind),
    ['title', 'head1', 'head2', 'body', 'head1', 'head2']);
  assert.equal(got[0].text, '사업 계획서');
});

test('빈 줄은 버린다 — 문단 사이 여백은 서식이 만든다', () => {
  assert.ok(classifyLines(DRAFT).every((l) => l.text.length > 0));
});

test('모델이 흘린 마크다운을 걷어낸다', () => {
  const got = classifyLines('## 제목\n**굵게** 문단\n- 항목');
  assert.equal(got[0].text, '제목');
  assert.equal(got[1].text, '굵게 문단');
  assert.equal(got[2].text, '· 항목', '목록 기호는 한글 문서식 가운뎃점으로');
});

test('빈 입력은 아무것도 만들지 않는다', () => {
  assert.deepEqual(classifyLines(''), []);
  assert.deepEqual(classifyLines('\n\n  \n'), []);
});

/**
 * 표 문법 — AI 가 `|항목|내용|` 로 쓰면 실제 표가 되어야 한다.
 * 줄마다 문단으로 넣으면 막대기만 늘어선 본문이 된다.
 */
test('연속한 | 줄을 표 한 덩어리로 묶는다', () => {
  const got = classifyLines('사업 예산\n|항목|금액|\n|인건비|1,000|\n|재료비|500|\n이상입니다.');
  assert.deepEqual(got.map((l) => l.kind), ['title', 'table', 'body']);
  assert.deepEqual(got[1].rows, [['항목', '금액'], ['인건비', '1,000'], ['재료비', '500']]);
});

test('마크다운 구분선(|---|)은 표 데이터가 아니다', () => {
  const got = classifyLines('제목\n|A|B|\n|---|---|\n|1|2|');
  assert.deepEqual(got[1].rows, [['A', 'B'], ['1', '2']]);
});

test('표 사이에 낀 본문은 따로 문단이 된다', () => {
  const got = classifyLines('제목\n|A|B|\n설명 문단\n|C|D|');
  assert.deepEqual(got.map((l) => l.kind), ['title', 'table', 'body', 'table']);
});
