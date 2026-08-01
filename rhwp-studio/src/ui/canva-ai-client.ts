/**
 * [캔버스 한컴 포크] MiniMax M3 공용 클라이언트 — AI 패널·AI 수정 대화상자가 공유.
 * dev 서버 프록시(/api/ai, vite.config)가 Authorization: Bearer를 서버측에서 주입한다.
 * OpenAI 호환: system도 messages 항목, 응답은 choices[0].message.content.
 */
export const AI_MODEL = 'MiniMax-M3';

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

export async function callMiniMax(systemPrompt: string, userText: string, maxTokens = 2048): Promise<string> {
  const res = await fetch('/api/ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getSelectedModel() || AI_MODEL,
      max_completion_tokens: maxTokens,
      thinking: { type: 'disabled' }, // 사고 과정(<think>) 없이 본문만
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  const data = await res.json();
  // OpenAI식 error + MiniMax 네이티브 base_resp 둘 다 방어
  const baseErr = data.base_resp && data.base_resp.status_code !== 0 ? data.base_resp.status_msg : '';
  if (data.error || baseErr || !data.choices?.length) {
    throw new Error(data.error?.message || baseErr || `${AI_MODEL} 호출 실패`);
  }
  const raw: string = data.choices[0]?.message?.content ?? '';
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // 혹시 남은 사고 태그 제거
}

/** 실패 사유를 사용자 안내 문구로 변환 (키/크레딧 등) */
export function aiErrorHint(detail: string): string {
  if (/credit|balance|too low|billing|余额|欠费|insufficient/i.test(detail)) {
    return '\n\nMiniMax 계정의 잔액/크레딧이 부족한 것 같습니다. 콘솔에서 충전 상태를 확인하세요.';
  }
  if (/auth|api[_ -]?key|token|401|invalid|unauthor/i.test(detail)) {
    return '\n\nAPI 키를 확인하세요. rhwp-studio/.env.local 에\nMINIMAX_API_KEY=... 를 넣고 dev 서버를 재시작해야 합니다.';
  }
  return '';
}
