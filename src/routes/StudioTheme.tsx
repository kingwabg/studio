// StudioTheme.tsx — /studio 라우트를 Radix Themes로 감싼다.
// Radix Themes CSS는 .radix-themes 클래스 아래로 스코프되므로, 이 래퍼 밖의 기존 앱(/)
// 은 전혀 영향받지 않는다 (preflight 없이 격리 — 두 편집기 공존 원칙 유지).
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { type ReactNode } from "react";

// 문서 폰트 스택 — Radix의 --default-font-family를 Pretendard로 덮어 앱 톤 통일
const FONT =
  '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export function StudioTheme({ children }: { children: ReactNode }) {
  return (
    <Theme
      accentColor="indigo"
      grayColor="slate"
      radius="large"
      scaling="100%"
      appearance="light"
      style={{ ["--default-font-family" as string]: FONT, minHeight: "100dvh" }}
    >
      {children}
    </Theme>
  );
}
