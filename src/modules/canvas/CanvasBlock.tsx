// CanvasBlock.tsx — 지면 위 블록 하나.
//  - dnd-kit useDraggable로 이동, 클릭으로 선택, 더블클릭으로 인라인 텍스트 편집
//  - 텍스트: 선택 시 8방향 리사이즈 핸들
//  - 표: 기존 앱에서 이관한 table-king 엔진(경계 드래그·병합·셀 스타일·실행취소).
//    크기는 스냅샷에서 파생(setTableData가 w/h 동기화), 이동은 그립 핸들로만
//    (표 내부 클릭은 셀 선택이어야 하므로). SCALE=3.7795라 표 px = 화면 px = mm×SCALE.
//  - 데이터 병합: 텍스트/표는 알약 드롭 대상. 저장의 진실은 {{열이름}} 토큰,
//    화면은 칩 또는 미리보기 값으로 렌더 (하이브리드 전략)
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block, type TableKingData, TEXT_DEFAULTS } from "../document/model";
import { ensureFont, fontByKey, fontCss, useFontStore } from "../document/fonts";
import { SCALE, mmToPx, pxToMm } from "./geometry";
import { useCanvasStore } from "./store";
import { useFollowStore } from "./snap";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { IcGrip, IcCopy, IcTrash } from "../../ui/icons";
import { TableKingBlock, makeTableKingData, tableDataToRows } from "../../table-king/TableKingBlock.jsx";
import "../../table-king/table-king.css";

const MIN_W = 12; // mm
const MIN_H = 8; // mm

// 기존 앱과 같은 table-king 테마 주입 (디자인 토큰 T와 동일 값)
const TK_THEME_VARS = {
  "--tk-ink": "#1A2233",
  "--tk-ink-soft": "#5B6577",
  "--tk-ink-faint": "#98A2B3",
  "--tk-paper": "#F6F7FA",
  "--tk-surface": "#FFFFFF",
  "--tk-line": "#E4E8EF",
  "--tk-line-strong": "#CBD2DE",
  "--tk-accent": "#2B5CE6",
  "--tk-accent-soft": "#EDF2FE",
} as React.CSSProperties;

export function CanvasBlock({ block }: { block: Block }) {
  const select = useCanvasStore((s) => s.select);
  const selectGroup = useCanvasStore((s) => s.selectGroup);
  const toggleSelect = useCanvasStore((s) => s.toggleSelect);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const duplicateBlock = useCanvasStore((s) => s.duplicateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);
  const setLocked = useCanvasStore((s) => s.setLocked);
  // 다중 선택 — 원시값 셀렉터(무한 리렌더 방지): 이 블록이 선택됐나 / 유일 선택인가
  const selected = useCanvasStore((s) => s.selectedIds.includes(block.id));
  const soleSelected = useCanvasStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === block.id);
  const [editing, setEditing] = useState(false);
  const isTable = block.type === "table";
  const locked = !!block.locked;
  // 라벨 칩 표기 (시안 1b) — 표는 R×C
  const typeLabel =
    block.type === "text"
      ? block.flow
        ? "본문"
        : "텍스트"
      : block.type === "table"
        ? `표 · ${(block.data as TableKingData | undefined)?.cells?.length ?? 0}×${(block.data as TableKingData | undefined)?.cells?.[0]?.length ?? 0}`
        : "이미지";

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
    disabled: editing || locked,
  });

  // 드래그 팔로우: 다른 블록이 드래그 중이고 내가 그 이동 집합(트리 자손·그룹 멤버·
  // 다중 선택)에 속하면 같은 델타로 실시간 따라간다. 집합은 StudioEditor가 1회 계산.
  // ⚠ zustand 셀렉터는 원시값 반환 (무한 리렌더 방지).
  const following = useFollowStore(
    (s) => s.activeId !== null && s.activeId !== block.id && (s.members?.has(block.id) ?? false)
  );
  const followX = useFollowStore((s) => (following ? s.dxPx : 0));
  const followY = useFollowStore((s) => (following ? s.dyPx : 0));

  // 8방향 리사이즈 (텍스트/이미지 전용 — 표는 table-king이 자체 크기 조절)
  const startResize = (e: RPointerEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault();
    const s = { px: e.clientX, py: e.clientY, x: block.x, y: block.y, w: block.w, h: block.h };
    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = pxToMm(ev.clientX - s.px);
      const dy = pxToMm(ev.clientY - s.py);
      let { x, y, w, h } = s;
      if (dir.includes("e")) w = s.w + dx;
      if (dir.includes("s")) h = s.h + dy;
      if (dir.includes("w")) {
        x = s.x + dx;
        w = s.w - dx;
      }
      if (dir.includes("n")) {
        y = s.y + dy;
        h = s.h - dy;
      }
      if (w < MIN_W) {
        if (dir.includes("w")) x = s.x + (s.w - MIN_W);
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes("n")) y = s.y + (s.h - MIN_H);
        h = MIN_H;
      }
      updateBlock(block.id, {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
        w: Math.round(w),
        h: Math.round(h),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={setNodeRef}
      data-block-id={block.id}
      {...attributes}
      onPointerDown={(e) => {
        if (editing) return;
        // Ctrl/⌘/Shift+클릭 = 다중 선택 토글, 아니면 단일
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.stopPropagation();
          toggleSelect(block.id);
          return;
        }
        select(block.id);
        // 표 내부 포인터는 셀 선택/경계 드래그 몫 — 블록 이동은 그립 핸들로만. 잠금이면 이동 안 함
        if (!isTable && !locked) listeners?.onPointerDown?.(e);
      }}
      onDoubleClick={() => block.type === "text" && !locked && setEditing(true)}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        // 표는 스냅샷에서, 텍스트는 내용에서 높이 파생(auto-height) — h는 export용 기록
        height: isTable || block.type === "text" ? undefined : mmToPx(block.h),
        minHeight: block.type === "text" ? mmToPx(8) : undefined,
        transform: following
          ? `translate3d(${followX}px, ${followY}px, 0)`
          : CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : following ? 19 : selected ? 10 : 1,
        cursor: editing ? "text" : locked ? "default" : "grab",
        touchAction: "none",
      }}
      className={`group/blk rounded-[3px] bg-white overflow-visible select-none transition-shadow ${
        selected
          ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(43,92,230,0.18)]"
          : "outline outline-1 outline-line hover:outline-accentline"
      } ${isDragging ? "opacity-95 shadow-[0_8px_24px_rgba(26,34,51,0.18)]" : ""}`}
    >
      <div className={`w-full h-full rounded-[2px] ${isTable ? "overflow-visible" : "overflow-hidden"}`}>
        {block.type === "text" ? (
          <TextContent block={block} editing={editing} onDoneEditing={() => setEditing(false)} />
        ) : isTable ? (
          <TableKingContent block={block} active={selected} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-paper text-inkfaint text-[11px]">
            이미지
          </div>
        )}
      </div>

      {block.flow && (
        <span className="absolute -top-2 right-1.5 z-20 rounded-full bg-emerald-600 text-white text-[10px] font-semibold px-1.5 leading-4 pointer-events-none shadow-sm">
          본문
        </span>
      )}
      {/* 잠금 배지 */}
      {locked && selected && (
        <span className="absolute -top-2 -left-2 z-30 w-5 h-5 rounded-md bg-inksoft text-white flex items-center justify-center" style={{ boxShadow: "var(--sh-card)" }}>
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
      {/* 단일 선택 + 미잠금일 때만 편집 어포던스(그립·플로팅 바·핸들). 다중은 outline만 */}
      {soleSelected && !editing && !locked && (
        <>
          {/* 표: 이동 그립만 (table-king 리본·우측 패널이 복제·삭제·서식 담당 — 툴바 중복 방지) */}
          {isTable && (
            <span
              {...listeners}
              onPointerDown={(e) => {
                select(block.id);
                listeners?.onPointerDown?.(e);
              }}
              title="이동"
              className="absolute -top-2.5 -left-2.5 z-40 flex items-center justify-center w-6 h-6 rounded-lg bg-accent text-white cursor-grab"
              style={{ touchAction: "none", boxShadow: "var(--sh-card)" }}
            >
              <IcGrip size={13} />
            </span>
          )}

          {/* 텍스트/이미지: 플로팅 액션 바 — 그룹 선택·잠금·복제·삭제 */}
          {!isTable && (
            <div
              className="absolute -top-[46px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
              style={{ boxShadow: "var(--sh-pop)" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* 그룹에 속하면: 그룹 전체 선택(opt-in) — 단일 클릭은 이 블록만 잡는다 */}
              {block.groupId && (
                <button onClick={() => selectGroup(block.id)} title="그룹 전체 선택" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 4h3.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
              )}
              <button onClick={() => setLocked([block.id], true)} title="잠금" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button onClick={() => duplicateBlock(block.id)} title="복제" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-paper hover:text-ink transition-colors">
                <IcCopy size={14} />
              </button>
              <button onClick={() => removeBlock(block.id)} title="삭제" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-inksoft hover:bg-[color:var(--cat-red-soft)] hover:text-[color:var(--cat-red)] transition-colors">
                <IcTrash size={14} />
              </button>
            </div>
          )}

          {/* 라벨 칩 (시안) — 종류·크기 */}
          <div
            className="absolute -top-[22px] left-0 z-30 flex items-center gap-1.5 px-2 py-0.5 rounded-[6px_6px_6px_0] bg-surface border border-accentline pointer-events-none whitespace-nowrap"
            style={{ boxShadow: "var(--sh-card)" }}
          >
            <span className="w-[5px] h-[5px] rounded-full bg-accent" />
            <span className="text-[10px] font-bold text-ink">{typeLabel}</span>
          </div>

          {/* 리사이즈 코너 핸들 (시안: 8px 흰 사각 + 파란 테두리) */}
          {!isTable &&
            RESIZE_HANDLES.filter((h) =>
              // 텍스트는 높이가 내용에서 파생되므로 좌우(폭)만 조절
              block.type === "text" ? h.dir === "e" || h.dir === "w" : true
            ).map((hdl) => (
              <div
                key={hdl.dir}
                onPointerDown={(e) => startResize(e, hdl.dir)}
                className="absolute z-30 bg-white border-[1.5px] border-accent rounded-[2px]"
                style={hdl.style}
              />
            ))}
        </>
      )}
    </div>
  );
}

const HANDLE = 8;
const off = -HANDLE / 2;
const RESIZE_HANDLES: { dir: string; style: React.CSSProperties }[] = [
  { dir: "nw", style: { top: off, left: off, width: HANDLE, height: HANDLE, cursor: "nwse-resize" } },
  { dir: "ne", style: { top: off, right: off, width: HANDLE, height: HANDLE, cursor: "nesw-resize" } },
  { dir: "sw", style: { bottom: off, left: off, width: HANDLE, height: HANDLE, cursor: "nesw-resize" } },
  { dir: "se", style: { bottom: off, right: off, width: HANDLE, height: HANDLE, cursor: "nwse-resize" } },
  { dir: "n", style: { top: off, left: "50%", marginLeft: off, width: HANDLE, height: HANDLE, cursor: "ns-resize" } },
  { dir: "s", style: { bottom: off, left: "50%", marginLeft: off, width: HANDLE, height: HANDLE, cursor: "ns-resize" } },
  { dir: "w", style: { left: off, top: "50%", marginTop: off, width: HANDLE, height: HANDLE, cursor: "ew-resize" } },
  { dir: "e", style: { right: off, top: "50%", marginTop: off, width: HANDLE, height: HANDLE, cursor: "ew-resize" } },
];

function textStyle(block: Block): React.CSSProperties {
  return {
    fontSize: ptToPx(block.fontSize ?? TEXT_DEFAULTS.fontSize),
    fontWeight: (block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textAlign: block.align ?? TEXT_DEFAULTS.align,
    color: block.color ?? TEXT_DEFAULTS.color,
    // 글꼴 + 전각(1em) 보정 — 폰트 레지스트리가 폰트별 letter-spacing을 실측 캘리브레이션
    // (한글/HWP 조판은 한글을 1em으로 계산 — em 단위라 fontSize별로 정확히 스케일)
    ...fontCss(block.font),
  };
}
const ptToPx = (pt: number) => `${pt * (96 / 72)}px`;

// {{토큰}}을 칩으로, 미리보기 중이면 실제 값(강조)으로 렌더
function TokenText({ text }: { text: string }) {
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  if (dataset && previewIndex !== null) {
    const resolved = resolveTokens(text, dataset.columns, dataset.rows[previewIndex] ?? []);
    if (resolved !== text)
      return <span className="bg-emerald-50 text-emerald-700 rounded-[2px] px-0.5">{resolved}</span>;
    return <>{resolved}</>;
  }

  const parts = text.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = new RegExp(`^${TOKEN_RE.source}$`).exec(p);
        return m ? (
          <span
            key={i}
            className="inline-block align-baseline rounded-full bg-accentsoft text-accent px-1.5 text-[0.85em] leading-normal mx-0.5"
          >
            {m[1].trim()}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

function TextContent({
  block,
  editing,
  onDoneEditing,
}: {
  block: Block;
  editing: boolean;
  onDoneEditing: () => void;
}) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  // 폰트 준비(지연 로딩 + 전각 캘리브레이션) — 완료 시 spacing 구독으로 리렌더되어
  // letter-spacing이 실측값으로 정밀화된다 (auto-height 사이저도 함께 갱신).
  const fontKey = fontByKey(block.font).key;
  useFontStore((s) => s.spacing[fontKey]); // 캘리브레이션 완료 리렌더 트리거
  useEffect(() => {
    void ensureFont(fontKey);
  }, [fontKey]);

  // auto-height: 내용의 자연 높이(사이저)를 관찰해 block.h(mm)로 동기화.
  // "한글에서 열었더니 마지막 줄이 잘림"을 원천 차단 — 내보내는 상자가 항상 내용을 담는다.
  // 사이저 높이는 block.h와 무관(자연 높이)하므로 되먹임 루프가 없다.
  useEffect(() => {
    const el = sizerRef.current;
    if (!el) return;
    const sync = () => {
      const needMm = Math.max(8, Math.ceil((el.offsetHeight + 8) / SCALE) + 1); // 패딩+여유 1mm
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
    // deps는 "시그니처 문자열" 하나로 고정 — RO가 놓치는 갱신(내용/폭/폰트 교체)에도
    // 재실행되면서, 배열 길이가 항상 2라 HMR 중 deps 크기 변화 경고가 안 난다. sync는 멱등.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, `${block.text}|${block.w}|${block.fontSize}|${block.bold}|${block.italic}|${block.font}`]);

  const { setNodeRef, isOver } = useDroppable({
    id: `textdrop:${block.id}`,
    data: { kind: "textblock", blockId: block.id },
  });

  if (editing)
    return (
      <textarea
        ref={taRef}
        value={block.text ?? ""}
        onChange={(e) => {
          updateBlock(block.id, { text: e.target.value });
          // 타이핑 중 즉시 늘어나게 (정확한 동기화는 blur 후 사이저가 담당)
          const ta = taRef.current;
          if (ta && ta.scrollHeight > ta.clientHeight)
            updateBlock(block.id, { h: Math.ceil((ta.scrollHeight + 8) / SCALE) + 1 });
        }}
        onBlur={onDoneEditing}
        onKeyDown={(e) => e.key === "Escape" && onDoneEditing()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...textStyle(block), height: mmToPx(block.h) }}
        className="w-full px-2 py-1 leading-snug bg-white outline-none resize-none border-0"
      />
    );

  return (
    <div
      ref={setNodeRef}
      style={textStyle(block)}
      className={`w-full px-2 py-1 leading-snug ${
        isOver ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2" : ""
      }`}
    >
      <div ref={sizerRef}>
        <TokenText text={block.text ?? ""} />
      </div>
    </div>
  );
}

// ── 표: table-king 엔진 (기존 앱에서 이관) ──
type TableContextMenuState = { x: number; y: number };

type TableMenuItem = {
  label: string;
  action?: string;
  disabled?: boolean;
};

const TABLE_CONTEXT_ITEMS: TableMenuItem[] = [
  { label: "복사", action: "복사" },
  { label: "붙여넣기", action: "붙여넣기" },
  { label: "행 추가", action: "행 추가" },
  { label: "열 추가", action: "열 추가" },
  { label: "행 삭제", action: "행 삭제" },
  { label: "열 삭제", action: "열 삭제" },
  { label: "셀 병합", action: "병합" },
  { label: "셀 나누기", action: "나누기" },
  { label: "테두리", disabled: true },
];

const TABLE_BG_SWATCHES = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 7H4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.8 10.5A7.2 7.2 0 1 1 7 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 7h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 10.5A7.2 7.2 0 1 0 17 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function AlignTopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 10h8M8 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlignMiddleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 8h8M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 10h6M8 14h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BorderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function TableKingContent({ block, active }: { block: Block; active: boolean }) {
  const setTableData = useCanvasStore((s) => s.setTableData);
  const select = useCanvasStore((s) => s.select);
  const [showHandles, setShowHandles] = useState(true);
  const [menu, setMenu] = useState<TableContextMenuState | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dataset = useMergeStore((s) => s.dataset);
  const previewIndex = useMergeStore((s) => s.previewIndex);

  // 알약 드롭 대상 (셀 특정은 StudioEditor가 드롭 좌표의 input으로 해결)
  const { setNodeRef, isOver } = useDroppable({
    id: `tabledrop:${block.id}`,
    data: { kind: "tableblock", blockId: block.id },
  });

  // 구형(rows만 있는) 저장 문서 호환 — 첫 렌더에서 스냅샷으로 승격
  const data: TableKingData =
    block.data ?? (makeTableKingData(block.rows ?? [[""]], 420) as TableKingData);

  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event: globalThis.PointerEvent) => {
      if (shellRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // table-king 원본 액션을 직접 옮기지 않고, 숨겨둔 원본 툴바 버튼을 호출한다.
  const runTableAction = (label: string) => {
    const buttons = Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>(".toolbar button") ?? []);
    const button = buttons.find((item) => item.textContent?.replace(/\s+/g, " ").trim() === label);
    button?.click();
    setMenu(null);
  };

  const runBackground = (index: number) => {
    const swatchGroups = Array.from(shellRef.current?.querySelectorAll<HTMLElement>(".toolbar.secondary .swatch-group") ?? []);
    const swatches = Array.from(swatchGroups[0]?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    swatches[index]?.click();
    setMenu(null);
  };

  const runStyleAction = (title: string) => {
    const button = shellRef.current?.querySelector<HTMLButtonElement>(`.toolbar.secondary button[title="${title}"]`);
    button?.click();
    setMenu(null);
  };

  const preserveContextSelection = (event: RMouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    select(block.id);
  };

  const openContextMenu = (event: RMouseEvent<HTMLDivElement>) => {
    select(block.id);
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const stopToolbarPointer = (event: RMouseEvent | RPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // 병합 미리보기 모드: 편집기 대신 값이 치환된 정적 표 (읽기 전용)
  if (dataset && previewIndex !== null)
    return <StaticResolvedTable data={data} columns={dataset.columns} row={dataset.rows[previewIndex] ?? []} />;

  return (
    <div
      ref={setNodeRef}
      className={isOver ? "outline outline-2 outline-accent -outline-offset-1 rounded-[2px]" : ""}
      data-tableblock={block.id}
    >
      <div
          ref={shellRef}
          className="table-action-shell"
          onMouseDownCapture={preserveContextSelection}
          onContextMenu={openContextMenu}
        >
        <TableKingBlock
          value={data}
          onChange={(next: TableKingData) => setTableData(block.id, next)}
          active={active}
          onActivate={() => select(block.id)}
          showHandles={showHandles}
          setShowHandles={setShowHandles}
          themeVars={TK_THEME_VARS}
        />

        {active && (
          <>
            <div className="table-mini-toolbar table-ribbon" onPointerDown={stopToolbarPointer}>
              <span className="table-ribbon-group" aria-label="실행">
                <button type="button" title="실행 취소" aria-label="실행 취소" onClick={() => runTableAction("실행 취소")}>
                  <UndoIcon />
                </button>
                <button type="button" title="다시 실행" aria-label="다시 실행" onClick={() => runTableAction("다시 실행")}>
                  <RedoIcon />
                </button>
              </span>
              <span className="table-ribbon-group" aria-label="가로 정렬">
                <span className="table-ribbon-label">정렬</span>
                <button type="button" title="왼쪽 정렬" onClick={() => runStyleAction("왼쪽 정렬")}>좌</button>
                <button type="button" title="가운데 정렬" onClick={() => runStyleAction("가운데 정렬")}>중</button>
                <button type="button" title="오른쪽 정렬" onClick={() => runStyleAction("오른쪽 정렬")}>우</button>
              </span>
              <span className="table-ribbon-group" aria-label="세로 정렬">
                <button type="button" title="위쪽 정렬" aria-label="상" onClick={() => runStyleAction("위쪽 정렬")}>
                  <AlignTopIcon />
                </button>
                <button type="button" title="세로 가운데 정렬" aria-label="중" onClick={() => runStyleAction("세로 가운데 정렬")}>
                  <AlignMiddleIcon />
                </button>
                <button type="button" title="아래쪽 정렬" aria-label="하" onClick={() => runStyleAction("아래쪽 정렬")}>
                  <AlignBottomIcon />
                </button>
              </span>
              <span className="table-ribbon-group" aria-label="테두리">
                <button type="button" title="테두리" aria-label="테두리" disabled>
                  <BorderIcon />
                  <span>테두리</span>
                </button>
              </span>
              <span className="table-mini-swatches" aria-label="배경색">
                <span className="table-ribbon-label">배경색</span>
                {TABLE_BG_SWATCHES.map((color, index) => (
                  <button
                    key={color || "transparent"}
                    type="button"
                    title={color ? "배경색" : "배경 지우기"}
                    onClick={() => runBackground(index)}
                    style={{ backgroundColor: color || "#ffffff" }}
                  />
                ))}
              </span>
            </div>

            {menu && (
              <div
                className="table-context-menu"
                style={{ left: menu.x, top: menu.y }}
                onPointerDown={stopToolbarPointer}
                role="menu"
              >
                {TABLE_CONTEXT_ITEMS.map((item, index) => (
                  <Fragment key={item.label}>
                    {index === 2 || index === 6 || index === 8 ? <div className="table-context-separator" /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => item.action && runTableAction(item.action)}
                    >
                      {item.label}
                    </button>
                  </Fragment>
                ))}
                <div className="table-context-separator" />
                <div className="table-context-palette" aria-label="배경색">
                  <span>배경색</span>
                  <div>
                    {TABLE_BG_SWATCHES.map((color, index) => (
                      <button
                        key={color || "transparent"}
                        type="button"
                        title={color ? "배경색" : "배경 지우기"}
                        onClick={() => runBackground(index)}
                        style={{ backgroundColor: color || "#ffffff" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 병합 미리보기용 정적 표 — 병합·행별 너비 반영, 토큰은 값으로 치환
function StaticResolvedTable({
  data,
  columns,
  row,
}: {
  data: TableKingData;
  columns: string[];
  row: string[];
}) {
  const cellsText = tableDataToRows(data) as string[][];
  const merges = data.merges ?? [];
  const covered = (r: number, c: number) =>
    merges.some((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c));
  const mergeAt = (r: number, c: number) => merges.find((m) => m.r === r && m.c === c);

  return (
    <table
      className="border-collapse text-[12px] text-ink"
      style={{ tableLayout: "fixed", width: data.widths[0]?.reduce((s, v) => s + v, 0) }}
    >
      <colgroup>
        {(data.widths[0] ?? []).map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {cellsText.map((r, ri) => (
          <tr key={ri} style={{ height: data.cellHeights[ri]?.[0] ?? 30 }}>
            {r.map((cell, ci) => {
              if (covered(ri, ci)) return null;
              const m = mergeAt(ri, ci);
              const resolved = resolveTokens(cell, columns, row);
              const changed = resolved !== cell;
              return (
                <td
                  key={ci}
                  colSpan={m?.cs ?? 1}
                  rowSpan={m?.rs ?? 1}
                  className={`border border-linestrong px-1.5 ${ri === 0 ? "bg-paper font-medium" : ""}`}
                >
                  {changed ? (
                    <span className="bg-emerald-50 text-emerald-700 rounded-[2px] px-0.5">{resolved}</span>
                  ) : (
                    resolved
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
