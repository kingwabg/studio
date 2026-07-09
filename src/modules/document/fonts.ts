// fonts.ts — 지면(문서) 폰트 레지스트리. 저작권·정합·다양성 3체 문제의 해법.
//
// 원칙:
//  1. 웹에 싣는 폰트는 100% OFL(구글폰츠 등재 한글 폰트)만 — npm self-host, CDN 없음.
//     문체부·저작권위 안심글꼴(KCC자은체 등)은 수동 woff2 반입으로 이 레지스트리에 추가 가능.
//  2. 한글/HWP 조판은 한글을 전각(1em)으로 계산 — 한글 문서 생태계 폰트(바탕·돋움·휴먼명조·
//     함초롬…)는 전부 한글 1em이라서다. 웹폰트는 대개 1em 미만(나눔 0.94, 본고딕 0.92)이므로
//     폰트마다 letter-spacing 보정값을 **런타임 실측**해 화면도 1em/글자로 만든다.
//  3. 폰트 파일은 무겁다(한글 서브셋 수백 KB) — 기본 폰트만 즉시, 나머지는 선택 시 지연 로딩.
//
// 확장(호환 폰트): hwpxName만 상용 폰트 원명(예: 휴먼명조)으로 두고 webFamily는 닮은꼴을
// 쓰면, 파일엔 원명이 선언되고(이름 선언은 합법 — 폰트 파일 배포가 아님) 관공서 한글에서
// 정품으로 렌더된다. 둘 다 한글 1em이라 줄바꿈도 일치.
import { create } from "zustand";

export type FontCategory = "gothic" | "myeongjo" | "display" | "hand";

export interface FontDef {
  key: string;
  label: string; // UI 표기
  category: FontCategory;
  webFamily: string; // CSS font-family (self-host)
  hwpxName: string; // hwpx charPr에 선언할 이름
  weights: number[]; // 지원 굵기 (700 없으면 브라우저 합성 굵기)
  // 지연 로딩 thunk — Vite가 정적 분석할 수 있게 리터럴 import 유지
  load?: () => Promise<unknown[]>;
}

export const FONTS: FontDef[] = [
  // ── 고딕 (본문·표) ──
  {
    key: "nanum-gothic", label: "나눔고딕", category: "gothic",
    webFamily: "Nanum Gothic", hwpxName: "나눔고딕", weights: [400, 700, 800],
    // 기본 폰트 — main.jsx에서 정적 로드(즉시 필요)
  },
  {
    key: "noto-sans-kr", label: "본고딕", category: "gothic",
    webFamily: "Noto Sans KR", hwpxName: "본고딕", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/noto-sans-kr/400.css"), import("@fontsource/noto-sans-kr/700.css")]),
  },
  {
    key: "gothic-a1", label: "고딕 A1", category: "gothic",
    webFamily: "Gothic A1", hwpxName: "고딕 A1", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/gothic-a1/400.css"), import("@fontsource/gothic-a1/700.css")]),
  },
  {
    key: "ibm-plex-kr", label: "IBM 플렉스", category: "gothic",
    webFamily: "IBM Plex Sans KR", hwpxName: "IBM Plex Sans KR", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/ibm-plex-sans-kr/400.css"), import("@fontsource/ibm-plex-sans-kr/700.css")]),
  },
  {
    key: "gowun-dodum", label: "고운돋움", category: "gothic",
    webFamily: "Gowun Dodum", hwpxName: "고운돋움", weights: [400],
    load: () => Promise.all([import("@fontsource/gowun-dodum/400.css")]),
  },
  // ── 명조/바탕 (공문서 본문) ──
  {
    key: "nanum-myeongjo", label: "나눔명조", category: "myeongjo",
    webFamily: "Nanum Myeongjo", hwpxName: "나눔명조", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/nanum-myeongjo/400.css"), import("@fontsource/nanum-myeongjo/700.css")]),
  },
  {
    key: "noto-serif-kr", label: "본명조", category: "myeongjo",
    webFamily: "Noto Serif KR", hwpxName: "본명조", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/noto-serif-kr/400.css"), import("@fontsource/noto-serif-kr/700.css")]),
  },
  {
    key: "gowun-batang", label: "고운바탕", category: "myeongjo",
    webFamily: "Gowun Batang", hwpxName: "고운바탕", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/gowun-batang/400.css"), import("@fontsource/gowun-batang/700.css")]),
  },
  // ── 제목/디스플레이 ──
  {
    key: "do-hyeon", label: "도현 (제목)", category: "display",
    webFamily: "Do Hyeon", hwpxName: "도현", weights: [400],
    load: () => Promise.all([import("@fontsource/do-hyeon/400.css")]),
  },
  {
    key: "black-han-sans", label: "검은고딕 (큰제목)", category: "display",
    webFamily: "Black Han Sans", hwpxName: "검은고딕", weights: [400],
    load: () => Promise.all([import("@fontsource/black-han-sans/400.css")]),
  },
  {
    key: "song-myung", label: "송명 (제목명조)", category: "display",
    webFamily: "Song Myung", hwpxName: "송명", weights: [400],
    load: () => Promise.all([import("@fontsource/song-myung/400.css")]),
  },
  // ── 손글씨 (포인트) ──
  {
    key: "nanum-pen", label: "나눔손글씨 펜", category: "hand",
    webFamily: "Nanum Pen Script", hwpxName: "나눔손글씨 펜", weights: [400],
    load: () => Promise.all([import("@fontsource/nanum-pen-script/400.css")]),
  },
];

export const DEFAULT_FONT = "nanum-gothic";
export const fontByKey = (key?: string): FontDef =>
  FONTS.find((f) => f.key === key) ?? FONTS.find((f) => f.key === DEFAULT_FONT)!;

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  gothic: "고딕",
  myeongjo: "명조·바탕",
  display: "제목",
  hand: "손글씨",
};

// ── 로딩 + 전각(1em) 캘리브레이션 ──
// 폰트가 로드되면 한글 20자의 advance를 실측해 letter-spacing 보정값(em)을 계산한다.
// 컴포넌트는 useFontStore를 구독 — 캘리브레이션 완료 시 리렌더.

interface FontState {
  // key → 보정값(em). 없으면 아직 미측정(기본 폰트 추정치 사용).
  spacing: Record<string, number>;
  loading: Record<string, boolean>;
  setSpacing: (key: string, em: number) => void;
  setLoading: (key: string, v: boolean) => void;
}
export const useFontStore = create<FontState>((set) => ({
  spacing: { [DEFAULT_FONT]: 0.06 }, // 기본 폰트는 기지값 (실측으로 곧 갱신)
  loading: {},
  setSpacing: (key, em) => set((s) => ({ spacing: { ...s.spacing, [key]: em } })),
  setLoading: (key, v) => set((s) => ({ loading: { ...s.loading, [key]: v } })),
}));

const SAMPLE = "가나다라마바사아자차카타파하거너더러머버"; // 한글 20자
function measureSpacingEm(family: string): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `100px "${family}"`;
  const adv = ctx.measureText(SAMPLE).width / SAMPLE.length; // px per char @ 100px em
  const em = Math.max(0, (100 - adv) / 100); // 1em까지 부족분
  return Math.round(em * 1000) / 1000;
}

// 폰트 준비(로드 + 캘리브레이션). 여러 번 불러도 안전(멱등).
export async function ensureFont(key: string): Promise<void> {
  const def = fontByKey(key);
  const st = useFontStore.getState();
  if (st.spacing[def.key] !== undefined && !def.load) {
    // 기본 폰트 — 로드는 정적, 실측만 갱신
  }
  if (st.loading[def.key]) return;
  st.setLoading(def.key, true);
  try {
    await def.load?.();
    if (typeof document !== "undefined" && document.fonts?.load) {
      await document.fonts.load(`16px "${def.webFamily}"`, SAMPLE);
      if (def.weights.includes(700)) await document.fonts.load(`700 16px "${def.webFamily}"`, SAMPLE);
    }
    useFontStore.getState().setSpacing(def.key, measureSpacingEm(def.webFamily));
  } finally {
    useFontStore.getState().setLoading(def.key, false);
  }
}

// 렌더용 CSS 조각 — 보정값 미측정이면 0.06(무난한 추정)으로 시작, 실측 후 리렌더로 정밀화
export function fontCss(key?: string): { fontFamily: string; letterSpacing: string } {
  const def = fontByKey(key);
  const em = useFontStore.getState().spacing[def.key] ?? 0.06;
  return {
    fontFamily: `"${def.webFamily}", "Malgun Gothic", "맑은 고딕", sans-serif`,
    letterSpacing: `${em}em`,
  };
}
