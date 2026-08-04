/**
 * AI 문서 작성 — 문서 유형별 템플릿(처방) (2026-08-05, 주문서 §9 이식).
 *
 * 템플릿은 **권고**다(주문서 원칙 6): 표준 목차와 "이 섹션은 표로, 이 정도 분량으로"
 * 라는 처방을 주고, 분할·병합·비중 조절은 모델이 사용자 요청에 맞춰 결정한다.
 * 응답은 JSON 이 아니라 **모델이 읽는 자연어 마크업**이다 — 주문서도 그것이 원래
 * 설계라고 적었다(LLM 이 직접 해석).
 */

interface TplSection {
  heading: string;
  level: 1 | 2 | 3;
  /** 처방 — 분량·블록타입·작성방향·표헤더 등 자유 서술 */
  rx: string;
}

interface Template {
  docType: string;
  /** 이 유형을 부르는 다른 말들 — get_template 의 느슨한 매칭용 */
  aliases: string[];
  globalRules: string[];
  sections: TplSection[];
}

const COMMON_RULES = [
  '개조식 명사형 종결(~함, ~임, ~추진, ~예정). 서술식 문장은 개요의 한두 줄로 제한.',
  '정량 지표는 구체적 수치+단위. 모르는 값은 [○○명] [○○천원] 처럼 단위까지 붙여 남길 것.',
  '예산·일정·현황·비교는 표, 항목 나열은 목록. 목록 한 항목은 한 줄.',
  '기간은 "2026. 1. ~ 2026. 12." 형식, 금액은 천원 단위 콤마.',
];

const TEMPLATES: Template[] = [
  {
    docType: '보고서',
    aliases: ['결과보고', '결과 보고서', 'report', '업무보고'],
    globalRules: COMMON_RULES,
    sections: [
      { heading: '개요', level: 1, rx: '문서 정보 표(2열: 기관명·부서·작성일, 모르면 [기관명]) + 목적 서술 1~2문장 + 근거·기간 목록' },
      { heading: '추진 현황', level: 1, rx: '표 · 헤더 [구분, 추진 내용, 실적, 비고] · 실적은 수치로' },
      { heading: '주요 성과', level: 1, rx: '목록 3~5개 · 각 항목 "○○ ○% 향상" 처럼 정량 우선' },
      { heading: '문제점 및 개선 방안', level: 1, rx: '목록 · 문제 → 개선을 짝으로' },
      { heading: '향후 계획', level: 1, rx: '분기별 일정 표(과제·분기·담당) + 예산 집행 계획 표(잔여·계획·목표율%·합계 행) · 마지막에 맺음 문단 "이상과 같이 …을 보고함"' },
    ],
  },
  {
    docType: '사업계획서',
    aliases: ['사업 계획', '운영계획서', '연간계획', 'plan'],
    globalRules: COMMON_RULES,
    sections: [
      { heading: '사업 개요', level: 1, rx: '1문단 · 산문 · 사업명·목적·추진 배경' },
      { heading: '현황 및 문제점', level: 1, rx: '산문 1~2문단 + 필요시 현황 표' },
      { heading: '사업 내용', level: 1, rx: '하위 섹션(level 2)으로 세부 사업별 분리 권장 · 각 사업은 산문+목록' },
      { heading: '추진 일정', level: 1, rx: '표 · 헤더 [구분, 세부 내용, 일정] · 월별 또는 분기별' },
      { heading: '소요 예산', level: 1, rx: '표 · 헤더 [항목, 산출 근거, 금액(천원)] · 마지막 행에 합계' },
      { heading: '기대 효과', level: 1, rx: '목록 · 3~5개' },
    ],
  },
  {
    docType: '공문',
    aliases: ['공문서', '협조문', '안내문', '시행문'],
    globalRules: [
      ...COMMON_RULES,
      '수신·발신·시행일 등 모르는 항목은 [수신자] 처럼 남긴다.',
      '본문은 "1. 귀 기관의 무궁한 발전을 기원합니다." 류 인사로 시작하는 관행을 따른다.',
    ],
    sections: [
      { heading: '수신 및 제목', level: 1, rx: '문단 2~3개 · [수신] · [경유] · 제목 명시' },
      { heading: '본문', level: 1, rx: '번호 목록(ordered) · 인사 → 목적 → 요청/안내 사항 → 붙임 안내' },
      { heading: '붙임', level: 1, rx: '목록 · "1. ○○ 1부." 형식 · 없으면 이 섹션 생략 가능' },
    ],
  },
  {
    docType: '회의록',
    aliases: ['회의 록', '회의결과', 'meeting'],
    globalRules: [
      ...COMMON_RULES,
      '발언은 요지만 간추린다. 결정사항과 후속조치는 반드시 분리한다.',
    ],
    sections: [
      { heading: '회의 개요', level: 1, rx: '표 · 헤더 [구분, 내용] · 행: 일시/장소/참석자/안건' },
      { heading: '논의 내용', level: 1, rx: '안건별 level 2 섹션 권장 · 각 안건은 산문 또는 목록' },
      { heading: '결정 사항', level: 1, rx: '목록(ordered) · 결정된 것만' },
      { heading: '후속 조치', level: 1, rx: '표 · 헤더 [조치 사항, 담당, 기한]' },
    ],
  },
  {
    docType: '제안서',
    aliases: ['기획서', '기획안', '제안 문서', 'proposal'],
    globalRules: COMMON_RULES,
    sections: [
      { heading: '제안 개요', level: 1, rx: '1문단 · 무엇을 왜 제안하는가' },
      { heading: '배경 및 필요성', level: 1, rx: '산문 1~2문단 · 현황의 문제와 근거' },
      { heading: '제안 내용', level: 1, rx: '하위 섹션(level 2) 권장 · 산문+목록, 필요시 비교 표' },
      { heading: '기대 효과', level: 1, rx: '목록 · 정량 효과 우선' },
      { heading: '소요 자원', level: 1, rx: '표 · 헤더 [항목, 내용, 비용] · 없으면 생략 가능' },
    ],
  },
];

const GENERIC: Template = {
  docType: '일반 문서',
  aliases: [],
  globalRules: COMMON_RULES,
  sections: [
    { heading: '개요', level: 1, rx: '1문단 · 문서 목적' },
    { heading: '본문', level: 1, rx: '내용에 맞게 섹션을 자유 구성 — 유형이 분명하면 get_template 를 그 유형으로 다시 부를 것' },
    { heading: '맺음', level: 1, rx: '1문단 또는 목록' },
  ],
};

export function templateNames(): string[] {
  return TEMPLATES.map((t) => t.docType);
}

/** 유형 문자열로 템플릿을 찾는다 — 느슨한 매칭, 못 찾으면 GENERIC. */
export function getTemplate(docType: string): { docType: string; rendered: string } {
  const q = docType.trim();
  const hit = TEMPLATES.find((t) =>
    t.docType === q || q.includes(t.docType) || t.aliases.some((a) => q.includes(a) || a.includes(q)),
  ) ?? GENERIC;

  const lines: string[] = [
    `[문서 유형: ${hit.docType}]${hit === GENERIC && q ? ` (요청 "${q}" 에 맞는 템플릿이 없어 일반 양식)` : ''}`,
    '',
    '공통 규칙:',
    ...hit.globalRules.map((r) => `· ${r}`),
    '',
    '표준 목차와 처방(권고 — 요청에 맞게 분할·병합·비중 조절 가능):',
    ...hit.sections.map((s, i) => `${i + 1}) [level ${s.level}] ${s.heading} — ${s.rx}`),
    '',
    `다른 유형: ${templateNames().join(', ')}`,
  ];
  return { docType: hit.docType, rendered: lines.join('\n') };
}
