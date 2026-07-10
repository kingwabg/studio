// EditorToolbar.tsx — 선택한 요소에 맞춰 필요한 기능만 보여주는 컨텍스트 리본.
import { type ReactNode } from "react";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, TEXT_DEFAULTS } from "../../modules/document/model";
import { FontSelect } from "./FontSelect";

const TEXT_COLORS = ["#000000", "#5B6577", "#2B5CE6", "#D64550", "#3B9B6B", "#C77A28"];
const FILL_COLORS = ["#ffffff", "#F3F6FF", "#FFF4D8", "#EAF8EF", "#FFE9E9", "transparent"];
const TABLE_BG_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];
const TABLE_TEXT_COLORS = ["#111827", "#ef4444", "#2563eb", "#16a34a", "#9333ea"];
const SAFE_MARGIN_MM = 20;

type TableRibbonCommand =
  | { kind: "primary"; label: string }
  | { kind: "style"; title: string }
  | { kind: "background"; index: number }
  | { kind: "textColor"; index: number }
  | { kind: "split"; rows: number; cols: number };

type RibbonButtonProps = {
  title: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  compact?: boolean;
  onClick?: () => void;
  children: ReactNode;
};

function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      className="studio-ribbon-group flex h-10 items-center gap-1 rounded-[13px] border border-line bg-surface px-2"
      aria-label={label}
    >
      <span className="mr-1 whitespace-nowrap text-[10px] font-extrabold tracking-[.08em] text-inkfaint">{label}</span>
      {children}
    </section>
  );
}

function RibbonButton({ title, disabled, active, danger, compact, onClick, children }: RibbonButtonProps) {
  return (
    <button
      type="button"
      title={disabled ? `${title} (준비 중)` : title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`studio-ribbon-button ${compact ? "min-w-7 px-1.5" : "min-w-8 px-2"} h-7 rounded-[8px] flex items-center justify-center gap-1 text-[12px] font-bold transition-colors ${
        active
          ? "bg-accentsoft text-accent shadow-[inset_0_0_0_1px_var(--accentline)]"
          : disabled
            ? "text-inkfaint cursor-default"
            : danger
              ? "text-inksoft hover:bg-[color:var(--cat-red-soft)] hover:text-[color:var(--cat-red)]"
              : "text-inksoft hover:bg-paper hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-line" />;
}

function Swatch({ color, active, title, onClick }: { color: string; active?: boolean; title: string; onClick: () => void }) {
  const isEmpty = !color || color === "transparent";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="h-[18px] w-[18px] rounded-full transition-transform hover:scale-110"
      style={{
        background: isEmpty
          ? "linear-gradient(135deg, transparent 0 44%, #d64550 45% 55%, transparent 56% 100%), #fff"
          : color,
        border: `2px solid ${active ? "var(--accent)" : "var(--surface)"}`,
        boxShadow: "0 0 0 1px rgba(16,24,40,.12)",
      }}
    />
  );
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 7H4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.8 10.5A7.2 7.2 0 1 1 7 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 7h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 10.5A7.2 7.2 0 1 0 17 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlignIcon({ mode }: { mode: "left" | "center" | "right" }) {
  const paths = {
    left: "M2 3h12M2 7h8M2 11h12M2 15h8",
    center: "M2 3h12M4 7h8M2 11h12M4 15h8",
    right: "M2 3h12M6 7h8M2 11h12M6 15h8",
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 18" fill="none" aria-hidden="true">
      <path d={paths[mode]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function VAlignIcon({ mode }: { mode: "top" | "middle" | "bottom" }) {
  const guide = mode === "top" ? "M3 4h10" : mode === "middle" ? "M3 9h10" : "M3 14h10";
  const text = mode === "top" ? "M5 8h6M5 11h4" : mode === "middle" ? "M5 6h6M5 12h6" : "M5 7h4M5 10h6";
  return (
    <svg width="16" height="16" viewBox="0 0 16 18" fill="none" aria-hidden="true">
      <path d={guide} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d={text} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function BoxPositionIcon({ mode }: { mode: "left" | "center" | "right" }) {
  const x = mode === "left" ? 3 : mode === "center" ? 6 : 9;
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.15" opacity=".42" />
      <rect x={x} y="4.5" width="4" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

export function EditorToolbar() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const page = useCanvasStore((s) => s.doc.page);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const nudgeMany = useCanvasStore((s) => s.nudgeMany);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const duplicateBlock = useCanvasStore((s) => s.duplicateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);
  const setLocked = useCanvasStore((s) => s.setLocked);
  const groupSelection = useCanvasStore((s) => s.groupSelection);
  const ungroupSelection = useCanvasStore((s) => s.ungroupSelection);
  const alignSelection = useCanvasStore((s) => s.alignSelection);

  const isText = block?.type === "text";
  const isTable = block?.type === "table";
  const hasSelection = !!block;
  const multi = selectedIds.length > 1;
  const showTextTools = isText && !multi;
  const showTableTools = isTable && !multi;
  const size = block?.fontSize ?? TEXT_DEFAULTS.fontSize;
  const align = block?.align ?? TEXT_DEFAULTS.align;
  const textColor = (block?.color ?? TEXT_DEFAULTS.color).toUpperCase();
  const fill = block?.fill ?? "transparent";
  const contextLabel = multi
    ? `${selectedIds.length}개 요소 선택`
    : isTable
      ? "표 편집"
      : isText
        ? block?.flow
          ? "본문 편집"
          : "텍스트 편집"
        : "문서 편집";

  const patch = (p: Partial<Block>) => {
    if (!block) return;
    updateBlock(block.id, p);
  };
  const positionSelectedBox = (mode: "left" | "center" | "right") => {
    if (!selectedIds.length) return;
    const selected = useCanvasStore.getState().doc.blocks.filter((item) => selectedIds.includes(item.id));
    if (!selected.length) return;
    const minX = Math.min(...selected.map((item) => item.x));
    const maxX = Math.max(...selected.map((item) => item.x + item.w));
    const width = maxX - minX;
    const safeLeft = SAFE_MARGIN_MM;
    const safeRight = page.w - SAFE_MARGIN_MM;
    const targetX =
      mode === "left" ? safeLeft : mode === "right" ? safeRight - width : safeLeft + (safeRight - safeLeft - width) / 2;
    nudgeMany(selectedIds, Math.round(targetX - minX), 0);
  };

  const runTable = (command: TableRibbonCommand) => {
    if (!block || block.type !== "table") return;
    window.dispatchEvent(new CustomEvent("studio:table-ribbon", { detail: { blockId: block.id, ...command } }));
  };


  const tableHAligns = [
    { title: "왼쪽 정렬", mode: "left" as const },
    { title: "가운데 정렬", mode: "center" as const },
    { title: "오른쪽 정렬", mode: "right" as const },
  ];

  const tableVAligns = [
    { title: "위쪽 정렬", mode: "top" as const },
    { title: "세로 가운데 정렬", mode: "middle" as const },
    { title: "아래쪽 정렬", mode: "bottom" as const },
  ];

  return (
    <div className="studio-toolbar-shell shrink-0 h-[62px] overflow-x-auto overflow-y-visible border-b border-line bg-surface px-3 relative z-[2]">
      <div className="studio-toolbar-track mx-auto flex h-full w-max min-w-fit items-center justify-center gap-2">
      <div className="studio-ribbon-context" aria-label={contextLabel}>
        <span className="studio-ribbon-context-dot" />
        <span>{contextLabel}</span>
      </div>
      <RibbonGroup label="공통">
        <RibbonButton title="실행 취소" compact onClick={undo}><UndoIcon /></RibbonButton>
        <RibbonButton title="다시 실행" compact onClick={redo}><RedoIcon /></RibbonButton>
        {hasSelection && (
          <>
            <Divider />
            <RibbonButton title="복제" onClick={() => block && duplicateBlock(block.id)}>복제</RibbonButton>
            <RibbonButton title="잠금" onClick={() => block && setLocked(selectedIds.length ? selectedIds : [block.id], true)}>잠금</RibbonButton>
            <RibbonButton title="삭제" danger onClick={() => block && removeBlock(block.id)}>삭제</RibbonButton>
          </>
        )}
      </RibbonGroup>

      {showTextTools && (
        <>
          <RibbonGroup label="텍스트">
            <FontSelect value={block?.font} disabled={!isText} onChange={(key) => patch({ font: key })} />
            <div className="flex h-7 items-center overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => patch({ fontSize: Math.max(6, size - 0.5) })} className="h-full w-6 text-[14px] text-inksoft hover:bg-paper">−</button>
              <span className="flex h-full w-12 items-center justify-center border-x border-line text-[12px] font-extrabold text-ink">{size}pt</span>
              <button type="button" onClick={() => patch({ fontSize: size + 0.5 })} className="h-full w-6 text-[14px] text-inksoft hover:bg-paper">＋</button>
            </div>
            <RibbonButton title="굵게" active={!!block?.bold} compact onClick={() => patch({ bold: !block?.bold })}>가</RibbonButton>
            <RibbonButton title="기울임" active={!!block?.italic} compact onClick={() => patch({ italic: !block?.italic })}><span className="italic">가</span></RibbonButton>
            <RibbonButton title="밑줄" active={!!block?.underline} compact onClick={() => patch({ underline: !block?.underline })}><span className="underline underline-offset-2">가</span></RibbonButton>
            <RibbonButton title="취소선" active={!!block?.strike} compact onClick={() => patch({ strike: !block?.strike })}><span className="line-through">가</span></RibbonButton>
            <Divider />
            {TEXT_COLORS.map((color) => (
              <Swatch key={color} color={color} title={`글자색 ${color}`} active={textColor === color.toUpperCase()} onClick={() => patch({ color })} />
            ))}
          </RibbonGroup>


          <RibbonGroup label="박스 위치">
            <RibbonButton title="박스를 왼쪽 여백에 맞춤" compact onClick={() => positionSelectedBox("left")}><BoxPositionIcon mode="left" /></RibbonButton>
            <RibbonButton title="박스를 가운데 배치" compact onClick={() => positionSelectedBox("center")}><BoxPositionIcon mode="center" /></RibbonButton>
            <RibbonButton title="박스를 오른쪽 여백에 맞춤" compact onClick={() => positionSelectedBox("right")}><BoxPositionIcon mode="right" /></RibbonButton>
          </RibbonGroup>

          <RibbonGroup label="모양">
            <span className="text-[10px] font-bold text-inkfaint">배경</span>
            {FILL_COLORS.map((color) => (
              <Swatch
                key={color}
                color={color}
                title={color === "transparent" ? "배경 없음" : `배경 ${color}`}
                active={(fill || "transparent").toUpperCase() === color.toUpperCase()}
                onClick={() => patch({ fill: color })}
              />
            ))}
            <Divider />
            <RibbonButton title="테두리 없음" compact active={!block?.borderWidth} onClick={() => patch({ borderWidth: 0 })}>0</RibbonButton>
            <RibbonButton title="얇은 테두리" compact active={block?.borderWidth === 1} onClick={() => patch({ borderWidth: 1, borderColor: "#98A4BD" })}>1</RibbonButton>
            <RibbonButton title="굵은 테두리" compact active={block?.borderWidth === 2} onClick={() => patch({ borderWidth: 2, borderColor: "#98A4BD" })}>2</RibbonButton>
          </RibbonGroup>
        </>
      )}

      {showTableTools && (
        <>
          <RibbonGroup label="표">
            <RibbonButton title="표 실행 취소" compact onClick={() => runTable({ kind: "primary", label: "실행 취소" })}><UndoIcon /></RibbonButton>
            <RibbonButton title="표 다시 실행" compact onClick={() => runTable({ kind: "primary", label: "다시 실행" })}><RedoIcon /></RibbonButton>
            <Divider />
            <RibbonButton title="복사" onClick={() => runTable({ kind: "primary", label: "복사" })}>복사</RibbonButton>
            <RibbonButton title="붙여넣기" onClick={() => runTable({ kind: "primary", label: "붙여넣기" })}>붙여넣기</RibbonButton>
            <RibbonButton title="지우기" onClick={() => runTable({ kind: "primary", label: "지우기" })}>지우기</RibbonButton>
            <Divider />
            <RibbonButton title="행 추가" onClick={() => runTable({ kind: "primary", label: "행 추가" })}>행+</RibbonButton>
            <RibbonButton title="열 추가" onClick={() => runTable({ kind: "primary", label: "열 추가" })}>열+</RibbonButton>
            <RibbonButton title="행 삭제" onClick={() => runTable({ kind: "primary", label: "행 삭제" })}>행−</RibbonButton>
            <RibbonButton title="열 삭제" onClick={() => runTable({ kind: "primary", label: "열 삭제" })}>열−</RibbonButton>
            <Divider />
            <RibbonButton title="셀 병합" onClick={() => runTable({ kind: "primary", label: "병합" })}>병합</RibbonButton>
            <RibbonButton title="병합 해제" onClick={() => runTable({ kind: "primary", label: "병합 해제" })}>해제</RibbonButton>
            <RibbonButton title="셀 나누기 2x2" onClick={() => runTable({ kind: "split", rows: 2, cols: 2 })}>나누기</RibbonButton>
            <RibbonButton title="열 너비 같게" onClick={() => runTable({ kind: "primary", label: "W 같게" })}>W</RibbonButton>
            <RibbonButton title="행 높이 같게" onClick={() => runTable({ kind: "primary", label: "H 같게" })}>H</RibbonButton>
          </RibbonGroup>

          <RibbonGroup label="표 서식">
            <RibbonButton title="굵게" compact onClick={() => runTable({ kind: "style", title: "굵게" })}>B</RibbonButton>
            <RibbonButton title="기울임" compact onClick={() => runTable({ kind: "style", title: "기울임" })}><span className="italic">I</span></RibbonButton>
            <Divider />
            {tableHAligns.map((item) => (
              <RibbonButton key={item.title} title={item.title} compact onClick={() => runTable({ kind: "style", title: item.title })}>
                <AlignIcon mode={item.mode} />
              </RibbonButton>
            ))}
            {tableVAligns.map((item) => (
              <RibbonButton key={item.title} title={item.title} compact onClick={() => runTable({ kind: "style", title: item.title })}>
                <VAlignIcon mode={item.mode} />
              </RibbonButton>
            ))}
            <Divider />
            <span className="text-[10px] font-bold text-inkfaint">배경</span>
            {TABLE_BG_COLORS.map((color, index) => (
              <Swatch key={color || "none"} color={color || "transparent"} title={color ? "배경색" : "배경 지우기"} onClick={() => runTable({ kind: "background", index })} />
            ))}
            <span className="ml-1 text-[10px] font-bold text-inkfaint">글자</span>
            {TABLE_TEXT_COLORS.map((color, index) => (
              <Swatch key={color} color={color} title="표 글자색" onClick={() => runTable({ kind: "textColor", index })} />
            ))}
          </RibbonGroup>
        </>
      )}

      {multi && (
        <RibbonGroup label="정렬">
          <RibbonButton title="왼쪽 맞춤" onClick={() => alignSelection("left")}>좌</RibbonButton>
          <RibbonButton title="가운데 맞춤" onClick={() => alignSelection("hcenter")}>중</RibbonButton>
          <RibbonButton title="오른쪽 맞춤" onClick={() => alignSelection("right")}>우</RibbonButton>
          <Divider />
          <RibbonButton title="선택 박스를 왼쪽 여백에 맞춤" compact onClick={() => positionSelectedBox("left")}><BoxPositionIcon mode="left" /></RibbonButton>
          <RibbonButton title="선택 박스를 가운데 배치" compact onClick={() => positionSelectedBox("center")}><BoxPositionIcon mode="center" /></RibbonButton>
          <RibbonButton title="선택 박스를 오른쪽 여백에 맞춤" compact onClick={() => positionSelectedBox("right")}><BoxPositionIcon mode="right" /></RibbonButton>
          <Divider />
          <RibbonButton title="위 맞춤" onClick={() => alignSelection("top")}>상</RibbonButton>
          <RibbonButton title="세로 가운데 맞춤" onClick={() => alignSelection("vcenter")}>중</RibbonButton>
          <RibbonButton title="아래 맞춤" onClick={() => alignSelection("bottom")}>하</RibbonButton>
          <Divider />
          <RibbonButton title="그룹" onClick={groupSelection}>그룹</RibbonButton>
          <RibbonButton title="그룹 해제" onClick={ungroupSelection}>해제</RibbonButton>
        </RibbonGroup>
      )}
      </div>
    </div>
  );
}







