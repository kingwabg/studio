// RightPanel.tsx — [속성] 선택 블록 편집 / [AI] 문서 도우미 (리디자인 시안 1b·1c).
// 시안의 섹션 구조(모양/크기/위치/여백/고급/디버그)를 그대로 따르되, 실제 문서 모델에
// 있는 컨트롤(내용·글자 서식·위치 유형·크기/좌표·서식 유전·디버그)만 진짜로 연결하고
// 모델에 없는 항목(배경·모서리·불투명도·안쪽 여백 등)은 "준비 중"으로 정직하게 표시한다.
import { type ReactNode } from "react";
import { useRightTabStore, usePanelStore } from "../../modules/ui/theme";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, type TableKingData, type TextAlign, LINE_SPACING_DEFAULT, TEXT_DEFAULTS } from "../../modules/document/model";
import { AiPanel } from "./AiPanel";
import { FontSelect } from "./FontSelect";
import { ColorPopover } from "./ColorPopover";
import { IcText, IcTable, IcImage, IcTrash, IcSparkles, IcCopy } from "../../ui/icons";
import { DsIcon } from "../../ui/design-icons";
import { TEXT_COLOR_PRESETS } from "../../ui/presets";
import { InspectorColor } from "./InspectorColor";
import { InspectorTypeTabs } from "./InspectorTypeTabs";
import { InspectorDimensions } from "./InspectorDimensions";
import { InspectorTable } from "./InspectorTable";
// 인스펙터 공용 키트(타이포·박스·탭·토글 단일 소스). 로컬 이름으로 별칭해 사용처는 그대로 둔다.
import { InsSection as Section, InsField as FieldBox, InsToggle as Toggle, InsIconBtn as FmtBtn, InsPill as SoonPill, InsHint } from "./inspector-kit";

// 글자색 프리셋 정본은 ui/presets.ts — 재선언 금지(4벌 표류 감사)

// ── 이 파일 전용 소품 (공용은 inspector-kit) ──
// 읽기 전용 값 셀 (페이지 인스펙터의 촘촘한 읽기 그리드용 — 편집 필드는 키트 InsNumber)
function ReadCell({ children, faint }: { children: ReactNode; faint?: boolean }) {
  return (
    <div className="flex h-9 items-center justify-end rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5">
      <span className={`text-[12.5px] font-semibold tabular-nums ${faint ? "text-[color:var(--ins-unit)]" : "text-[color:var(--ins-value)]"}`}>{children}</span>
    </div>
  );
}

// 라벨 + 컨트롤 한 줄 (좌 라벨 고정폭) — 라벨은 단위·접두 스타일
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <span className="w-8 shrink-0 text-[10.5px] font-bold text-[color:var(--ins-unit)]">{label}</span>
      {children}
    </div>
  );
}

// 글자 서식 (글꼴·B/I/U/S·정렬·크기·줄간격·색) — 텍스트 블록 실동작
function TextFormat({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const size = block.fontSize ?? TEXT_DEFAULTS.fontSize;
  const align = block.align ?? TEXT_DEFAULTS.align;
  const aligns: { v: TextAlign; title: string }[] = [
    { v: "left", title: "왼쪽" },
    { v: "center", title: "가운데" },
    { v: "right", title: "오른쪽" },
  ];
  return (
    <>
      {/* 글꼴 — 풀 폭 드롭다운 (디자인 글자 섹션) */}
      <FontSelect
        fullWidth
        value={block.font}
        onChange={(key) => patch({ font: key })}
        className="w-full appearance-none h-9 pl-2.5 pr-7 rounded-lg border border-[color:var(--ins-fborder)] bg-white text-[color:var(--ins-value)] outline-none hover:border-[color:var(--ins-track)] focus:border-[color:var(--ins-acc)] transition-colors cursor-pointer"
      />
      {/* B I U S + 정렬 — 두 그룹(유동 정사각으로 좁은 패널에 맞춤) */}
      <div className="flex items-center gap-2">
        <div className="grid flex-[4] grid-cols-4 gap-1">
          <FmtBtn fluid active={!!block.bold} title="굵게" onClick={() => patch({ bold: !block.bold })}><DsIcon name="bold" size={15} /></FmtBtn>
          <FmtBtn fluid active={!!block.italic} title="기울임" onClick={() => patch({ italic: !block.italic })}><DsIcon name="italic" size={15} /></FmtBtn>
          <FmtBtn fluid active={!!block.underline} title="밑줄" onClick={() => patch({ underline: !block.underline })}><DsIcon name="underline" size={15} /></FmtBtn>
          <FmtBtn fluid active={!!block.strike} title="취소선" onClick={() => patch({ strike: !block.strike })}><DsIcon name="strikethrough" size={15} /></FmtBtn>
        </div>
        <div className="grid flex-[3] grid-cols-3 gap-1">
          {aligns.map((a) => (
            <FmtBtn fluid key={a.v} active={align === a.v} title={a.title} onClick={() => patch({ align: a.v })}>
              <DsIcon name={`align-${a.v}`} size={15} />
            </FmtBtn>
          ))}
        </div>
      </div>
      {/* 크기 */}
      <Row label="크기">
        <div className="flex h-9 flex-1 items-center overflow-hidden rounded-lg border border-[color:var(--ins-fborder)] text-[13px]">
          <button onClick={() => patch({ fontSize: Math.max(6, size - 0.5) })} className="h-full w-7 text-[color:var(--ins-ficon)] hover:bg-[color:var(--ins-segbg)]">−</button>
          <span className="flex h-full flex-1 items-center justify-center text-center text-[12.5px] font-semibold tabular-nums text-[color:var(--ins-value)]">{size}pt</span>
          <button onClick={() => patch({ fontSize: size + 0.5 })} className="h-full w-7 text-[color:var(--ins-ficon)] hover:bg-[color:var(--ins-segbg)]">＋</button>
        </div>
      </Row>
      <Row label="줄간격">
        <div className="flex h-9 flex-1 items-center overflow-hidden rounded-lg border border-[color:var(--ins-fborder)] text-[13px]">
          <button
            onClick={() => patch({ lineSpacing: Math.max(100, (block.lineSpacing ?? LINE_SPACING_DEFAULT) - 10) })}
            className="h-full w-7 text-[color:var(--ins-ficon)] hover:bg-[color:var(--ins-segbg)]"
          >
            −
          </button>
          <span className="flex h-full flex-1 items-center justify-center border-x border-[color:var(--ins-fborder)] text-center text-[12.5px] font-semibold tabular-nums text-[color:var(--ins-value)]">
            {block.lineSpacing ?? LINE_SPACING_DEFAULT}%
          </span>
          <button
            onClick={() => patch({ lineSpacing: Math.min(300, (block.lineSpacing ?? LINE_SPACING_DEFAULT) + 10) })}
            className="h-full w-7 text-[color:var(--ins-ficon)] hover:bg-[color:var(--ins-segbg)]"
          >
            ＋
          </button>
        </div>
        {block.lineSpacing != null && block.lineSpacing !== LINE_SPACING_DEFAULT && (
          <button
            onClick={() => patch({ lineSpacing: undefined })}
            title={`기본(${LINE_SPACING_DEFAULT}%)으로`}
            className="px-1 text-[10.5px] font-bold text-[color:var(--ins-sub)] transition-colors hover:text-[color:var(--ins-acc)]"
          >
            기본
          </button>
        )}
      </Row>
      {/* 색 — 디자인: 팝오버가 아니라 인스펙터에 펼쳐진 인라인 피커(스와치+그라데이션+HEX) */}
      <div className="flex flex-col gap-2 pt-0.5">
        <span className="text-[10.5px] font-bold text-[color:var(--ins-unit)]">색</span>
        <InspectorColor
          value={block.color ?? TEXT_DEFAULTS.color}
          presets={TEXT_COLOR_PRESETS}
          onChange={(color) => patch({ color })}
        />
      </div>
    </>
  );
}

// 모양 — 배경 채우기·모서리·테두리 (실동작)
const FILL_SWATCHES = ["", "#FFFFFF", "#F6F7FA", "#EDF2FE", "#FDEEF0", "#EAF6EF", "#FEF9E7"];
const BORDER_COLORS = ["#000000", "#5B6577", "#98A4BD", "#256EF4", "#D64550", "#3B9B6B"];

function ShapeSection({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const bw = block.borderWidth ?? 0;
  return (
    <Section label="박스모양">
      {/* 배경 + 모서리 한 줄 (디자인 박스모양 — 각 필드가 테두리 박스) */}
      <div className="grid grid-cols-2 gap-2">
        <FieldBox label="배경">
          <ColorPopover
            label="배경색"
            value={block.fill ?? "transparent"}
            presets={FILL_SWATCHES.filter(Boolean)}
            allowTransparent
            transparentLabel="없음"
            shape="square"
            compact
            onChange={(color) => patch({ fill: color === "transparent" ? undefined : color })}
          />
        </FieldBox>
        <FieldBox label="모서리">
          <span className="flex items-center gap-1">
            <input
              type="number"
              value={block.radius ?? 0}
              onChange={(e) => patch({ radius: Math.max(0, Math.min(40, Number(e.target.value))) })}
              className="w-7 appearance-none border-0 bg-transparent text-right tabular-nums text-[color:var(--ins-value)] outline-none focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10.5px] font-bold text-[color:var(--ins-unit)]">px</span>
          </span>
        </FieldBox>
      </div>
      {/* 테두리 — 전폭, 클릭 시 없음→1px→2px 순환 */}
      <FieldBox label="테두리" onClick={() => patch({ borderWidth: (bw + 1) % 3, borderColor: block.borderColor ?? "#98A4BD" })}>
        <span className="text-[color:var(--ins-value)]">{bw === 0 ? "없음" : `${bw}px`}</span>
      </FieldBox>
      {bw > 0 && (
        <Row label="선색">
          <div className="flex items-center gap-1.5 flex-1">
            {BORDER_COLORS.map((c) => {
              const on = (block.borderColor ?? "#98A4BD").toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  onClick={() => patch({ borderColor: c })}
                  aria-label={`선색 ${c}`}
                  className="w-4 h-4 rounded-full transition-transform hover:scale-[1.12] shrink-0"
                  style={{ backgroundColor: c, border: `2px solid ${on ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.08)" }}
                />
              );
            })}
          </div>
        </Row>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold text-[color:var(--ins-sub)]">추가:</span>
        <SoonPill>그림자</SoonPill>
        <SoonPill>불투명도</SoonPill>
        <SoonPill>필터</SoonPill>
      </div>
    </Section>
  );
}

// 안내문(폼 placeholder) — 토글 + 안내문 입력칸. 켤 때 본문에 글자가 있으면 그걸 안내문으로
// 옮기고 본문을 비운다(템플릿 "[…입력하세요]"가 자연스럽게 placeholder로 전환).
function HintSection({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const on = !!block.hintOn;
  const toggle = (next: boolean) => {
    if (next && !block.hint && (block.text ?? "").trim())
      updateBlock(block.id, { hintOn: true, hint: block.text, text: "", runs: undefined });
    else updateBlock(block.id, { hintOn: next });
  };
  return (
    <Section label="안내문">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold text-[color:var(--ins-tlabel)]">채우기 안내문 (placeholder)</span>
        <Toggle on={on} onChange={toggle} />
      </div>
      {on && (
        <>
          <textarea
            value={block.hint ?? ""}
            onChange={(e) => updateBlock(block.id, { hint: e.target.value })}
            rows={2}
            placeholder="예: [문서 제목을 입력하세요]"
            style={{ fontSize: 12 }}
            className="resize-none rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 py-1.5 leading-snug text-[color:var(--ins-value)] outline-none transition-colors placeholder:text-[color:var(--ins-hint)] focus:border-[color:var(--ins-acc)]"
          />
          <InsHint>비어있을 때 회색으로 표시되고, 지면에서 실제 글자를 입력하면 사라집니다. 내보내기(HWPX)엔 포함되지 않아요.</InsHint>
        </>
      )}
    </Section>
  );
}

const PAGE_MARGIN_MM = 20;

function PageInspector() {
  const doc = useCanvasStore((s) => s.doc);
  const setTitle = useCanvasStore((s) => s.setTitle);
  const selectedCount = useCanvasStore((s) => s.selectedIds.length);
  const counts = doc.blocks.reduce(
    (acc, block) => {
      acc.total += 1;
      acc[block.type] += 1;
      return acc;
    },
    { total: 0, text: 0, table: 0, image: 0 } as Record<"total" | "text" | "table" | "image", number>
  );
  const editableW = Math.max(0, doc.page.w - PAGE_MARGIN_MM * 2);
  const editableH = Math.max(0, doc.page.h - PAGE_MARGIN_MM * 2);

  return (
    <div className="flex-1 overflow-auto">
      <div className="studio-inspector-heading px-3.5 py-2.5 flex items-center gap-2 border-b border-line">
        <div className="w-6 h-6 rounded-md bg-accentsoft text-accent flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h10v11H3z" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-ink truncate">페이지 / 눈금자</div>
          <div className="text-[11px] text-inkfaint truncate">상단·좌측 눈금자 기준 속성</div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
        <Section label="문서">
          <Row label="제목">
            <input
              value={doc.title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ fontSize: 12.5 }}
              className="h-9 flex-1 rounded-lg border border-[color:var(--ins-fborder)] bg-white px-2.5 font-semibold text-[color:var(--ins-value)] outline-none focus:border-[color:var(--ins-acc)]"
            />
          </Row>
          <Row label="상태"><ReadCell>{counts.total}개 객체</ReadCell></Row>
        </Section>

        <Section label="용지 크기">
          <div className="grid grid-cols-2 gap-2">
            <Row label="폭"><ReadCell>{doc.page.w} mm</ReadCell></Row>
            <Row label="높이"><ReadCell>{doc.page.h} mm</ReadCell></Row>
            <Row label="규격"><ReadCell>A4</ReadCell></Row>
            <Row label="방향"><ReadCell>{doc.page.w > doc.page.h ? "가로" : "세로"}</ReadCell></Row>
          </div>
        </Section>

        <Section label="편집 가능 영역">
          <div className="grid grid-cols-2 gap-2">
            <Row label="폭"><ReadCell>{editableW} mm</ReadCell></Row>
            <Row label="높이"><ReadCell>{editableH} mm</ReadCell></Row>
            <Row label="좌우"><ReadCell>{PAGE_MARGIN_MM} mm</ReadCell></Row>
            <Row label="상하"><ReadCell>{PAGE_MARGIN_MM} mm</ReadCell></Row>
          </div>
          <p className="text-[11px] text-inkfaint leading-relaxed">
            객체는 이 여백 안쪽에서만 이동·생성됩니다. 눈금자의 파란 하이라이트는 선택 객체의 실제 위치와 크기를 투영합니다.
          </p>
        </Section>

        <Section label="객체 요약">
          <div className="grid grid-cols-2 gap-2">
            <Row label="텍스트"><ReadCell>{counts.text}</ReadCell></Row>
            <Row label="표"><ReadCell>{counts.table}</ReadCell></Row>
            <Row label="이미지"><ReadCell>{counts.image}</ReadCell></Row>
            <Row label="선택"><ReadCell faint>{selectedCount || "없음"}</ReadCell></Row>
          </div>
        </Section>

        <Section label="눈금자 동작">
          <div className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-[10.5px] text-inksoft leading-relaxed">
            상단 눈금자는 X/폭, 좌측 눈금자는 Y/높이를 보여줍니다. 객체를 선택하면 눈금자에 위치가 투영되고, 여백 밖으로 나가면 경고색으로 바뀝니다.
          </div>
        </Section>
        <div className="h-4" />
      </div>
    </div>
  );
}
// 표 크기 "R×C" — 스냅샷 셀 배열에서
function tableDims(block: Block): string {
  const d = block.data as TableKingData | undefined;
  if (!d?.cells?.length) return "표";
  return `${d.cells.length}×${d.cells[0]?.length ?? 0}`;
}

export function RightPanel() {
  const inspectorTarget = useCanvasStore((s) => s.inspectorTarget);
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const parentText = useCanvasStore((s) => {
    const sel = s.doc.blocks.find((b) => b.id === s.selectedId);
    if (!sel?.parentId) return null;
    return s.doc.blocks.find((b) => b.id === sel.parentId)?.text ?? null;
  });
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);
  const duplicateBlock = useCanvasStore((s) => s.duplicateBlock);
  const setLocked = useCanvasStore((s) => s.setLocked);
  const reorder = useCanvasStore((s) => s.reorder);
  const cascadeStyle = useCanvasStore((s) => s.cascadeStyle);
  const hasKids = useCanvasStore((s) => s.doc.blocks.some((b) => b.parentId === s.selectedId));
  const tab = useRightTabStore((s) => s.tab);
  const setTab = useRightTabStore((s) => s.setTab);
  const rightW = usePanelStore((s) => s.rightW);
  const rightOpen = usePanelStore((s) => s.rightOpen);
  const toggleRight = usePanelStore((s) => s.toggleRight);
  if (!rightOpen) return null;

  const kind =
    block?.type === "text"
      ? { label: block.flow ? "본문 블록" : "텍스트 블록", icon: <IcText size={13} /> }
      : block?.type === "table"
        ? { label: `표 블록 · ${block ? tableDims(block) : ""}`, icon: <IcTable size={13} /> }
        : { label: "이미지 블록", icon: <IcImage size={13} /> };

  return (
    <aside className="studio-right-panel shrink-0 border-l border-line bg-surface flex flex-col overflow-hidden" style={{ width: rightW }}>
      <div className="studio-inspector-intro">
        <div>
          <span className="studio-panel-eyebrow">INSPECT</span>
          <h2>디자인 속성</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="studio-inspector-target">{block ? kind.label : inspectorTarget === "page" ? "페이지" : "선택 없음"}</span>
          <button
            type="button"
            title="오른쪽 패널 접기"
            aria-label="오른쪽 패널 접기"
            onClick={toggleRight}
            className="studio-panel-collapse"
          >
            ›
          </button>
        </div>
      </div>
      {/* 속성/AI — 박스(세그먼트 컨테이너) 없는 KRDS 수평 탭: 활성 = 블루 700 + 하단 2px 라인 */}
      <div className="flex shrink-0 border-b border-line px-4 text-[12px]">
        {(
          [
            ["props", "속성", null],
            ["ai", "AI", <IcSparkles key="i" size={12} />],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              fontWeight: tab === key ? 700 : 600,
              color: tab === key ? "var(--ins-acc)" : "var(--ins-title)",
              boxShadow: tab === key ? "inset 0 -2px 0 var(--ins-acc)" : "none",
            }}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 transition-colors"
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === "ai" ? (
        <AiPanel />
      ) : inspectorTarget === "page" ? (
        <PageInspector />
      ) : !block ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-paper text-inkfaint">
            <IcText size={18} />
          </span>
          <p className="text-[11px] text-inkfaint leading-relaxed">블록을 선택하면<br />속성이 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* 요소 헤더 — 아이콘 타일 + 종류 + 부모(트리) */}
          <div className="studio-inspector-heading px-3.5 py-2.5 flex items-center gap-2 border-b border-line">
            <div className="w-6 h-6 rounded-md bg-accentsoft text-accent flex items-center justify-center shrink-0">
              {kind.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-ink truncate">{kind.label}</div>
              <div className="text-[11px] text-inkfaint truncate">
                {parentText ? `${parentText.slice(0, 16)}의 하위` : "루트 블록"}
              </div>
            </div>
            <button
              onClick={() => setLocked([block.id], !block.locked)}
              title={block.locked ? "잠금 해제" : "위치 잠금"}
              className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${block.locked ? "text-accent bg-accentsoft" : "text-inkfaint hover:text-ink hover:bg-paper"}`}
            >
              <DsIcon name="lock" size={14} />
            </button>
            <button onClick={() => duplicateBlock(block.id)} title="복제" className="w-6 h-6 rounded-md text-inkfaint hover:text-ink hover:bg-paper flex items-center justify-center transition-colors">
              <IcCopy size={14} />
            </button>
            <button onClick={() => removeBlock(block.id)} title="삭제" className="w-6 h-6 rounded-md text-inkfaint hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors">
              <IcTrash size={14} />
            </button>
          </div>

          {/* 타입 탭 (텍스트/표/이미지/그룹) — 디자인 인스펙터 ptype 탭 */}
          <InspectorTypeTabs block={block} />

          <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
            {/* 안내문 (폼 placeholder) — 비어있을 때 회색 안내문, 입력하면 사라짐. 내보내기 제외. */}
            {block.type === "text" && <HintSection block={block} />}

            {/* 글자 서식 (텍스트) */}
            {block.type === "text" && (
              <Section label="글자">
                <TextFormat block={block} />
              </Section>
            )}


            {/* 표 블록 — 표 편집·셀 여백·크기·캡션 (디자인 표 인스펙터). 그 외는 박스모양+치수. */}
            {block.type === "table" ? (
              <InspectorTable block={block} />
            ) : (
              <>
                <ShapeSection block={block} />
                <InspectorDimensions block={block} />
              </>
            )}

            {/* 순서 — 겹침(z). 진실은 blocks 배열 순서(렌더·HWPX 내보내기 공통 파생), ⌘]/⌘[ */}
            <Section label="순서">
              <div className="grid grid-cols-4 gap-1 text-[11px] font-semibold">
                {([["back", "맨뒤"], ["backward", "뒤로"], ["forward", "앞으로"], ["front", "맨앞"]] as const).map(([d, l]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => reorder([block.id], d)}
                    className="h-8 rounded-lg border border-[color:var(--ins-fborder)] text-[color:var(--ins-tlabel)] transition-colors hover:border-[color:var(--ins-acc)] hover:bg-[color:var(--ins-tint)] hover:text-[color:var(--ins-acc)]"
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Section>

            {/* 접힌 섹션 (준비 중) */}
            <div className="opacity-55 pointer-events-none select-none">
              {["고급", "내보내기 설정"].map((s) => (
                <div key={s} className="flex items-center h-7 border-b border-line">
                  <span className="flex-1 text-[11px] font-semibold text-ink">{s}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2l3 3-3 3" stroke="var(--inkfaint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              ))}
            </div>

            {/* 디버그 — 실제 블록 JSON (개발·검증에 유용) */}
            <Section label="디버그">
              <div className="bg-paper border border-line rounded-md px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-inksoft break-all">
                {JSON.stringify({ id: block.id.slice(0, 12), type: block.type, x: Math.round(block.x), y: Math.round(block.y), w: Math.round(block.w), h: Math.round(block.h), ...(block.flow ? { flow: true } : {}), ...(block.parentId ? { parent: true } : {}) })}
              </div>
            </Section>
            <div className="h-4" />
          </div>
        </div>
      )}
    </aside>
  );
}









