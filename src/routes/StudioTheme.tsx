// StudioTheme.tsx — /studio 라우트를 Radix Themes + 스튜디오 토큰으로 감싼다.
// Radix Themes CSS는 .radix-themes 클래스 아래로 스코프되므로, 이 래퍼 밖의 기존 앱(/)
// 은 전혀 영향받지 않는다 (preflight 없이 격리 — 두 편집기 공존 원칙 유지).
//
// 다크 모드: useThemeStore.dark → Radix appearance + .studio-root.dark(CSS 변수 오버라이드).
// .studio-root는 여기(래퍼) 한 곳에만 둔다 — 하위에서 또 선언하면 라이트 변수가
// 다크 오버라이드를 되덮는다.
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { type ReactNode } from "react";
import { useThemeStore } from "../modules/ui/theme";

// 문서 폰트 스택 — Radix의 --default-font-family를 Pretendard로 덮어 앱 톤 통일
const FONT =
  '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export function StudioTheme({ children }: { children: ReactNode }) {
  const dark = useThemeStore((s) => s.dark);
  return (
    <Theme
      accentColor="indigo"
      grayColor="slate"
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
