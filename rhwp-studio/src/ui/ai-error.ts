/**
 * [캔버스 한컴 포크] AI 실패 사유 해석 — 의존성 0.
 *
 * 왜 따로 있나: 사용자가 **엉뚱한 곳을 뒤지지 않게** 사유를 갈라주는 것이 이 코드의 전부다.
 * 실사고(2026-08-05): 공급자 대기열이 붐벼 실패했는데 화면은 "API 키를 확인하세요"라고 해서
 * 설정만 한참 뒤졌다. 분기가 늘어날 자리라 잠금 테스트(tests/ai-error-hint.test.ts)를 붙였고,
 * 그러려면 wasm·카탈로그를 안 물어야 해서 클라이언트에서 떼어냈다.
 */

/** 공급자 혼잡(대기열 초과)인가 — 재시도로 풀리는 일시 오류다. */
export function isBusy(detail: string): boolean {
  return /ResourceExhausted|request limit|rate.?limit|too many requests|429|503|overload/i.test(detail);
}

/** 실패 사유를 사용자 안내 문구로 변환 (혼잡/크레딧/키). 모르면 빈 문자열 — 억지로 짐작하지 않는다. */
export function aiErrorHint(detail: string): string {
  // 혼잡이 먼저다 — 설정 문제가 아니라고 알려주는 것이 이 순서의 이유다.
  if (isBusy(detail)) {
    return '\n\n지금 AI 공급자가 붐빕니다(무료 대기열 초과). 잠시 뒤 다시 시도하거나, '
      + '채팅 아래 모델 버튼에서 더 가벼운 모델로 바꿔 보세요.';
  }
  if (/credit|balance|too low|billing|quota|insufficient/i.test(detail)) {
    return '\n\nAI 공급자의 크레딧이 부족한 것 같습니다. 환경 설정의 AI 공급자에서 상태를 확인하세요.';
  }
  if (/auth|api[_ -]?key|token|401|403|invalid|unauthor/i.test(detail)) {
    return '\n\nAPI 키를 확인하세요. 호스트 환경 설정의 AI 공급자 키, 단독 실행이면 rhwp-studio/.env.local 의 NVIDIA_API_KEY 를 확인하세요.';
  }
  return '';
}
