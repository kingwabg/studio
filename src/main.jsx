import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import DocumentStudio from "./DocumentStudio.jsx";
import StudioHome from "./routes/StudioHome.tsx";
import StudioEditor from "./routes/StudioEditor.tsx";
import { StudioTheme } from "./routes/StudioTheme.tsx";
import "./styles.css";
import "./tailwind.css";

// 라우팅 분리 — 기존 앱은 "/"에서 그대로(무손상), 새 모듈형 캔버스는 "/studio"에 신설.
// Strangler Fig: 두 표면이 공존하며 src/hwpx/ 코어를 공유하고, 준비되면 기능을 이관한다.
// /studio만 Radix Themes(StudioTheme)로 감싸 UI 품질을 올린다 — 기존 앱은 밖이라 무손상.
const router = createBrowserRouter([
  { path: "/", element: <DocumentStudio /> },
  { path: "/studio", element: <StudioTheme><StudioHome /></StudioTheme> },
  { path: "/studio/editor/:id", element: <StudioTheme><StudioEditor /></StudioTheme> },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
