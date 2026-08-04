/**
 * AI 문서 작성 — 실체화 (2026-08-05).
 *
 * WriterDocument(모델)를 rhwp 엔진 호출로 **진짜 문서**로 만든다. 모델이 유일한
 * 진실이고 지면은 그 사본이다 — 그래서 다시 그릴 때는 이전 실체화를 Ctrl+Z 한 번
 * 분량(스냅샷 1개)으로 되돌리고 처음부터 다시 짓는다. 부분 갱신을 시도하지 않는
 * 이유: 섹션 삭제 하나로 번호가 전부 밀리는데, 지면에서 그걸 따라 고치는 코드는
 * 반드시 어긋난다(모델→지면 한 방향이면 어긋날 수가 없다).
 *
 * ⚠ 삽입 함정 3가지는 ai-doc-insert.ts 의 실측에서 이관한 것(그 파일은 우측 패널·
 * 전자서명 도구가 계속 쓰므로 남아 있다 — 여기는 의존하지 않고 지식만 가져왔다):
 *   ① 커서 오프셋은 논리 좌표, insertText 는 텍스트 좌표 — logicalToTextOffset 변환.
 *   ② 글자취급 표는 글자 한 칸 — 표 뒤는 offset+1 에서 잘라야 순서가 안 뒤집힌다.
 *   ③ 문단 정렬 키는 `alignment` — `align` 으로 보내면 조용히 무시된다.
 */
import type { WriterDocument, Section } from './document-model';
import { headingLabel } from './document-model';

/**
 * 레벨별 제목 서식 — 실무 보고서 관행에 맞춘 값(2026-08-05 품질 개선):
 * L1 은 16pt + 연회색 글자 음영(shadeColor) — "음영 제목"은 정부 보고서의 표준 인상이다.
 * 18pt 는 A4 에서 과했다(첫 실측 화면 기준). 본문 11pt, 제목 22pt 유지.
 */
const HEADING_STYLE: Record<1 | 2 | 3, { fontSize: number; bold: boolean; shade?: string }> = {
  1: { fontSize: 1600, bold: true, shade: '#e8edf3' },
  2: { fontSize: 1300, bold: true },
  3: { fontSize: 1150, bold: true },
};
const TITLE_STYLE = { fontSize: 2200, bold: true };
const BODY_PT = 1100;
/** 표 머리행 배경 — sc- 업무분장표 라벨 셀과 같은 계열(정부 서식 관행) */
const TABLE_HEAD_FILL = '#f1f5f9';

/**
 * 목록 마커 — 행정 문서의 계층 기호 관행(□ → ○ → -)을 섹션 깊이로 따른다.
 * 모델이 마커를 직접 쓰면 뒤섞이므로(프롬프트 ⑥) 여기서만 붙인다.
 */
const LIST_MARK: Record<1 | 2 | 3, string> = { 1: '□ ', 2: '○ ', 3: '- ' };

/** 실체화가 남기는 주소록 — review 가 실제 조판에서 쪽을 찾을 때 쓴다. */
export interface RealizeMap {
  /** 섹션별: 제목 문단 번호와 첫 내용 문단 번호 */
  sections: Array<{ headingPara: number; firstBlockPara: number; lastPara: number }>;
  totalParas: number;
}

interface WasmLike {
  insertText(s: number, p: number, o: number, t: string): unknown;
  splitParagraph(s: number, p: number, o: number): unknown;
  applyCharFormat(s: number, p: number, from: number, to: number, json: string): unknown;
  applyParaFormat(s: number, p: number, json: string): unknown;
  createTableEx(o: Record<string, unknown>): { paraIdx?: number; controlIdx?: number };
  insertTextInCell(s: number, pp: number, ci: number, cei: number, cpi: number, o: number, t: string): unknown;
  getTableCellBboxes(s: number, pp: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
  mergeTableCells(s: number, pp: number, ci: number, top: number, left: number, bottom: number, right: number): unknown;
  setCellProperties(s: number, pp: number, ci: number, cellIdx: number, props: Record<string, unknown>): unknown;
  applyCharFormatInCell(s: number, pp: number, ci: number, cellIdx: number, cellPara: number, from: number, to: number, json: string): unknown;
  applyParaFormatInCell(s: number, pp: number, ci: number, cellIdx: number, cellPara: number, json: string): unknown;
}

interface IhLike {
  executeOperation(d: unknown): unknown;
  performUndo(): void;
  isFormMode?(): boolean;
  setEditMode?(mode: string): void;
}

interface ServicesLike {
  getInputHandler(): unknown;
  eventBus: { emit(ev: string, payload?: unknown): void };
  wasm: { pageCount: number };
}

/** 직전 실체화를 스냅샷 1개로 되돌릴 수 있는지 — 세션당 하나만 유지한다. */
let realizedOnce = false;
export function resetRealizeState(): void { realizedOnce = false; }

/**
 * 모델을 지면으로. 반환 = 주소록(실패 시 null).
 * 이미 실체화돼 있으면 performUndo 로 걷어내고 다시 짓는다.
 */
export function realize(services: ServicesLike, doc: WriterDocument): RealizeMap | null {
  const ih = services.getInputHandler() as IhLike | null;
  if (!ih || services.wasm.pageCount === 0) return null;

  if (realizedOnce) {
    // 직전 실체화 = 스냅샷 1개 — 한 번의 undo 로 정확히 그만큼 걷힌다.
    try { ih.performUndo(); } catch { /* undo 실패면 이어서 덧그린다 — 아래에서 다시 지어진다 */ }
    realizedOnce = false;
  }

  // ⚠ 양식 모드는 스냅샷 연산을 통째로 막는다(도장 삽입에서 실측) — 넣는 동안만 푼다.
  //   CanvaServices 에는 setEditMode 가 없어 입력기(ih)에 직접 건다.
  const wasForm = typeof ih.isFormMode === 'function' && ih.isFormMode();
  if (wasForm) ih.setEditMode?.('normal');

  const map: RealizeMap = { sections: [], totalParas: 0 };
  try {
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'aiWriterRealize',
      operation: (wasm: WasmLike) => {
        let para = 0;
        let offset = 0;
        /**
         * 모든 문단에 까는 기본값. ⚠ indent 0 과 pageBreakBefore false 를 **명시**하는
         * 이유: splitParagraph 는 문단 속성을 다음 문단에 상속시킨다. new_page 제목의
         * pageBreakBefore 가 뒤따르는 목록 항목들에 상속돼 항목마다 쪽을 넘겼다
         * (실측: 4개 섹션 문서가 5쪽 — 2쪽이어야 했다). 매 문단 기본값으로 눌러 끊는다.
         */
        const lineFmt: Record<string, unknown> = {
          lineSpacing: doc.lineSpacing, lineSpacingType: 'Percent',
          pageBreakBefore: false,
        };

        /** 한 줄을 넣고 다음 문단으로 넘어간다. 반환 = 이 줄이 앉은 문단 번호. */
        const emitLine = (
          text: string,
          char: { fontSize: number; bold: boolean; shade?: string } | null,
          paraProps: Record<string, unknown>,
          split = true,
        ): number => {
          const at = para;
          wasm.insertText(0, para, offset, text);
          const len = [...text].length; // 코드포인트 기준 — UTF-16 length 는 이모지에서 어긋난다
          if (char) {
            // ⚠ shadeColor 를 **항상** 명시한다. 삽입 텍스트는 앞 글자의 서식을 상속해서,
            //   L1 제목의 음영이 뒤 문단·목록·표 셀까지 번졌다(실측 화면). '#ffffff' 가
            //   "음영 없음" 규약이다(char-shape-dialog 와 동일).
            wasm.applyCharFormat(0, para, offset, offset + len, JSON.stringify({
              fontSize: char.fontSize, bold: char.bold, shadeColor: char.shade ?? '#ffffff',
            }));
          }
          try { wasm.applyParaFormat(0, para, JSON.stringify({ ...lineFmt, ...paraProps })); } catch { /* 서식 실패가 삽입을 막지 않는다 */ }
          if (split) {
            wasm.splitParagraph(0, para, offset + len);
            para += 1;
            offset = 0;
          }
          return at;
        };

        // ── 제목 ──
        if (doc.title) {
          emitLine(doc.title, TITLE_STYLE, { alignment: 'center', after: 600 });
        }

        // ── 섹션들 ──
        doc.sections.forEach((s: Section, si) => {
          const headingProps: Record<string, unknown> = {
            alignment: 'left', before: s.level === 1 ? 500 : 300, after: 200,
          };
          // 쪽 나눔은 제목 문단 속성으로 — 엔진이 실제 조판에서 반영한다.
          if (s.pageBreakBefore && (si > 0 || doc.title)) headingProps.pageBreakBefore = true;
          const headingPara = emitLine(headingLabel(s), HEADING_STYLE[s.level], headingProps);

          let firstBlockPara = -1;
          for (const b of s.blocks) {
            if (b.type === 'para') {
              const at = emitLine(b.text, { fontSize: BODY_PT, bold: false }, { alignment: 'justify' });
              if (firstBlockPara < 0) firstBlockPara = at;
            } else if (b.type === 'list') {
              b.items.forEach((item, i) => {
                const mark = b.ordered ? `${i + 1}. ` : LIST_MARK[s.level];
                // ⚠ indent 는 쓰지 않는다 — 단위 해석이 달라 첫 줄이 지면 절반까지 밀렸다
                //   (실측 화면). 계층은 마커(□/○/-)가 이미 말해 준다.
                const at = emitLine(mark + item, { fontSize: BODY_PT, bold: false },
                  { alignment: 'left' });
                if (firstBlockPara < 0) firstBlockPara = at;
              });
            } else {
              // 표 — 표가 놓일 문단의 정렬을 먼저 왼쪽으로(앞 제목의 가운데가 상속된다).
              try { wasm.applyParaFormat(0, para, JSON.stringify({ alignment: 'left', ...lineFmt })); } catch { /* 표시용 */ }
              const res = wasm.createTableEx({
                sectionIdx: 0, paraIdx: para, charOffset: offset,
                rowCount: b.rows.length, colCount: b.rows[0].length, treatAsChar: true,
              });
              const pp = res.paraIdx ?? para;
              const ci = res.controlIdx;
              if (ci !== undefined) {
                // 병합을 먼저 — 채운 뒤 병합하면 먹힌 칸의 내용이 사라진다.
                for (const m of b.merges) {
                  try { wasm.mergeTableCells(0, pp, ci, m.top, m.left, m.bottom, m.right); } catch { /* 범위 무효면 건너뜀 */ }
                }
                const seen = new Set<number>();
                for (const bb of wasm.getTableCellBboxes(0, pp, ci)) {
                  if (seen.has(bb.cellIdx)) continue;
                  seen.add(bb.cellIdx);
                  const text = b.rows[bb.row]?.[bb.col] ?? '';
                  if (text) wasm.insertTextInCell(0, pp, ci, bb.cellIdx, 0, 0, text);
                  try {
                    if (bb.row === 0) {
                      // 머리행: 연회색 배경 + 굵게 + 가운데 — 표가 "표"로 보이게 하는 최소 서식.
                      wasm.setCellProperties(0, pp, ci, bb.cellIdx, { fillColor: TABLE_HEAD_FILL, verticalAlign: 1 });
                      wasm.applyParaFormatInCell(0, pp, ci, bb.cellIdx, 0, JSON.stringify({ alignment: 'center' }));
                    }
                    // ⚠ 셀 텍스트도 앞 글자 서식을 상속한다 — L1 제목의 글자 음영이 표 안까지
                    //   번졌다(실측 화면). 모든 채운 셀에 shadeColor 를 명시해 끊는다.
                    if (text) {
                      wasm.applyCharFormatInCell(0, pp, ci, bb.cellIdx, 0, 0, [...text].length,
                        JSON.stringify({ bold: bb.row === 0, shadeColor: '#ffffff', fontSize: BODY_PT }));
                    }
                  } catch { /* 셀 서식 실패가 표 생성을 막지 않는다 */ }
                }
              }
              if (firstBlockPara < 0) firstBlockPara = para;
              // ⚠ 글자취급 표 = 글자 한 칸. offset 에서 자르면 표 앞이 잘린다 — 표 뒤(+1)에서.
              wasm.splitParagraph(0, para, offset + 1);
              para += 1;
              offset = 0;
            }
          }
          map.sections.push({
            headingPara,
            firstBlockPara: firstBlockPara < 0 ? headingPara : firstBlockPara,
            lastPara: Math.max(0, para - 1),
          });
        });
        map.totalParas = para;
        return null;
      },
    });
    realizedOnce = true;
    services.eventBus.emit('document-changed');
    return map;
  } finally {
    if (wasForm) ih.setEditMode?.('form');
  }
}
