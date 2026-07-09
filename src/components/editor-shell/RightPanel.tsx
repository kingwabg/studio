// RightPanel.tsx — [속성] 선택 블록 편집 / [AI] 문서 도우미 (리디자인 시안 1b·1c).
// 시안의 섹션 구조(모양/크기/위치/여백/고급/디버그)를 그대로 따르되, 실제 문서 모델에
// 있는 컨트롤(내용·글자 서식·위치 유형·크기/좌표·서식 유전·디버그)만 진짜로 연결하고
// 모델에 없는 항목(배경·모서리·불투명도·안쪽 여백 등)은 "준비 중"으로 정직하게 표시한다.
import { type ReactNode } from "react";
import { useRightTabStore, usePanelStore } from "../../modules/ui/theme";
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, type TableKingData, type TextAlign, TEXT_DEFAULTS, DEFAULT_TEXT_PAD, padOf } from "../../modules/document/model";
import { AiPanel } from "./AiPanel";
import { FontSelect } from "./FontSelect";
import { IcText, IcTable, IcImage, IcTrash, IcSparkles, IcCopy } from "../../ui/icons";

const TEXT_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#D64550", "#3B9B6B", "#C77A28"];

// ── 재사용 소품 (시안: 섹션 라벨 11px/700/tracking .08em, 행 26px, 구분선) ──
function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="py-3 flex flex-col gap-[7px] border-b border-[color:var(--line)]">
      {label && <div className="text-[11px] font-bold text-inkfaint tracking-[.08em]">{label}</div>}
      {children}
    </div>
  );
}

// 값 표시 셀 (26px, 우측 정렬) — 편집 가능한 건 NumField, 아닌 건 ReadCell
function NumField({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="h-[26px] border border-line rounded-[7px] flex items-center px-2 bg-surface focus-within:border-accentline transition-colors">
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-right text-[12px] font-semibold text-ink outline-none bg-transparent tabular-nums"
      />
      {suffix && <span className="text-[11px] text-inkfaint ml-1">{suffix}</span>}
    </div>
  );
}
function ReadCell({ children, faint }: { children: ReactNode; faint?: boolean }) {
  return (
    <div className="h-[26px] border border-line rounded-[7px] flex items-center justify-end px-2 bg-surface">
      <span className={`text-[12px] ${faint ? "text-inkfaint" : "text-ink font-semibold"} tabular-nums`}>{children}</span>
    </div>
  );
}

// 라벨 + 컨트롤 한 줄 (좌 라벨 고정폭)
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-inksoft w-9 shrink-0">{label}</span>
      {children}
    </div>
  );
}

// 세그먼트 (인라인/절대, 좁게/보통/넓게 등) — active 옵션만 콜백
function Segment<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { v: T; label: string; soon?: boolean }[];
  value: T;
  onChange?: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex h-[26px] bg-paper border border-line rounded-[7px] overflow-hidden p-px ${disabled ? "opacity-60" : ""}`}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            title={o.soon ? `${o.label} (준비 중)` : o.label}
            onClick={o.soon || disabled ? undefined : () => onChange?.(o.v)}
            className={`flex-1 flex items-center justify-center text-[11px] rounded-[6px] transition-colors ${
              on ? "bg-surface text-accent font-bold" : "text-inksoft hover:bg-line/50"
            }`}
            style={on ? { boxShadow: "inset 0 0 0 1px var(--accentline)" } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// "준비 중" 점선 pill (추가: 그림자·필터 등)
function SoonPill({ children }: { children: ReactNode }) {
  return (
    <span
      title="준비 중"
      className="text-[11px] text-inksoft border border-dashed border-linestrong rounded-full px-2 py-0.5 cursor-default select-none"
    >
      {children}
    </span>
  );
}

// 글자 서식 (크기 스테퍼·가/가·정렬·색) — 텍스트 블록 실동작
function TextFormat({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const size = block.fontSize ?? TEXT_DEFAULTS.fontSize;
  const align = block.align ?? TEXT_DEFAULTS.align;
  const aligns: { v: TextAlign; label: string }[] = [
    { v: "left", label: "좌" },
    { v: "center", label: "중" },
    { v: "right", label: "우" },
  ];
  return (
    <>
      <Row label="글꼴">
        <FontSelect
          value={block.font}
          onChange={(key) => patch({ font: key })}
          className="h-[26px] px-1.5 rounded-[7px] border border-line bg-surface text-[12px] text-ink flex-1 outline-none hover:border-linestrong focus:border-accentline transition-colors cursor-pointer"
        />
      </Row>
      <Row label="크기">
        <div className="flex items-center h-[26px] border border-line rounded-[7px] overflow-hidden flex-1">
          <button onClick={() => patch({ fontSize: Math.max(6, size - 0.5) })} className="w-6 h-full text-inksoft hover:bg-paper text-[13px]">−</button>
          <span className="flex-1 text-center text-[12px] font-semibold text-ink border-x border-line h-full flex items-center justify-center tabular-nums">{size}pt</span>
          <button onClick={() => patch({ fontSize: size + 0.5 })} className="w-6 h-full text-inksoft hover:bg-paper text-[13px]">＋</button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => patch({ bold: !block.bold })}
            title="굵게"
            className={`w-[26px] h-[26px] rounded-[7px] text-[13px] font-extrabold transition-colors ${block.bold ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper"}`}
          >
            가
          </button>
          <button
            onClick={() => patch({ italic: !block.italic })}
            title="기울임"
            className={`w-[26px] h-[26px] rounded-[7px] text-[13px] italic transition-colors ${block.italic ? "bg-accentsoft text-accent" : "text-inksoft hover:bg-paper"}`}
          >
            가
          </button>
        </div>
      </Row>
      <Row label="정렬">
        <Segment
          options={aligns.map((a) => ({ v: a.v, label: a.label }))}
          value={align}
          onChange={(v) => patch({ align: v })}
        />
      </Row>
      <Row label="색">
        <div className="flex items-center gap-2 flex-1">
          {TEXT_COLORS.map((c) => {
            const on = (block.color ?? TEXT_DEFAULTS.color).toUpperCase() === c.toUpperCase();
            return (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                aria-label={`색 ${c}`}
                className="w-[18px] h-[18px] rounded-full transition-transform hover:scale-[1.15]"
                style={{ backgroundColor: c, border: `2px solid ${on ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.08)" }}
              />
            );
          })}
        </div>
      </Row>
    </>
  );
}

// 모양 — 배경 채우기·모서리·테두리 (실동작)
const FILL_SWATCHES = ["", "#FFFFFF", "#F6F7FA", "#EDF2FE", "#FDEEF0", "#EAF6EF", "#FEF9E7"];
const BORDER_COLORS = ["#1A2233", "#5B6577", "#CBD2DE", "#2B5CE6", "#D64550", "#3B9B6B"];

function ShapeSection({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const bw = block.borderWidth ?? 0;
  return (
    <Section label="모양">
      <Row label="배경">
        <div className="flex items-center gap-1.5 flex-1">
          {FILL_SWATCHES.map((c) => {
            const on = (block.fill ?? "") === c;
            return (
              <button
                key={c || "none"}
                onClick={() => patch({ fill: c || undefined })}
                title={c || "없음"}
                className="w-[18px] h-[18px] rounded-[5px] transition-transform hover:scale-[1.15] flex items-center justify-center shrink-0"
                style={{ background: c || "var(--surface)", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.06)" }}
              >
                {!c && <span className="text-[9px] text-inkfaint leading-none">✕</span>}
              </button>
            );
          })}
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="모서리">
          <NumField value={block.radius ?? 0} onChange={(v) => patch({ radius: Math.max(0, Math.min(40, v)) })} suffix="px" />
        </Row>
        <Row label="테두리">
          <Segment
            options={[{ v: "0", label: "없음" }, { v: "1", label: "1" }, { v: "2", label: "2" }]}
            value={String(bw)}
            onChange={(v) => patch({ borderWidth: Number(v), borderColor: block.borderColor ?? "#CBD2DE" })}
          />
        </Row>
      </div>
      {bw > 0 && (
        <Row label="선색">
          <div className="flex items-center gap-1.5 flex-1">
            {BORDER_COLORS.map((c) => {
              const on = (block.borderColor ?? "#CBD2DE").toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  onClick={() => patch({ borderColor: c })}
                  aria-label={`선색 ${c}`}
                  className="w-[18px] h-[18px] rounded-full transition-transform hover:scale-[1.15] shrink-0"
                  style={{ backgroundColor: c, border: `2px solid ${on ? "var(--accent)" : "var(--surface)"}`, boxShadow: "0 0 0 1px rgba(16,24,40,.08)" }}
                />
              );
            })}
          </div>
        </Row>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-1">
        <span className="text-[11px] text-inkfaint">추가:</span>
        <SoonPill>그림자</SoonPill>
        <SoonPill>불투명도</SoonPill>
        <SoonPill>필터</SoonPill>
      </div>
    </Section>
  );
}

// 여백 — 상자 안쪽 패딩(mm). 화면 CSS = 내보내기 cellMargin 같은 값 → 줄바꿈 정합.
function PaddingSection({ block }: { block: Block }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const patch = (p: Partial<Block>) => updateBlock(block.id, p);
  const pad = padOf(block);
  const level = pad.x < 1.5 ? "s" : pad.x > 3.5 ? "l" : "m";
  return (
    <Section label="여백">
      <Row label="안쪽">
        <Segment
          options={[{ v: "s", label: "좁게" }, { v: "m", label: "보통" }, { v: "l", label: "넓게" }]}
          value={level}
          onChange={(v) =>
            patch(v === "s" ? { padX: 1, padY: 0.6 } : v === "l" ? { padX: 5, padY: 3 } : { padX: DEFAULT_TEXT_PAD.x, padY: DEFAULT_TEXT_PAD.y })
          }
        />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="좌우"><NumField value={pad.x} onChange={(v) => patch({ padX: Math.max(0, v) })} suffix="mm" /></Row>
        <Row label="상하"><NumField value={pad.y} onChange={(v) => patch({ padY: Math.max(0, v) })} suffix="mm" /></Row>
      </div>
    </Section>
  );
}

// 온/오프 스위치 (시안 토큰 — 켜짐=accent)
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-[38px] h-[22px] rounded-full transition-colors shrink-0 ${on ? "bg-accent" : "bg-linestrong"}`}
    >
      <span
        className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform ${on ? "translate-x-[19px]" : "translate-x-[3px]"}`}
        style={{ boxShadow: "0 1px 2px rgba(16,24,40,.2)" }}
      />
    </button>
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
        <span className="text-[12px] text-inksoft">채우기 안내문 (placeholder)</span>
        <Toggle on={on} onChange={toggle} />
      </div>
      {on && (
        <>
          <textarea
            value={block.hint ?? ""}
            onChange={(e) => updateBlock(block.id, { hint: e.target.value })}
            rows={2}
            placeholder="예: [문서 제목을 입력하세요]"
            className="px-2.5 py-2 rounded-lg border border-line text-ink text-[13px] outline-none focus:border-accentline transition-colors resize-none leading-relaxed bg-surface"
          />
          <p className="text-[11px] text-inkfaint leading-relaxed">
            비어있을 때 회색으로 표시되고, 지면에서 실제 글자를 입력하면 사라집니다. 내보내기(HWPX)엔 포함되지 않아요.
          </p>
        </>
      )}
    </Section>
  );
}

// 표 크기 "R×C" — 스냅샷 셀 배열에서
function tableDims(block: Block): string {
  const d = block.data as TableKingData | undefined;
  if (!d?.cells?.length) return "표";
  return `${d.cells.length}×${d.cells[0]?.length ?? 0}`;
}

export function RightPanel() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const parentText = useCanvasStore((s) => {
    const sel = s.doc.blocks.find((b) => b.id === s.selectedId);
    if (!sel?.parentId) return null;
    return s.doc.blocks.find((b) => b.id === sel.parentId)?.text ?? null;
  });
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const removeBlock = useCanvasStore((s) => s.removeBlock);
  const duplicateBlock = useCanvasStore((s) => s.duplicateBlock);
  const cascadeStyle = useCanvasStore((s) => s.cascadeStyle);
  const hasKids = useCanvasStore((s) => s.doc.blocks.some((b) => b.parentId === s.selectedId));
  const tab = useRightTabStore((s) => s.tab);
  const setTab = useRightTabStore((s) => s.setTab);
  const rightW = usePanelStore((s) => s.rightW);
  const rightOpen = usePanelStore((s) => s.rightOpen);
  if (!rightOpen) return null;

  const kind =
    block?.type === "text"
      ? { label: block.flow ? "본문 블록" : "텍스트 블록", icon: <IcText size={13} /> }
      : block?.type === "table"
        ? { label: `표 블록 · ${block ? tableDims(block) : ""}`, icon: <IcTable size={13} /> }
        : { label: "이미지 블록", icon: <IcImage size={13} /> };

  return (
    <aside className="shrink-0 border-l border-line bg-surface flex flex-col overflow-hidden" style={{ width: rightW }}>
      {/* 속성 / AI 세그먼트 (시안 1b) */}
      <div className="px-3.5 pt-3.5 shrink-0">
        <div className="flex bg-paper border border-line rounded-[9px] p-[3px] gap-[3px]">
          {(
            [
              ["props", "속성", null],
              ["ai", "AI", <IcSparkles key="i" size={12} />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[7px] text-[13px] transition-colors ${
                tab === key ? "bg-surface text-ink font-bold shadow-sm" : "text-inksoft font-medium hover:text-ink"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "ai" ? (
        <AiPanel />
      ) : !block ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-paper text-inkfaint">
            <IcText size={18} />
          </span>
          <p className="text-[12px] text-inkfaint leading-relaxed">블록을 선택하면<br />속성이 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* 요소 헤더 — 아이콘 타일 + 종류 + 부모(트리) */}
          <div className="px-4 py-3.5 flex items-center gap-2.5 border-b border-line">
            <div className="w-6 h-6 rounded-[7px] bg-accentsoft text-accent flex items-center justify-center shrink-0">
              {kind.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold text-ink truncate">{kind.label}</div>
              <div className="text-[11px] text-inkfaint truncate">
                {parentText ? `${parentText.slice(0, 16)}의 하위` : "루트 블록"}
              </div>
            </div>
            <button onClick={() => duplicateBlock(block.id)} title="복제" className="w-7 h-7 rounded-lg text-inkfaint hover:text-ink hover:bg-paper flex items-center justify-center transition-colors">
              <IcCopy size={14} />
            </button>
            <button onClick={() => removeBlock(block.id)} title="삭제" className="w-7 h-7 rounded-lg text-inkfaint hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors">
              <IcTrash size={14} />
            </button>
          </div>

          <div className="px-4">
            {/* 안내문 (폼 placeholder) — 비어있을 때 회색 안내문, 입력하면 사라짐. 내보내기 제외. */}
            {block.type === "text" && <HintSection block={block} />}

            {/* 글자 서식 (텍스트) */}
            {block.type === "text" && (
              <Section label="글자">
                <TextFormat block={block} />
              </Section>
            )}

            {/* 위치 유형 (텍스트) — 본문(인라인)/절대 = flow 토글 */}
            {block.type === "text" && (
              <Section label="위치 유형">
                <Segment
                  options={[
                    { v: "flow", label: "본문(인라인)" },
                    { v: "abs", label: "절대 배치" },
                  ]}
                  value={block.flow ? "flow" : "abs"}
                  onChange={(v) => updateBlock(block.id, { flow: v === "flow" })}
                />
                <p className="text-[11px] text-inkfaint leading-relaxed">
                  {block.flow
                    ? "한글에서 커서가 흐르는 진짜 문단 (길면 페이지 넘김)"
                    : "지면 좌표에 고정된 개체 (자유 배치)"}
                </p>
              </Section>
            )}

            {/* 크기 · 위치 (공통) — 실제 x/y/w/h */}
            <Section label="크기 · 위치 (mm)">
              <div className="grid grid-cols-2 gap-2">
                <Row label="X"><NumField value={block.x} onChange={(v) => updateBlock(block.id, { x: v })} /></Row>
                <Row label="Y"><NumField value={block.y} onChange={(v) => updateBlock(block.id, { y: v })} /></Row>
                <Row label="폭"><NumField value={block.w} onChange={(v) => updateBlock(block.id, { w: v })} /></Row>
                <Row label="높이">
                  {block.type === "text" ? <ReadCell faint>자동 {Math.round(block.h)}</ReadCell> : <NumField value={block.h} onChange={(v) => updateBlock(block.id, { h: v })} />}
                </Row>
              </div>
            </Section>

            {/* 서식 유전 (자식 있을 때) */}
            {hasKids && (
              <Section label="트리">
                <button
                  onClick={() => cascadeStyle(block.id)}
                  className="flex flex-col items-start rounded-lg border border-line px-3 py-2 text-left hover:border-accentline hover:bg-accentsoft/30 transition-colors"
                >
                  <span className="text-[12px] font-semibold text-ink">하위 서식 계단 적용</span>
                  <span className="text-[11px] text-inkfaint mt-0.5">
                    이 블록({block.fontSize ?? TEXT_DEFAULTS.fontSize}pt) 기준, 하위 텍스트를 한 단계씩 −2pt
                  </span>
                </button>
              </Section>
            )}

            {/* 모양 — 배경·모서리·테두리 (실동작) */}
            <ShapeSection block={block} />

            {/* 여백 — 안쪽 패딩 (텍스트 실동작) */}
            {block.type === "text" && <PaddingSection block={block} />}

            {/* 접힌 섹션 (준비 중) */}
            <div className="opacity-55 pointer-events-none select-none">
              {["고급", "내보내기 설정"].map((s) => (
                <div key={s} className="flex items-center h-[34px] border-b border-line">
                  <span className="flex-1 text-[12px] font-semibold text-ink">{s}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2l3 3-3 3" stroke="var(--inkfaint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              ))}
            </div>

            {/* 디버그 — 실제 블록 JSON (개발·검증에 유용) */}
            <Section label="디버그">
              <div className="bg-paper border border-line rounded-lg px-2.5 py-2 font-mono text-[10px] leading-relaxed text-inksoft break-all">
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
