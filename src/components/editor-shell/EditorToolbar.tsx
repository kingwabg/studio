// EditorToolbar.tsx — 상단 서식 바. 타깃 사용자(한글에 익숙한 실무자)가 기대하는
// 문법으로 글자 서식을 노출한다: 글꼴·크기·가(굵게)/가(기울임)·글자색·정렬.
// 선택된 텍스트 블록에 작동 — 표는 표 자체 리본이 담당.
// (되돌리기·복제·삭제·삽입은 단축키 Ctrl+Z/Y·Delete + 좌측 팔레트가 담당)
import { useCanvasStore } from "../../modules/canvas/store";
import { type Block, type TextAlign, TEXT_DEFAULTS } from "../../modules/document/model";

const TEXT_COLORS = ["#1A2233", "#5B6577", "#2B5CE6", "#DC2626", "#16A34A", "#B45309"];
const Sep = () => <span className="w-px h-8 bg-line mx-1 shrink-0" />;

export function EditorToolbar() {
  const block = useCanvasStore((s) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null);
  const updateBlock = useCanvasStore((s) => s.updateBlock);

  const isText = block?.type === "text";
  const patch = (p: Partial<Block>) => block && updateBlock(block.id, p);
  const align = block?.align ?? TEXT_DEFAULTS.align;
  const aligns: { v: TextAlign; label: string; title: string }[] = [
    { v: "left", label: "좌", title: "왼쪽 정렬" },
    { v: "center", label: "중", title: "가운데 정렬" },
    { v: "right", label: "우", title: "오른쪽 정렬" },
  ];

  return (
    <div
      className={`shrink-0 flex items-center gap-2 px-3 h-11 bg-white border-b border-line ${
        isText ? "" : "opacity-45 pointer-events-none select-none"
      }`}
    >
      <span
        title="문서 폰트 — 한글 조판(전각)과의 줄바꿈 일치를 위해 맑은 고딕으로 고정"
        className="h-7 px-2.5 flex items-center rounded-md border border-line bg-white text-[12px] text-inksoft min-w-24"
      >
        맑은 고딕
      </span>
      <div className="flex items-center h-7 rounded-md border border-line bg-white overflow-hidden">
        <input
          type="number"
          step={0.5}
          min={6}
          value={block?.fontSize ?? TEXT_DEFAULTS.fontSize}
          onChange={(e) => patch({ fontSize: Math.max(6, Number(e.target.value)) })}
          className="w-14 h-full px-2 text-[12px] text-ink text-right outline-none"
        />
        <span className="px-1.5 text-[11px] text-inkfaint border-l border-line h-full flex items-center bg-paper">pt</span>
      </div>
      <Sep />
      <button
        onClick={() => patch({ bold: !block?.bold })}
        title="굵게"
        className={`w-7 h-7 rounded-md border text-[13px] font-bold transition-colors ${
          block?.bold ? "border-accent bg-accentsoft text-accent" : "border-line bg-white text-inksoft hover:border-accentline"
        }`}
      >
        가
      </button>
      <button
        onClick={() => patch({ italic: !block?.italic })}
        title="기울임"
        className={`w-7 h-7 rounded-md border text-[13px] italic transition-colors ${
          block?.italic ? "border-accent bg-accentsoft text-accent" : "border-line bg-white text-inksoft hover:border-accentline"
        }`}
      >
        가
      </button>
      <Sep />
      <div className="flex items-center gap-1.5">
        {TEXT_COLORS.map((c) => {
          const on = (block?.color ?? TEXT_DEFAULTS.color).toUpperCase() === c.toUpperCase();
          return (
            <button
              key={c}
              onClick={() => patch({ color: c })}
              aria-label={`글자색 ${c}`}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                on ? "ring-2 ring-accent border-white" : "border-line"
              }`}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>
      <Sep />
      <div className="flex gap-0.5 p-0.5 rounded-md bg-white border border-line">
        {aligns.map((a) => (
          <button
            key={a.v}
            title={a.title}
            onClick={() => patch({ align: a.v })}
            className={`w-7 h-6 rounded text-[12px] transition-colors ${
              align === a.v && isText ? "bg-accentsoft text-accent font-semibold" : "text-inksoft hover:bg-paper"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {!isText && (
        <span className="ml-auto text-[11px] text-inkfaint">
          {block?.type === "table" ? "표 서식은 표를 선택하면 뜨는 리본에서" : "텍스트 블록을 선택하면 서식을 바꿀 수 있어요"}
        </span>
      )}
    </div>
  );
}
