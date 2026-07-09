// theme.ts — /studio 전용 라이트/다크 테마 상태.
// 다크는 크롬(툴바·패널·캔버스 바탕)만 어둡게 하고 A4 지면은 흰색을 유지한다(조판 정합).
// 적용 경로: .studio-root.dark 클래스(CSS 변수 오버라이드) + Radix Theme appearance.
import { create } from "zustand";

const KEY = "studio:theme";

interface ThemeState {
  dark: boolean;
  toggle: () => void;
  setDark: (v: boolean) => void;
}

// 우측 패널 탭 — 좌측 레일(AI)에서도 열 수 있게 전역
interface RightTabState {
  tab: "props" | "ai";
  setTab: (t: "props" | "ai") => void;
}
export const useRightTabStore = create<RightTabState>((set) => ({
  tab: "props",
  setTab: (tab) => set({ tab }),
}));

export const useThemeStore = create<ThemeState>((set) => ({
  dark: typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "dark",
  toggle: () =>
    set((s) => {
      const dark = !s.dark;
      localStorage.setItem(KEY, dark ? "dark" : "light");
      return { dark };
    }),
  setDark: (dark) => {
    localStorage.setItem(KEY, dark ? "dark" : "light");
    set({ dark });
  },
}));
