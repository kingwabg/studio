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
  type PointerEvent as RPointerEvent,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block, type TableKingData, TEXT_DEFAULTS } from "../document/model";
import { mmToPx, pxToMm } from "./geometry";
import { useCanvasStore } from "./store";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";
import { IcGrip } from "../../ui/icons";
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
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const selected = selectedId === block.id;
  const [editing, setEditing] = useState(false);
  const isTable = block.type === "table";

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
    disabled: editing,
  });

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
      {...attributes}
      onPointerDown={(e) => {
        if (editing) return;
        select(block.id);
        // 표 내부 포인터는 셀 선택/경계 드래그 몫 — 블록 이동은 그립 핸들로만
        if (!isTable) listeners?.onPointerDown?.(e);
      }}
      onDoubleClick={() => block.type === "text" && setEditing(true)}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        height: isTable ? undefined : mmToPx(block.h),
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : selected ? 10 : 1,
        cursor: editing ? "text" : isTable ? "default" : "grab",
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

      {selected && !editing && (
        <>
          {/* 이동 그립 — 표는 이것만이 이동 수단, 텍스트는 장식(전체가 드래그됨) */}
          <span
            {...(isTable ? listeners : {})}
            onPointerDown={
              isTable
                ? (e) => {
                    select(block.id);
                    listeners?.onPointerDown?.(e);
                  }
                : undefined
            }
            className={`absolute -top-2.5 -left-2.5 z-30 flex items-center justify-center w-5 h-5 rounded-md bg-accent text-white shadow-sm ${
              isTable ? "cursor-grab" : "pointer-events-none"
            }`}
            style={{ touchAction: "none" }}
          >
            <IcGrip size={12} />
          </span>
          {!isTable &&
            RESIZE_HANDLES.map((hdl) => (
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

function textStyle(block: Block): React.CSSProperties {
  return {
    fontSize: ptToPx(block.fontSize ?? TEXT_DEFAULTS.fontSize),
    fontWeight: (block.bold ?? TEXT_DEFAULTS.bold) ? 700 : 400,
    fontStyle: (block.italic ?? TEXT_DEFAULTS.italic) ? "italic" : "normal",
    textAlign: block.align ?? TEXT_DEFAULTS.align,
    color: block.color ?? TEXT_DEFAULTS.color,
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

// ── 표: table-king 엔진 (기존 앱에서 이관) ──
function TableKingContent({ block, active }: { block: Block; active: boolean }) {
  const setTableData = useCanvasStore((s) => s.setTableData);
  const select = useCanvasStore((s) => s.select);
  const [showHandles, setShowHandles] = useState(true);
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

  // 병합 미리보기 모드: 편집기 대신 값이 치환된 정적 표 (읽기 전용)
  if (dataset && previewIndex !== null)
    return <StaticResolvedTable data={data} columns={dataset.columns} row={dataset.rows[previewIndex] ?? []} />;

  return (
    <div
      ref={setNodeRef}
      className={isOver ? "outline outline-2 outline-accent -outline-offset-1 rounded-[2px]" : ""}
      data-tableblock={block.id}
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
