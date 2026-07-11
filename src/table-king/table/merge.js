// 병합 판정의 단일 소스 — 같은 술어가 6곳(boundaryResize·boundarySegments·TableKingBlock·
// TableContent·PageSnapshot·exportCore)에 복제돼 있었다(감사 CONFIRMED, 중복 3회 룰 = 무조건 추출).
// ⚠ exportCore.js(src/hwpx)만은 "의존성 0 코어" 계약(외부 파일 무의존)으로 자체 복사본을
//   유지한다 — 의도적 중복, 로직 변경 시 그쪽도 함께 고칠 것.
// (row,col)을 덮는 병합(앵커 자신은 제외) — 없으면 undefined
export const coveringMerge = (merges, row, col) =>
  (merges || []).find(
    (merge) =>
      row >= merge.r &&
      row < merge.r + merge.rs &&
      col >= merge.c &&
      col < merge.c + merge.cs &&
      !(row === merge.r && col === merge.c)
  );

export const isCoveredByMerge = (merges, row, col) => coveringMerge(merges, row, col) !== undefined;

export const mergeAt = (merges, row, col) =>
  (merges || []).find((merge) => merge.r === row && merge.c === col);
