/**
 * NVIDIA NIM 모델 목록 — 환경 설정에서 고를 수 있게.
 *
 * ⚠ 모델 ID 는 build.nvidia.com 카드 경로와 같다(`/nvidia/nemotron-3-nano-30b-a3b`
 *   → `nvidia/nemotron-3-nano-30b-a3b`). 아래는 2026-08-01 카탈로그를 직접 열어
 *   링크에서 뽑은 값이다 — 기억으로 적으면 404 가 난다(실제로 그랬다).
 *   카탈로그는 자주 바뀌니, 안 되는 모델이 생기면 사이트에서 확인해 여기를 고칠 것.
 *
 * 텍스트 생성만 담는다. 임베딩(nemotron-3-embed)·OCR·번역·이미지 모델은 문장 다듬기에
 * 쓸 수 없어 뺐다 — 목록에 있으면 누군가 고르고 실패한다.
 *
 * ⚠ 순서 = **한국어 교정 실측 결과**(2026-08-01, 같은 문장·같은 프롬프트로 비교).
 *   "우울하다 박으로 나ㅆ다.타. … 날파리 들어 틀어와서"
 *     Gemma 4 31B  → "우울해서 밖으로 나왔다. 작은 날파리가 들어와서…"  ✅
 *     GLM-5.2      → "우울하다. 밖으로 나갔다. 아주 작은 날파리가…"     ✅
 *     Nemotron Nano→ "박으로 나가"  ❌ 오타를 그대로 둠
 *   크기보다 한국어 처리가 갈랐다 — 작다고 무조건 나쁜 게 아니라 모델마다 다르다.
 */

export interface AiModelChoice {
  /** 그대로 API 에 보내는 모델 ID */
  id: string;
  label: string;
  /** 고를 때 판단 근거 한 줄 */
  hint: string;
}

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const NVIDIA_MODELS: AiModelChoice[] = [
  {
    id: 'google/gemma-4-31b-it',
    label: 'Gemma 4 31B',
    hint: '한국어 교정 실측 1위 — 기본 추천',
  },
  {
    id: 'z-ai/glm-5.2',
    label: 'GLM-5.2',
    hint: '한국어 교정 양호. 긴 문서에도 강함',
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'Nemotron 3 Nano 30B',
    hint: '가장 빠르지만 한국어 오타 교정은 약함',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'gpt-oss 20B',
    hint: '가장 가벼움. 크레딧을 아낄 때',
  },
  {
    id: 'deepseek-ai/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    hint: '긴 문맥(최대 100만 토큰)',
  },
  {
    id: 'stepfun-ai/step-3.7-flash',
    label: 'Step 3.7 Flash',
    hint: '빠른 응답 우선',
  },
  {
    id: 'thinkingmachines/inkling',
    label: 'Inkling',
    hint: '추론 특화(생각을 많이 함 — 느릴 수 있음)',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra 550B',
    hint: '품질 최상 — 크레딧 소모가 큼',
  },
];
