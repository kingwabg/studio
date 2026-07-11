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

// 사이드바 폭·접힘 (밀고 당기기) — 드래그로 폭 조절, 토글로 접기. localStorage 유지.
export const LEFT_MIN = 250;
export const LEFT_MAX = 420;
export const LEFT_DEFAULT = 300;
export const RIGHT_MIN = 276;
export const RIGHT_MAX = 460;
export const RIGHT_DEFAULT = 276; // 확정 스펙: 속성 패널 기본 276px

const clampW = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
const num = (key: string, fallback: number) => {
  const v = typeof localStorage !== "undefined" ? Number(localStorage.getItem(key)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const bool = (key: string, fallback: boolean) => {
  if (typeof localStorage === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "1";
};

interface PanelState {
  leftW: number;
  rightW: number;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftW: (v: number) => void;
  setRightW: (v: number) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}
export const usePanelStore = create<PanelState>((set) => ({
  leftW: clampW(num("studio:leftW", LEFT_DEFAULT), LEFT_MIN, LEFT_MAX),
  rightW: clampW(num("studio:rightW", RIGHT_DEFAULT), RIGHT_MIN, RIGHT_MAX),
  leftOpen: bool("studio:leftOpen", true),
  rightOpen: bool("studio:rightOpen", true),
  setLeftW: (v) => {
    const w = clampW(v, LEFT_MIN, LEFT_MAX);
    localStorage.setItem("studio:leftW", String(w));
    set({ leftW: w });
  },
  setRightW: (v) => {
    const w = clampW(v, RIGHT_MIN, RIGHT_MAX);
    localStorage.setItem("studio:rightW", String(w));
    set({ rightW: w });
  },
  toggleLeft: () =>
    set((s) => {
      localStorage.setItem("studio:leftOpen", s.leftOpen ? "0" : "1");
      return { leftOpen: !s.leftOpen };
    }),
  toggleRight: () =>
    set((s) => {
      localStorage.setItem("studio:rightOpen", s.rightOpen ? "0" : "1");
      return { rightOpen: !s.rightOpen };
    }),
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
