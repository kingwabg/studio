// design-icons.tsx — 클로드 디자인 핸드오프(assets/icons) 43종.
// 전부 24×24·fill=none·stroke=currentColor·1.6 두께 공통이라, 내부 마크업만 맵으로 관리하고
// 공통 래퍼로 감싼다. 원본 path를 그대로 담아 디자인과 픽셀 일치 + currentColor로 테마 대응.
// (kebab-case 속성은 raw SVG 마크업이라 dangerouslySetInnerHTML로 그대로 렌더된다.)
import { type CSSProperties } from "react";

const ICONS = {
  "account": `<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="9.8" r="2.8"></circle><path d="M6.8 18.2a5.6 5.6 0 0 1 10.4 0"></path>`,
  "align-center": `<path d="M4 5.5h16M7 10h10M6 14.5h12M8 19h8"></path>`,
  "align-left": `<path d="M4 5.5h16M4 10h10M4 14.5h13M4 19h8"></path>`,
  "align-right": `<path d="M4 5.5h16M10 10h10M7 14.5h13M12 19h8"></path>`,
  "approval-line": `<rect x="3.5" y="6" width="17" height="12" rx="1.5"></rect><path d="M9 6v12M15 6v12M3.5 9.5h17"></path>`,
  "arrow": `<path d="M4 12h13M12 6.5l5.5 5.5-5.5 5.5"></path>`,
  "attachment": `<path d="M16.5 8.5v7.5a4.5 4.5 0 0 1-9 0V7a2.8 2.8 0 0 1 5.6 0v8.5a1.2 1.2 0 0 1-2.4 0V8.5"></path>`,
  "banner": `<rect x="3" y="8" width="18" height="8" rx="1"></rect><path d="M6.5 12h11"></path>`,
  "bold": `<path d="M7 5h6a3.4 3.4 0 0 1 0 6.8H7zM7 11.8h7a3.5 3.5 0 0 1 0 7H7zM7 5v13.8"></path>`,
  "border-all": `<path d="M4 4h16v16H4Z"></path><path d="M4 12h16M12 4v16"></path>`,
  "brand-logo": `<rect x="3" y="3" width="18" height="18" rx="5"></rect><path d="M8.5 8.5h4l3 3v4H8.5z"></path><path d="M12.5 8.5v3h3"></path>`,
  "caption": `<rect x="4" y="4" width="16" height="9" rx="1.5"></rect><path d="M6.5 16.5h11M8.5 19.5h7"></path>`,
  "cell-merge": `<rect x="3.5" y="6" width="17" height="12" rx="1.5"></rect><path d="M12 6.5v11" stroke-dasharray="1.8 2"></path><path d="M5.5 12h4M7.6 9.9 9.7 12 7.6 14.1"></path><path d="M18.5 12h-4M16.4 9.9 14.3 12 16.4 14.1"></path>`,
  "cell-split": `<rect x="4" y="6" width="16" height="12" rx="1.5"></rect><path d="M12 6.5v11M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5"></path>`,
  "col-add": `<rect x="4" y="4" width="16" height="10.5" rx="1.5"></rect><path d="M12 4v10.5"></path><path d="M12 17v4M10 19h4"></path>`,
  "date": `<rect x="3.5" y="5" width="17" height="15" rx="2"></rect><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8.5 13.3h.01M12 13.3h.01M15.5 13.3h.01"></path>`,
  "duplicate": `<rect x="4" y="4" width="13" height="13" rx="2"></rect><rect x="7.5" y="7.5" width="13" height="13" rx="2"></rect>`,
  "flatten": `<path d="M4 5v6M2.5 9 4 11 5.5 9"></path><path d="M9 6.5h11M9 12h11M9 17.5h11"></path>`,
  "group": `<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"></rect><rect x="6.5" y="6.5" width="4.5" height="4.5" rx="1"></rect><rect x="13" y="13" width="4.5" height="4.5" rx="1"></rect>`,
  "highlight": `<path d="M5 6.5h14"></path><path d="M5 12h11" stroke-width="6.5" stroke-linecap="round" opacity="0.28"></path><path d="M5 12h11"></path><path d="M5 17.5h9"></path>`,
  "highlighter": `<path d="M8.5 14.5l6-6 3 3-6 6H8.5z"></path><path d="M6 20h10M8.5 17.5l-2 2"></path>`,
  "italic": `<path d="M10 5h7M7 19h7M14.5 5L9.5 19"></path>`,
  "label": `<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"></path><circle cx="7.4" cy="7.4" r="1.15" fill="currentColor"></circle>`,
  "line-height": `<path d="M8 6.5h12M8 12h12M8 17.5h12"></path><path d="M4 6.5v11M2.5 8L4 6.5 5.5 8M2.5 16L4 17.5 5.5 16"></path>`,
  "list-bullet": `<path d="M9 6.5h11M9 12h11M9 17.5h11"></path><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.4"></path>`,
  "list-number": `<path d="M9 5.5h11M9 12h11M9 18.5h11"></path><path d="M3.6 4l1-.7v3.8M3.3 7.8h2.4"></path><path d="M3.4 10.6a1.15 1.15 0 0 1 2 .8c0 1.1-2 1.6-2 2.9h2.3"></path><path d="M3.5 16.9h2.1l-1.2 1.4a1.2 1.2 0 1 1-1 1.8"></path>`,
  "lock": `<rect x="5" y="10" width="14" height="9.5" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v2.5"></path>`,
  "notice": `<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><path d="M12 8.5v4M12 15.5h.01"></path>`,
  "page-number": `<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8.5 8h7M8.5 11.5h5"></path><path d="M11.2 15.5l1-.7v4.2M10.4 19.7h3.2"></path>`,
  "photo-frame": `<rect x="4.5" y="4.5" width="15" height="15" rx="2"></rect><circle cx="9" cy="9.3" r="1.4"></circle><path d="M6 17.5l4-3.5 2.5 2 3.5-3.5 2.5 2.5"></path>`,
  "row-add": `<rect x="4" y="4" width="16" height="10.5" rx="1.5"></rect><path d="M4 9.25h16"></path><path d="M12 17v4M10 19h4"></path>`,
  "settings": `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>`,
  "signature": `<path d="M4.5 15.5c1.6-6 3-6.1 3.7-1.4s1.4 2.7 2.4-1.5 1.7-1.1 2.4.9 1.5 1.4 3.1-1.6"></path><path d="M13.8 12.2c1.6 1.1 2.9 1.6 4.7 1.1"></path><path d="M4 19.5h16"></path>`,
  "snap-guides": `<path d="M12 2.5v19" stroke-dasharray="2.2 2.2"></path><rect x="5" y="5" width="7" height="5" rx="1"></rect><rect x="12" y="14" width="7" height="5" rx="1"></rect>`,
  "speech": `<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.2V16H5.5A1.5 1.5 0 0 1 4 14.5z"></path>`,
  "star": `<path d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.5l-5.1 2.7.98-5.68L3.75 9.5l5.7-.83z"></path>`,
  "strikethrough": `<path d="M16.5 7.5a4.3 4.3 0 0 0-3.8-2.5c-2.2 0-3.9 1.2-3.9 3 0 1.6 1.2 2.4 3 3M7.8 16.2a4.4 4.4 0 0 0 3.9 2.3c2.3 0 4-1.2 4-3.1 0-1-.4-1.7-1.1-2.2"></path><path d="M4 12h16"></path>`,
  "subtitle": `<path d="M4 6.5h8M8 6.5v11"></path><path d="M13.5 10.5h5M16.5 7.8v6.9a1.6 1.6 0 0 0 1.7 1.6"></path>`,
  "table-form": `<rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M9 5v14M3.5 9.7h17M3.5 14.3h17"></path>`,
  "table-list": `<rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M3.5 9.7h17M3.5 14.3h17"></path>`,
  "text-color": `<path d="M6.5 15l4-10 4 10M8 11.5h5"></path><path d="M5 19.5h14" stroke-width="2.6"></path>`,
  "title": `<path d="M5 7h14M12 7v11"></path>`,
  "underline": `<path d="M7 4.5v6.5a5 5 0 0 0 10 0V4.5M5 20h14"></path>`,
} as const;

export type DsIconName = keyof typeof ICONS;

export function DsIcon({
  name,
  size = 16,
  className,
  style,
}: {
  name: DsIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
