/**
 * [캔버스 한컴 포크] AI 공용 클라이언트 — AI 패널·AI 수정 대화상자·회의록·에이전트가 공유.
 *
 * 경로는 항상 같은 출처 `/api/ai/*` 하나다:
 *  · 호스트(sc-) 임베드 — 호스트의 /api/ai 프록시가 설정된 공급자(NVIDIA NIM 등)로 태우고
 *    서버가 Authorization 을 붙인다. 공급자·키의 정본은 호스트 설정이다.
 *  · 단독 dev — vite 프록시가 NVIDIA NIM 으로 직결한다(vite.config, NVIDIA_API_KEY).
 * (구 MiniMax 직결 경로는 2026-08-04 제거 — 공급자가 NVIDIA NIM 으로 대체됨)
 */
import { NVIDIA_MODELS } from './ai-models';
// 실패 해석은 의존성 0 모듈로 분리했다(테스트 가능하게) — 재export 로 기존 사용처를 유지한다.
import { isBusy } from './ai-error';
export { aiErrorHint } from './ai-error';

/** 모델 미선택 시 기본값 — 한국어 교정 실측 1위(ai-models.ts 의 순서가 곧 근거). */
export const AI_MODEL = NVIDIA_MODELS[0].id;

/**
 * 도우미가 쓸 모델 — 패널의 모델 버튼이 정한다(localStorage).
 * 호스트 프록시는 이 값이 **설정된 공급자 목록에 있을 때만** 그 공급자로 태우고,
 * 아니면 기본 공급자를 쓴다 — 임의 모델 호출은 여전히 막혀 있다.
 */
const MODEL_KEY = 'rhwpAiModel';
export function getSelectedModel(): string {
  try { return localStorage.getItem(MODEL_KEY) ?? ''; } catch { return ''; }
}
export function setSelectedModel(model: string): void {
  try { localStorage.setItem(MODEL_KEY, model); } catch { /* 시크릿 모드 등 */ }
}

/**
 * 호스트(sc-) 프록시 뒤에서 도는가 — 모델 선택 줄이 공급자 목록을 받아오면 true.
 * 호스트가 있으면 model 을 비워 보내 **호스트 기본 공급자**(키가 저장된 것)를 쓰게 한다.
 * 단독 실행(vite 직결)은 NVIDIA 가 model 을 필수로 요구해 카탈로그 기본값을 채워야 한다.
 */
let hostProxyKnown = false;
export function markHostProxy(): void { hostProxyKnown = true; }
export function isHostProxy(): boolean { return hostProxyKnown; }

/**
 * ⚠ 공급자 혼잡은 **재시도로 넘긴다**(2026-08-05 실사고).
 *   NVIDIA NIM 무료 티어는 큰 모델일수록 대기열이 붐벼
 *   "ResourceExhausted: Worker local total request limit reached (77/32)" 가 뜬다.
 *   에이전트는 한 턴에 도구를 여러 번 부르므로, 중간 한 번이 막히면 작업 전체가 죽는다.
 *   짧게 두 번만 더 시도한다 — 더 늘리면 붐비는 큐를 우리가 더 밀어 넣는 꼴이 된다.
 */
const BUSY_RETRY_DELAYS = [1200, 3000];

export async function callAi(systemPrompt: string, userText: string, maxTokens = 2048): Promise<string> {
  let lastErr = '';
  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS.length; attempt++) {
    try {
      return await callOnce(systemPrompt, userText, maxTokens);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (!isBusy(lastErr) || attempt === BUSY_RETRY_DELAYS.length) throw e;
      await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAYS[attempt]));
    }
  }
  throw new Error(lastErr || 'AI 호출 실패');
}

async function callOnce(systemPrompt: string, userText: string, maxTokens: number): Promise<string> {
  const chosen = getSelectedModel();
  const res = await fetch('/api/ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // ⚠ 고른 모델이 없으면 model 을 **아예 안 보낸다**(2026-08-05 실사고 수리).
      //   종전엔 카탈로그 1순위(Gemma)를 박아 보냈는데, 호스트에 키가 저장된 공급자는
      //   다른 것(Nemotron)이라 매 호출이 503 "API 키가 없습니다" 로 죽었다.
      //   비워 보내면 호스트가 **자기 기본 공급자**(설정 화면에서 키를 넣은 것)를 쓴다.
      //   단독 실행(vite 직결)은 model 이 필수라 그때만 카탈로그 기본값을 채운다.
      ...(chosen ? { model: chosen } : isHostProxy() ? {} : { model: AI_MODEL }),
      // ⚠ 추론(reasoning) 모델의 생각을 끈다(2026-08-05 실사고 수리).
      //   Nemotron 계열은 생각을 reasoning_content 로 따로 내지만, 생각이 길어 토큰 예산을
      //   다 쓰면 **생각이 본문(content)으로 흘러넘치고 잘린다**. 그러면 도구 호출 JSON 이
      //   없어 「문서 작업」이 표를 못 고치고, 채팅에는 영어 사고문이 그대로 찍혔다.
      //   실측: thinking:false → reasoning_content 빈 문자열, content 는 순수 JSON.
      //   ⚠ 이 키는 NVIDIA 전용이다 — 호스트 프록시가 공급자별 허용 목록으로 거르므로
      //   다른 공급자에는 실려 나가지 않는다(sc- route.ts PROVIDER_EXTRA).
      chat_template_kwargs: { thinking: false },
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  // 프록시 404/502 는 HTML 을 돌려줘 json() 이 SyntaxError 를 던진다 → 상태코드 문구로 대체
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status} ${res.statusText}` }));
  if (data.error || !data.choices?.length) {
    // ⚠ error 는 문자열일 수도, {message} 일 수도 있다. 호스트 프록시는 **문자열**로 주는데
    //   종전엔 .message 만 봐서 그 안내("API 키가 없습니다 — 설정 → AI 공급자에서…")를
    //   통째로 삼키고 "AI 호출 실패"만 띄웠다 — 사용자가 원인을 알 수 없었다(2026-08-05).
    const detail = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(detail || 'AI 호출 실패');
  }
  const raw: string = data.choices[0]?.message?.content ?? '';
  // 추론 모델이 흘리는 사고 태그 제거 — 본문만 남긴다
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
