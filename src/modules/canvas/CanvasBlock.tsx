// CanvasBlock.tsx — 지면 위 블록 하나.
//  - dnd-kit useDraggable로 이동, 클릭으로 선택, 더블클릭으로 인라인 텍스트 편집
//  - 선택 시 8방향 리사이즈 핸들 (포인터 드래그로 w/h·x/y 조절)
//  - 데이터 병합: 텍스트/셀은 알약 드롭 대상. 저장의 진실은 {{열이름}} 토큰,
//    화면은 칩(chip) 또는 미리보기 값으로 렌더 (하이브리드 전략)
import { Fragment, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block, TEXT_DEFAULTS } from "../document/model";
import { mmToPx, pxToMm } from "./geometry";
import { useCanvasStore } from "./store";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { IcGrip } from "../../ui/icons";

const MIN_W = 12; // mm
const MIN_H = 8; // mm

export function CanvasBlock({ block }: { block: Block }) {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const selected = selectedId === block.id;
  const [editing, setEditing] = useState(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
    disabled: editing, // 편집 중엔 드래그 금지
  });

  // 8방향 리사이즈 — 핸들에서 시작, window에서 pointermove/up 추적 (dnd와 분리)
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
      // 최소 크기 — 좌/상 방향이면 반대편 고정을 위해 x/y 보정
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
      {...attributes}
      onPointerDown={(e) => {
        if (editing) return;
        select(block.id);
        listeners?.onPointerDown?.(e);
      }}
      onDoubleClick={() => block.type === "text" && setEditing(true)}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        height: mmToPx(block.h),
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : selected ? 10 : 1,
        cursor: editing ? "text" : "grab",
        touchAction: "none",
      }}
      className={`group/blk rounded-[3px] bg-white overflow-visible select-none transition-shadow ${
        selected
          ? "outline outline-2 outline-accent shadow-[0_4px_16px_rgba(43,92,230,0.18)]"
          : "outline outline-1 outline-line hover:outline-accentline"
      } ${isDragging ? "opacity-95 shadow-[0_8px_24px_rgba(26,34,51,0.18)]" : ""}`}
    >
      <div className="w-full h-full overflow-hidden rounded-[2px]">
        {block.type === "text" ? (
          <TextContent block={block} editing={editing} onDoneEditing={() => setEditing(false)} />
        ) : block.type === "table" ? (
          <TableContent block={block} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-paper text-inkfaint text-[11px]">
            이미지
          </div>
        )}
      </div>

      {selected && !editing && (
        <>
          <span className="absolute -top-2.5 -left-2.5 z-30 flex items-center justify-center w-5 h-5 rounded-md bg-accent text-white shadow-sm pointer-events-none">
            <IcGrip size={12} />
          </span>
          {RESIZE_HANDLES.map((hdl) => (
            <div
              key={hdl.dir}
              onPointerDown={(e) => startResize(e, hdl.dir)}
              className="absolute z-30 bg-white border border-accent rounded-[2px]"
              style={hdl.style}
            />
          ))}
        </>
      )}
    </div>
  );
}

// 핸들 위치/커서 — 모서리 4 + 변 4
const HANDLE = 9;
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

// 텍스트 스타일 → CSS
function textStyle(block: Block): React.CSSProperties {
  return {
    fontSize: mmToPt(block.fontSize ?? TEXT_DEFAULTS.fontSize),
    fontWeight: (block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textAlign: block.align ?? TEXT_DEFAULTS.align,
    color: block.color ?? TEXT_DEFAULTS.color,
  };
}
const mmToPt = (pt: number) => `${pt * (96 / 72)}px`; // pt → 화면 px

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
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  const { setNodeRef, isOver } = useDroppable({
    id: `textdrop:${block.id}`,
    data: { kind: "textblock", blockId: block.id },
  });

  if (editing)
    return (
      <textarea
        ref={taRef}
        value={block.text ?? ""}
        onChange={(e) => updateBlock(block.id, { text: e.target.value })}
        onBlur={onDoneEditing}
        onKeyDown={(e) => e.key === "Escape" && onDoneEditing()}
        onPointerDown={(e) => e.stopPropagation()}
        style={textStyle(block)}
        className="w-full h-full px-2 py-1 leading-snug bg-white outline-none resize-none border-0"
      />
    );

  return (
    <div
      ref={setNodeRef}
      style={textStyle(block)}
      className={`w-full h-full px-2 py-1 leading-snug overflow-hidden ${
        isOver ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2" : ""
      }`}
    >
      <TokenText text={block.text ?? ""} />
    </div>
  );
}

function DroppableCell({
  blockId,
  r,
  c,
  text,
  isHeader,
}: {
  blockId: string;
  r: number;
  c: number;
  text: string;
  isHeader: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${blockId}:${r}:${c}`,
    data: { kind: "cell", blockId, r, c },
  });
  return (
    <td
      ref={setNodeRef}
      className={`border border-linestrong px-1 ${isHeader ? "bg-paper font-medium" : ""} ${
        isOver ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-1" : ""
      }`}
    >
      <TokenText text={text} />
    </td>
  );
}

function TableContent({ block }: { block: Block }) {
  return (
    <table className="w-full h-full border-collapse text-[11px] text-ink">
      <tbody>
        {(block.rows ?? []).map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <DroppableCell key={c} blockId={block.id} r={r} c={c} text={cell} isHeader={r === 0} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
