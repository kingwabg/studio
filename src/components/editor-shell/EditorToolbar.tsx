// EditorToolbar.tsx — 선택한 요소에 맞춰 필요한 기능만 보여주는 컨텍스트 리본.
import { type ReactNode } from "react";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, TEXT_DEFAULTS } from "../../modules/document/model";
import { FontSelect } from "./FontSelect";
import { ColorPopover } from "./ColorPopover";
import { RibbonDropdown, DropSection, DropIconButton } from "./RibbonDropdown";
import { DsIcon } from "../../ui/design-icons";
import { TEXT_COLOR_PRESETS } from "../../ui/presets";

// 글자색 프리셋 정본은 ui/presets.ts — 재선언 금지(4벌 표류 감사)
import { BG_SWATCHES as TABLE_BG_COLORS } from "../../table-king/table/constants.js"; // 원본 사본 금지 — TableContent와 같은 인덱스 계약
const TABLE_TEXT_COLORS = ["#111827", "#ef4444", "#2563eb", "#16a34a", "#9333ea"];
const SAFE_MARGIN_MM = 20;

type TableRibbonCommand =
  | { kind: "primary"; label: string }
  | { kind: "style"; title: string }
  | { kind: "background"; index: number }
  | { kind: "textColor"; index: number }
  | { kind: "stylePatch"; style: Record<string, string | undefined> }
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

// 디자인: 그룹 박스/라벨 없이 평평하게 나열, 그룹 사이는 얇은 세로 구분선(Divider)으로만 구분.
function RibbonGroup({ label, children }: { label: string; children: ReactNode; hideLabel?: boolean }) {
  return (
    <section className="flex items-center gap-0.5" aria-label={label}>
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
      className={`studio-ribbon-button ${compact ? "h-8 w-8" : "h-8 min-w-8 px-2.5"} rounded-lg flex items-center justify-center gap-1 text-[12px] font-bold transition-colors ${
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
  return <DsIcon name={`align-${mode}`} />;
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
function BorderScopeIcon({ mode }: { mode: "all" | "outer" | "inner" | "none" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mode === "all" && (<><path d="M4 4h16v16H4Z" /><path d="M4 12h16M12 4v16" /></>)}
      {mode === "outer" && (<><path d="M4 12h16M12 4v16" opacity="0.32" /><path d="M4 4h16v16H4Z" strokeWidth="2.1" /></>)}
      {mode === "inner" && (<><path d="M4 4h16v16H4Z" opacity="0.32" /><path d="M4 12h16M12 4v16" strokeWidth="2.1" /></>)}
      {mode === "none" && (<><path d="M4 4h16v16H4M4 12h16M12 4v16" opacity="0.32" /><path d="M5 19 19 5" strokeWidth="2.1" /></>)}
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
  const groupSelection = useCanvasStore((s) => s.groupSelection);
  const ungroupSelection = useCanvasStore((s) => s.ungroupSelection);
  const alignSelection = useCanvasStore((s) => s.alignSelection);

  const isText = block?.type === "text";
  const isTable = block?.type === "table";
  const multi = selectedIds.length > 1;
  const showTextTools = isText && !multi;
  const showTableTools = isTable && !multi;
  const size = block?.fontSize ?? TEXT_DEFAULTS.fontSize;
  const align = block?.align ?? TEXT_DEFAULTS.align;
  const valign = block?.valign ?? "top";
  const textColor = (block?.color ?? TEXT_DEFAULTS.color).toUpperCase();

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
    if (command.kind === "stylePatch") {
      window.dispatchEvent(new CustomEvent("studio:table-apply-style", { detail: { blockId: block.id, style: command.style } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("studio:table-ribbon", { detail: { blockId: block.id, ...command } }));
  };


  const TEXT_HALIGNS = [
    { title: "왼쪽", mode: "left" as const },
    { title: "가운데", mode: "center" as const },
    { title: "오른쪽", mode: "right" as const },
  ];
  const TEXT_VALIGNS = [
    { title: "위", mode: "top" as const },
    { title: "가운데", mode: "center" as const },
    { title: "아래", mode: "bottom" as const },
  ];
  const BORDER_SCOPES = [
    { scope: "all" as const, title: "전체" },
    { scope: "outer" as const, title: "외곽" },
    { scope: "inner" as const, title: "중앙" },
    { scope: "none" as const, title: "없음" },
  ];

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
    <div className="studio-toolbar-shell shrink-0 h-10 overflow-x-auto overflow-y-visible border-b border-line bg-surface px-2.5 relative z-[2]">
      <div className="studio-toolbar-track flex h-full w-full items-center gap-1.5">
      {showTextTools && (
        <>
          <RibbonGroup label="텍스트">
            <FontSelect value={block?.font} disabled={!isText} onChange={(key) => patch({ font: key })} />
            <div className="flex h-8 items-center overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => patch({ fontSize: Math.max(6, size - 0.5) })} className="h-full w-7 text-[15px] text-inksoft hover:bg-paper">−</button>
              <span className="flex h-full w-9 items-center justify-center text-[12.5px] font-bold text-ink">{size}</span>
              <button type="button" onClick={() => patch({ fontSize: size + 0.5 })} className="h-full w-7 text-[15px] text-inksoft hover:bg-paper">＋</button>
            </div>
            <RibbonButton title="굵게" active={!!block?.bold} compact onClick={() => patch({ bold: !block?.bold })}><DsIcon name="bold" size={15} /></RibbonButton>
            <RibbonButton title="기울임" active={!!block?.italic} compact onClick={() => patch({ italic: !block?.italic })}><DsIcon name="italic" size={15} /></RibbonButton>
            <RibbonButton title="밑줄" active={!!block?.underline} compact onClick={() => patch({ underline: !block?.underline })}><DsIcon name="underline" size={15} /></RibbonButton>
            <RibbonButton title="취소선" active={!!block?.strike} compact onClick={() => patch({ strike: !block?.strike })}><DsIcon name="strikethrough" size={15} /></RibbonButton>
            <Divider />
            <ColorPopover
              label="글자색"
              glyph="A"
              value={block?.color ?? TEXT_DEFAULTS.color}
              presets={TEXT_COLOR_PRESETS}
              onChange={(color) => patch({ color })}
            />
          </RibbonGroup>

          <RibbonDropdown label="텍스트 정렬" icon={<AlignIcon mode={align === "center" ? "center" : align === "right" ? "right" : "left"} />}>
            <DropSection label="가로">
              {TEXT_HALIGNS.map((item) => (
                <DropIconButton key={item.mode} title={item.title} active={align === item.mode} onClick={() => patch({ align: item.mode })}>
                  <AlignIcon mode={item.mode} />
                </DropIconButton>
              ))}
            </DropSection>
            <DropSection label="세로">
              {TEXT_VALIGNS.map((item) => (
                <DropIconButton key={item.mode} title={item.title} active={valign === item.mode} onClick={() => patch({ valign: item.mode })}>
                  <VAlignIcon mode={item.mode === "center" ? "middle" : item.mode} />
                </DropIconButton>
              ))}
            </DropSection>
          </RibbonDropdown>

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
            <span className="text-[10px] font-bold text-inkfaint">배경</span>
            <ColorPopover
              label="셀 배경"
              value={TABLE_BG_COLORS[0]}
              presets={TABLE_BG_COLORS.filter(Boolean)}
              allowTransparent
              transparentLabel="지우기"
              shape="square"
              onChange={(color) => runTable({ kind: "stylePatch", style: { backgroundColor: color === "transparent" ? undefined : color } })}
            />
            <span className="ml-1 text-[10px] font-bold text-inkfaint">글자</span>
            <ColorPopover
              label="표 글자색"
              value={TABLE_TEXT_COLORS[0]}
              presets={TABLE_TEXT_COLORS}
              onChange={(color) => runTable({ kind: "stylePatch", style: { color } })}
            />
          </RibbonGroup>

          <RibbonDropdown label="표 정렬" icon={<AlignIcon mode="center" />}>
            <DropSection label="가로 위치">
              {tableHAligns.map((item) => (
                <DropIconButton key={item.title} title={item.title} onClick={() => runTable({ kind: "style", title: item.title })}>
                  <AlignIcon mode={item.mode} />
                </DropIconButton>
              ))}
            </DropSection>
            <DropSection label="셀 세로 정렬">
              {tableVAligns.map((item) => (
                <DropIconButton key={item.title} title={item.title} onClick={() => runTable({ kind: "style", title: item.title })}>
                  <VAlignIcon mode={item.mode} />
                </DropIconButton>
              ))}
            </DropSection>
          </RibbonDropdown>

          <RibbonDropdown label="표 테두리" icon={<BorderScopeIcon mode="all" />}>
            <DropSection label="적용 범위">
              {BORDER_SCOPES.map((item) => (
                <DropIconButton
                  key={item.scope}
                  title={item.title}
                  active={(block?.borderScope ?? "all") === item.scope}
                  onClick={() => patch({ borderScope: item.scope })}
                >
                  <BorderScopeIcon mode={item.scope} />
                </DropIconButton>
              ))}
            </DropSection>
          </RibbonDropdown>
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

      {/* 디자인: 우측 끝 "…블록 편집 중" 상태 pill */}
      {block && !multi && (
        <div
          className="ml-auto flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold"
          style={{ background: "var(--accentsoft)", color: "var(--accenttext)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--guide)" }} />
          {isText ? "텍스트 블록 편집 중" : isTable ? "표 블록 편집 중" : "블록 편집 중"}
        </div>
      )}
      </div>
    </div>
  );
}











