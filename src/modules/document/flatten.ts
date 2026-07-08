// flatten.ts — "마인드맵 → 공문서" 변환. 캔버스 위 자유롭게 배치된 트리(parentId)를
// 상하관계 기준으로 접어(flatten), 정부 공문서 개요 번호(Ⅰ. → 1. → 가. → 1))가 매겨진
// 수직 문서로 재배치한 "새 문서"를 만든다. 원본(마인드맵)은 그대로 남는다.
//
// 규칙:
//  - 순서: 형제끼리 y좌표(그다음 x) 오름차순 — 화면에서 위에 있는 것이 먼저
//  - 자식이 있는 텍스트 = 머리글(번호+굵게, 깊이별 크기), 잎 텍스트 = 본문 문단
//  - 모든 텍스트는 flow(흐름 본문) — 한글에서 커서가 흐르는 진짜 문서가 된다
//  - 표·이미지는 들여쓰기 위치에 절대배치로 끼워 넣음
//  - 트리 관계(parentId)는 새 문서에도 유지 — 자석 그룹·재펴기 가능
import { type Block, type CanvasDoc, createBlock, createDoc } from "./model";

const ROMANS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"];
const HANGULS = "가나다라마바사아자차카타파하";

// 공문서 개요 번호 — aiToCanvas(AI 생성 문서)도 같은 규칙을 쓴다
export const numberFor = (depth: number, idx: number): string =>
  depth === 0
    ? `${ROMANS[idx] ?? idx + 1}.`
    : depth === 1
      ? `${idx + 1}.`
      : depth === 2
        ? `${HANGULS[idx] ?? idx + 1}.`
        : `${idx + 1})`;

const MARGIN = 20; // mm — 공문서 기본 여백
const INDENT = 8; // mm — 깊이당 들여쓰기
const GAP = 3; // mm — 블록 간 간격

export function flattenDoc(src: CanvasDoc): CanvasDoc {
  const out = createDoc(`${src.title} — 공문서`);
  const blocks: Block[] = [];
  const pageW = src.page.w;
  let y = 18;

  // 문서 제목 (가운데, 굵게)
  const title = createBlock("text", MARGIN, y);
  Object.assign(title, {
    text: src.title,
    w: pageW - MARGIN * 2,
    flow: true,
    bold: true,
    fontSize: 16,
    align: "center",
  });
  blocks.push(title);
  y += 16;

  const childrenOf = (pid?: string) =>
    src.blocks
      .filter((b) => (b.parentId ?? undefined) === pid)
      .sort((a, b) => a.y - b.y || a.x - b.x);
  const hasKids = (id: string) => src.blocks.some((b) => b.parentId === id);

  const walk = (pid: string | undefined, depth: number, newParentId?: string) => {
    let headingIdx = 0;
    for (const b of childrenOf(pid)) {
      const clone = structuredClone(b) as Block;
      clone.id = createBlock(b.type, 0, 0).id; // 새 문서용 새 id
      clone.parentId = newParentId;
      clone.collapsed = undefined; // 접기는 보기 상태 — 펴진 문서는 전부 보인다
      const indent = MARGIN + depth * INDENT;

      if (clone.type === "text") {
        const isHeading = hasKids(b.id);
        if (isHeading) {
          y += 2; // 머리글 앞 여백
          clone.text = `${numberFor(depth, headingIdx++)} ${clone.text ?? ""}`.trim();
          clone.bold = true;
          clone.fontSize = depth === 0 ? 14 : depth === 1 ? 12 : 11;
        } else {
          clone.fontSize = clone.fontSize ?? 10.5;
          clone.bold = clone.bold ?? false;
        }
        clone.align = "left";
        clone.flow = true; // 흐름 본문 — 한글에서 이어 편집 가능
        clone.x = indent;
        clone.w = pageW - MARGIN - indent;
        clone.y = y;
        y += Math.max(8, clone.h) + GAP;
      } else {
        // 표·이미지: 들여쓰기 위치에 절대배치 (지면 우측을 넘으면 안쪽으로)
        clone.x = indent + clone.w > pageW - MARGIN ? Math.max(MARGIN, pageW - MARGIN - clone.w) : indent;
        clone.y = y;
        y += clone.h + GAP + 1;
      }

      blocks.push(clone);
      walk(b.id, depth + 1, clone.id);
    }
  };
  walk(undefined, 0);

  out.blocks = blocks;
  return out;
}
