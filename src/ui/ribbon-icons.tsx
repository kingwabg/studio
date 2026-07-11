// ribbon-icons.tsx — 한글(HWP) 리본 헤더 전용 아이콘 18종.
// design-icons.tsx와 같은 규약: 24×24·fill=none·stroke=currentColor·1.6 두께, 내부 마크업만
// 맵으로 관리. 기존 design-icons에 있는 것(그림=photo-frame, 표=table-form, 격자=snap-guides,
// 복사=duplicate, 개체속성=settings 등)은 재선언하지 않고 그쪽을 쓴다 — 중복 금지.
import { type CSSProperties } from "react";

const ICONS = {
  // 파일/편집
  "save": `<path d="M5 4h11l3 3v13H5z"></path><path d="M8 4v5h7V4M8 20v-6h8v6"></path>`,
  "cut": `<circle cx="6.5" cy="17.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle><path d="M8.6 15.7 18 4M15.4 15.7 6 4"></path>`,
  "paste": `<rect x="5" y="5" width="14" height="16" rx="2"></rect><path d="M9 5a3 3 0 0 1 6 0"></path><path d="M9 12h6M9 15.5h4.5"></path>`,
  "format-brush": `<path d="M5 4h11v4.5H5z"></path><path d="M16 6.5h3.5v4H11v2.5"></path><rect x="9.5" y="13" width="3" height="7" rx="1"></rect>`,
  "find": `<circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5 5"></path>`,
  // 입력(개체)
  "shape": `<circle cx="9" cy="9" r="5"></circle><rect x="10.5" y="10.5" width="9.5" height="9.5" rx="1.5"></rect>`,
  "chart": `<path d="M4 20h16"></path><rect x="6" y="11" width="3.2" height="9" rx="0.8"></rect><rect x="11" y="6" width="3.2" height="14" rx="0.8"></rect><rect x="16" y="14" width="3.2" height="6" rx="0.8"></rect>`,
  "video": `<rect x="3.5" y="5" width="17" height="14" rx="2.5"></rect><path d="M10.2 9.2l4.6 2.8-4.6 2.8z"></path>`,
  "footnote": `<rect x="4.5" y="3.5" width="15" height="17" rx="2"></rect><path d="M8 8h8M8 11.5h6"></path><path d="M7.5 16.5h9" stroke-dasharray="1.6 1.8"></path><path d="M15.3 18.8h.01" stroke-width="2.2"></path>`,
  "endnote": `<rect x="4.5" y="3.5" width="15" height="17" rx="2"></rect><path d="M8 7.5h8M8 11h8"></path><path d="M8 17.8h3.4" ></path><path d="M14.5 16.5l3 2.6M17.5 16.5l-3 2.6"></path>`,
  "hyperlink": `<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3"></path><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3"></path>`,
  "charmap": `<path d="M12 4.5v15M4.5 12h15"></path><path d="M7 7l10 10M17 7 7 17" opacity="0.45"></path><circle cx="12" cy="12" r="2.6"></circle>`,
  // 서식
  "char-shape": `<path d="M5.5 17.5 10 6l4.5 11.5M7.2 13.5h5.6"></path><path d="M16 14.5h4.5M16 17.5h4.5M16 20.5h4.5" stroke-width="1.4"></path>`,
  "para-shape": `<path d="M18.5 4.5v15M14.5 4.5v15"></path><path d="M18.5 4.5h-7a4 4 0 0 0 0 8h3"></path>`,
  // 쪽/보기
  "header-mark": `<rect x="4.5" y="3.5" width="15" height="17" rx="2"></rect><path d="M7.5 7.2h9" stroke-width="2.2"></path><path d="M7.5 11.5h9M7.5 14.5h6" opacity="0.45"></path>`,
  "footer-mark": `<rect x="4.5" y="3.5" width="15" height="17" rx="2"></rect><path d="M7.5 16.8h9" stroke-width="2.2"></path><path d="M7.5 9.5h9M7.5 12.5h6" opacity="0.45"></path>`,
  "control-code": `<path d="M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5"></path>`,
  "para-mark": `<path d="M17 4.5v15M13 4.5v15"></path><path d="M17 4.5h-6.5a4 4 0 0 0 0 8H13"></path><path d="M6 19.5h8" opacity="0.45"></path>`,
  // 안심글꼴 (방패 + 체크) — 우리 셀링포인트
  "safe-font": `<path d="M12 3.5 19 6v6.2c0 4.3-3 7.3-7 8.3-4-1-7-4-7-8.3V6z"></path><path d="M9 12.2l2.1 2.1L15.2 10"></path>`,
  "preview": `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="3"></circle>`,
} as const;

export type RbIconName = keyof typeof ICONS;

export function RbIcon({
  name,
  size = 22,
  className,
  style,
}: {
  name: RbIconName;
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
