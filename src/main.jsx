import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import StudioEmbed from "./routes/StudioEmbed.tsx";
import StudioRhwp from "./routes/StudioRhwp.tsx";
import { StudioTheme } from "./routes/StudioTheme.tsx";
// 지면(문서) 폰트 — 나눔고딕 OFL 웹폰트 self-host (임베드 에디터 기본 폰트, 전 OS 동일 렌더).
import "@fontsource/nanum-gothic/korean-400.css";
import "@fontsource/nanum-gothic/korean-700.css";
import "@fontsource/nanum-gothic/korean-800.css";
import "./styles.css";
import "./tailwind.css";

// 레거시(DocumentStudio · /studio 모듈형 캔버스) 제거 후 (2026-07-13):
// 제품 에디터 = rhwp-studio(7700, 별도 앱). 이 5173 앱 = 판매용 임베드 에디터 전용 사이트.
// HWPX 내보내기 코어(src/hwpx/)는 자산으로 보존(임베드 에디터가 내보내기에 사용).
const router = createBrowserRouter([
  // 루트 = 판매용 임베드 에디터 제품 페이지
  { path: "/", element: <StudioTheme><StudioEmbed /></StudioTheme> },
  { path: "/studio/embed", element: <StudioTheme><StudioEmbed /></StudioTheme> },
  // rhwp 에디터 임베드(@rhwp/editor 공식 iframe) — 제품 미리보기용
  { path: "/studio/rhwp", element: <StudioTheme><StudioRhwp /></StudioTheme> },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
