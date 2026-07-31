/**
 * 환경 설정 「AI」 탭 — 모델 고르기·API 키 입력.
 *
 * ① 탭이 있고 모델 목록이 채워진다
 * ② 키 입력칸은 **비밀번호 타입**이고 늘 빈 칸에서 시작한다(저장분을 되불러오지 않는다)
 * ③ 저장할 때 키를 서버로 보내되, 모델만 바꿀 땐 apiKey 를 **안 보낸다**
 *    (빈 칸으로 저장했다고 기존 키가 지워지면 안 된다)
 * ④ 호스트가 없으면(단독 실행) 조용히 안내만 — 편집기는 계속 동작한다
 */
import assert from 'node:assert';
import { runTest, createNewDocument } from './helpers.mjs';

runTest('환경 설정 AI 탭', async ({ page }) => {
  await createNewDocument(page);
  await new Promise((r) => setTimeout(r, 800));

  // 호스트 응답을 흉내낸다(단독 dev 서버에는 /api/ai-providers 가 없다)
  const sent = await page.evaluate(async () => {
    const calls = [];
    const orig = window.fetch;
    window.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/api/ai-providers')) {
        if (init?.method === 'PUT') {
          calls.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ provider: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({
          providers: [{
            id: 'p1', name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1',
            model: 'nvidia/nemotron-3-nano-30b-a3b', keyEnv: 'NVIDIA_API_KEY',
            isDefault: true, enabled: true, hasKey: false, keySource: 'none', canStoreKey: true,
          }],
        }), { status: 200 });
      }
      return orig(url, init);
    };
    window.__dispatcher.dispatch('tool:options');
    await new Promise((r) => setTimeout(r, 900));
    document.querySelector('.dialog-tab[data-tab="ai"]').click();
    await new Promise((r) => setTimeout(r, 900));

    const sel = document.querySelector('.opt-ai-model');
    const key = document.querySelector('.opt-ai-key');
    const models = sel ? [...sel.options].map((o) => o.value) : [];

    // ③ 키 없이 저장 → apiKey 가 없어야 한다
    document.querySelector('.opt-ai .dialog-btn-primary').click();
    await new Promise((r) => setTimeout(r, 500));
    // 키를 넣고 저장 → apiKey 가 실려야 한다
    key.value = 'nvapi-test-value';
    document.querySelector('.opt-ai .dialog-btn-primary').click();
    await new Promise((r) => setTimeout(r, 500));

    return { models, keyType: key?.type, keyValueAfter: key?.value, calls };
  });

  console.log('  ① 모델 수:', sent.models.length, sent.models.slice(0, 3));
  assert.ok(sent.models.length >= 5, `모델 목록이 채워져야 한다: ${sent.models}`);
  assert.ok(sent.models.includes('nvidia/nemotron-3-nano-30b-a3b'), '기본 모델이 있어야 한다');

  console.log('  ② 키 칸 타입:', sent.keyType, '/ 저장 뒤 값:', JSON.stringify(sent.keyValueAfter));
  assert.strictEqual(sent.keyType, 'password', '키 칸은 비밀번호 타입이어야 한다');
  assert.strictEqual(sent.keyValueAfter, '', '저장하면 입력칸을 비워야 한다');

  console.log('  ③ 저장 요청:', JSON.stringify(sent.calls));
  assert.strictEqual(sent.calls.length, 2, '저장 두 번');
  assert.ok(!('apiKey' in sent.calls[0]), '빈 칸이면 apiKey 를 보내지 않는다(기존 키 보존)');
  assert.strictEqual(sent.calls[1].apiKey, 'nvapi-test-value', '넣었으면 보낸다');
});
