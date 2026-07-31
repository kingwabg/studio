/**
 * AI 본문 삽입 — 줄을 **제목/소제목/본문으로 나눠 서식을 입혀** 넣는다.
 *
 * 그냥 통째로 넣으면(insertPlainTextAtCursor) 제목도 10pt 평문이라, 사용자가 다시
 * 한 줄씩 굵게·크게 만들어야 한다. 문서 도우미가 할 일의 절반이 서식이다.
 *
 * 분류는 **AI 에게 시킨 형식**을 그대로 읽는다(canva-ai-panel 의 SYSTEM_PROMPT):
 *   첫 줄        → 문서 제목
 *   `1. ` `2. `  → 대제목
 *   `가. ` `나. `→ 소제목
 *   그 외        → 본문
 * ⚠ 마크다운(#·**)은 프롬프트에서 금지했지만 모델이 흘릴 때가 있어 여기서 걷어낸다.
 *
 * 전체가 스냅샷 1회 — 되돌리기 한 번이면 통째로 사라진다.
 */

export type LineKind = 'title' | 'head1' | 'head2' | 'body';

export interface DocLine {
  text: string;
  kind: LineKind;
}

/** 서식 값(HWP 단위: pt×100). 한글 공문서의 흔한 크기에 맞췄다. */
const STYLE: Record<LineKind, { fontSize: number; bold: boolean }> = {
  title: { fontSize: 1600, bold: true },
  head1: { fontSize: 1300, bold: true },
  head2: { fontSize: 1100, bold: true },
  body: { fontSize: 1000, bold: false },
};

/** 모델이 흘린 마크다운 흔적을 걷어낸다 — 한글 문서엔 기호가 그대로 찍힌다. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*+]\s+/, '· ')
    .trim();
}

/** AI 출력 한 덩어리를 줄별 종류로 나눈다. 빈 줄은 버린다(문단 사이 여백은 서식이 만든다). */
export function classifyLines(raw: string): DocLine[] {
  const lines = raw.split('\n').map(stripMarkdown).filter((l) => l.length > 0);
  return lines.map((text, i) => {
    if (i === 0) return { text, kind: 'title' as const };
    if (/^\d+[.)]\s/.test(text)) return { text, kind: 'head1' as const };
    if (/^[가-힣][.)]\s/.test(text)) return { text, kind: 'head2' as const };
    return { text, kind: 'body' as const };
  });
}

interface Ih {
  getCursorPosition(): { sectionIndex: number; paragraphIndex: number; charOffset: number };
  executeOperation(d: unknown): unknown;
}

/**
 * 커서 자리에 서식을 입혀 넣는다. 반환 = 넣은 줄 수.
 *
 * ⚠ 한 번의 스냅샷으로 묶는다 — 줄마다 기록하면 20줄짜리 초안을 되돌리는 데
 *   Ctrl+Z 를 20번 눌러야 한다(「전부 적용」에서 같은 판단을 했다).
 */
export function insertFormatted(ih: Ih, raw: string): number {
  const lines = classifyLines(raw);
  if (lines.length === 0) return 0;
  const pos = ih.getCursorPosition();

  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'aiDocInsert',
    operation: (wasm: {
      insertText(s: number, p: number, o: number, t: string): unknown;
      splitParagraph(s: number, p: number, o: number): unknown;
      applyCharFormat(s: number, p: number, from: number, to: number, json: string): unknown;
      getParagraphLength(s: number, p: number): number;
    }) => {
      let para = pos.paragraphIndex;
      let offset = pos.charOffset;
      for (let i = 0; i < lines.length; i++) {
        const { text, kind } = lines[i];
        wasm.insertText(pos.sectionIndex, para, offset, text);
        // 글자 수는 코드포인트 기준 — str.length 는 UTF-16 이라 이모지에서 어긋난다.
        const len = [...text].length;
        const st = STYLE[kind];
        wasm.applyCharFormat(pos.sectionIndex, para, offset, offset + len,
          JSON.stringify({ fontSize: st.fontSize, bold: st.bold }));
        if (i < lines.length - 1) {
          wasm.splitParagraph(pos.sectionIndex, para, offset + len);
          para += 1;
          offset = 0;
        }
      }
      return null;
    },
  });
  return lines.length;
}
