// LeftPanel.tsx — 좌측 패널: [블록] 팔레트 + 레이어 / [데이터] 병합 데이터 연동.
// 데이터 탭: 엑셀·CSV 업로드 → 열 이름이 "알약"이 되고, 지면의 텍스트/셀에 끌어다
// 놓으면 {{열이름}} 토큰이 박힌다. 미리보기 스테퍼로 레코드를 넘겨보고 일괄 생성.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block, type BlockType, descendantIds } from "../../modules/document/model";
import { useRightTabStore, usePanelStore } from "../../modules/ui/theme";
import { useCanvasStore } from "../../modules/canvas/store";
import { useMergeStore } from "../../modules/merge/store";
import { parseSheetFile } from "../../modules/merge/parseSheet";
import { resolveDoc, usedTokens } from "../../modules/merge/resolve";
import {
  buildHwpxBytes,
  buildHwpxBytesMultiPage,
  downloadBytes,
} from "../../modules/document/exportHwpx";
import {
  IcText,
  IcTable,
  IcImage,
  IcFile,
  IcUpload,
  IcDownload,
  IcChevronLeft,
  IcChevronRight,
  IcSparkles,
  IcSearch,
} from "../../ui/icons";

// Canva식 객체 팔레트 — 현재 문서 모델(text/table/image)을 유지하면서 클릭/드래그 추가를 지원한다.
type ObjectPreset = {
  id: string;
  type: BlockType;
  label: string;
  icon: ReactNode;
  tint: string;
  tone: string;
  flow?: boolean;
  description?: string;
  detailGroup?: "basic" | "accent" | "document";
  extra?: Partial<Block>;
};

type ObjectCategory = { id: string; title: string; presets: ObjectPreset[] };

const TEXT_BOX: Partial<Block> = {
  manualW: true,
  fill: "#ffffff",
  borderColor: "#98A4BD",
  borderWidth: 1,
  radius: 2,
  color: "#000000",
};

const OBJECT_CATEGORIES: ObjectCategory[] = [
  {
    id: "text",
    title: "텍스트",
    presets: [
      {
        id: "plain-text",
        type: "text",
        label: "텍스트",
        description: "가장 기본 텍스트 박스",
        detailGroup: "basic",
        icon: <IcText size={17} />,
        tint: "var(--accentsoft)",
        tone: "var(--accenttext)",
        extra: { ...TEXT_BOX, text: "텍스트를 입력하세요", w: 44, fontSize: 10.5 },
      },
      {
        id: "title-text",
        type: "text",
        label: "제목",
        description: "큰 제목용",
        detailGroup: "basic",
        icon: <span className="text-[18px] font-black">T</span>,
        tint: "#EEF2FF",
        tone: "#2B5CE6",
        extra: { ...TEXT_BOX, text: "제목을 입력하세요", w: 72, fontSize: 20, bold: true, borderWidth: 0 },
      },
      {
        id: "subtitle-text",
        type: "text",
        label: "부제목",
        description: "제목 아래 설명 문구",
        detailGroup: "basic",
        icon: <span className="text-[15px] font-black">Tt</span>,
        tint: "#E0F2FE",
        tone: "#0369A1",
        extra: { ...TEXT_BOX, text: "부제목을 입력하세요", w: 86, fontSize: 13, bold: true, color: "#334155", borderWidth: 0 },
      },
      {
        id: "body-flow",
        type: "text",
        label: "본문",
        description: "공문 본문처럼 길게 쓰는 문단",
        detailGroup: "basic",
        icon: <IcFile size={17} />,
        flow: true,
        tint: "var(--cat-orange-soft)",
        tone: "var(--cat-orange)",
        extra: { flow: true, text: "본문을 입력하세요. 한글에서 이어 쓸 수 있는 진짜 문단으로 내보내집니다.", w: 170, manualW: true, borderWidth: 0 },
      },
      {
        id: "label-chip",
        type: "text",
        label: "라벨",
        description: "짧은 분류 태그",
        detailGroup: "basic",
        icon: <span className="text-[12px] font-black">Aa</span>,
        tint: "#F1F5F9",
        tone: "#334155",
        extra: { text: "라벨", w: 24, fontSize: 9, bold: true, align: "center", manualW: true, fill: "#F8FAFC", borderColor: "#CBD5E1", borderWidth: 1, radius: 999, padX: 1.6, padY: 0.8 },
      },
      {
        id: "caption-text",
        type: "text",
        label: "캡션",
        description: "작은 설명 문구",
        detailGroup: "basic",
        icon: <span className="text-[13px] font-bold">cap</span>,
        tint: "#F8FAFC",
        tone: "#64748B",
        extra: { text: "작은 설명", w: 44, fontSize: 8.5, color: "#64748B", manualW: true, borderWidth: 0, fill: "#ffffff" },
      },
      {
        id: "notice-box",
        type: "text",
        label: "안내문",
        description: "주의·안내 박스",
        detailGroup: "accent",
        icon: <span className="text-[15px] font-black">!</span>,
        tint: "#FFF7ED",
        tone: "#C2410C",
        extra: { text: "안내 문구를 입력하세요", w: 82, fontSize: 10, manualW: true, fill: "#FFF7ED", borderColor: "#FDBA74", borderWidth: 1, radius: 8, padX: 2.2, padY: 1.4 },
      },
      {
        id: "highlight-text",
        type: "text",
        label: "강조 문구",
        description: "형광펜 느낌의 강조선",
        detailGroup: "accent",
        icon: <span className="text-[15px] font-black">강</span>,
        tint: "#FEF9C3",
        tone: "#A16207",
        extra: { text: "중요한 문구", w: 58, fontSize: 11, bold: true, italic: true, manualW: true, fill: "#FEF08A", borderColor: "#FACC15", borderWidth: 1, radius: 3, padX: 1.4, padY: 0.6 },
      },
      {
        id: "speech-text",
        type: "text",
        label: "말풍선",
        description: "코멘트나 메모용",
        detailGroup: "accent",
        icon: <span className="text-[15px] font-black">말</span>,
        tint: "#F3E8FF",
        tone: "#7E22CE",
        extra: { text: "메모를 입력하세요", w: 70, fontSize: 10, manualW: true, fill: "#FAF5FF", borderColor: "#C084FC", borderWidth: 1, radius: 12, padX: 2.4, padY: 1.6 },
      },
      {
        id: "signature-text",
        type: "text",
        label: "서명",
        description: "서명·확인란",
        detailGroup: "document",
        icon: <span className="text-[15px] font-black">서</span>,
        tint: "#E0E7FF",
        tone: "#4F46E5",
        extra: { text: "서명", w: 34, fontSize: 10, align: "center", manualW: true, fill: "#ffffff", borderColor: "#A5B4FC", borderWidth: 1, radius: 7, padX: 2, padY: 1.2 },
      },
      {
        id: "date-text",
        type: "text",
        label: "날짜",
        description: "날짜 입력용",
        detailGroup: "document",
        icon: <span className="text-[15px] font-black">날</span>,
        tint: "#FFEDD5",
        tone: "#EA580C",
        extra: { text: "2026.  .  .", w: 36, fontSize: 9.5, align: "center", manualW: true, fill: "#ffffff", borderColor: "#FED7AA", borderWidth: 1, radius: 6, padX: 1.5, padY: 1 },
      },
      {
        id: "page-number-text",
        type: "text",
        label: "쪽 번호",
        description: "문서 하단 페이지 번호",
        detailGroup: "document",
        icon: <span className="text-[13px] font-black">쪽</span>,
        tint: "#DCFCE7",
        tone: "#16A34A",
        extra: { text: "- 1 -", w: 24, fontSize: 9, align: "center", manualW: true, fill: "#ffffff", borderWidth: 0, padX: 1, padY: 0.8 },
      },
    ],
  },
  {
    id: "shape",
    title: "도형",
    presets: [
      {
        id: "shape-rect",
        type: "text",
        label: "사각형",
        icon: <span className="block w-6 h-5 bg-current rounded-sm" />,
        tint: "#F1F5F9",
        tone: "#111827",
        extra: { text: " ", w: 34, manualW: true, fill: "#111827", borderWidth: 0, radius: 0, padX: 0, padY: 2.8 },
      },
      {
        id: "shape-round",
        type: "text",
        label: "둥근박스",
        icon: <span className="block w-7 h-5 bg-current rounded-lg" />,
        tint: "#E0F2FE",
        tone: "#0284C7",
        extra: { text: " ", w: 38, manualW: true, fill: "#BAE6FD", borderColor: "#38BDF8", borderWidth: 1, radius: 10, padX: 0, padY: 2.8 },
      },
      {
        id: "shape-pill",
        type: "text",
        label: "캡슐",
        icon: <span className="block w-8 h-4 bg-current rounded-full" />,
        tint: "#DCFCE7",
        tone: "#16A34A",
        extra: { text: " ", w: 42, manualW: true, fill: "#BBF7D0", borderColor: "#22C55E", borderWidth: 1, radius: 999, padX: 0, padY: 2.2 },
      },
      {
        id: "shape-line",
        type: "text",
        label: "라인",
        icon: <span className="block w-9 h-[2px] bg-current" />,
        tint: "#F8FAFC",
        tone: "#0F172A",
        extra: { text: " ", w: 48, manualW: true, fill: "#0F172A", borderWidth: 0, radius: 999, padX: 0, padY: 0.2 },
      },
      {
        id: "shape-arrow",
        type: "text",
        label: "화살표",
        icon: <span className="text-[22px] leading-none">→</span>,
        tint: "#FEE2E2",
        tone: "#DC2626",
        extra: { text: "→", w: 20, fontSize: 24, bold: true, align: "center", manualW: true, fill: "#ffffff", borderWidth: 0, padX: 0, padY: 0 },
      },
      {
        id: "shape-star",
        type: "text",
        label: "별",
        icon: <span className="text-[20px] leading-none">★</span>,
        tint: "#FEF3C7",
        tone: "#D97706",
        extra: { text: "★", w: 18, fontSize: 24, bold: true, align: "center", color: "#F59E0B", manualW: true, fill: "#ffffff", borderWidth: 0, padX: 0, padY: 0 },
      },
    ],
  },
  {
    id: "document",
    title: "문서 요소",
    presets: [
      {
        id: "approval",
        type: "text",
        label: "결재선",
        icon: <span className="text-[13px] font-black">결</span>,
        tint: "var(--cat-red-soft)",
        tone: "var(--cat-red)",
        extra: { text: "담당  검토  승인", w: 62, fontSize: 9, align: "center", manualW: true, fill: "#ffffff", borderColor: "#CBD5E1", borderWidth: 1, radius: 2, padX: 1.5, padY: 1 },
      },
      {
        id: "signature",
        type: "text",
        label: "서명",
        icon: <span className="text-[15px] font-black">서</span>,
        tint: "#E0E7FF",
        tone: "#4F46E5",
        extra: { text: "서명", w: 34, fontSize: 10, align: "center", manualW: true, fill: "#ffffff", borderColor: "#A5B4FC", borderWidth: 1, radius: 7, padX: 2, padY: 1.2 },
      },
      {
        id: "date",
        type: "text",
        label: "날짜",
        icon: <span className="text-[15px] font-black">날</span>,
        tint: "#FFEDD5",
        tone: "#EA580C",
        extra: { text: "2026.  .  .", w: 36, fontSize: 9.5, align: "center", manualW: true, fill: "#ffffff", borderColor: "#FED7AA", borderWidth: 1, radius: 6, padX: 1.5, padY: 1 },
      },
      {
        id: "page-number",
        type: "text",
        label: "쪽 번호",
        icon: <span className="text-[13px] font-black">쪽</span>,
        tint: "#DCFCE7",
        tone: "#16A34A",
        extra: { text: "- 1 -", w: 24, fontSize: 9, align: "center", manualW: true, fill: "#ffffff", borderWidth: 0, padX: 1, padY: 0.8 },
      },
      {
        id: "attachment",
        type: "text",
        label: "붙임",
        icon: <span className="text-[13px] font-black">붙</span>,
        tint: "#F3E8FF",
        tone: "#9333EA",
        extra: { text: "붙임  ", w: 42, fontSize: 10, manualW: true, fill: "#ffffff", borderColor: "#D8B4FE", borderWidth: 1, radius: 4, padX: 2, padY: 1.2 },
      },
    ],
  },
  {
    id: "table",
    title: "표",
    presets: [
      { id: "table-basic", type: "table", label: "기본 표", icon: <IcTable size={17} />, tint: "var(--cat-green-soft)", tone: "var(--cat-green)" },
      { id: "table-list", type: "table", label: "목록 표", icon: <span className="text-[14px] font-black">☷</span>, tint: "#ECFDF5", tone: "#059669" },
      { id: "table-form", type: "table", label: "양식 표", icon: <span className="text-[14px] font-black">▦</span>, tint: "#F0FDFA", tone: "#0D9488" },
    ],
  },
  {
    id: "media",
    title: "미디어",
    presets: [
      { id: "image", type: "image", label: "이미지", icon: <IcImage size={17} />, tint: "var(--cat-purple-soft)", tone: "var(--cat-purple)", extra: { w: 54, h: 34 } },
      { id: "photo-frame", type: "image", label: "사진틀", icon: <span className="text-[15px] font-black">▧</span>, tint: "#DBEAFE", tone: "#2563EB", extra: { w: 44, h: 44 } },
      { id: "banner-frame", type: "image", label: "배너", icon: <span className="text-[15px] font-black">▭</span>, tint: "#FCE7F3", tone: "#DB2777", extra: { w: 92, h: 28 } },
    ],
  },
];

const CATEGORY_FILTERS = [{ id: "all", title: "전체" }, ...OBJECT_CATEGORIES.map((c) => ({ id: c.id, title: c.title }))];
const TEXT_DETAIL_GROUPS: { id: NonNullable<ObjectPreset["detailGroup"]>; title: string; hint: string }[] = [
  { id: "basic", title: "기본 텍스트", hint: "제목, 본문, 라벨처럼 가장 자주 쓰는 글자 블록" },
  { id: "accent", title: "강조·메모", hint: "안내문, 형광펜, 말풍선처럼 시선을 끄는 텍스트" },
  { id: "document", title: "문서용 요소", hint: "서명, 날짜, 쪽 번호처럼 공문서에 자주 쓰는 항목" },
];

const textPresets = () => OBJECT_CATEGORIES.find((c) => c.id === "text")?.presets ?? [];

const previewText = (preset: ObjectPreset) => {
  const text = preset.extra?.text?.trim();
  if (text) return text.length > 32 ? `${text.slice(0, 32)}...` : text;
  return preset.label;
};

function textPreviewStyle(preset: ObjectPreset): CSSProperties {
  const extra = preset.extra ?? {};
  const radius = typeof extra.radius === "number" ? Math.min(extra.radius, 18) : 8;
  return {
    color: extra.color ?? "#000000",
    backgroundColor: extra.fill ?? "#ffffff",
    border: extra.borderWidth ? `1px solid ${extra.borderColor ?? "#98A4BD"}` : "1px solid rgba(152,164,189,.34)",
    borderRadius: radius,
    fontSize: Math.max(11, Math.min(22, extra.fontSize ?? 11)),
    fontWeight: extra.bold ? 800 : 600,
    fontStyle: extra.italic ? "italic" : "normal",
    textAlign: extra.align ?? "left",
  };
}

function mergePresetExtra(preset: ObjectPreset): Partial<Block> | undefined {
  const flowExtra = preset.flow
    ? { flow: true, w: 170, manualW: true, text: "본문을 입력하세요. 한글에서 이어 쓸 수 있는 진짜 문단으로 내보내집니다." }
    : undefined;
  return flowExtra || preset.extra ? { ...(flowExtra ?? {}), ...(preset.extra ?? {}) } : undefined;
}

function PaletteItem({ preset }: { preset: ObjectPreset }) {
  const addBlock = useCanvasStore((s) => s.addBlock);
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const extra = mergePresetExtra(preset);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${preset.id}`,
    data: { kind: "palette", type: preset.type, flow: preset.flow, extra },
  });
  const addFromClick = () => {
    const offset = (blocks.length % 6) * 5;
    addBlock(preset.type, 28 + offset, 28 + offset, extra);
  };
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={addFromClick}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`studio-object-card group flex flex-col items-center gap-1.5 cursor-grab select-none rounded-[12px] p-1 transition-all hover:-translate-y-px hover:bg-paper ${
        isDragging ? "opacity-60 scale-95 z-50" : ""
      }`}
      title={`${preset.label} 추가`}
    >
      <div
        className="studio-object-preview w-full h-[48px] rounded-[13px] flex items-center justify-center shadow-[inset_0_0_0_1px_rgba(255,255,255,.45)] transition-transform group-hover:scale-[1.03]"
        style={{ background: preset.tint, color: preset.tone }}
      >
        {preset.icon}
      </div>
      <span className="text-[11px] font-medium text-inksoft max-w-full truncate">{preset.label}</span>
    </button>
  );
}

function TextPresetCard({ preset }: { preset: ObjectPreset }) {
  const addBlock = useCanvasStore((s) => s.addBlock);
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const page = useCanvasStore((s) => s.doc.page);
  const extra = mergePresetExtra(preset);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${preset.id}`,
    data: { kind: "palette", type: preset.type, flow: preset.flow, extra },
  });
  const addFromClick = () => {
    const width = typeof extra?.w === "number" ? extra.w : 64;
    const height = typeof extra?.h === "number" ? extra.h : 10;
    const offset = (blocks.length % 5) * 4;
    addBlock(preset.type, page.w / 2 - width / 2 + offset, page.h / 2 - height / 2 + offset, extra);
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={addFromClick}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`studio-template-card group w-full text-left cursor-grab select-none rounded-[16px] border border-line bg-surface p-3 transition-all hover:-translate-y-px hover:border-accentline hover:bg-paper ${
        isDragging ? "opacity-60 scale-[.98] z-50" : ""
      }`}
      title={`${preset.label} 추가`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0" style={{ background: preset.tint, color: preset.tone }}>
          {preset.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-ink truncate">{preset.label}</p>
            <span className="text-[10px] text-inkfaint shrink-0">클릭/드래그</span>
          </div>
          <p className="text-[11px] text-inkfaint mt-0.5 truncate">{preset.description ?? "텍스트 블록"}</p>
        </div>
      </div>
      <div
        className="mt-3 min-h-[44px] px-3 py-2 flex items-center shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)] overflow-hidden"
        style={textPreviewStyle(preset)}
      >
        <span className="truncate w-full">{previewText(preset)}</span>
      </div>
    </button>
  );
}

function TextDetailPanel({ onBack }: { onBack: () => void }) {
  const presets = textPresets();
  return (
    <div className="h-full flex flex-col">
      <div className="px-3.5 py-3.5 border-b border-line flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-fit h-8 -ml-1 px-2 rounded-lg flex items-center gap-1.5 text-[12px] font-bold text-inksoft hover:bg-paper hover:text-ink transition-colors"
        >
          <IcChevronLeft size={14} /> 텍스트
        </button>
        <div>
          <h2 className="text-[18px] font-black tracking-tight text-ink">텍스트 유형</h2>
          <p className="text-[11.5px] text-inkfaint mt-1 leading-relaxed">
            원하는 글자 스타일을 클릭하면 A4 중앙에 추가되고, 끌어다 놓으면 원하는 위치에 바로 배치됩니다.
          </p>
        </div>
        <div className="studio-search h-9 bg-paper border border-line rounded-[11px] flex items-center gap-2 px-2.5">
          <span className="text-inkfaint"><IcSearch size={14} /></span>
          <span className="text-[12px] text-inkfaint">제목, 캡션, 날짜 검색</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3.5 py-3.5 pr-2 flex flex-col gap-5">
        {TEXT_DETAIL_GROUPS.map((group) => {
          const groupPresets = presets.filter((preset) => preset.detailGroup === group.id);
          if (!groupPresets.length) return null;
          return (
            <section key={group.id} className="flex flex-col gap-2.5">
              <div className="pr-1">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-extrabold text-ink">{group.title}</p>
                  <span className="text-[10.5px] text-inkfaint">{groupPresets.length}</span>
                </div>
                <p className="text-[11px] text-inkfaint mt-0.5 leading-snug">{group.hint}</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {groupPresets.map((preset) => (
                  <TextPresetCard key={preset.id} preset={preset} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
// 데이터 알약 — 지면의 텍스트/셀에 드롭하면 {{열이름}} 토큰이 삽입된다
function FieldPill({ column }: { column: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `field-${column}`,
    data: { kind: "field", column },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`inline-flex items-center gap-1 rounded-full bg-accentsoft text-accent text-[12px] font-medium pl-2 pr-2.5 py-1 cursor-grab select-none border border-accentline hover:bg-accent hover:text-white transition-colors ${
        isDragging ? "opacity-60 shadow-md z-50 pointer-events-none" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {column}
    </div>
  );
}

const iconFor = (t: BlockType) =>
  t === "text" ? <IcText size={14} /> : t === "table" ? <IcTable size={14} /> : <IcImage size={14} />;
const labelFor = (b: Block) =>
  b.type === "text"
    ? // 본문이 비면 안내문(placeholder)을 라벨로 (안내문 블록이 목록에서 blank로 안 보이게)
      b.text?.trim() || b.hint?.trim() || "빈 텍스트"
    : b.type === "table"
      ? "표"
      : "이미지";

// 레이어 행 — 드래그(kind:layer)해서 다른 행에 놓으면 그 블록의 자식이 된다.
// 자식이 있으면 ▾/▸ 토글로 가지를 접는다(캔버스·패널 모두 숨김, 보기 전용).
function LayerRow({ block, depth, kidCount }: { block: Block; depth: number; kidCount: number }) {
  const select = useCanvasStore((s) => s.select);
  const toggleSelect = useCanvasStore((s) => s.toggleSelect);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const drag = useDraggable({ id: `layer-${block.id}`, data: { kind: "layer", blockId: block.id } });
  const drop = useDroppable({ id: `layerdrop-${block.id}`, data: { kind: "layer", blockId: block.id } });
  const selectedRow = useCanvasStore((s) => s.selectedIds.includes(block.id));
  return (
    <button
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? toggleSelect(block.id) : select(block.id))}
      style={{
        paddingLeft: 8 + depth * 14,
        transform: CSS.Translate.toString(drag.transform),
        touchAction: "none",
      }}
      className={`flex items-center gap-2 text-left pr-2 py-1.5 rounded-lg text-[12px] transition-colors w-full ${
        drop.isOver && !drag.isDragging
          ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2"
          : selectedRow
            ? "bg-accentsoft text-accent font-medium"
            : "text-inksoft hover:bg-paper"
      } ${drag.isDragging ? "opacity-50 z-50 relative" : ""}`}
    >
      {depth > 0 && <span className="text-inkfaint/60 -ml-1">└</span>}
      {kidCount > 0 ? (
        // 접기 토글 — 부모 <button> 안이라 span으로 (중첩 button 금지), 드래그 시작도 차단
        <span
          role="button"
          aria-label={block.collapsed ? "펴기" : "접기"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateBlock(block.id, { collapsed: !block.collapsed });
          }}
          className="w-4 h-4 -ml-1 flex items-center justify-center rounded text-inkfaint hover:text-accent hover:bg-accentsoft text-[10px] shrink-0"
        >
          {block.collapsed ? "▸" : "▾"}
        </span>
      ) : (
        depth === 0 && <span className="w-4 -ml-1 shrink-0" />
      )}
      <span className={selectedRow ? "text-accent" : "text-inkfaint"}>{iconFor(block.type)}</span>
      <span className="truncate">{labelFor(block)}</span>
      {block.groupId && (
        <span title="공간 그룹" className="text-accent/70 shrink-0">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 4h3.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </span>
      )}
      {block.locked && (
        <span title="잠김" className="text-inkfaint shrink-0">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
      {block.collapsed && kidCount > 0 && (
        <span className="ml-auto text-[10px] text-inkfaint bg-paper rounded-full px-1.5 py-0.5 shrink-0">
          +{kidCount}
        </span>
      )}
    </button>
  );
}

function BlocksTab() {
  const [category, setCategory] = useState("all");
  const [detailCategory, setDetailCategory] = useState<string | null>(null);
  const blocks = useCanvasStore((s) => s.doc.blocks);
  // 루트 해제 드롭 영역 (레이어 목록 하단)
  const rootDrop = useDroppable({ id: "layerroot", data: { kind: "layerroot" } });
  const shownCategories = category === "all" ? OBJECT_CATEGORIES : OBJECT_CATEGORIES.filter((c) => c.id === category);

  // parentId 트리를 y좌표순으로 평탄화 (들여쓰기 렌더용) — 접힌 가지는 건너뛴다
  const rows: { block: Block; depth: number; kidCount: number }[] = [];
  const byY = (a: Block, b: Block) => a.y - b.y || a.x - b.x;
  const walk = (parentId: string | undefined, depth: number) => {
    blocks
      .filter((b) => (b.parentId ?? undefined) === parentId)
      .sort(byY)
      .forEach((b) => {
        rows.push({ block: b, depth, kidCount: descendantIds(blocks, b.id).size });
        if (!b.collapsed) walk(b.id, depth + 1);
      });
  };
  walk(undefined, 0);

  if (detailCategory === "text") {
    return <TextDetailPanel onBack={() => setDetailCategory(null)} />;
  }

  return (
    <>
      <div className="studio-library-head px-3.5 py-3.5 border-b border-line flex flex-col gap-3">
        <div className="studio-panel-intro">
          <span className="studio-panel-eyebrow">CREATE</span>
          <div className="studio-panel-title-row">
            <div>
              <h2>요소 라이브러리</h2>
              <p>클릭하거나 끌어서 문서에 추가</p>
            </div>
            <span className="studio-panel-count">{OBJECT_CATEGORIES.reduce((sum, item) => sum + item.presets.length, 0)}</span>
          </div>
        </div>
        <div className="studio-search h-9 bg-paper border border-line rounded-[11px] flex items-center gap-2 px-2.5">
          <span className="text-inkfaint"><IcSearch size={14} /></span>
          <span className="text-[12px] text-inkfaint">객체·서식 검색</span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
          {CATEGORY_FILTERS.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (c.id === "text") {
                    setDetailCategory("text");
                    setCategory("all");
                    return;
                  }
                  setDetailCategory(null);
                  setCategory(c.id);
                }}
                className={`shrink-0 h-8 px-3 rounded-full text-[11.5px] font-bold border transition-colors ${
                  active ? "bg-accent text-onaccent border-accent" : "bg-surface text-inksoft border-line hover:border-accentline hover:text-accent"
                }`}
              >
                {c.title}
              </button>
            );
          })}
        </div>

        <div className="max-h-[430px] overflow-auto pr-1 flex flex-col gap-4">
          {shownCategories.map((cat) => (
            <section key={cat.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-ink tracking-[.02em]">{cat.title}</p>
                {cat.id === "text" ? (
                  <button
                    type="button"
                    onClick={() => setDetailCategory("text")}
                    className="text-[10.5px] font-bold text-accent hover:underline"
                  >
                    모두 보기
                  </button>
                ) : (
                  <span className="text-[10.5px] text-inkfaint">{cat.presets.length}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {cat.presets.map((preset) => (
                  <PaletteItem key={preset.id} preset={preset} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="studio-layer-tree px-3.5 py-3.5 flex-1 overflow-auto flex flex-col">
        <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2.5">
          구조 {blocks.length > 0 && <span className="text-inkfaint/70">· {blocks.length}</span>}
        </p>
        <div className="flex flex-col gap-0.5">
          {rows.map(({ block, depth, kidCount }) => (
            <LayerRow key={block.id} block={block} depth={depth} kidCount={kidCount} />
          ))}
          {blocks.length === 0 && (
            <p className="text-[12px] text-inkfaint px-2 py-1">아직 블록이 없습니다</p>
          )}
        </div>
        {/* 루트 해제 영역 — 행을 여기로 끌면 최상위로 */}
        {blocks.length > 0 && (
          <div
            ref={rootDrop.setNodeRef}
            className={`mt-2 rounded-lg border border-dashed px-2 py-2 text-[11px] text-center transition-colors ${
              rootDrop.isOver ? "border-accent bg-accentsoft text-accent" : "border-line text-inkfaint"
            }`}
          >
            여기로 끌면 최상위로
          </div>
        )}
        <p className="text-[11px] text-inkfaint leading-relaxed mt-2">
          행을 다른 행에 끌어다 놓으면 하위로 연결됩니다. 부모를 움직이면 하위가 함께 움직여요.
        </p>
      </div>
    </>
  );
}
function DataTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);
  const setDataset = useMergeStore((s) => s.setDataset);
  const clearDataset = useMergeStore((s) => s.clearDataset);
  const setPreviewIndex = useMergeStore((s) => s.setPreviewIndex);
  const doc = useCanvasStore((s) => s.doc);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDataset(await parseSheetFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tokens = usedTokens(doc);
  const bound = dataset ? tokens.filter((t) => dataset.columns.includes(t)) : [];
  const preview = previewIndex !== null;

  const generateZip = async () => {
    if (!dataset) return;
    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      dataset.rows.forEach((row, i) => {
        const resolved = resolveDoc(doc, dataset.columns, row);
        const label = (row[0] || String(i + 1)).replace(/[\\/:*?"<>|]/g, "_");
        zip.file(`${doc.title}_${label}.hwpx`, buildHwpxBytes(resolved));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBytes(blob, `${doc.title}_병합_${dataset.rows.length}건.zip`);
    } finally {
      setBusy(false);
    }
  };

  const generateSingle = () => {
    if (!dataset) return;
    const docs = dataset.rows.map((row) => resolveDoc(doc, dataset.columns, row));
    downloadBytes(buildHwpxBytesMultiPage(docs), `${doc.title}_병합_${dataset.rows.length}쪽.hwpx`);
  };

  return (
    <div className="px-3.5 py-3.5 flex-1 overflow-auto flex flex-col gap-4">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      {!dataset ? (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-linestrong px-3 py-7 text-center text-inksoft hover:border-accent hover:text-accent hover:bg-accentsoft/30 transition-all disabled:opacity-50"
          >
            <IcUpload size={22} />
            <span className="text-[12.5px] font-medium">{busy ? "읽는 중…" : "엑셀 · CSV 업로드"}</span>
            <span className="text-[11px] text-inkfaint">첫 행 = 열 이름</span>
          </button>
          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2.5 py-2">{error}</p>
          )}
          <div className="rounded-xl bg-paper px-3 py-3">
            <p className="text-[11px] text-inksoft leading-relaxed">
              업로드하면 열 이름이 <span className="text-accent font-medium">알약</span>이 됩니다. 지면의
              텍스트나 표 칸에 끌어다 놓으면 자동으로 값이 채워져요.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accentsoft text-accent shrink-0">
              <IcTable size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink truncate">{dataset.name}</p>
              <p className="text-[11px] text-inkfaint">
                {dataset.rows.length}행 · 매핑 {bound.length}/{dataset.columns.length}
              </p>
            </div>
            <button
              onClick={clearDataset}
              className="text-[11px] text-inkfaint hover:text-red-500 shrink-0"
            >
              제거
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2">
              열 알약 — 지면에 끌어다 놓기
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dataset.columns.map((c) => (
                <FieldPill key={c} column={c} />
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-inkfaint tracking-wide">미리보기</p>
              <button
                onClick={() => setPreviewIndex(preview ? null : 0)}
                className="text-[11px] text-accent font-medium hover:underline"
              >
                {preview ? "칩 보기" : "값 보기"}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPreviewIndex(preview ? Math.max(0, previewIndex! - 1) : 0)}
                disabled={!preview || previewIndex === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-line text-inksoft hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
              >
                <IcChevronLeft size={16} />
              </button>
              <div className="flex-1 h-8 flex items-center justify-center rounded-lg bg-paper text-[12px] text-ink font-medium tabular-nums">
                {preview ? `${previewIndex! + 1} / ${dataset.rows.length}` : "칩 보기"}
              </div>
              <button
                onClick={() =>
                  setPreviewIndex(preview ? Math.min(dataset.rows.length - 1, previewIndex! + 1) : 0)
                }
                disabled={!preview || previewIndex === dataset.rows.length - 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-line text-inksoft hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
              >
                <IcChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="border-t border-line pt-3.5 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-inkfaint tracking-wide">
              일괄 생성 · {dataset.rows.length}건
            </p>
            <button
              onClick={generateZip}
              disabled={busy || bound.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-accent text-white text-[12.5px] font-semibold py-2.5 hover:bg-accenthover active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100 shadow-[0_1px_2px_rgba(43,92,230,0.25)]"
            >
              {busy ? (
                "생성 중…"
              ) : (
                <>
                  <IcDownload size={15} /> 개별 파일 {dataset.rows.length}개 (ZIP)
                </>
              )}
            </button>
            <button
              onClick={generateSingle}
              disabled={busy || bound.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-accentline text-accent text-[12.5px] font-semibold py-2.5 hover:bg-accentsoft transition-colors disabled:opacity-40"
            >
              <IcDownload size={15} /> 한 파일 {dataset.rows.length}쪽 (HWPX)
            </button>
            {bound.length === 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-inkfaint">
                <IcSparkles size={13} /> 알약을 문서에 놓으면 생성할 수 있어요.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 캔바식 2단: 아이콘 레일 66px + 콘텐츠 패널 250px (시안 1b)
type RailKey = "blocks" | "templates" | "data" | "upload";

export function LeftPanel() {
  const [tab, setTab] = useState<RailKey>("blocks");
  const hasDataset = useMergeStore((s) => s.dataset !== null);
  const openAi = useRightTabStore((s) => s.setTab);
  const leftW = usePanelStore((s) => s.leftW);
  const leftOpen = usePanelStore((s) => s.leftOpen);

  const rail: { key: RailKey | "ai"; label: string; icon: ReactNode; soon?: boolean }[] = [
    { key: "blocks", label: "요소", icon: <IcText size={17} /> },
    { key: "templates", label: "템플릿", icon: <IcFile size={17} />, soon: true },
    { key: "data", label: "데이터", icon: <IcTable size={17} /> },
    { key: "upload", label: "업로드", icon: <IcUpload size={17} />, soon: true },
    { key: "ai", label: "AI", icon: <IcSparkles size={17} /> },
  ];

  return (
    <aside className="studio-left-panel shrink-0 border-r border-line bg-surface flex">
      {/* 아이콘 레일 */}
      <div className="studio-tool-rail w-[66px] shrink-0 border-r border-line flex flex-col items-center gap-1 py-2">
        {rail.map((r) => {
          const active = r.key === tab;
          return (
            <button
              key={r.key}
              title={r.soon ? `${r.label} (준비 중)` : r.label}
              onClick={() => (r.key === "ai" ? openAi("ai") : setTab(r.key as RailKey))}
              className={`studio-rail-button w-14 py-2 rounded-[10px] flex flex-col items-center gap-1 transition-colors ${
                active ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
              }`}
            >
              {r.icon}
              <span className={`text-[10.5px] ${active ? "font-bold" : "font-medium"}`}>{r.label}</span>
            </button>
          );
        })}
        {hasDataset && <span className="w-1.5 h-1.5 rounded-full bg-accent -mt-9 ml-9" />}
      </div>
      {/* 콘텐츠 패널 — 폭 조절/접힘 (밀고 당기기). 접히면 rail(66px)만 남는다 */}
      <div className={`studio-left-content flex flex-col min-h-0 ${leftOpen ? "" : "hidden"}`} style={{ width: leftW }}>
        {tab === "blocks" ? (
          <BlocksTab />
        ) : tab === "data" ? (
          <DataTab />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-paper text-inkfaint">
              {tab === "templates" ? <IcFile size={18} /> : <IcUpload size={18} />}
            </span>
            <p className="text-[12px] text-inkfaint leading-relaxed">
              {tab === "templates" ? "템플릿 라이브러리는 준비 중이에요" : "이미지 업로드는 준비 중이에요"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

