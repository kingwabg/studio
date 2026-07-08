// store.ts — 병합(데이터 연동) 상태. 데이터셋은 문서와 별개의 작업 상태라 캔버스
// 스토어와 분리한다 (문서 JSON에는 토큰만 저장 — 데이터는 진실이 아니라 재료).
import { create } from "zustand";
import { type Dataset } from "./parseSheet";

interface MergeState {
  dataset: Dataset | null;
  previewIndex: number | null; // null = 칩(토큰) 표시, n = n번 레코드 값으로 미리보기
  setDataset: (d: Dataset) => void;
  clearDataset: () => void;
  setPreviewIndex: (i: number | null) => void;
}

export const useMergeStore = create<MergeState>((set) => ({
  dataset: null,
  previewIndex: null,
  setDataset: (dataset) => set({ dataset, previewIndex: 0 }), // 업로드 직후 1번 레코드 미리보기
  clearDataset: () => set({ dataset: null, previewIndex: null }),
  setPreviewIndex: (previewIndex) => set({ previewIndex }),
}));
