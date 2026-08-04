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

export async function callAi(systemPrompt: string, userText: string, maxTokens = 2048): Promise<string> {
  const res = await fetch('/api/ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getSelectedModel() || AI_MODEL,
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
  const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status} ${res.statusText}` } }));
  if (data.error || !data.choices?.length) {
    throw new Error(data.error?.message || 'AI 호출 실패');
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
