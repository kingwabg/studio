import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import DocumentStudio from "./DocumentStudio.jsx";
import StudioHome from "./routes/StudioHome.tsx";
import StudioEditor from "./routes/StudioEditor.tsx";
import StudioEmbed from "./routes/StudioEmbed.tsx";
import { StudioTheme } from "./routes/StudioTheme.tsx";
// 지면(문서) 폰트 — 나눔고딕 OFL 웹폰트 self-host (저작권 안전 + 전 OS 동일 렌더).
// 맑은 고딕(MS 상용·윈도우 전용)을 대체: 한글 전각(1em)이라 줄바꿈 정합 유지, 웹 배포 합법.
import "@fontsource/nanum-gothic/korean-400.css";
import "@fontsource/nanum-gothic/korean-700.css";
import "@fontsource/nanum-gothic/korean-800.css";
import "./styles.css";
import "./tailwind.css";

// 라우팅 분리 — 기존 앱은 "/"에서 그대로(무손상), 새 모듈형 캔버스는 "/studio"에 신설.
// Strangler Fig: 두 표면이 공존하며 src/hwpx/ 코어를 공유하고, 준비되면 기능을 이관한다.
// /studio만 Radix Themes(StudioTheme)로 감싸 UI 품질을 올린다 — 기존 앱은 밖이라 무손상.
const router = createBrowserRouter([
  { path: "/", element: <DocumentStudio /> },
  { path: "/studio", element: <StudioTheme><StudioHome /></StudioTheme> },
  { path: "/studio/editor/:id", element: <StudioTheme><StudioEditor /></StudioTheme> },
  // 판매용 임베드 에디터 제품 페이지 (홈 "에디터" 탭)
  { path: "/studio/embed", element: <StudioTheme><StudioEmbed /></StudioTheme> },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
