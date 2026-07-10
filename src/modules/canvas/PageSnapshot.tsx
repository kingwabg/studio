// PageSnapshot.tsx — CanvasDoc 한 페이지를 읽기 전용 정적 렌더.
// 한글 미리보기(rhwp SVG)와 "나란히/겹치기"로 비교하기 위한 "화면(진실)" 쪽 그림.
// ⚠ SCALE(3.7795px/mm)이 rhwp SVG의 96DPI(793.7px=210mm)와 같아 1:1로 겹친다.
// 텍스트는 캔버스 읽기 모드와 동일하게(textStyle + RichRead + 안쪽 여백 + pre-wrap) 그려,
// "화면 줄바꿈"을 그대로 보여준다. 편집 어포던스·핸들·스토어 효과는 없다.
import { useEffect, useState } from "react";
import { type CanvasDoc, type Block, type TableKingData, padOf, showingHint } from "../document/model";
import { mmToPx } from "./geometry";
import { RichRead, textStyle } from "../richtext";
import { getAssetUrl } from "../document/assets";
import { tableDataToRows } from "../../table-king/TableKingBlock.jsx";

function TextSnapshot({ block }: { block: Block }) {
  const pad = padOf(block);
  const hint = showingHint(block);
  return (
    <div
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        ...textStyle(block),
        lineHeight: (block.lineSpacing ?? 137.5) / 100, // 캔버스 leading-snug(1.375) 기본
        whiteSpace: "pre-wrap",
        paddingLeft: mmToPx(pad.x),
        paddingRight: mmToPx(pad.x),
        paddingTop: mmToPx(pad.y),
        paddingBottom: mmToPx(pad.y),
        background: block.fill || undefined,
        border: block.borderWidth ? `${block.borderWidth}px solid ${block.borderColor || "#000"}` : undefined,
        borderRadius: block.radius ?? undefined,
        boxSizing: "border-box",
      }}
    >
      {hint ? <span style={{ color: "var(--inkfaint)" }}>{block.hint}</span> : <RichRead block={block} />}
    </div>
  );
}

function TableSnapshot({ block }: { block: Block }) {
  const data = block.data as TableKingData | undefined;
  if (!data?.cells?.length) return null;
  const cellsText = tableDataToRows(data) as string[][];
  const merges = data.merges ?? [];
  const widths = data.widths?.[0] ?? [];
  const covered = (r: number, c: number) =>
    merges.some((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c));
  const mergeAt = (r: number, c: number) => merges.find((m) => m.r === r && m.c === c);
  return (
    <div style={{ position: "absolute", left: mmToPx(block.x), top: mmToPx(block.y) }}>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", fontSize: "12.5px", color: "#1A2233" }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {cellsText.map((row, ri) => (
            <tr key={ri} style={{ height: data.cellHeights?.[ri]?.[0] ?? 30 }}>
              {row.map((cell, ci) => {
                if (covered(ri, ci)) return null;
                const m = mergeAt(ri, ci);
                return (
                  <td
                    key={ci}
                    colSpan={m?.cs ?? 1}
                    rowSpan={m?.rs ?? 1}
                    style={{ border: "1px solid #CBD2DE", padding: "1px 5px", verticalAlign: "middle", fontWeight: ri === 0 ? 600 : 400 }}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageSnapshot({ block }: { block: Block }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (block.src) void getAssetUrl(block.src).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [block.src]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      style={{
        position: "absolute",
        left: mmToPx(block.x),
        top: mmToPx(block.y),
        width: mmToPx(block.w),
        height: mmToPx(block.h),
        objectFit: "fill",
      }}
    />
  );
}

export function PageSnapshot({ doc }: { doc: CanvasDoc }) {
  return (
    <div
      className="relative bg-white"
      style={{ width: mmToPx(doc.page.w), height: mmToPx(doc.page.h), overflow: "hidden" }}
    >
      {doc.blocks.map((b) =>
        b.type === "text" ? (
          <TextSnapshot key={b.id} block={b} />
        ) : b.type === "table" ? (
          <TableSnapshot key={b.id} block={b} />
        ) : b.type === "image" ? (
          <ImageSnapshot key={b.id} block={b} />
        ) : null
      )}
    </div>
  );
}
