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

export async function callAi(systemPrompt: string, userText: string, maxTokens = 2048): Promise<string> {
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
      // 표준 OpenAI 파라미터만 보낸다 — 공급자 전용 키는 호스트 프록시가 공급자별로 처리한다
      // (실사고: MiniMax 전용 thinking 을 NVIDIA 에 보내 "Unsupported parameter" 400).
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

/** 실패 사유를 사용자 안내 문구로 변환 (키/크레딧 등) */
export function aiErrorHint(detail: string): string {
  if (/credit|balance|too low|billing|quota|insufficient/i.test(detail)) {
    return '\n\nAI 공급자의 크레딧이 부족한 것 같습니다. 환경 설정의 AI 공급자에서 상태를 확인하세요.';
  }
  if (/auth|api[_ -]?key|token|401|403|invalid|unauthor/i.test(detail)) {
    return '\n\nAPI 키를 확인하세요. 호스트 환경 설정의 AI 공급자 키, 단독 실행이면 rhwp-studio/.env.local 의 NVIDIA_API_KEY 를 확인하세요.';
  }
  return '';
}
