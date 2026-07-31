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
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'Nemotron 3 Nano 30B',
    hint: '가볍고 빠름 — 문장 다듬기 기본 추천',
  },
  {
    id: 'google/gemma-4-31b-it',
    label: 'Gemma 4 31B',
    hint: '균형형. 지시 수행이 안정적',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'gpt-oss 20B',
    hint: '가장 가벼움. 크레딧을 아낄 때',
  },
  {
    id: 'z-ai/glm-5.2',
    label: 'GLM-5.2',
    hint: '긴 문서·복잡한 지시에 강함',
  },
  {
    id: 'deepseek-ai/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    hint: '긴 문맥(최대 100만 토큰)',
  },
  {
    id: 'minimaxai/minimax-m3',
    label: 'MiniMax M3',
    hint: '멀티모달 추론',
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
