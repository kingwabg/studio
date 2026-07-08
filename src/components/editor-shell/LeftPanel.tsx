// LeftPanel.tsx — 좌측 패널: [블록] 팔레트 + 레이어 / [데이터] 병합 데이터 연동.
// 데이터 탭: 엑셀·CSV 업로드 → 열 이름이 "알약"이 되고, 지면의 텍스트/셀에 끌어다
// 놓으면 {{열이름}} 토큰이 박힌다. 미리보기 스테퍼로 레코드를 넘겨보고 일괄 생성.
import { useRef, useState, type ReactNode } from "react";
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
import {
  IcText,
  IcTable,
  IcImage,
  IcUpload,
  IcDownload,
  IcChevronLeft,
  IcChevronRight,
  IcSparkles,
} from "../../ui/icons";

const PALETTE: { type: BlockType; label: string; icon: ReactNode }[] = [
  { type: "text", label: "텍스트", icon: <IcText size={17} /> },
  { type: "table", label: "표", icon: <IcTable size={17} /> },
  { type: "image", label: "이미지", icon: <IcImage size={17} /> },
];

function PaletteItem({ type, label, icon }: { type: BlockType; label: string; icon: ReactNode }) {
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
      className={`flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl border border-line bg-white text-inksoft cursor-grab select-none hover:border-accentline hover:text-accent hover:bg-accentsoft/40 transition-all ${
        isDragging ? "opacity-60 shadow-md scale-95 z-50" : ""
      }`}
    >
      {icon}
      <span className="text-[12px] font-medium">{label}</span>
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
      className={`inline-flex items-center gap-1 rounded-full bg-accentsoft text-accent text-[12px] font-medium pl-2 pr-2.5 py-1 cursor-grab select-none border border-accentline hover:bg-accent hover:text-white transition-colors ${
        isDragging ? "opacity-60 shadow-md z-50" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {column}
    </div>
  );
}

function BlocksTab() {
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const iconFor = (t: BlockType) =>
    t === "text" ? <IcText size={14} /> : t === "table" ? <IcTable size={14} /> : <IcImage size={14} />;
  return (
    <>
      <div className="px-3.5 py-3.5 border-b border-line">
        <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2.5">블록 추가</p>
        <div className="grid grid-cols-3 gap-2">
          {PALETTE.map((p) => (
            <PaletteItem key={p.type} type={p.type} label={p.label} icon={p.icon} />
          ))}
        </div>
      </div>
      <div className="px-3.5 py-3.5 flex-1 overflow-auto">
        <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2.5">
          레이어 {blocks.length > 0 && <span className="text-inkfaint/70">· {blocks.length}</span>}
        </p>
        <div className="flex flex-col gap-0.5">
          {blocks.map((b) => (
            <button
              key={b.id}
              onClick={() => select(b.id)}
              className={`flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[12px] transition-colors ${
                selectedId === b.id
                  ? "bg-accentsoft text-accent font-medium"
                  : "text-inksoft hover:bg-paper"
              }`}
            >
              <span className={selectedId === b.id ? "text-accent" : "text-inkfaint"}>{iconFor(b.type)}</span>
              <span className="truncate">
                {b.type === "text" ? (b.text?.trim() || "빈 텍스트") : b.type === "table" ? "표" : "이미지"}
              </span>
            </button>
          ))}
          {blocks.length === 0 && (
            <p className="text-[12px] text-inkfaint px-2 py-1">아직 블록이 없습니다</p>
          )}
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
  const preview = previewIndex !== null;

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

  const generateSingle = () => {
    if (!dataset) return;
    const docs = dataset.rows.map((row) => resolveDoc(doc, dataset.columns, row));
    downloadBytes(buildHwpxBytesMultiPage(docs), `${doc.title}_병합_${dataset.rows.length}쪽.hwpx`);
  };

  return (
    <div className="px-3.5 py-3.5 flex-1 overflow-auto flex flex-col gap-4">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      {!dataset ? (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-linestrong px-3 py-7 text-center text-inksoft hover:border-accent hover:text-accent hover:bg-accentsoft/30 transition-all disabled:opacity-50"
          >
            <IcUpload size={22} />
            <span className="text-[12.5px] font-medium">{busy ? "읽는 중…" : "엑셀 · CSV 업로드"}</span>
            <span className="text-[11px] text-inkfaint">첫 행 = 열 이름</span>
          </button>
          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2.5 py-2">{error}</p>
          )}
          <div className="rounded-xl bg-paper px-3 py-3">
            <p className="text-[11px] text-inksoft leading-relaxed">
              업로드하면 열 이름이 <span className="text-accent font-medium">알약</span>이 됩니다. 지면의
              텍스트나 표 칸에 끌어다 놓으면 자동으로 값이 채워져요.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accentsoft text-accent shrink-0">
              <IcTable size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink truncate">{dataset.name}</p>
              <p className="text-[11px] text-inkfaint">
                {dataset.rows.length}행 · 매핑 {bound.length}/{dataset.columns.length}
              </p>
            </div>
            <button
              onClick={clearDataset}
              className="text-[11px] text-inkfaint hover:text-red-500 shrink-0"
            >
              제거
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2">
              열 알약 — 지면에 끌어다 놓기
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dataset.columns.map((c) => (
                <FieldPill key={c} column={c} />
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-inkfaint tracking-wide">미리보기</p>
              <button
                onClick={() => setPreviewIndex(preview ? null : 0)}
                className="text-[11px] text-accent font-medium hover:underline"
              >
                {preview ? "칩 보기" : "값 보기"}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPreviewIndex(preview ? Math.max(0, previewIndex! - 1) : 0)}
                disabled={!preview || previewIndex === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-line text-inksoft hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
              >
                <IcChevronLeft size={16} />
              </button>
              <div className="flex-1 h-8 flex items-center justify-center rounded-lg bg-paper text-[12px] text-ink font-medium tabular-nums">
                {preview ? `${previewIndex! + 1} / ${dataset.rows.length}` : "칩 보기"}
              </div>
              <button
                onClick={() =>
                  setPreviewIndex(preview ? Math.min(dataset.rows.length - 1, previewIndex! + 1) : 0)
                }
                disabled={!preview || previewIndex === dataset.rows.length - 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-line text-inksoft hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
              >
                <IcChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="border-t border-line pt-3.5 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-inkfaint tracking-wide">
              일괄 생성 · {dataset.rows.length}건
            </p>
            <button
              onClick={generateZip}
              disabled={busy || bound.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-accent text-white text-[12.5px] font-semibold py-2.5 hover:bg-accenthover active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100 shadow-[0_1px_2px_rgba(43,92,230,0.25)]"
            >
              {busy ? (
                "생성 중…"
              ) : (
                <>
                  <IcDownload size={15} /> 개별 파일 {dataset.rows.length}개 (ZIP)
                </>
              )}
            </button>
            <button
              onClick={generateSingle}
              disabled={busy || bound.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-accentline text-accent text-[12.5px] font-semibold py-2.5 hover:bg-accentsoft transition-colors disabled:opacity-40"
            >
              <IcDownload size={15} /> 한 파일 {dataset.rows.length}쪽 (HWPX)
            </button>
            {bound.length === 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-inkfaint">
                <IcSparkles size={13} /> 알약을 문서에 놓으면 생성할 수 있어요.
              </p>
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
    <aside className="w-60 shrink-0 border-r border-line bg-white flex flex-col">
      <div className="flex px-2 pt-2 gap-1">
        {(
          [
            ["blocks", "블록"],
            ["data", "데이터"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12.5px] font-semibold transition-colors ${
              tab === key ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper"
            }`}
          >
            {label}
            {key === "data" && hasDataset && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>
      <div className="h-px bg-line mt-2" />
      {tab === "blocks" ? <BlocksTab /> : <DataTab />}
    </aside>
  );
}
