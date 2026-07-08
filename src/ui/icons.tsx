// icons.tsx — 새 스튜디오용 라인 아이콘. 기존 앱과 같은 1.5px 스트로크·currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const Svg = ({ size = 16, children, ...p }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {children}
  </svg>
);

export const IcText = (p: P) => (
  <Svg {...p}>
    <path d="M5 6h14M12 6v13M9 19h6" />
  </Svg>
);
export const IcTable = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M3.5 15h17M9 4.5v15" />
  </Svg>
);
export const IcImage = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M20 15l-4.5-4L6 19" />
  </Svg>
);
export const IcDatabase = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="2.8" />
    <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
  </Svg>
);
export const IcUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V4M8 8l4-4 4 4M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Svg>
);
export const IcDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M8 11l4 4 4-4M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Svg>
);
export const IcSparkles = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
    <path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </Svg>
);
export const IcChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="M14 6l-6 6 6 6" />
  </Svg>
);
export const IcChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="M10 6l6 6-6 6" />
  </Svg>
);
export const IcTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
  </Svg>
);
export const IcPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IcBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const IcGrip = (p: P) => (
  <Svg {...p} strokeWidth={0} fill="currentColor" stroke="none">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </Svg>
);
export const IcFile = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h8l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3H6zM14 3v5h5" />
  </Svg>
);
export const IcLogo = (p: P) => (
  <Svg {...p} strokeWidth={0} fill="currentColor" stroke="none">
    <rect x="3" y="3" width="18" height="18" rx="5" />
  </Svg>
);
export const IcUndo = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 9h9a5 5 0 0 1 0 10H8M4.5 9l4-4M4.5 9l4 4" />
  </Svg>
);
export const IcRedo = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 9h-9a5 5 0 0 0 0 10H16M19.5 9l-4-4M19.5 9l-4 4" />
  </Svg>
);
export const IcCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </Svg>
);
export const IcEye = (p: P) => (
  <Svg {...p}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);
export const IcClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
