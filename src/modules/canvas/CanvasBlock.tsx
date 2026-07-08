// CanvasBlock.tsx — 지면 위 블록 하나. dnd-kit useDraggable로 이동, 클릭으로 선택.
// 데이터 병합: 텍스트 블록과 표 셀은 "데이터 알약"의 드롭 대상이기도 하다.
// 저장의 진실은 {{열이름}} 토큰 문자열 — 화면에서는 칩(chip)으로, 미리보기
// 모드에서는 선택한 레코드의 실제 값으로 렌더한다 (하이브리드 전략).
import { Fragment } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block } from "../document/model";
import { mmToPx } from "./geometry";
import { useCanvasStore } from "./store";
import { useMergeStore } from "../merge/store";
import { TOKEN_RE, resolveTokens } from "../merge/resolve";

export function CanvasBlock({ block }: { block: Block }) {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const selected = selectedId === block.id;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block" },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      // 선택과 드래그를 한 핸들러로 합친다 — listeners를 스프레드한 뒤 onPointerDown을
      // 따로 주면 dnd 리스너가 덮여 드래그가 죽는다. 그래서 명시적으로 둘 다 호출.
      onPointerDown={(e) => {
        select(block.id);
        listeners?.onPointerDown?.(e);
      }}
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        height: mmToPx(block.h),
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : selected ? 10 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
      className={`rounded-[3px] bg-white overflow-hidden select-none ${
        selected ? "outline outline-2 outline-blue-500" : "outline outline-1 outline-slate-300"
      } ${isDragging ? "opacity-90 shadow-lg" : ""}`}
    >
      {block.type === "text" ? (
        <TextContent block={block} />
      ) : block.type === "table" ? (
        <TableContent block={block} />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400 text-[11px]">
          이미지
        </div>
      )}
    </div>
  );
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
          <span key={i} className="inline-block align-baseline rounded-full bg-blue-100 text-blue-700 px-1.5 text-[11px] leading-4 mx-0.5">
            {m[1].trim()}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

function TextContent({ block }: { block: Block }) {
  // 텍스트 블록 전체가 알약 드롭 대상
  const { setNodeRef, isOver } = useDroppable({
    id: `textdrop:${block.id}`,
    data: { kind: "textblock", blockId: block.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`w-full h-full px-2 py-1 text-[13px] leading-snug text-slate-800 overflow-hidden ${
        isOver ? "bg-blue-50 outline outline-2 outline-blue-400 -outline-offset-2" : ""
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
      className={`border border-slate-300 px-1 ${isHeader ? "bg-slate-50 font-medium" : ""} ${
        isOver ? "bg-blue-50 outline outline-2 outline-blue-400 -outline-offset-1" : ""
      }`}
    >
      <TokenText text={text} />
    </td>
  );
}

function TableContent({ block }: { block: Block }) {
  return (
    <table className="w-full h-full border-collapse text-[11px] text-slate-700">
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
