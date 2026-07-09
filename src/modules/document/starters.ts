// starters.ts — 홈 시작 카드·인기 템플릿의 시드 문서.
// "껍데기 UI"가 아니라 실제로 동작하게: 클릭하면 aiJsonToBlocks(검증된 트리 변환)로
// 개요 번호·flow 본문·표가 갖춰진 문서를 만들어 편집기로 이동한다.
// 수치는 [○○] 플레이스홀더 — 사용자가 채우는 양식이지 지어낸 내용이 아니다.
import { type AiDocJson, aiJsonToBlocks } from "../ai/aiToCanvas";
import { A4, type CanvasDoc, createDoc } from "./model";

export interface Starter {
  key: string;
  name: string;
  tone: string; // 미니 썸네일 첫 줄 색 (시안 1a)
  tint: string; // 템플릿 카드 배경 틴트
  fixture: AiDocJson | null; // null = 빈 문서
}

export const STARTERS: Starter[] = [
  { key: "blank", name: "빈 문서", tone: "#98A2B3", tint: "#F6F7FA", fixture: null },
  {
    key: "official",
    name: "공문서",
    tone: "#2B5CE6",
    tint: "#EDF2FE",
    fixture: {
      title: "대외 공문서",
      sections: [
        { heading: "수신", level: 1, blocks: [{ type: "para", text: "[수신 기관명] ([참조] 담당 부서)" }] },
        { heading: "제목", level: 1, blocks: [{ type: "para", text: "[문서 제목을 입력하세요]" }] },
        {
          heading: "내용",
          level: 1,
          blocks: [
            { type: "para", text: "1. 귀 기관의 무궁한 발전을 기원합니다." },
            { type: "para", text: "2. [본문 내용을 입력하세요]에 따라 아래와 같이 요청하고자 합니다." },
            { type: "table", rows: [["구분", "내용", "비고"], ["[항목]", "[내용]", ""]] },
          ],
        },
      ],
    },
  },
  {
    key: "bizplan",
    name: "사업계획서",
    tone: "#E58B3A",
    tint: "#FBF3E7",
    fixture: {
      title: "사업계획서",
      sections: [
        { heading: "추진 배경", level: 1, blocks: [{ type: "para", text: "[추진 배경과 필요성을 입력하세요]" }] },
        { heading: "사업 개요", level: 1, blocks: [
          { type: "table", rows: [["구분", "내용"], ["사업명", "[사업명]"], ["기간", "[YYYY.MM ~ YYYY.MM]"], ["예산", "[○○]백만원"]] },
        ] },
        { heading: "세부 추진 계획", level: 1, blocks: [{ type: "list", items: ["[과업 1]", "[과업 2]", "[과업 3]"], ordered: true }] },
        { heading: "기대 효과", level: 1, blocks: [{ type: "para", text: "[기대 효과를 입력하세요]" }] },
      ],
    },
  },
  {
    key: "report",
    name: "보고서",
    tone: "#4CAF7D",
    tint: "#EAF6EF",
    fixture: {
      title: "주간 업무 보고",
      sections: [
        { heading: "금주 추진 실적", level: 1, blocks: [{ type: "list", items: ["[실적 1]", "[실적 2]"], ordered: false }] },
        { heading: "세부 내용", level: 1, blocks: [
          { type: "table", rows: [["구분", "내용", "진행률"], ["[과업]", "[내용]", "[○○]%"]] },
        ] },
        { heading: "차주 계획", level: 1, blocks: [{ type: "list", items: ["[계획 1]", "[계획 2]"], ordered: false }] },
      ],
    },
  },
  {
    key: "minutes",
    name: "회의록",
    tone: "#9A6FD4",
    tint: "#F3EEFB",
    fixture: {
      title: "회의록",
      sections: [
        { heading: "회의 개요", level: 1, blocks: [
          { type: "table", rows: [["일시", "[YYYY.MM.DD HH:MM]"], ["장소", "[장소]"], ["참석", "[참석자 명단]"]] },
        ] },
        { heading: "논의 사항", level: 1, blocks: [{ type: "list", items: ["[안건 1]", "[안건 2]"], ordered: true }] },
        { heading: "결정 사항", level: 1, blocks: [{ type: "para", text: "[결정 사항을 입력하세요]" }] },
      ],
    },
  },
  {
    key: "approval",
    name: "품의서",
    tone: "#D46F8C",
    tint: "#FDEEF0",
    fixture: {
      title: "품의서",
      sections: [
        { heading: "품의 개요", level: 1, blocks: [{ type: "para", text: "아래와 같이 [품의 목적]을 위하여 품의하오니 재가하여 주시기 바랍니다." }] },
        { heading: "내역", level: 1, blocks: [
          { type: "table", rows: [["품목", "수량", "단가", "금액"], ["[품목]", "[○○]", "[○○]", "[○○]"]] },
        ] },
        { heading: "소요 예산", level: 1, blocks: [{ type: "para", text: "총 [○○]원 ([예산 과목])" }] },
      ],
    },
  },
];

// 시작 카드/템플릿 클릭 → 시드 문서 생성
export function buildStarterDoc(starter: Starter): CanvasDoc {
  const doc = createDoc(starter.fixture?.title ?? "제목 없는 문서");
  if (starter.fixture) doc.blocks = aiJsonToBlocks(starter.fixture, A4);
  return doc;
}
