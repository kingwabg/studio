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

export type FontCategory = "gothic" | "myeongjo" | "display" | "hand" | "compat" | "safe";

export interface FontDef {
  key: string;
  label: string; // UI 표기
  category: FontCategory;
  webFamily: string; // CSS font-family (화면 렌더 — self-host)
  hwpxName: string; // hwpx charPr에 선언할 이름 (관공서 한글에서 열 때의 폰트)
  weights: number[]; // 지원 굵기 (700 없으면 브라우저 합성 굵기)
  // 지연 로딩 thunk — Vite가 정적 분석할 수 있게 리터럴 import 유지 (fontsource 폰트)
  load?: () => Promise<unknown[]>;
  // 로컬 반입 폰트(public/fonts/*.woff2) — @font-face를 런타임 주입 (안심글꼴 수동 반입용)
  localSrc?: { url: string; weight: number }[];
  // 호환 폰트 — webFamily(닮은꼴)와 hwpxName(상용 원명)이 다름. 화면은 안전한 닮은꼴,
  // 파일엔 원명 선언 → 관공서 정품 렌더. 이름 선언은 폰트 파일 배포가 아니라 합법.
  compat?: boolean;
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

  // ── 호환 폰트 (실무 관행 대응) ──
  // 화면은 라이선스 안전한 닮은꼴 OFL 폰트로 렌더하고, hwpx 파일엔 상용 폰트 원명을 선언한다.
  // 관공서 PC에는 그 상용 폰트(휴먼명조·HY·윤 등)가 정품으로 깔려 있어 열면 정품으로 조판되고,
  // 우리 서버·웹에는 상용 폰트 파일을 올리지 않으므로 저작권 안전(이름 선언 ≠ 파일 배포).
  // 둘 다 한글 전각(1em)이라 줄바꿈 정합도 유지된다.
  {
    key: "compat-humanmyeongjo", label: "휴먼명조 (호환)", category: "compat", compat: true,
    webFamily: "Nanum Myeongjo", hwpxName: "휴먼명조", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/nanum-myeongjo/400.css"), import("@fontsource/nanum-myeongjo/700.css")]),
  },
  {
    key: "compat-hyshingothic", label: "HY신명조 (호환)", category: "compat", compat: true,
    webFamily: "Nanum Myeongjo", hwpxName: "HY신명조", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/nanum-myeongjo/400.css"), import("@fontsource/nanum-myeongjo/700.css")]),
  },
  {
    key: "compat-hygungso", label: "HY궁서 (호환)", category: "compat", compat: true,
    webFamily: "Gowun Batang", hwpxName: "HY궁서B", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/gowun-batang/400.css"), import("@fontsource/gowun-batang/700.css")]),
  },
  {
    key: "compat-hygothic", label: "HY견고딕 (호환)", category: "compat", compat: true,
    webFamily: "Black Han Sans", hwpxName: "HY견고딕", weights: [400],
    load: () => Promise.all([import("@fontsource/black-han-sans/400.css")]),
  },
  {
    key: "compat-yoongothic", label: "윤고딕 (호환)", category: "compat", compat: true,
    webFamily: "Noto Sans KR", hwpxName: "윤고딕140", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/noto-sans-kr/400.css"), import("@fontsource/noto-sans-kr/700.css")]),
  },
  {
    key: "compat-junggothic", label: "중고딕 (호환)", category: "compat", compat: true,
    webFamily: "Noto Sans KR", hwpxName: "중고딕", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/noto-sans-kr/400.css"), import("@fontsource/noto-sans-kr/700.css")]),
  },
  {
    key: "compat-hamchorombatang", label: "함초롬바탕 (호환)", category: "compat", compat: true,
    webFamily: "Nanum Myeongjo", hwpxName: "함초롬바탕", weights: [400, 700],
    load: () => Promise.all([import("@fontsource/nanum-myeongjo/400.css"), import("@fontsource/nanum-myeongjo/700.css")]),
  },
  {
    key: "compat-hamchoromdotum", label: "함초롬돋움 (호환)", category: "compat", compat: true,
    webFamily: "Nanum Gothic", hwpxName: "함초롬돋움", weights: [400, 700, 800],
    // 나눔고딕은 기본 정적 로드라 load 불필요
  },

  // ── 안심글꼴 (상업·웹 100% 무료, public/fonts self-host) ──
  // KoPubWorld: 한국출판인회의(KOPUS) 배포, 상업·웹 임베딩 무료. 전 글리프 포함(대용량).
  //   출처: github.com/adrinerDP/font-kopubworld · kopus.org. 공문서 본문에 적합.
  {
    key: "kopub-batang", label: "KoPub 바탕", category: "safe",
    webFamily: "KoPubWorld Batang", hwpxName: "KoPubWorld바탕체_Pro Light", weights: [400, 700],
    localSrc: [
      { url: "/fonts/KoPubWorld-Batang-Medium.woff2", weight: 400 },
      { url: "/fonts/KoPubWorld-Batang-Bold.woff2", weight: 700 },
    ],
  },
  {
    key: "kopub-dotum", label: "KoPub 돋움", category: "safe",
    webFamily: "KoPubWorld Dotum", hwpxName: "KoPubWorld돋움체_Pro Light", weights: [400, 700],
    localSrc: [
      { url: "/fonts/KoPubWorld-Dotum-Medium.woff2", weight: 400 },
      { url: "/fonts/KoPubWorld-Dotum-Bold.woff2", weight: 700 },
    ],
  },
  // 나눔스퀘어(네이버, 나눔글꼴 자유 라이선스) — 제목·표지용 고딕. 웹 서브셋이라 본문보다 제목에.
  {
    key: "nanum-square", label: "나눔스퀘어", category: "safe",
    webFamily: "NanumSquare", hwpxName: "나눔스퀘어", weights: [400, 700, 800],
    localSrc: [
      { url: "/fonts/NanumSquareR.woff2", weight: 400 },
      { url: "/fonts/NanumSquareB.woff2", weight: 700 },
      { url: "/fonts/NanumSquareEB.woff2", weight: 800 },
    ],
  },
  {
    key: "nanum-square-round", label: "나눔스퀘어라운드", category: "safe",
    webFamily: "NanumSquareRound", hwpxName: "나눔스퀘어라운드", weights: [400, 700, 800],
    localSrc: [
      { url: "/fonts/NanumSquareRoundR.woff2", weight: 400 },
      { url: "/fonts/NanumSquareRoundB.woff2", weight: 700 },
      { url: "/fonts/NanumSquareRoundEB.woff2", weight: 800 },
    ],
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
  safe: "안심글꼴",
  compat: "호환 (실무 폰트)",
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

// 로컬 반입 폰트(public/fonts/*.woff2) — @font-face를 <head>에 1회 주입.
const injectedLocal = new Set<string>();
function injectLocalFace(def: FontDef): void {
  if (!def.localSrc || injectedLocal.has(def.key) || typeof document === "undefined") return;
  injectedLocal.add(def.key);
  const css = def.localSrc
    .map(
      (s) =>
        `@font-face{font-family:"${def.webFamily}";font-style:normal;font-display:swap;` +
        `font-weight:${s.weight};src:url("${s.url}") format("woff2");}`
    )
    .join("");
  const el = document.createElement("style");
  el.dataset.font = def.key;
  el.textContent = css;
  document.head.appendChild(el);
}

// hwpxName(한글 이름) → webFamily 별칭 @font-face 주입.
// ⚠ 한글 미리보기(rhwp)는 hwpx가 선언한 폰트 이름("나눔고딕")을 CSS font-family 스택 맨
// 앞에 넣어 SVG를 그린다. 그런데 브라우저에 로드된 웹폰트 family는 "Nanum Gothic"(영문)이라
// 이름이 안 맞아 맑은 고딕으로 폴백된다(미리보기가 맑은고딕으로 보이던 원인). webFamily의
// @font-face src를 긁어 hwpxName 이름으로 복제하면, 미리보기도 진짜 나눔고딕으로 렌더된다.
// (rhwp 조판=줄바꿈은 rhwp 내부 metric이 결정하므로 이 별칭은 "보이는 폰트"만 바로잡는다.)
const aliasedHwpx = new Set<string>();
function injectHwpxAlias(def: FontDef): void {
  if (typeof document === "undefined") return;
  const alias = def.hwpxName;
  if (!alias || alias === def.webFamily || aliasedHwpx.has(alias)) return;
  const faces: { weight: string; style: string; src: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 교차 출처 시트는 접근 불가 — 건너뜀
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      // CSSFontFaceRule.type === 5
      if ((rule as CSSRule).type !== 5) continue;
      const style = (rule as CSSFontFaceRule).style;
      const fam = style.getPropertyValue("font-family").replace(/^['"]|['"]$/g, "").trim();
      if (fam !== def.webFamily) continue;
      const src = style.getPropertyValue("src");
      if (src) faces.push({ weight: style.getPropertyValue("font-weight") || "400", style: style.getPropertyValue("font-style") || "normal", src });
    }
  }
  if (!faces.length) return; // 아직 CSS 미로드 — aliasedHwpx에 안 넣어 다음 호출에 재시도
  aliasedHwpx.add(alias);
  const css = faces
    .map((f) => `@font-face{font-family:"${alias}";font-weight:${f.weight};font-style:${f.style};font-display:swap;src:${f.src};}`)
    .join("");
  const el = document.createElement("style");
  el.dataset.hwpxAlias = alias;
  el.textContent = css;
  document.head.appendChild(el);
}

// 폰트 준비(로드 + 캘리브레이션). 여러 번 불러도 안전(멱등).
export async function ensureFont(key: string): Promise<void> {
  const def = fontByKey(key);
  const st = useFontStore.getState();
  if (st.loading[def.key]) return;
  st.setLoading(def.key, true);
  try {
    injectLocalFace(def); // 로컬 반입 폰트면 @font-face 주입
    await def.load?.(); // fontsource 폰트면 CSS 지연 로딩
    if (typeof document !== "undefined" && document.fonts?.load) {
      await document.fonts.load(`16px "${def.webFamily}"`, SAMPLE);
      if (def.weights.includes(700)) await document.fonts.load(`700 16px "${def.webFamily}"`, SAMPLE);
    }
    injectHwpxAlias(def); // hwpxName → webFamily 별칭 (한글 미리보기 폰트 정합)
    if (typeof document !== "undefined" && document.fonts?.load && def.hwpxName !== def.webFamily) {
      try {
        await document.fonts.load(`16px "${def.hwpxName}"`, SAMPLE);
      } catch {
        // 별칭 로드 실패는 치명적 아님 — 폴백 렌더
      }
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

// ── 전각(1em) 취급 문자 판별 — 한글 음절 + 호환 자모 ──
// HWP/rhwp 조판은 "한글"만 전각 고정폭으로 계산하고, 숫자·라틴은 폰트 자연폭(반각)으로
// 흘린다(rhwp 실측: measureTextWidth 콜백 없이 자체 조판 — 자모는 화면과 정확 일치,
// 숫자는 보정 걸면 74 vs 82자/줄로 어긋남). 따라서 전각 보정 letter-spacing은 이
// 문자들에만 걸어야 화면 줄바꿈 = 한글 줄바꿈 정합이 유지된다.
const HANGUL_CHAR = /[가-힣㄰-㆏]/; // 음절 가-힣 + 호환 자모 ㄱ-ㆎ

// 텍스트를 한글/비한글 구간으로 쪼갠다 — 화면 렌더가 비한글 구간에 letter-spacing:0을 건다
export function splitByHangul(text: string): { text: string; hangul: boolean }[] {
  const out: { text: string; hangul: boolean }[] = [];
  for (const ch of text) {
    const h = HANGUL_CHAR.test(ch);
    const last = out[out.length - 1];
    if (last && last.hangul === h) last.text += ch;
    else out.push({ text: ch, hangul: h });
  }
  return out;
}

// 전각 보정 대상(한글) 글자 수 — canvas 폭 측정에서 letter-spacing 합산용
export function countHangul(text: string): number {
  let n = 0;
  for (const ch of text) if (HANGUL_CHAR.test(ch)) n++;
  return n;
}
