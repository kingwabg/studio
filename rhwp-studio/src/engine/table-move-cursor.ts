/**
 * [커서 정합 2026-07-30] 글자처럼취급(TAC) 표를 세로로 옮기면 **엔진이 문단 배열을 swap** 한다
 * (rhwp document_core/commands/table_ops.rs move_table_offset_native — is_treat_as_char && delta_v!=0
 *  경로가 paragraphs.swap 을 반복). 예전 studio 는 selectedTableRef 만 갱신하고 커서의
 * parentParaIndex/paragraphIndex 는 옛 인덱스로 남겨, 표를 옮긴 뒤 **입력이 엉뚱한 문단으로**
 * 들어갔다(병렬 조사 확정 갭, high).
 *
 * 순수 인덱스 산술이므로 wasm 의존 없이 단위 검증 가능하게 분리한다(cell-copy/cell-paste 와 같은 패턴).
 */
import type { DocumentPosition } from '@/core/types';

/**
 * 문단 하나가 from → to 로 연쇄 swap 이동했을 때, 임의의 문단 인덱스 p 의 새 위치.
 * 아래로 이동(to>from): (from,to] 구간은 한 칸 위로. 위로 이동(to<from): [to,from) 구간은 한 칸 아래로.
 */
export function shiftParagraphIndex(p: number, from: number, to: number): number {
  if (from === to) return p;
  if (p === from) return to;
  if (to > from) return p > from && p <= to ? p - 1 : p;
  return p >= to && p < from ? p + 1 : p;
}

/** 표 이동으로 문단이 재배치된 뒤의 커서 위치. 바뀔 게 없으면 같은 객체를 돌려준다. */
export function correctPositionAfterTableMove(
  pos: DocumentPosition, from: number, to: number,
): DocumentPosition {
  if (from === to) return pos;
  // 표 안(셀/중첩 셀)에 있으면 표를 품은 문단 인덱스(parentParaIndex)를 따라간다.
  if (pos.parentParaIndex !== undefined) {
    const next = shiftParagraphIndex(pos.parentParaIndex, from, to);
    if (next === pos.parentParaIndex) return pos;
    return { ...pos, parentParaIndex: next };
  }
  const next = shiftParagraphIndex(pos.paragraphIndex, from, to);
  if (next === pos.paragraphIndex) return pos;
  return { ...pos, paragraphIndex: next };
}
