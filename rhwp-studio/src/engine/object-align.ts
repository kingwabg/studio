// [캔버스 한컴 포크] 개체 정렬 — 다중 선택된 개체의 위치를 그룹 기준으로 정렬한다.
// 순수 함수(wasm 무의존)라 단위 테스트로 정합을 검증한다(picture-resize.ts와 동일 패턴).
// 좌표계: HWPUNIT. 개체는 offset(horzOffset/vertOffset)=좌상단 + width/height=크기.
// 그룹 내부 상대 정렬만 하므로 앵커(Paper/Para) 기준이 무엇이든 결과가 동일하다.

export type AlignMode =
  | 'left' | 'hcenter' | 'right'    // 가로: 왼쪽/가운데/오른쪽 모서리
  | 'top' | 'vcenter' | 'bottom'    // 세로: 위/가운데/아래 모서리
  | 'hdistribute' | 'vdistribute';  // 간격 균등 분배(가로/세로)

/** 정렬 입력 — 개체 하나의 현재 위치·크기(HWPUNIT). */
export interface AlignBox {
  horzOffset: number;
  vertOffset: number;
  width: number;
  height: number;
}

/** 정렬 결과 — 개체의 새 좌상단 offset(HWPUNIT). 변경 없으면 null. */
export interface AlignResult {
  horzOffset: number;
  vertOffset: number;
}

function finiteBox(b: AlignBox): boolean {
  return (
    Number.isFinite(b.horzOffset) && Number.isFinite(b.vertOffset) &&
    Number.isFinite(b.width) && Number.isFinite(b.height)
  );
}

/**
 * 다중 선택 개체의 정렬 결과를 계산한다(순수).
 * @returns boxes와 같은 길이의 배열. 각 원소는 새 offset 또는 변경 없음(null).
 *   정렬은 개체 2개 이상, 분배는 3개 이상일 때만 의미가 있으므로 그 미만이면 전부 null.
 */
export function computeObjectAlignment(boxes: AlignBox[], mode: AlignMode): (AlignResult | null)[] {
  const n = boxes.length;
  const none = (): (AlignResult | null)[] => boxes.map(() => null);
  if (n < 2) return none();
  if (!boxes.every(finiteBox)) return none();

  const isDistribute = mode === 'hdistribute' || mode === 'vdistribute';
  if (isDistribute) return distribute(boxes, mode === 'hdistribute');

  // ── 모서리/가운데 정렬 ──────────────────────────────
  const lefts = boxes.map((b) => b.horzOffset);
  const rights = boxes.map((b) => b.horzOffset + b.width);
  const tops = boxes.map((b) => b.vertOffset);
  const bottoms = boxes.map((b) => b.vertOffset + b.height);
  const gLeft = Math.min(...lefts);
  const gRight = Math.max(...rights);
  const gTop = Math.min(...tops);
  const gBottom = Math.max(...bottoms);
  const gHCenter = (gLeft + gRight) / 2;
  const gVCenter = (gTop + gBottom) / 2;

  return boxes.map((b) => {
    let horz = b.horzOffset;
    let vert = b.vertOffset;
    switch (mode) {
      case 'left':    horz = gLeft; break;
      case 'right':   horz = gRight - b.width; break;
      case 'hcenter': horz = Math.round(gHCenter - b.width / 2); break;
      case 'top':     vert = gTop; break;
      case 'bottom':  vert = gBottom - b.height; break;
      case 'vcenter': vert = Math.round(gVCenter - b.height / 2); break;
    }
    horz = Math.round(horz);
    vert = Math.round(vert);
    if (horz === b.horzOffset && vert === b.vertOffset) return null; // 무변경 → Undo 기록 방지
    return { horzOffset: horz, vertOffset: vert };
  });
}

/**
 * 간격 균등 분배 — 양 끝 개체는 고정하고 사이 간격을 같게 만든다(파워포인트/캔바 규약).
 * @param horizontal true=가로, false=세로.
 */
function distribute(boxes: AlignBox[], horizontal: boolean): (AlignResult | null)[] {
  const n = boxes.length;
  if (n < 3) return boxes.map(() => null); // 2개 이하는 분배할 사이가 없음

  const pos = (b: AlignBox) => (horizontal ? b.horzOffset : b.vertOffset);
  const size = (b: AlignBox) => (horizontal ? b.width : b.height);

  // 원래 인덱스를 유지한 채 시작 좌표순 정렬
  const order = boxes.map((b, i) => i).sort((a, c) => pos(boxes[a]) - pos(boxes[c]));
  const first = order[0];
  const last = order[n - 1];
  const spanStart = pos(boxes[first]);
  const spanEnd = pos(boxes[last]) + size(boxes[last]);
  const sumSizes = order.reduce((acc, i) => acc + size(boxes[i]), 0);
  const gap = (spanEnd - spanStart - sumSizes) / (n - 1); // 음수(겹침)여도 규약대로 적용

  const results: (AlignResult | null)[] = boxes.map(() => null);
  let cursor = spanStart;
  for (const i of order) {
    const b = boxes[i];
    const newPos = Math.round(cursor);
    cursor += size(b) + gap;
    // 양 끝(첫·마지막)은 앵커라 사실상 무변경이지만 라운딩 편차만 반영
    if (newPos === pos(b)) { results[i] = null; continue; }
    results[i] = horizontal
      ? { horzOffset: newPos, vertOffset: b.vertOffset }
      : { horzOffset: b.horzOffset, vertOffset: newPos };
  }
  return results;
}
