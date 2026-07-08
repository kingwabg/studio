// LeftPanel.tsx — 좌측 패널: [블록] 팔레트 + 레이어 / [데이터] 병합 데이터 연동.
// 데이터 탭: 엑셀·CSV 업로드 → 열 이름이 "알약"이 되고, 지면의 텍스트/셀에 끌어다
// 놓으면 {{열이름}} 토큰이 박힌다. 미리보기 스테퍼로 레코드를 넘겨보고 일괄 생성.
import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type BlockType } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";
import { useMergeStore } from "../../modules/merge/store";
import { parseSheetFile } from "../../modules/merge/parseSheet";
import { resolveDoc, usedTokens } from "../../modules/merge/resolve";
import {
  buildHwpxBytes,
  buildHwpxBytesMultiPage,
  downloadBytes,
} from "../../modules/document/exportHwpx";

const PALETTE: { type: BlockType; label: string }[] = [
  { type: "text", label: "텍스트" },
  { type: "table", label: "표" },
  { type: "image", label: "이미지" },
];

function PaletteItem({ type, label }: { type: BlockType; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { kind: "palette", type },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 cursor-grab select-none hover:border-blue-400 hover:text-blue-600 ${
        isDragging ? "opacity-60 shadow-md z-50" : ""
      }`}
    >
      {label}
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
      className={`inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[12px] px-2.5 py-1 cursor-grab select-none hover:bg-blue-200 ${
        isDragging ? "opacity-60 shadow-md z-50" : ""
      }`}
    >
      {column}
    </div>
  );
}

function BlocksTab() {
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  return (
    <>
      <div className="px-3 py-3 border-b border-slate-100">
        <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">블록</p>
        <div className="flex flex-col gap-2">
          {PALETTE.map((p) => (
            <PaletteItem key={p.type} type={p.type} label={p.label} />
          ))}
        </div>
      </div>
      <div className="px-3 py-3 flex-1 overflow-auto">
        <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">레이어 ({blocks.length})</p>
        <div className="flex flex-col gap-1">
          {blocks.map((b) => (
            <button
              key={b.id}
              onClick={() => select(b.id)}
              className={`text-left px-2 py-1.5 rounded text-[12px] truncate ${
                selectedId === b.id ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {b.type === "text" ? `텍스트 · ${b.text ?? ""}` : b.type === "table" ? "표" : "이미지"}
            </button>
          ))}
          {blocks.length === 0 && <p className="text-[12px] text-slate-300">아직 블록이 없습니다</p>}
        </div>
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

  // 일괄 생성 — 개별 파일 ZIP
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

  // 일괄 생성 — 한 파일 N쪽 (레코드마다 페이지)
  const generateSingle = () => {
    if (!dataset) return;
    const docs = dataset.rows.map((row) => resolveDoc(doc, dataset.columns, row));
    downloadBytes(buildHwpxBytesMultiPage(docs), `${doc.title}_병합_${dataset.rows.length}쪽.hwpx`);
  };

  return (
    <div className="px-3 py-3 flex-1 overflow-auto flex flex-col gap-3">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      {!dataset ? (
        <>
          <p className="text-[11px] font-semibold text-slate-400 tracking-wide">데이터 연동</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-center text-[12px] text-slate-500 hover:border-blue-400 hover:text-blue-600"
          >
            {busy ? "읽는 중…" : "엑셀 · CSV 업로드\n(첫 행 = 열 이름)"}
          </button>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            업로드하면 열 이름이 알약이 됩니다. 지면의 텍스트나 표 칸에 끌어다 놓으세요.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-slate-700 truncate">{dataset.name}</p>
            <button onClick={clearDataset} className="text-[11px] text-slate-400 hover:text-red-500 shrink-0">
              제거
            </button>
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            {dataset.rows.length}행 · 매핑 {bound.length}/{dataset.columns.length}
          </p>

          <div>
            <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">
              열 알약 — 지면에 끌어다 놓기
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dataset.columns.map((c) => (
                <FieldPill key={c} column={c} />
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-2">미리보기</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewIndex(previewIndex === null ? 0 : Math.max(0, previewIndex - 1))}
                className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:border-blue-400"
              >
                ‹
              </button>
              <span className="text-[12px] text-slate-600 min-w-14 text-center">
                {previewIndex === null ? "칩 보기" : `${previewIndex + 1} / ${dataset.rows.length}`}
              </span>
              <button
                onClick={() =>
                  setPreviewIndex(
                    previewIndex === null ? 0 : Math.min(dataset.rows.length - 1, previewIndex + 1)
                  )
                }
                className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:border-blue-400"
              >
                ›
              </button>
              <button
                onClick={() => setPreviewIndex(previewIndex === null ? 0 : null)}
                className="ml-auto text-[11px] text-blue-600 hover:underline"
              >
                {previewIndex === null ? "값 보기" : "칩 보기"}
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-slate-400 tracking-wide">일괄 생성</p>
            <button
              onClick={generateZip}
              disabled={busy || bound.length === 0}
              className="rounded-lg bg-blue-600 text-white text-[12px] font-medium py-2 hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? "생성 중…" : `개별 파일 ${dataset.rows.length}개 (ZIP)`}
            </button>
            <button
              onClick={generateSingle}
              disabled={busy || bound.length === 0}
              className="rounded-lg border border-blue-200 text-blue-700 text-[12px] font-medium py-2 hover:bg-blue-50 disabled:opacity-40"
            >
              한 파일 {dataset.rows.length}쪽 (HWPX)
            </button>
            {bound.length === 0 && (
              <p className="text-[11px] text-slate-400">알약을 문서에 놓으면 생성할 수 있어요.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<"blocks" | "data">("blocks");
  const hasDataset = useMergeStore((s) => s.dataset !== null);

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="flex border-b border-slate-100">
        {(
          [
            ["blocks", "블록"],
            ["data", "데이터"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 text-[12px] font-medium ${
              tab === key ? "text-blue-600 border-b-2 border-blue-500" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {label}
            {key === "data" && hasDataset && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 align-middle" />}
          </button>
        ))}
      </div>
      {tab === "blocks" ? <BlocksTab /> : <DataTab />}
    </aside>
  );
}
