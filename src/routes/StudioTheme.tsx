// StudioTheme.tsx — /studio 라우트를 Radix Themes + 스튜디오 토큰으로 감싼다.
// Radix Themes CSS는 .radix-themes 클래스 아래로 스코프되므로, 이 래퍼 밖의 기존 앱(/)
// 은 전혀 영향받지 않는다 (preflight 없이 격리 — 두 편집기 공존 원칙 유지).
//
// 다크 모드: useThemeStore.dark → Radix appearance + .studio-root.dark(CSS 변수 오버라이드).
// .studio-root는 여기(래퍼) 한 곳에만 둔다 — 하위에서 또 선언하면 라이트 변수가
// 다크 오버라이드를 되덮는다.
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import { type ReactNode } from "react";
import { useThemeStore } from "../modules/ui/theme";

// 편집기 크롬은 읽기 좋은 IBM Plex Sans KR, A4 지면은 별도 문서 폰트를 유지한다.
const FONT =
  '"IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export function StudioTheme({ children }: { children: ReactNode }) {
  const dark = useThemeStore((s) => s.dark);
  return (
    <Theme
      accentColor="blue"
      grayColor="sand"
      radius="large"
      scaling="100%"
      appearance={dark ? "dark" : "light"}
      className={`studio-root${dark ? " dark" : ""}`}
      style={{ ["--default-font-family" as string]: FONT, minHeight: "100dvh" }}
    >
      {children}
    </Theme>
  );
}
