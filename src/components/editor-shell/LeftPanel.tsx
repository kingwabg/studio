// LeftPanel.tsx — 좌측 패널: [블록] 팔레트 + 레이어 / [데이터] 병합 데이터 연동.
// 데이터 탭: 엑셀·CSV 업로드 → 열 이름이 "알약"이 되고, 지면의 텍스트/셀에 끌어다
// 놓으면 {{열이름}} 토큰이 박힌다. 미리보기 스테퍼로 레코드를 넘겨보고 일괄 생성.
import { useRef, useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { type Block, type BlockType, descendantIds } from "../../modules/document/model";
import { useRightTabStore, usePanelStore } from "../../modules/ui/theme";
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
  IcFile,
  IcUpload,
  IcDownload,
  IcChevronLeft,
  IcChevronRight,
  IcSparkles,
  IcSearch,
} from "../../ui/icons";

// 카테고리 틴트 타일 팔레트 (시안 1b) — 앞 4종은 드래그 실동작, 뒤 5종은 준비 중
const PALETTE: { type: BlockType; label: string; icon: ReactNode; flow?: boolean; tint: string; tone: string }[] = [
  { type: "text", label: "텍스트", icon: <IcText size={16} />, tint: "var(--accentsoft)", tone: "var(--accenttext)" },
  // 본문 = 흐름 텍스트: hwpx로 나갈 때 절대배치 개체가 아니라 진짜 문단이 된다
  { type: "text", label: "본문", icon: <IcFile size={16} />, flow: true, tint: "var(--cat-orange-soft)", tone: "var(--cat-orange)" },
  { type: "table", label: "표", icon: <IcTable size={16} />, tint: "var(--cat-green-soft)", tone: "var(--cat-green)" },
  { type: "image", label: "이미지", icon: <IcImage size={16} />, tint: "var(--cat-purple-soft)", tone: "var(--cat-purple)" },
];
const PALETTE_SOON = ["결재선", "서명", "날짜", "쪽 번호", "붙임"];

function PaletteItem({ type, label, icon, flow, tint, tone }: (typeof PALETTE)[number]) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${flow ? "flow" : type}`,
    data: { kind: "palette", type, flow },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), touchAction: "none" }}
      className={`flex flex-col items-center gap-1.5 cursor-grab select-none transition-all hover:-translate-y-px ${
        isDragging ? "opacity-60 scale-95 z-50" : ""
      }`}
    >
      <div className="w-full h-[46px] rounded-[10px] flex items-center justify-center" style={{ background: tint, color: tone }}>
        {icon}
      </div>
      <span className="text-[11px] font-medium text-inksoft">{label}</span>
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
        isDragging ? "opacity-60 shadow-md z-50 pointer-events-none" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {column}
    </div>
  );
}

const iconFor = (t: BlockType) =>
  t === "text" ? <IcText size={14} /> : t === "table" ? <IcTable size={14} /> : <IcImage size={14} />;
const labelFor = (b: Block) =>
  b.type === "text" ? (b.text?.trim() || "빈 텍스트") : b.type === "table" ? "표" : "이미지";

// 레이어 행 — 드래그(kind:layer)해서 다른 행에 놓으면 그 블록의 자식이 된다.
// 자식이 있으면 ▾/▸ 토글로 가지를 접는다(캔버스·패널 모두 숨김, 보기 전용).
function LayerRow({ block, depth, kidCount }: { block: Block; depth: number; kidCount: number }) {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const select = useCanvasStore((s) => s.select);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const drag = useDraggable({ id: `layer-${block.id}`, data: { kind: "layer", blockId: block.id } });
  const drop = useDroppable({ id: `layerdrop-${block.id}`, data: { kind: "layer", blockId: block.id } });
  const selectedRow = selectedId === block.id;
  return (
    <button
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={() => select(block.id)}
      style={{
        paddingLeft: 8 + depth * 14,
        transform: CSS.Translate.toString(drag.transform),
        touchAction: "none",
      }}
      className={`flex items-center gap-2 text-left pr-2 py-1.5 rounded-lg text-[12px] transition-colors w-full ${
        drop.isOver && !drag.isDragging
          ? "bg-accentsoft outline outline-2 outline-accent -outline-offset-2"
          : selectedRow
            ? "bg-accentsoft text-accent font-medium"
            : "text-inksoft hover:bg-paper"
      } ${drag.isDragging ? "opacity-50 z-50 relative" : ""}`}
    >
      {depth > 0 && <span className="text-inkfaint/60 -ml-1">└</span>}
      {kidCount > 0 ? (
        // 접기 토글 — 부모 <button> 안이라 span으로 (중첩 button 금지), 드래그 시작도 차단
        <span
          role="button"
          aria-label={block.collapsed ? "펴기" : "접기"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateBlock(block.id, { collapsed: !block.collapsed });
          }}
          className="w-4 h-4 -ml-1 flex items-center justify-center rounded text-inkfaint hover:text-accent hover:bg-accentsoft text-[10px] shrink-0"
        >
          {block.collapsed ? "▸" : "▾"}
        </span>
      ) : (
        depth === 0 && <span className="w-4 -ml-1 shrink-0" />
      )}
      <span className={selectedRow ? "text-accent" : "text-inkfaint"}>{iconFor(block.type)}</span>
      <span className="truncate">{labelFor(block)}</span>
      {block.collapsed && kidCount > 0 && (
        <span className="ml-auto text-[10px] text-inkfaint bg-paper rounded-full px-1.5 py-0.5 shrink-0">
          +{kidCount}
        </span>
      )}
    </button>
  );
}

function BlocksTab() {
  const blocks = useCanvasStore((s) => s.doc.blocks);
  // 루트 해제 드롭 영역 (레이어 목록 하단)
  const rootDrop = useDroppable({ id: "layerroot", data: { kind: "layerroot" } });

  // parentId 트리를 y좌표순으로 평탄화 (들여쓰기 렌더용) — 접힌 가지는 건너뛴다
  const rows: { block: Block; depth: number; kidCount: number }[] = [];
  const byY = (a: Block, b: Block) => a.y - b.y || a.x - b.x;
  const walk = (parentId: string | undefined, depth: number) => {
    blocks
      .filter((b) => (b.parentId ?? undefined) === parentId)
      .sort(byY)
      .forEach((b) => {
        rows.push({ block: b, depth, kidCount: descendantIds(blocks, b.id).size });
        if (!b.collapsed) walk(b.id, depth + 1);
      });
  };
  walk(undefined, 0);

  return (
    <>
      <div className="px-3.5 py-3.5 border-b border-line flex flex-col gap-3">
        {/* 블록 검색 (준비 중) */}
        <div title="준비 중" className="h-9 bg-paper border border-line rounded-[9px] flex items-center gap-2 px-2.5">
          <span className="text-inkfaint"><IcSearch size={14} /></span>
          <span className="text-[12px] text-inkfaint">블록·서식 검색</span>
        </div>
        <div>
          <p className="text-[11px] font-bold text-inkfaint tracking-[.08em] mb-2">카테고리 둘러보기</p>
          <div className="grid grid-cols-3 gap-2">
            {PALETTE.map((p) => (
              <PaletteItem key={p.label} {...p} />
            ))}
            {/* 준비 중 타일 — 로드맵(결재선·서명·날짜·쪽 번호·붙임) 자리 */}
            {PALETTE_SOON.map((label, i) => (
              <div key={label} title={`${label} (준비 중)`} className="flex flex-col items-center gap-1.5 select-none opacity-55">
                <div
                  className="w-full h-[46px] rounded-[10px] flex items-center justify-center text-[13px] font-bold"
                  style={{
                    background: ["var(--cat-red-soft)", "var(--accentsoft)", "var(--cat-orange-soft)", "var(--cat-green-soft)", "var(--cat-purple-soft)"][i],
                    color: ["var(--cat-red)", "var(--accenttext)", "var(--cat-orange)", "var(--cat-green)", "var(--cat-purple)"][i],
                  }}
                >
                  {label.slice(0, 1)}
                </div>
                <span className="text-[11px] font-medium text-inkfaint">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-3.5 py-3.5 flex-1 overflow-auto flex flex-col">
        <p className="text-[11px] font-semibold text-inkfaint tracking-wide mb-2.5">
          구조 {blocks.length > 0 && <span className="text-inkfaint/70">· {blocks.length}</span>}
        </p>
        <div className="flex flex-col gap-0.5">
          {rows.map(({ block, depth, kidCount }) => (
            <LayerRow key={block.id} block={block} depth={depth} kidCount={kidCount} />
          ))}
          {blocks.length === 0 && (
            <p className="text-[12px] text-inkfaint px-2 py-1">아직 블록이 없습니다</p>
          )}
        </div>
        {/* 루트 해제 영역 — 행을 여기로 끌면 최상위로 */}
        {blocks.length > 0 && (
          <div
            ref={rootDrop.setNodeRef}
            className={`mt-2 rounded-lg border border-dashed px-2 py-2 text-[11px] text-center transition-colors ${
              rootDrop.isOver ? "border-accent bg-accentsoft text-accent" : "border-line text-inkfaint"
            }`}
          >
            여기로 끌면 최상위로
          </div>
        )}
        <p className="text-[11px] text-inkfaint leading-relaxed mt-2">
          행을 다른 행에 끌어다 놓으면 하위로 연결됩니다. 부모를 움직이면 하위가 함께 움직여요.
        </p>
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

// 캔바식 2단: 아이콘 레일 66px + 콘텐츠 패널 250px (시안 1b)
type RailKey = "blocks" | "templates" | "data" | "upload";

export function LeftPanel() {
  const [tab, setTab] = useState<RailKey>("blocks");
  const hasDataset = useMergeStore((s) => s.dataset !== null);
  const openAi = useRightTabStore((s) => s.setTab);
  const leftW = usePanelStore((s) => s.leftW);
  const leftOpen = usePanelStore((s) => s.leftOpen);

  const rail: { key: RailKey | "ai"; label: string; icon: ReactNode; soon?: boolean }[] = [
    { key: "blocks", label: "블록", icon: <IcText size={17} /> },
    { key: "templates", label: "템플릿", icon: <IcFile size={17} />, soon: true },
    { key: "data", label: "데이터", icon: <IcTable size={17} /> },
    { key: "upload", label: "업로드", icon: <IcUpload size={17} />, soon: true },
    { key: "ai", label: "AI", icon: <IcSparkles size={17} /> },
  ];

  return (
    <aside className="shrink-0 border-r border-line bg-surface flex">
      {/* 아이콘 레일 */}
      <div className="w-[66px] shrink-0 border-r border-line flex flex-col items-center gap-1 py-2">
        {rail.map((r) => {
          const active = r.key === tab;
          return (
            <button
              key={r.key}
              title={r.soon ? `${r.label} (준비 중)` : r.label}
              onClick={() => (r.key === "ai" ? openAi("ai") : setTab(r.key as RailKey))}
              className={`w-14 py-2 rounded-[10px] flex flex-col items-center gap-1 transition-colors ${
                active ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper hover:text-ink"
              }`}
            >
              {r.icon}
              <span className={`text-[10.5px] ${active ? "font-bold" : "font-medium"}`}>{r.label}</span>
            </button>
          );
        })}
        {hasDataset && <span className="w-1.5 h-1.5 rounded-full bg-accent -mt-9 ml-9" />}
      </div>
      {/* 콘텐츠 패널 — 폭 조절/접힘 (밀고 당기기). 접히면 rail(66px)만 남는다 */}
      <div className={`flex flex-col min-h-0 ${leftOpen ? "" : "hidden"}`} style={{ width: leftW }}>
        {tab === "blocks" ? (
          <BlocksTab />
        ) : tab === "data" ? (
          <DataTab />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-paper text-inkfaint">
              {tab === "templates" ? <IcFile size={18} /> : <IcUpload size={18} />}
            </span>
            <p className="text-[12px] text-inkfaint leading-relaxed">
              {tab === "templates" ? "템플릿 라이브러리는 준비 중이에요" : "이미지 업로드는 준비 중이에요"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
