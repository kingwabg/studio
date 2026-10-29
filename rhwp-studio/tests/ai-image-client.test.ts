// [캔버스 한컴 포크] 네트워크 호출 없이 실제 클라이언트 요청 형식과 이미지 경계를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function client(finishReason = 'stop') {
  const requests: any[] = [];
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/ui/canva-ai-client.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, AbortSignal,
    require: (name: string) => name === './ai-models' ? { NVIDIA_MODELS: [{ id: 'test-vision' }] } : { isBusy: () => false },
    fetch: async (_url: string, options: any) => {
      requests.push(JSON.parse(options.body));
      return { json: async () => ({ choices: [{ finish_reason: finishReason, message: { content: 'ok' } }] }) };
    },
  });
  return { ...exports, requests };
}

test('기존 텍스트 요청은 문자열, 이미지 첨부만 멀티모달 content를 보낸다', async () => {
  const c = client();
  await c.callAi('system', 'text');
  assert.equal(c.requests[0].messages[1].content, 'text');
  await c.callAi('system', 'image', 4096, ['data:image/png;base64,YQ==']);
  assert.equal(c.requests[1].chat_template_kwargs.enable_thinking,false);
  assert.deepEqual(c.requests[1].messages[1].content, [
    { type: 'text', text: 'image' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } },
  ]);
});

test('외부 URL·지원하지 않는 MIME·과대 이미지·여러 이미지는 전송 전에 거부한다', async () => {
  const c = client();
  for (const images of [
    ['https://example.com/image.png'], ['data:image/svg+xml;base64,YQ=='],
    ['data:image/png;base64,' + 'A'.repeat(Math.ceil(10 * 1024 * 1024 * 4 / 3) + 4)],
    ['data:image/png;base64,YQ==', 'data:image/png;base64,YQ=='],
  ]) await assert.rejects(c.callAi('system', 'text', 100, images));
  assert.equal(c.requests.length, 0);
});

test('잘린 AI 응답은 편집 명령으로 넘기지 않고 오류로 보고한다', async () => {
 const c=client('length'); await assert.rejects(c.callAi('system','image',8192,['data:image/png;base64,YQ==']), /길이 한도/);
});
