// HwpRibbon.tsx — 한글(HWP) 웹 스타일 리본 헤더: 메뉴 탭 + 아이콘 툴바 (KRDS 룩).
// 레이아웃은 한글 웹을 따르되(익숙함), 색·보더·라운드는 KRDS(#256EF4·플랫+보더) 유지.
// 구현된 기능만 배선하고 미구현은 비활성(회색, "(준비 중)" 툴팁) — 자리 먼저, 기능 나중.
// 컨텍스트 서식바(EditorToolbar)는 이 아래 3번째 줄로 유지된다.
import { type ReactNode, useState } from "react";
import { useCanvasStore } from "../../modules/canvas/store";
import { useRightTabStore } from "../../modules/ui/theme";
import { useInspectStore } from "../../modules/canvas/snap";
import { FONTS, fontCss, ensureFont } from "../../modules/document/fonts";
import { DsIcon } from "../../ui/design-icons";
import { RbIcon } from "../../ui/ribbon-icons";

const TABS = ["파일", "편집", "보기", "입력", "서식", "쪽", "표", "검토", "도구"] as const;
type TabKey = (typeof TABS)[number];

type Item =
  | {
      kind: "btn";
      key: string;
      label: string;
      icon: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      active?: boolean;
      title?: string;
    }
  | { kind: "divider"; key: string };

function IconButton({ item }: { item: Extract<Item, { kind: "btn" }> }) {
  return (
    <button
      type="button"
      title={item.disabled ? `${item.title ?? item.label} (준비 중)` : (item.title ?? item.label)}
      disabled={item.disabled}
      onClick={item.disabled ? undefined : item.onClick}
      aria-pressed={item.active}
      className={`flex h-[54px] w-[54px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg transition-colors ${
        item.active
          ? "bg-accentsoft text-accent shadow-[inset_0_0_0_1px_var(--accentline)]"
          : item.disabled
            ? "cursor-default text-inkfaint opacity-60"
            : "text-inksoft hover:bg-paper hover:text-ink"
      }`}
    >
      {item.icon}
      <span className="whitespace-nowrap text-[10.5px] font-semibold leading-none">{item.label}</span>
    </button>
  );
}

// 공공안심글꼴 팝오버 — 선택한 텍스트 블록에 안심글꼴(category "safe") 즉시 적용.
// 폰트 저작권 안전이 셀링포인트라 한글 웹의 "공공안심글꼴" 자리에 실동작으로 배선.
function SafeFontButton({ blockId, disabled }: { blockId: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const safeFonts = FONTS.filter((f) => f.category === "safe");
  return (
    <div className="relative shrink-0">
      <IconButton
        item={{
          kind: "btn",
          key: "safe-font",
          label: "안심글꼴",
          icon: <RbIcon name="safe-font" />,
          title: "안심글꼴 — 상업 이용 무료 폰트를 선택 블록에 적용",
          disabled,
          active: open,
          onClick: () => setOpen((v) => !v),
        }}
      />
      {open && blockId && (
        <>
          <button type="button" aria-label="닫기" className="fixed inset-0 z-[59] cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[58px] z-[60] w-52 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
            <div className="px-2 py-1 text-[10.5px] font-bold text-inkfaint">공공·상업 안심글꼴 (저작권 안전)</div>
            {safeFonts.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  void ensureFont(f.key);
                  updateBlock(blockId, { font: f.key });
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center rounded-lg px-2 text-left text-[13px] text-ink hover:bg-paper"
                style={fontCss(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HwpRibbon({ onExport, onPreview }: { onExport: () => void; onPreview: () => void }) {
  const [tab, setTab] = useState<TabKey>("편집");
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const blocks = useCanvasStore((s) => s.doc.blocks);
  const page = useCanvasStore((s) => s.doc.page);
  const addBlock = useCanvasStore((s) => s.addBlock);
  const openInspector = useRightTabStore((s) => s.setTab);
  const showGuides = useInspectStore((s) => s.showGuides);
  const toggleGuides = useInspectStore((s) => s.toggle);

  const textBlockId = block?.type === "text" ? block.id : null;
  const tableSelected = block?.type === "table";

  // 지면 가운데 삽입 — LeftPanel 클릭 삽입과 같은 규칙(살짝 어긋나게 겹침 방지)
  const insert = (type: "table" | "image", w: number, h: number) => {
    const offset = (blocks.length % 5) * 4;
    addBlock(type, page.w / 2 - w / 2 + offset, page.h / 2 - h / 2 + offset);
  };
  const runTable = (label: string) => {
    if (!block || block.type !== "table") return;
    window.dispatchEvent(new CustomEvent("studio:table-ribbon", { detail: { blockId: block.id, kind: "primary", label } }));
  };
  const tableTitle = tableSelected ? undefined : "표를 선택(더블클릭=셀 편집)한 뒤 사용";

  const div = (key: string): Item => ({ kind: "divider", key });
  const btn = (key: string, label: string, icon: ReactNode, rest: Partial<Extract<Item, { kind: "btn" }>> = {}): Item => ({
    kind: "btn", key, label, icon, ...rest,
  });

  // 공통 조각 — 여러 탭이 공유(스크린샷의 "편집" 탭이 종합 세트)
  const inputItems: Item[] = [
    btn("shape", "도형", <RbIcon name="shape" />, { disabled: true }),
    btn("image", "그림", <DsIcon name="photo-frame" size={22} />, { onClick: () => insert("image", 80, 60) }),
    btn("table", "표", <DsIcon name="table-form" size={22} />, { onClick: () => insert("table", 120, 40) }),
    btn("chart", "차트", <RbIcon name="chart" />, { disabled: true }),
    btn("video", "웹 동영상", <RbIcon name="video" />, { disabled: true }),
    div("d-note"),
    btn("footnote", "각주", <RbIcon name="footnote" />, { disabled: true }),
    btn("endnote", "미주", <RbIcon name="endnote" />, { disabled: true }),
    div("d-link"),
    btn("link", "하이퍼링크", <RbIcon name="hyperlink" />, {
      disabled: true,
      title: "하이퍼링크 — 텍스트를 드래그 선택하면 뜨는 서식바에서 지원",
    }),
    btn("charmap", "문자표", <RbIcon name="charmap" />, { disabled: true }),
  ];
  const shapeItems: Item[] = [
    btn("char-shape", "글자 모양", <RbIcon name="char-shape" />, { onClick: () => openInspector("props"), title: "글자 모양 — 우측 속성 패널" }),
    btn("para-shape", "문단 모양", <RbIcon name="para-shape" />, { onClick: () => openInspector("props"), title: "문단 모양 — 우측 속성 패널" }),
  ];
  const pageItems: Item[] = [
    btn("header", "머리말", <RbIcon name="header-mark" />, { disabled: true }),
    btn("footer", "꼬리말", <RbIcon name="footer-mark" />, { disabled: true }),
    btn("ctrl-code", "조판 부호", <RbIcon name="control-code" />, { disabled: true }),
    btn("para-mark", "문단 부호", <RbIcon name="para-mark" />, { disabled: true }),
    btn("grid", "격자 보기", <DsIcon name="snap-guides" size={22} />, {
      onClick: toggleGuides,
      active: showGuides,
      title: "격자 보기 — 선택 요소의 정렬 점선 항상 표시",
    }),
  ];

  const ITEMS: Record<TabKey, Item[]> = {
    파일: [
      btn("save", "저장하기", <RbIcon name="save" />, { onClick: onExport, title: "저장하기 — HWPX로 내려받기" }),
      btn("preview", "한글 미리보기", <RbIcon name="preview" />, { onClick: onPreview }),
      div("d-file"),
      btn("new", "새 문서", <DsIcon name="duplicate" size={22} />, { disabled: true, title: "새 문서 — 문서함에서 생성" }),
      btn("open", "불러오기", <RbIcon name="find" />, { disabled: true }),
      btn("pdf", "PDF 저장", <RbIcon name="save" />, { disabled: true }),
    ],
    편집: [
      btn("save", "저장하기", <RbIcon name="save" />, { onClick: onExport, title: "저장하기 — HWPX로 내려받기" }),
      div("d-clip"),
      btn("cut", "오려 두기", <RbIcon name="cut" />, { disabled: true }),
      btn("copy", "복사하기", <DsIcon name="duplicate" size={22} />, { disabled: true }),
      btn("paste", "붙이기", <RbIcon name="paste" />, { disabled: true }),
      btn("brush", "모양 복사", <RbIcon name="format-brush" />, { disabled: true }),
      div("d-find"),
      btn("find", "찾기", <RbIcon name="find" />, { disabled: true }),
      div("d-input"),
      ...inputItems,
      div("d-shape"),
      ...shapeItems,
      div("d-obj"),
      btn("obj-props", "개체 속성", <DsIcon name="settings" size={22} />, {
        onClick: () => openInspector("props"),
        title: "개체 속성 — 우측 속성 패널",
      }),
      div("d-page"),
      ...pageItems,
    ],
    보기: [
      btn("grid", "격자 보기", <DsIcon name="snap-guides" size={22} />, { onClick: toggleGuides, active: showGuides }),
      btn("preview", "한글 미리보기", <RbIcon name="preview" />, { onClick: onPreview }),
      div("d-marks"),
      btn("ctrl-code", "조판 부호", <RbIcon name="control-code" />, { disabled: true }),
      btn("para-mark", "문단 부호", <RbIcon name="para-mark" />, { disabled: true }),
    ],
    입력: inputItems,
    서식: [...shapeItems, div("d-style"), btn("style", "스타일", <DsIcon name="title" size={22} />, { disabled: true })],
    쪽: [
      btn("header", "머리말", <RbIcon name="header-mark" />, { disabled: true }),
      btn("footer", "꼬리말", <RbIcon name="footer-mark" />, { disabled: true }),
      btn("page-no", "쪽 번호", <DsIcon name="page-number" size={22} />, { disabled: true }),
      btn("paper", "용지 설정", <DsIcon name="table-list" size={22} />, { disabled: true }),
    ],
    표: [
      btn("table", "표 삽입", <DsIcon name="table-form" size={22} />, { onClick: () => insert("table", 120, 40) }),
      div("d-rc"),
      btn("row-add", "행 추가", <DsIcon name="row-add" size={22} />, { onClick: () => runTable("행 추가"), disabled: !tableSelected, title: tableTitle }),
      btn("col-add", "열 추가", <DsIcon name="col-add" size={22} />, { onClick: () => runTable("열 추가"), disabled: !tableSelected, title: tableTitle }),
      btn("row-del", "행 삭제", <DsIcon name="row-add" size={22} style={{ transform: "scaleY(-1)" }} />, { onClick: () => runTable("행 삭제"), disabled: !tableSelected, title: tableTitle }),
      btn("col-del", "열 삭제", <DsIcon name="col-add" size={22} style={{ transform: "scaleX(-1)" }} />, { onClick: () => runTable("열 삭제"), disabled: !tableSelected, title: tableTitle }),
      div("d-merge"),
      btn("merge", "셀 병합", <DsIcon name="cell-merge" size={22} />, { onClick: () => runTable("병합"), disabled: !tableSelected, title: tableTitle }),
      btn("unmerge", "병합 해제", <DsIcon name="cell-split" size={22} />, { onClick: () => runTable("병합 해제"), disabled: !tableSelected, title: tableTitle }),
      div("d-eq"),
      btn("eq-w", "너비 같게", <DsIcon name="col-add" size={22} />, { onClick: () => runTable("W 같게"), disabled: !tableSelected, title: tableTitle }),
      btn("eq-h", "높이 같게", <DsIcon name="row-add" size={22} />, { onClick: () => runTable("H 같게"), disabled: !tableSelected, title: tableTitle }),
    ],
    검토: [
      btn("spell", "맞춤법", <RbIcon name="find" />, { disabled: true }),
      btn("track", "변경 추적", <RbIcon name="control-code" />, { disabled: true }),
      btn("memo", "메모", <DsIcon name="speech" size={22} />, { disabled: true }),
    ],
    도구: [
      btn("merge-data", "데이터 병합", <DsIcon name="table-list" size={22} />, { disabled: true, title: "데이터 병합 — 좌측 '데이터' 탭에서 지원" }),
      btn("rhwp-editor", "rhwp 에디터", <DsIcon name="brand-logo" size={22} />, {
        title: "rhwp 에디터 — 한글 문서 엔진의 완성 에디터(무수정 임베드) 열기",
        onClick: () => { window.location.href = "/studio/rhwp"; },
      }),
    ],
  };

  return (
    <div className="shrink-0 border-b border-line bg-surface relative z-[2]">
      {/* 메뉴 탭 — KRDS 수평 탭 (활성 = 블루 + 하단 2px) */}
      <div className="flex h-9 items-end gap-0.5 border-b border-line px-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-selected={tab === t}
            className={`h-full px-3 text-[13px] font-bold transition-colors ${
              tab === t ? "text-accent shadow-[inset_0_-2px_0_var(--accent)]" : "text-inksoft hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {/* 아이콘 툴바 — 아이콘 위 + 라벨 아래 (한글 웹 스타일) */}
      <div className="flex h-[62px] items-center gap-0.5 overflow-x-auto px-2.5">
        {ITEMS[tab].map((item) =>
          item.kind === "divider" ? (
            <span key={item.key} className="mx-1 h-9 w-px shrink-0 bg-line" />
          ) : (
            <IconButton key={item.key} item={item} />
          )
        )}
        {(tab === "편집" || tab === "도구") && <SafeFontButton blockId={textBlockId} disabled={!textBlockId} />}
      </div>
    </div>
  );
}
