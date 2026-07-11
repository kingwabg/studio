// tableScale.ts — 표 트랙(열 너비·행 높이) 비례 스케일의 유일 구현.
// ⚠ 반올림은 반드시 "경계(누적) 공간"에서: 셀 단위로 독립 Math.round하면 같은 물리 경계가
// 행마다 다르게 라운드되어 세로 경계가 1px씩 찢어진다(2026-07 표 감사 실측: [105,45,150]류
// 행들 ×1.13에서 공유 경계 170/169/170, 행 합 339/338). 이 드리프트가 통선 그룹 판정
// EPS(0.6px)를 넘으면 통선 드래그가 일부 행만 움직여 어긋남이 고착·증폭된다.
// importCore의 "행별 반올림 금지 = 1px 유령 열" 교훈과 동일 원칙.
// 소비자: CanvasBlock.scaleTableKingData(표 전체 리사이즈) · store.fitTableDataToSafeArea.

// 한 행의 트랙 폭을 경계 공간에서 스케일 — 누적 경계를 round한 뒤 차분으로 복원.
// 같은 누적값(공유 경계)은 어느 행에서든 같은 정수로 라운드되어 정합이 보존된다.
// min 클램프는 단조성 유지(경계가 최소 간격만큼은 전진) — 발동한 행은 이후 경계가 밀려
// 어긋날 수 있으나, 이는 극단 축소의 안전장치일 뿐 정상 스케일에선 미발동.
export function scaleTracksRow(row: number[], ratio: number, min: number): number[] {
  const out: number[] = [];
  let cum = 0;
  let prev = 0;
  for (const w of row) {
    cum += w;
    const r = Math.max(Math.round(cum * ratio), prev + min);
    out.push(r - prev);
    prev = r;
  }
  return out;
}

// 열 너비(widths[행][열]) — 세로 경계는 행 방향 누적이 공유선.
export const scaleWidths = (widths: number[][], ratio: number, min: number): number[][] =>
  widths.map((row) => scaleTracksRow(row, ratio, min));

// 셀 높이(cellHeights[행][열]) — 가로 경계는 "열 방향 세로 누적"이 공유선.
// 열별로 위→아래 누적을 경계 공간에서 라운드해야 열 사이 가로 경계가 찢어지지 않는다.
export function scaleHeights(cellHeights: number[][], ratio: number, min: number): number[][] {
  if (!cellHeights.length) return cellHeights;
  const rows = cellHeights.length;
  const cols = Math.max(0, ...cellHeights.map((r) => r.length));
  const out = cellHeights.map((r) => r.slice());
  for (let c = 0; c < cols; c++) {
    let cum = 0;
    let prev = 0;
    for (let r = 0; r < rows; r++) {
      const h = cellHeights[r]?.[c];
      if (h == null) continue;
      cum += h;
      const v = Math.max(Math.round(cum * ratio), prev + min);
      out[r][c] = v - prev;
      prev = v;
    }
  }
  return out;
}
