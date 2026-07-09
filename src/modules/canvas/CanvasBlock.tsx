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
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  type Block,
  type TableKingData,
  type TextRun,
  TEXT_DEFAULTS,
  padOf,
  blockRuns,
  applyRunStyle,
  rangeRuns,
  normalizeRuns,
  runsToText,
  showingHint,
} from "../document/model";
import { CATEGORY_LABEL, FONTS, ensureFont, fontByKey, fontCss, useFontStore } from "../document/fonts";
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
  const clearAutoEdit = useCanvasStore((s) => s.clearAutoEdit);
  const autoEdit = useCanvasStore((s) => s.autoEditId === block.id);
  // 다중 선택 — 원시값 셀렉터(무한 리렌더 방지): 이 블록이 선택됐나 / 유일 선택인가
  const selected = useCanvasStore((s) => s.selectedIds.includes(block.id));
  const soleSelected = useCanvasStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === block.id);
  const [editing, setEditing] = useState(false);
  const isTable = block.type === "table";
  const isText = block.type === "text";
  const locked = !!block.locked;

  // 텍스트 도구로 방금 생성 → 바로 편집 모드 진입 (커서 깜빡)
  useEffect(() => {
    if (autoEdit) {
      setEditing(true);
      clearAutoEdit();
    }
  }, [autoEdit, clearAutoEdit]);

  // 편집 종료 — 내용이 비면(공백뿐이면) 블록을 지운다. 더블클릭 오발/빈 텍스트 정리.
  // 단, 안내문(placeholder)이 켜진 블록은 "비어있는 게 정상"이므로 지우지 않는다.
  const finishEditing = () => {
    setEditing(false);
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && cur.type === "text" && !(cur.text ?? "").trim() && !(cur.hintOn && cur.hint))
      removeBlock(block.id);
  };
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
      if (block.type === "text") {
        // 텍스트: 폭만 조절(높이는 auto). manualW로 auto-width 해제 → 이 폭에서 줄바꿈.
        // 글자 크기는 절대 건드리지 않는다 (박스만 커지고 폰트는 그대로).
        updateBlock(block.id, { x: Math.max(0, Math.round(x)), w: Math.round(w), manualW: true });
      } else {
        updateBlock(block.id, {
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          w: Math.round(w),
          h: Math.round(h),
        });
      }
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
      className={`group/blk rounded-[3px] overflow-visible select-none transition-[outline-color,box-shadow] ${
        isText ? "" : "bg-white"
      } ${
        selected
          ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(43,92,230,0.18)]"
          : isText
            ? "outline-none hover:outline hover:outline-2 hover:outline-accent" // 텍스트 우선: 평소엔 순수 텍스트, 올려야 테두리
            : "outline outline-1 outline-line hover:outline-2 hover:outline-accent"
      } ${isDragging ? "opacity-95 shadow-[0_8px_24px_rgba(26,34,51,0.18)]" : ""}`}
    >
      <div
        className={`w-full h-full ${isTable ? "overflow-visible" : "overflow-hidden"}`}
        style={{
          borderRadius: block.radius ?? 2,
          background: block.fill || undefined,
          border: block.borderWidth ? `${block.borderWidth}px solid ${block.borderColor || "#1A2233"}` : undefined,
        }}
      >
        {block.type === "text" ? (
          <TextContent block={block} editing={editing} onDoneEditing={finishEditing} />
        ) : isTable ? (
          <TableKingContent block={block} active={selected} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-paper text-inkfaint text-[11px]">
            이미지
          </div>
        )}
      </div>

      {/* 고정 배지 — 클릭하면 해제(그룹이면 그룹 전체). 잠긴 요소는 플로팅바가 없어
          이 배지가 유일한 해제 통로다. */}
      {locked && selected && (
        <button
          title={block.groupId ? "그룹 고정 해제" : "고정 해제"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const all = useCanvasStore.getState().doc.blocks;
            const ids = block.groupId ? all.filter((b) => b.groupId === block.groupId).map((b) => b.id) : [block.id];
            setLocked(ids, false);
          }}
          className="absolute -top-2 -left-2 z-40 w-5 h-5 rounded-md bg-inksoft text-white flex items-center justify-center hover:bg-ink transition-colors"
          style={{ boxShadow: "var(--sh-card)" }}
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6M2.6 6h8.8v6H2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
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

          {/* 리사이즈 코너 핸들 (시안: 8px 흰 사각 + 파란 테두리) */}
          {!isTable &&
            RESIZE_HANDLES.filter((h) =>
              // 텍스트: 모서리 4점 + 좌우 — 전부 폭만 조절(높이 auto). 순수 상하(n/s)는 제외.
              block.type === "text" ? h.dir !== "n" && h.dir !== "s" : true
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

// 런(run) 하나의 화면 스타일 — 블록 기본값 위에 런이 지정한 속성만 덮어쓴다.
// 굵기·기울임·색은 항상 명시(런 없으면 블록값), 크기·글꼴은 런이 지정할 때만 덮어써
// 나머지는 컨테이너(textStyle) 상속을 그대로 받게 한다 → 전각 보정·크기 정합 유지.
function runCssObj(block: Block, run: TextRun): React.CSSProperties {
  return {
    fontWeight: (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    color: run.color ?? block.color ?? TEXT_DEFAULTS.color,
    ...(run.fontSize != null ? { fontSize: ptToPx(run.fontSize) } : {}),
    ...(run.font ? fontCss(run.font) : {}),
  };
}

// 읽기 모드: 런을 스타일 span으로, 각 span 안에서 {{토큰}}은 칩으로 렌더
function RichRead({ block }: { block: Block }) {
  const runs = blockRuns(block);
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} style={runCssObj(block, run)}>
          <TokenText text={run.text} />
        </span>
      ))}
    </>
  );
}

// ── auto-width 측정 (canvas) ──
// 예전엔 visibility:hidden 사이저를 하나 더 그려 폭을 쟀지만, DOM에 텍스트가 두 번
// 생겨 검사기에서 헷갈렸다 → 제거. 이제 텍스트는 화면 사이저 "하나"뿐이고, 폭은
// canvas.measureText로 잰다(런별 폰트·크기·굵기·기울임 + 전각 보정 letter-spacing 반영).
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  return _measureCtx;
}

// 런들을 \n 기준으로 줄 배열로 쪼갠다 (각 줄 = 런 배열, 서식 유지)
function splitRunsIntoLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines;
}

// 줄바꿈 없는 "가장 긴 줄"의 자연 폭(px) — auto-width가 이 값 + 좌우 패딩으로 박스를 맞춘다.
// letter-spacing은 브라우저가 글자마다 뒤에 붙이므로 em×px×글자수로 근사(±1mm 허용).
function measureNaturalWidthPx(block: Block, spacing: Record<string, number>): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  const lines = showingHint(block)
    ? (block.hint ?? "").split("\n").map((l) => [{ text: l } as TextRun])
    : splitRunsIntoLines(blockRuns(block));
  let max = 0;
  for (const line of lines) {
    let w = 0;
    for (const run of line) {
      const def = fontByKey(run.font ?? block.font);
      const sizePx = (run.fontSize ?? block.fontSize ?? TEXT_DEFAULTS.fontSize) * (96 / 72);
      const weight = (run.bold ?? block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400;
      const italic = (run.italic ?? block.italic ?? TEXT_DEFAULTS.italic) ? "italic " : "";
      ctx.font = `${italic}${weight} ${sizePx}px "${def.webFamily}", "Malgun Gothic", sans-serif`;
      const em = spacing[def.key] ?? 0.06;
      w += ctx.measureText(run.text).width + em * sizePx * run.text.length;
    }
    if (w > max) max = w;
  }
  return max;
}

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

// ═════════════════ 인라인 리치 텍스트: contentEditable 직렬화 ═════════════════
// 편집 표면은 contentEditable(런=span). 진실은 스토어의 runs다. 타이핑 중에는 DOM을
// 다시 그리지 않고(한글 IME·커서 보존), input에서 DOM→runs로 읽어 스토어에 반영한다.
// 서식 적용(선택 구간)만 DOM을 다시 그리고 오프셋으로 커서를 복원한다.

// 런 → span 엘리먼트. dataset이 직렬화의 진실(readRunStyle이 이것만 읽는다).
// inline style은 보이기용 — 브라우저가 span을 쪼개도 dataset이 함께 복제돼 서식이 산다.
function runToSpanEl(block: Block, run: TextRun): HTMLSpanElement {
  const span = document.createElement("span");
  // bold/italic은 3-상태 — 명시값(true/false)만 dataset에 기록(undefined=상속은 미기록).
  if (run.bold !== undefined) span.dataset.b = run.bold ? "1" : "0";
  if (run.italic !== undefined) span.dataset.i = run.italic ? "1" : "0";
  if (run.color) span.dataset.color = run.color;
  if (run.fontSize != null) span.dataset.size = String(run.fontSize);
  if (run.font) span.dataset.font = run.font;
  Object.assign(span.style, runCssObj(block, run) as Record<string, string>);
  span.textContent = run.text;
  return span;
}

// contentEditable을 현재 런으로 채운다 (편집 진입·서식 적용 시). 빈 텍스트면 비운다.
function seedEditable(el: HTMLElement, block: Block, runs: TextRun[]) {
  if (runs.length <= 1 && !(runs[0]?.text ?? "")) {
    el.replaceChildren();
    return;
  }
  el.replaceChildren(...runs.map((r) => runToSpanEl(block, r)));
}

function readRunStyle(el: HTMLElement): Partial<TextRun> {
  const d = el.dataset;
  const st: Partial<TextRun> = {};
  if (d.b !== undefined) st.bold = d.b === "1"; // "0"=강제 보통도 보존
  if (d.i !== undefined) st.italic = d.i === "1";
  if (d.color) st.color = d.color;
  if (d.size) st.fontSize = Number(d.size);
  if (d.font) st.font = d.font;
  return st;
}

// DOM(편집 중 자유 변형된 상태) → 정규화된 런 배열. 줄바꿈은 \n 텍스트·BR·블록경계 모두 흡수.
function domToRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, style: Partial<TextRun>) => {
    if (text) runs.push({ text, ...style });
  };
  const walk = (node: Node, style: Partial<TextRun>) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child as Text).data, style);
      } else if (child.nodeName === "BR") {
        push("\n", style);
      } else if (child instanceof HTMLElement) {
        const isBlock = /^(DIV|P)$/.test(child.nodeName);
        // 엔터로 생긴 블록 요소 앞에는 줄바꿈 (이미 \n로 끝났으면 생략 — 중복 방지)
        if (isBlock && runs.length && !runsToText(runs).endsWith("\n")) push("\n", style);
        walk(child, { ...style, ...readRunStyle(child) });
      }
    });
  };
  walk(root, {});
  return normalizeRuns(runs);
}

// 선택 지점(node,offset)의 root 기준 평문 오프셋 — BR은 1글자, 텍스트는 그 길이로 계산
function textOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  let count = 0;
  let done = false;
  const walk = (n: Node): void => {
    if (done) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) count += offset;
      else for (let i = 0; i < offset; i++) count += (n.childNodes[i]?.textContent?.length ?? 0);
      done = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      count += (n as Text).data.length;
    } else if (n.nodeName === "BR") {
      count += 1;
    } else {
      n.childNodes.forEach(walk);
    }
  };
  walk(root);
  return count;
}

// 현재 선택의 [start,end] 오프셋 (root 안이고 접혀있지 않을 때만)
function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = textOffsetOf(root, range.startContainer, range.startOffset);
  const b = textOffsetOf(root, range.endContainer, range.endOffset);
  return a <= b ? [a, b] : [b, a];
}

// 평문 오프셋 → DOM 위치 (커서 복원용)
function locateOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
  let count = 0;
  let result: { node: Node; offset: number } | null = null;
  const walk = (n: Node): void => {
    if (result) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n as Text).data.length;
      if (target <= count + len) {
        result = { node: n, offset: target - count };
        return;
      }
      count += len;
    } else if (n.nodeName === "BR") {
      count += 1;
    } else {
      n.childNodes.forEach(walk);
    }
  };
  walk(root);
  return result ?? { node: root, offset: root.childNodes.length };
}

function setSelectionRange(root: HTMLElement, start: number, end: number) {
  const s = locateOffset(root, start);
  const e = locateOffset(root, end);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretEnd(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// 캐럿 자리에 평문 삽입 (엔터=\n·붙여넣기 정규화용) — pre-wrap이라 \n이 줄바꿈으로 보인다
function insertTextAtCaret(text: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tn = document.createTextNode(text);
  range.insertNode(tn);
  range.setStartAfter(tn);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

type InlineSel = { rect: DOMRect; bold: boolean; italic: boolean; color?: string; fontSize?: number; font?: string };

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
  const setRichText = useCanvasStore((s) => s.setRichText);
  const pageW = useCanvasStore((s) => s.doc.page.w);
  const editRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  // 마지막 유효 선택 오프셋 — 서식바(폰트 드롭다운 등)로 포커스가 옮겨가 선택이 사라져도
  // 이 값으로 구간을 되찾아 서식을 적용한다.
  const selRef = useRef<[number, number] | null>(null);
  const [sel, setSel] = useState<InlineSel | null>(null);
  const pad = padOf(block);
  const padXpx = mmToPx(pad.x);
  const padYpx = mmToPx(pad.y);
  const padStyle = { paddingLeft: padXpx, paddingRight: padXpx, paddingTop: padYpx, paddingBottom: padYpx };

  const fontKey = fontByKey(block.font).key;
  useFontStore((s) => s.spacing[fontKey]); // 캘리브레이션 완료 리렌더 트리거
  useEffect(() => {
    void ensureFont(fontKey);
  }, [fontKey]);

  // 편집 중 높이 동기화 — contentEditable 자연 높이(패딩 포함)를 block.h로
  const syncEditH = () => {
    const el = editRef.current;
    if (!el) return;
    const needMm = Math.max(8, Math.ceil(el.offsetHeight / SCALE) + 1);
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
  };

  // 편집 진입 — 현재 런으로 contentEditable을 채우고 커서를 끝에 둔다 (1회, editing 토글에만)
  useEffect(() => {
    if (!editing) {
      setSel(null);
      selRef.current = null;
      return;
    }
    const el = editRef.current;
    if (!el) return;
    seedEditable(el, block, blockRuns(block));
    el.focus();
    placeCaretEnd(el);
    syncEditH();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 편집 중 선택 변화 → 서식바 위치·활성 상태 갱신 (구간 선택일 때만 표시)
  useEffect(() => {
    if (!editing) return;
    const onSelChange = () => {
      const el = editRef.current;
      if (!el) return;
      // 서식바 컨트롤에 포커스가 있으면(폰트 드롭다운 등) 유지 — 선택이 사라져도 숨기지 않음
      if (toolbarRef.current?.contains(document.activeElement)) return;
      const offs = selectionOffsets(el);
      if (!offs || offs[0] === offs[1]) {
        setSel(null);
        return;
      }
      selRef.current = offs;
      const range = window.getSelection()!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const rr = rangeRuns(domToRuns(el), offs[0], offs[1]);
      const all = (pred: (r: TextRun) => boolean) => rr.length > 0 && rr.every(pred);
      const same = <T,>(get: (r: TextRun) => T): T | undefined => {
        if (!rr.length) return undefined;
        const first = get(rr[0]);
        return rr.every((r) => get(r) === first) ? first : undefined;
      };
      setSel({
        rect,
        bold: all((r) => (r.bold ?? block.bold ?? false) === true),
        italic: all((r) => (r.italic ?? block.italic ?? false) === true),
        color: same((r) => r.color ?? block.color ?? TEXT_DEFAULTS.color),
        fontSize: same((r) => r.fontSize ?? block.fontSize ?? TEXT_DEFAULTS.fontSize),
        font: same((r) => r.font ?? block.font),
      });
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, block]);

  // DOM→runs 반영 (타이핑·삭제·붙여넣기). IME 조합 중엔 건너뛰고 compositionend에서 처리.
  const flushRuns = () => {
    const el = editRef.current;
    if (!el || composingRef.current) return;
    setRichText(block.id, domToRuns(el));
    syncEditH();
  };

  // 선택 구간에 서식 패치 적용 — DOM을 다시 그리고 커서를 복원한다
  const applyStyle = (patch: Partial<Omit<TextRun, "text">>) => {
    const el = editRef.current;
    const offs = selRef.current;
    if (!el || !offs || offs[0] === offs[1]) return;
    const next = applyRunStyle(domToRuns(el), offs[0], offs[1], patch);
    seedEditable(el, block, next);
    setRichText(block.id, next);
    el.focus();
    setSelectionRange(el, offs[0], offs[1]);
    syncEditH();
  };

  // auto-height (읽기 모드) — 내용 자연 높이를 관찰해 block.h로. 편집 중엔 syncEditH가 담당.
  const sizerRef = useRef<HTMLDivElement>(null);
  // 전각 보정 spacing 맵 — 폰트 캘리브레이션 완료 시 갱신돼 폭 재측정 트리거
  const spacing = useFontStore((s) => s.spacing);
  useEffect(() => {
    if (editing) return;
    const el = sizerRef.current;
    if (!el) return;
    const sync = () => {
      const needMm = Math.max(8, Math.ceil((el.offsetHeight + padYpx * 2) / SCALE) + 1);
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (cur && Math.abs((cur.h ?? 0) - needMm) >= 1) updateBlock(block.id, { h: needMm });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, editing, `${block.text}|${block.w}|${block.fontSize}|${block.bold}|${block.italic}|${block.font}|${block.padY}|${(block.runs ?? []).length}|${block.hint}|${block.hintOn}`]);

  // auto-width — canvas로 잰 자연 폭 + 좌우 패딩으로 박스 폭을 글자에 맞춘다(캔바식).
  // 숨은 DOM 사이저가 없어졌으므로 ResizeObserver 대신 canvas 측정. 지면 밖으로는 못 나감.
  useEffect(() => {
    if (editing || block.manualW) return;
    const naturalPx = measureNaturalWidthPx(block, spacing);
    const needMm = Math.min(pageW - block.x, Math.max(20, Math.ceil((naturalPx + padXpx * 2) / SCALE) + 1));
    const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
    if (cur && Math.abs((cur.w ?? 0) - needMm) >= 1) updateBlock(block.id, { w: needMm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.manualW, block.x, pageW, editing, spacing, padXpx, `${block.text}|${block.fontSize}|${block.bold}|${block.italic}|${block.font}|${(block.runs ?? []).length}|${block.hint}|${block.hintOn}`]);

  const { setNodeRef, isOver } = useDroppable({
    id: `textdrop:${block.id}`,
    data: { kind: "textblock", blockId: block.id },
  });

  if (editing)
    return (
      <>
        <div
          key="editor"
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={flushRuns}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            flushRuns();
          }}
          onPaste={(e) => {
            // 붙여넣기는 평문으로 — 외부 서식 HTML 유입을 막아 직렬화를 단순하게 유지
            e.preventDefault();
            insertTextAtCaret(e.clipboardData.getData("text/plain"));
            flushRuns();
          }}
          onBlur={(e) => {
            // 서식바로 포커스가 옮겨간 blur는 편집 종료가 아님 (폰트 드롭다운 등)
            if (toolbarRef.current?.contains(e.relatedTarget as Node | null)) return;
            onDoneEditing();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onDoneEditing();
              return;
            }
            // 엔터=\n (pre-wrap이 줄바꿈으로 렌더). 브라우저 기본(div/br)을 막아 직렬화 단순화.
            // IME 조합 확정 엔터는 통과(isComposing) — 줄바꿈이 아니라 글자 확정이어야 한다.
            if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              insertTextAtCaret("\n");
              flushRuns();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...textStyle(block), ...padStyle, whiteSpace: "pre-wrap", minHeight: mmToPx(8) }}
          className="w-full leading-snug bg-white outline-none border-0 cursor-text"
        />
        {sel &&
          createPortal(
            <InlineToolbar
              sel={sel}
              toolbarRef={toolbarRef}
              onApply={applyStyle}
              defaults={{
                bold: block.bold ?? TEXT_DEFAULTS.bold,
                italic: block.italic ?? TEXT_DEFAULTS.italic,
              }}
            />,
            document.body
          )}
      </>
    );

  // 안내문(placeholder) 표시 여부 — 비었고 토글 켜졌을 때 회색 안내문을 내용 대신 렌더.
  // 사이저도 안내문 기준으로 재므로 빈 블록이 안내문 크기만큼 자리를 차지한다.
  const hinting = showingHint(block);
  return (
    <div
      key="reader"
      ref={setNodeRef}
      style={{ ...textStyle(block), ...padStyle }}
      className={`w-full leading-snug ${
        isOver ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2" : ""
      }`}
    >
      {/* 텍스트는 이 사이저 하나뿐 — 폭은 canvas로 재므로 숨은 복사본이 없다(DOM에 텍스트 1개) */}
      <div ref={sizerRef} style={{ whiteSpace: "pre-wrap" }}>
        {hinting ? <span style={{ color: "var(--inkfaint)" }}>{block.hint}</span> : <RichRead block={block} />}
      </div>
    </div>
  );
}

// ── 선택 위 플로팅 서식바 (굵게·기울임·색·크기·글꼴) ──
const INLINE_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#D64550", "#3B9B6B", "#C77A28"];

function InlineToolbar({
  sel,
  toolbarRef,
  onApply,
  defaults,
}: {
  sel: InlineSel;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onApply: (patch: Partial<Omit<TextRun, "text">>) => void;
  defaults: { bold: boolean; italic: boolean };
}) {
  // 토글 끄기 값 — 블록 기본이 이미 보통이면 상속(undefined)으로 되돌리고, 블록이 굵으면
  // 명시적 false로 덮는다(그래야 인접 상속 런과 병합되지 않고 그 구간만 보통이 된다).
  const offBold = defaults.bold ? false : undefined;
  const offItalic = defaults.italic ? false : undefined;
  const [fontOpen, setFontOpen] = useState(false);
  // 서식바 위치 — 선택 사각 위쪽 중앙. 화면 밖으로 나가지 않게 좌우 클램프.
  const top = Math.max(8, sel.rect.top - 46);
  const left = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2), window.innerWidth - 8);
  const size = sel.fontSize ?? TEXT_DEFAULTS.fontSize;
  // 굵게/기울임 토글: 켜져 있으면 끄기(false로 명시 — 블록 기본이 굵을 수도 있으므로)
  const btn = "w-[28px] h-[28px] rounded-[7px] flex items-center justify-center text-inksoft hover:bg-paper transition-colors";
  const btnOn = "bg-accentsoft text-accent";

  return (
    <div
      ref={toolbarRef}
      // 포인터다운 기본 차단 → contentEditable 선택 유지(포커스·하이라이트 안 뺏김)
      onPointerDown={(e) => e.preventDefault()}
      style={{ position: "fixed", top, left, transform: "translateX(-50%)", zIndex: 70, boxShadow: "var(--sh-pop)" }}
      className="flex items-center gap-px p-[3px] rounded-[11px] bg-surface border border-line"
    >
      <button className={`${btn} ${sel.bold ? btnOn : ""} font-extrabold text-[13px]`} title="굵게 (선택 구간)" onClick={() => onApply({ bold: sel.bold ? offBold : true })}>
        가
      </button>
      <button className={`${btn} ${sel.italic ? btnOn : ""} italic text-[13px]`} title="기울임 (선택 구간)" onClick={() => onApply({ italic: sel.italic ? offItalic : true })}>
        가
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 크기 스테퍼 */}
      <button className={`${btn} text-[15px]`} title="작게" onClick={() => onApply({ fontSize: Math.max(6, Math.round((size - 0.5) * 2) / 2) })}>
        −
      </button>
      <span className="text-[11px] font-semibold text-ink tabular-nums w-8 text-center">{size}</span>
      <button className={`${btn} text-[15px]`} title="크게" onClick={() => onApply({ fontSize: Math.round((size + 0.5) * 2) / 2 })}>
        ＋
      </button>
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 색 */}
      {INLINE_COLORS.map((c) => (
        <button
          key={c}
          title={`색 ${c}`}
          onClick={() => onApply({ color: c })}
          className="w-[18px] h-[18px] rounded-full mx-[1px] transition-transform hover:scale-[1.15] shrink-0"
          style={{ backgroundColor: c, border: `2px solid ${(sel.color ?? "").toUpperCase() === c.toUpperCase() ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.1)" }}
        />
      ))}
      <span className="w-px h-5 bg-line mx-0.5" />
      {/* 글꼴 — 커스텀 팝오버(네이티브 select는 blur로 선택 잃음) */}
      <div className="relative">
        <button
          className="h-[28px] px-2 rounded-[7px] text-[11.5px] text-ink hover:bg-paper transition-colors flex items-center gap-1 whitespace-nowrap max-w-[92px]"
          title="글꼴 (선택 구간)"
          onClick={() => setFontOpen((v) => !v)}
        >
          <span className="truncate">{fontByKey(sel.font).label}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {fontOpen && (
          <div
            className="absolute left-0 top-[32px] w-[168px] max-h-[240px] overflow-auto rounded-[9px] bg-surface border border-line py-1 z-10"
            style={{ boxShadow: "var(--sh-pop)" }}
          >
            {(["gothic", "myeongjo", "display", "hand", "safe", "compat"] as const).map((cat) => {
              const inCat = FONTS.filter((f) => f.category === cat);
              if (!inCat.length) return null;
              return (
                <div key={cat}>
                  <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold text-inkfaint tracking-[.06em]">{CATEGORY_LABEL[cat]}</div>
                  {inCat.map((f) => (
                    <button
                      key={f.key}
                      className={`w-full text-left px-2.5 py-1 text-[12px] hover:bg-paper transition-colors ${sel.font === f.key ? "text-accent font-bold" : "text-ink"}`}
                      onClick={() => {
                        void ensureFont(f.key);
                        onApply({ font: f.key });
                        setFontOpen(false);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
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
