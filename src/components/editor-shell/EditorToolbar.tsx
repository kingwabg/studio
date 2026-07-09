// EditorToolbar.tsx — 서식 툴바 44px (리디자인 시안 1b).
// 한글에 익숙한 실무자의 문법: 글꼴·크기 스테퍼·가(굵게/기울임/밑줄/취소선)·글자색·
// 정렬·줄 간격·목록·표 도구(테두리 팝오버). 모델에 아직 없는 컨트롤(밑줄·취소선·
// 줄 간격·목록·표 테두리 적용)은 "준비 중" — UI는 시안대로, 동작은 정직하게 표시.
import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, type TextAlign, TEXT_DEFAULTS } from "../../modules/document/model";

// 시안 스와치 6색 (내보내기는 hex 그대로 — 어떤 색이든 charPr로 나간다)
const TEXT_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#D64550", "#3B9B6B", "#C77A28"];

const Sep = () => <span className="w-px h-5 bg-line mx-1 shrink-0" />;

// 28px 정사각 토글 버튼 (가/가/가/가, 목록 등)
function TBtn({
  active,
  disabled,
  title,
  onClick,
  children,
  w = "w-7",
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  w?: string;
}) {
  return (
    <button
      title={disabled ? `${title} (준비 중)` : title}
      onClick={disabled ? undefined : onClick}
      className={`${w} h-7 rounded-[7px] flex items-center justify-center text-[13px] transition-colors ${
        active
          ? "bg-accentsoft text-accent font-extrabold"
          : disabled
            ? "text-inkfaint/70 cursor-default"
            : "text-inksoft hover:bg-paper hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// 표 테두리 프리셋 미니 다이어그램 — 활성 변만 잉크색 (시안 팝오버)
type Edges = { t?: boolean; r?: boolean; b?: boolean; l?: boolean; h?: boolean; v?: boolean };
function EdgeDiagram({ e }: { e: Edges }) {
  const on = "var(--ink)";
  const off = "#DFE4EC";
  const sw = (a?: boolean) => ({ stroke: a ? on : off, strokeWidth: a ? 1.6 : 1.1 });
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <line x1="1" y1="1" x2="17" y2="1" {...sw(e.t)} />
      <line x1="17" y1="1" x2="17" y2="17" {...sw(e.r)} />
      <line x1="1" y1="17" x2="17" y2="17" {...sw(e.b)} />
      <line x1="1" y1="1" x2="1" y2="17" {...sw(e.l)} />
      <line x1="1" y1="9" x2="17" y2="9" {...sw(e.h)} />
      <line x1="9" y1="1" x2="9" y2="17" {...sw(e.v)} />
    </svg>
  );
}

const BORDER_PRESETS: { key: string; label: string; e: Edges }[] = [
  { key: "all", label: "모두", e: { t: true, r: true, b: true, l: true, h: true, v: true } },
  { key: "outer", label: "바깥", e: { t: true, r: true, b: true, l: true } },
  { key: "inner", label: "안쪽", e: { h: true, v: true } },
  { key: "none", label: "없음", e: {} },
  { key: "top", label: "위", e: { t: true } },
  { key: "bottom", label: "아래", e: { b: true } },
  { key: "left", label: "왼쪽", e: { l: true } },
  { key: "right", label: "오른쪽", e: { r: true } },
  { key: "tb", label: "위아래", e: { t: true, b: true } },
  { key: "lr", label: "좌우", e: { l: true, r: true } },
  { key: "hlines", label: "가로선", e: { h: true } },
  { key: "vlines", label: "세로선", e: { v: true } },
];

// 표 테두리 팝오버 (시안 276px) — UI는 완성, 표 적용은 table-king 연동 과제(준비 중)
function BorderPopover({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState("all");
  const [lineStyle, setLineStyle] = useState("solid");
  const [width, setWidth] = useState(0.4);
  const [cellOnly, setCellOnly] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const lines: { key: string; el: React.ReactNode }[] = [
    { key: "solid", el: <div className="w-8 border-t-[1.6px]" style={{ borderColor: "var(--ink)" }} /> },
    { key: "dashed", el: <div className="w-8 border-t-[1.6px] border-dashed" style={{ borderColor: "var(--ink)" }} /> },
    { key: "dotted", el: <div className="w-8 border-t-[1.6px] border-dotted" style={{ borderColor: "var(--ink)" }} /> },
    { key: "double", el: <div className="w-8 border-t-[3px] border-double" style={{ borderColor: "var(--ink)" }} /> },
  ];

  return (
    <div
      ref={ref}
      className="absolute top-[calc(100%+6px)] left-0 w-[276px] bg-surface border border-line rounded-[13px] p-3.5 z-50 flex flex-col gap-3"
      style={{ boxShadow: "var(--sh-pop)" }}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {BORDER_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`flex flex-col items-center gap-1 py-1.5 rounded-lg transition-colors ${
              preset === p.key ? "bg-accentsoft" : "hover:bg-paper"
            }`}
          >
            <EdgeDiagram e={p.e} />
            <span className={`text-[10px] ${preset === p.key ? "text-accent font-bold" : "text-inksoft"}`}>{p.label}</span>
          </button>
        ))}
      </div>
      <div className="h-px bg-line" />
      <div className="flex items-center gap-1.5">
        {lines.map((l) => (
          <button
            key={l.key}
            onClick={() => setLineStyle(l.key)}
            className={`flex-1 h-8 rounded-lg flex items-center justify-center transition-colors ${
              lineStyle === l.key ? "bg-accentsoft" : "hover:bg-paper"
            }`}
          >
            {l.el}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-inksoft font-medium">굵기</span>
        <div className="flex items-center h-7 border border-line rounded-lg overflow-hidden">
          <button onClick={() => setWidth((w) => Math.max(0.1, +(w - 0.1).toFixed(1)))} className="w-6 h-full text-inksoft hover:bg-paper">−</button>
          <span className="w-14 text-center text-[11.5px] font-semibold text-ink border-x border-line h-full flex items-center justify-center">{width.toFixed(1)}mm</span>
          <button onClick={() => setWidth((w) => +(w + 0.1).toFixed(1))} className="w-6 h-full text-inksoft hover:bg-paper">＋</button>
        </div>
      </div>
      <button onClick={() => setCellOnly((v) => !v)} className="flex items-center justify-between">
        <span className="text-[11.5px] text-inksoft font-medium">선택한 셀에만 적용</span>
        <span className={`w-8 h-[18px] rounded-full relative transition-colors ${cellOnly ? "bg-accent" : "bg-line"}`}>
          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${cellOnly ? "left-[16px]" : "left-[2px]"}`} />
        </span>
      </button>
      <p className="text-[10.5px] text-inkfaint leading-relaxed -mt-1">표 적용은 준비 중 — 지금은 표 리본에서 조정하세요.</p>
    </div>
  );
}

export function EditorToolbar() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const [borderOpen, setBorderOpen] = useState(false);

  const isText = block?.type === "text";
  const isTable = block?.type === "table";
  const patch = (p: Partial<Block>) => block && updateBlock(block.id, p);
  const size = block?.fontSize ?? TEXT_DEFAULTS.fontSize;
  const align = block?.align ?? TEXT_DEFAULTS.align;
  const aligns: { v: TextAlign; d: string; title: string }[] = [
    { v: "left", d: "M1 1.5h12M1 5h8M1 8.5h12M1 12h8", title: "왼쪽 정렬" },
    { v: "center", d: "M1 1.5h12M3 5h8M1 8.5h12M3 12h8", title: "가운데 정렬" },
    { v: "right", d: "M1 1.5h12M5 5h8M1 8.5h12M5 12h8", title: "오른쪽 정렬" },
  ];

  // 텍스트 전용 컨트롤 묶음의 비활성 톤
  const textZone = isText ? "" : "opacity-45 pointer-events-none select-none";

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 h-11 bg-surface border-b border-line relative z-[2]">
      <div className={`flex items-center gap-2 ${textZone}`}>
        {/* 폰트 (전각 조판 정합을 위해 맑은 고딕 고정) */}
        <span
          title="문서 폰트 — 한글 조판(전각)과의 줄바꿈 일치를 위해 맑은 고딕으로 고정"
          className="h-[30px] px-2.5 flex items-center gap-2 rounded-lg border border-line bg-surface text-[12.5px] text-ink min-w-[100px] hover:border-linestrong transition-colors"
        >
          맑은 고딕
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto">
            <path d="M2.5 4l2.5 2.5L7.5 4" stroke="var(--inkfaint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {/* 크기 스테퍼 */}
        <div className="flex items-center h-[30px] border border-line rounded-lg overflow-hidden">
          <button onClick={() => patch({ fontSize: Math.max(6, size - 0.5) })} title="작게" className="w-[22px] h-full flex items-center justify-center text-inksoft hover:bg-paper text-[14px]">−</button>
          <span className="w-11 text-center text-[12.5px] font-semibold text-ink border-x border-line h-full flex items-center justify-center">{size}pt</span>
          <button onClick={() => patch({ fontSize: size + 0.5 })} title="크게" className="w-[22px] h-full flex items-center justify-center text-inksoft hover:bg-paper text-[14px]">＋</button>
        </div>
        <Sep />
        {/* 가 4종 — 굵게·기울임 실동작, 밑줄·취소선 준비 중 */}
        <div className="flex items-center gap-0.5">
          <TBtn active={!!block?.bold && isText} title="굵게" onClick={() => patch({ bold: !block?.bold })}>가</TBtn>
          <TBtn active={!!block?.italic && isText} title="기울임" onClick={() => patch({ italic: !block?.italic })}>
            <span className="italic">가</span>
          </TBtn>
          <TBtn disabled title="밑줄"><span className="underline underline-offset-2">가</span></TBtn>
          <TBtn disabled title="취소선"><span className="line-through">가</span></TBtn>
        </div>
        <Sep />
        {/* 글자색 스와치 */}
        <div className="flex items-center gap-1.5">
          {TEXT_COLORS.map((c) => {
            const on = (block?.color ?? TEXT_DEFAULTS.color).toUpperCase() === c.toUpperCase();
            return (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                aria-label={`글자색 ${c}`}
                className="w-[17px] h-[17px] rounded-full transition-transform hover:scale-[1.15]"
                style={{
                  backgroundColor: c,
                  border: `2px solid ${on ? "var(--accent)" : "var(--surface)"}`,
                  boxShadow: "0 0 0 1px rgba(16,24,40,.06)",
                }}
              />
            );
          })}
        </div>
        <Sep />
        {/* 정렬 세그먼트 */}
        <div className="flex h-[30px] border border-line rounded-lg overflow-hidden bg-paper p-px">
          {aligns.map((a) => {
            const on = align === a.v && isText;
            return (
              <button
                key={a.v}
                title={a.title}
                onClick={() => patch({ align: a.v })}
                className={`w-8 flex items-center justify-center rounded-[7px] transition-colors ${on ? "bg-surface" : "hover:bg-line/60"}`}
                style={on ? { boxShadow: "inset 0 0 0 1px var(--accentline)" } : undefined}
              >
                <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
                  <path d={a.d} stroke={on ? "var(--accent)" : "var(--inkfaint)"} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            );
          })}
          <button title="양쪽 정렬 (준비 중)" className="w-8 flex items-center justify-center rounded-[7px] cursor-default">
            <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
              <path d="M1 1.5h12M1 5h12M1 8.5h12M1 12h8" stroke="var(--inkfaint)" strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
            </svg>
          </button>
        </div>
        {/* 줄 간격 (준비 중) */}
        <span title="줄 간격 (준비 중)" className="flex items-center gap-1.5 h-[30px] px-2.5 border border-line rounded-lg text-[12.5px] font-semibold text-inkfaint/70">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6 2.2h6M6 6.5h6M6 10.8h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M2.4 2.4v8.2M1 4l1.4-1.6L3.8 4M1 9l1.4 1.6L3.8 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          160%
        </span>
        {/* 목록 (준비 중) */}
        <div className="flex items-center gap-0.5">
          <TBtn disabled title="글머리 기호">
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
              <rect x="1" y="1" width="2.4" height="2.4" stroke="currentColor" strokeWidth="1.1" />
              <rect x="1" y="8.4" width="2.4" height="2.4" stroke="currentColor" strokeWidth="1.1" />
              <path d="M6 2.2h7M6 9.6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </TBtn>
          <TBtn disabled title="번호 목록"><span className="text-[10px] font-bold tracking-tight">1.</span></TBtn>
          <TBtn disabled title="한글 목록"><span className="text-[10px] font-bold">가.</span></TBtn>
        </div>
      </div>

      <Sep />
      {/* 표 도구 — 표 선택 시 활성 */}
      <div className={`relative flex items-center gap-0.5 ${isTable ? "" : "opacity-45 pointer-events-none select-none"}`}>
        <button
          onClick={() => setBorderOpen((v) => !v)}
          className={`flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg text-[12.5px] font-semibold transition-colors ${
            borderOpen ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
          }`}
          style={borderOpen ? { boxShadow: "inset 0 0 0 1px var(--accentline)" } : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1.4" y="1.4" width="11.2" height="11.2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M1.4 7h11.2M7 1.4v11.2" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.8 1.6" />
          </svg>
          테두리
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {borderOpen && <BorderPopover onClose={() => setBorderOpen(false)} />}
      </div>

      {!isText && !isTable && (
        <span className="ml-auto text-[11px] text-inkfaint">텍스트 블록을 선택하면 서식을 바꿀 수 있어요</span>
      )}
      {isTable && (
        <span className="ml-auto text-[11px] text-inkfaint">표 서식은 표를 선택하면 뜨는 리본에서</span>
      )}
    </div>
  );
}
