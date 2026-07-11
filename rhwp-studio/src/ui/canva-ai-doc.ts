/**
 * [캔버스 한컴 포크] AI 문서 접근 공용 모듈 — 글상자 텍스트 읽기/교체 + 검토 계약 타입.
 * "AI에게 수정하기"(canva-ai-edit-dialog)와 "문서 전체 검토"(canva-ai-review)가 공유한다
 * (중복 2회 룰: readShapeText/replaceShapeText가 두 기능에 동시 필요 → 여기로 추출).
 * ⚠ 이 파일은 계약(contract)이다 — 검토 코어(A)·검토 UI(B)가 아래 타입에 맞춰 병렬 개발된다.
 */

/** 글상자(=1×1 무테두리 표) 하나를 가리키는 wasm 접근 좌표. */
export interface ShapeRef { sec: number; ppi: number; ci: number; }

/**
 * 문서에서 수집한 텍스트 개체 하나 (검토 대상).
 * id는 findings가 개체를 가리키는 안정적 참조 — 수집 순서로 부여한다.
 */
export interface DocTextElement {
  id: number;
  ref: ShapeRef;
  /** 현재 전체 텍스트 (문단들을 \n으로 결합) */
  text: string;
}

/** 검토가 잡아내는 문제 종류 (v1 = 표현 다듬기·오탈자). 표/누락/일관성은 v2. */
export type ReviewKind = '표현' | '오탈자';

/**
 * AI가 반환하는 문제 항목 하나.
 * ⚠ v1 규약: 개체당 finding 1개까지 — suggestion은 그 개체의 "수정된 전체 텍스트"다
 *   (replaceShapeText가 개체를 통째 교체하므로, 부분 교체 충돌을 피한다).
 */
export interface ReviewFinding {
  /** DocTextElement.id */
  elementId: number;
  kind: ReviewKind;
  /** 문제가 된 원문 (사용자에게 맥락으로 보여줄 현재 텍스트) */
  original: string;
  /** 제안 — 이 개체를 통째 교체할 전체 텍스트 */
  suggestion: string;
  /** 왜 고쳐야 하는지 한 줄 설명 */
  reason: string;
}

/** 검토 1회 결과 (코어 A가 반환 → UI B가 렌더). */
export interface DocReviewResult {
  /** 검토에 사용한 개체들 (findings의 elementId가 여기를 가리킴) */
  elements: DocTextElement[];
  findings: ReviewFinding[];
  /** 전송 요약 — "글상자 N개 · 총 M자" (전송 투명성 표시용) */
  sentSummary: { count: number; chars: number };
}

/** 글상자 전체 텍스트 읽기 (문단들 → \n 결합). */
export function readShapeText(wasm: any, ref: ShapeRef): string {
  const n = wasm.getCellParagraphCount(ref.sec, ref.ppi, ref.ci, 0);
  const lines: string[] = [];
  for (let cpi = 0; cpi < n; cpi++) {
    const len = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, cpi);
    lines.push(len > 0 ? wasm.getTextInCell(ref.sec, ref.ppi, ref.ci, 0, cpi, 0, len) : '');
  }
  return lines.join('\n');
}

/** 글상자 내용을 새 텍스트로 통째 교체 (스냅샷 안에서 호출). */
export function replaceShapeText(wasm: any, ref: ShapeRef, next: string): void {
  // 뒤 문단부터 비우고 앞 문단에 합쳐 1문단으로 정리
  const n = wasm.getCellParagraphCount(ref.sec, ref.ppi, ref.ci, 0);
  for (let cpi = n - 1; cpi >= 1; cpi--) {
    const len = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, cpi);
    if (len > 0) wasm.deleteTextInCell(ref.sec, ref.ppi, ref.ci, 0, cpi, 0, len);
    wasm.mergeParagraphInCell(ref.sec, ref.ppi, ref.ci, 0, cpi);
  }
  const len0 = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, 0);
  if (len0 > 0) wasm.deleteTextInCell(ref.sec, ref.ppi, ref.ci, 0, 0, 0, len0);
  // 새 텍스트 삽입 (줄마다 insert → 분할)
  const lines = next.split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]) wasm.insertTextInCell(ref.sec, ref.ppi, ref.ci, 0, k, 0, lines[k]);
    if (k < lines.length - 1) wasm.splitParagraphInCell(ref.sec, ref.ppi, ref.ci, 0, k, lines[k].length);
  }
}
