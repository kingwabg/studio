// AiPanel.tsx — AI 문서 도우미 (기존 에디터 AiPanel 이식본, 새 캔버스용).
//
// 흐름: 요청 + 현재 문서 요약 → Claude(Fable 5 우선, Sonnet 4.6 폴백) →
// {title, sections} JSON → 게이트웨이 검증 → aiJsonToBlocks로 "트리 문서" 생성 →
// loadDoc 교체. 각 응답에 '되돌리기' 스냅샷을 달아 실수를 복구한다.
//
// ⚠ 보안: 지금은 브라우저에서 API를 직접 호출한다(키 없이 이 개발 환경에서만 동작).
// 배포 전에는 반드시 Supabase Edge Function 프록시로 교체할 것 (docs/phase-2-design.md).
import { useEffect, useMemo, useRef, useState } from "react";
import { type CanvasDoc } from "../../modules/document/model";
import { useCanvasStore } from "../../modules/canvas/store";
import { aiJsonToBlocks, validateDocJson, type AiDocJson } from "../../modules/ai/aiToCanvas";
import { lintDoc, fixAll, type Finding } from "../../modules/lint/adminLint";
import { IcSparkles, IcSend, IcRestore } from "../../ui/icons";

const AI_SYSTEM_PROMPT = `당신은 한국어 공식 문서(보고서·사업계획서·제안서·공문·회의록) 작성 AI입니다.
사용자의 요청과 '현재 문서'를 바탕으로 완성된 문서 전체를 아래 JSON 형식으로만 출력하세요.

{"title":"문서 제목","sections":[{"heading":"섹션 제목","level":1,"blocks":[{"type":"para","text":"..."},{"type":"list","items":["...","..."],"ordered":false},{"type":"table","rows":[["헤더1","헤더2"],["값1","값2"]]}]}]}

규칙:
1. JSON 외 어떤 텍스트도 출력 금지 (마크다운 백틱, 설명, 인사 모두 금지)
2. level은 1(Ⅰ.) | 2(1.) | 3(가.) — 섹션 번호는 시스템이 자동 부여하므로 heading에 번호를 쓰지 말 것
3. 표의 모든 행은 같은 열 수, 첫 행은 헤더, 최대 10열
4. 객관적 공문체 (~하고자 함, ~를 목적으로 함). 1인칭·구어체 금지
5. 모르는 수치는 [○○]로 표기하고 지어내지 말 것
6. 예산·일정·현황은 표, 항목 나열은 목록, 설명은 산문(para)
7. 전체는 간결하게: 섹션 3~6개, 응답 JSON이 지나치게 길지 않게
8. 사용자가 부분 수정을 요청하면 나머지는 유지한 채 해당 부분만 바꾼 '문서 전체'를 반환`;

// 캔버스 문서 → AI 컨텍스트 (좌표는 노이즈 — 트리와 내용만 요약해 토큰 절약)
function serializeForAi(doc: CanvasDoc) {
  return {
    title: doc.title,
    blocks: doc.blocks.map((b) => ({
      type: b.type,
      text: b.text,
      parent: b.parentId ? doc.blocks.find((p) => p.id === b.parentId)?.text?.slice(0, 20) : undefined,
      rows: b.data ? b.data.cells.map((row) => row.map((c) => c.text)) : b.rows,
    })),
  };
}

// Fable 5 우선, 미지원이면 Sonnet 4.6 폴백 — 성공한 모델을 기억해 재사용
const MODEL_CANDIDATES = ["claude-fable-5", "claude-sonnet-4-6"];

interface Msg {
  role: "user" | "ai" | "error";
  text: string;
  prevDoc?: CanvasDoc; // 되돌리기 스냅샷
}

const CHIPS = ["사업계획서 초안", "주간 업무 보고서", "회의록 양식"];

export function AiPanel() {
  const [mode, setMode] = useState<"chat" | "lint">("chat");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "어떤 문서를 만들까요? 요청하면 캔버스의 문서를 새로 작성하거나 수정해 드립니다." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const workingModelRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, busy]);

  const callModel = async (prompt: string) => {
    const candidates = workingModelRef.current ? [workingModelRef.current] : MODEL_CANDIDATES;
    let lastErr: Error | null = null;
    for (const model of candidates) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            system: AI_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const data = await res.json();
        if (data.type === "error" || data.error || !data.content) {
          lastErr = new Error(data.error?.message || `${model} 호출 실패`);
          continue;
        }
        workingModelRef.current = model;
        setActiveModel(model);
        return data;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error("모든 모델 호출에 실패했습니다.");
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setBusy(true);
    try {
      const { doc } = useCanvasStore.getState();
      const prompt = `현재 문서(JSON):\n${JSON.stringify(serializeForAi(doc))}\n\n요청: ${msg}`;
      const data = await callModel(prompt);
      const raw = (data.content as { type: string; text?: string }[])
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .replace(/```json|```/g, "")
        .trim();
      let json: AiDocJson;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("AI 응답을 JSON으로 해석하지 못했습니다. 다시 시도해 주세요.");
      }
      const err = validateDocJson(json); // 게이트웨이 검증 — 실패면 캔버스 무손상
      if (err) throw new Error(`검증 실패: ${err}`);
      const prevDoc = doc;
      const next: CanvasDoc = { ...doc, title: json.title.trim(), blocks: aiJsonToBlocks(json, doc.page) };
      useCanvasStore.getState().loadDoc(next);
      setMessages((m) => [
        ...m,
        { role: "ai", text: `문서를 갱신했어요 — 「${json.title}」, 섹션 ${json.sections.length}개`, prevDoc },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: e instanceof Error ? e.message : "요청에 실패했습니다." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 px-3.5 py-3.5">
      {/* 모드: 도우미(생성/수정) | 서식 검사(공문서 린터) */}
      <div className="flex bg-paper border border-line rounded-[9px] p-[3px] gap-[3px] mb-2.5">
        {(
          [
            ["chat", "도우미"],
            ["lint", "서식 검사"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[7px] text-[12px] transition-colors ${
              mode === key ? "bg-surface text-ink font-bold shadow-sm" : "text-inksoft font-medium hover:text-ink"
            }`}
          >
            {key === "chat" ? <IcSparkles size={12} /> : <LintGlyph />}
            {label}
          </button>
        ))}
        {mode === "chat" && activeModel && (
          <span
            title={`현재 응답 모델: ${activeModel}`}
            className={`self-center text-[9px] font-semibold rounded px-1.5 py-0.5 border shrink-0 ${
              activeModel === "claude-fable-5" ? "text-accent bg-accentsoft border-accentline" : "text-inkfaint bg-surface border-line"
            }`}
          >
            {activeModel === "claude-fable-5" ? "Fable 5" : "Sonnet 4.6"}
          </span>
        )}
      </div>

      {mode === "lint" ? (
        <LintView />
      ) : (
      <>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {CHIPS.map((c) => (
          <button
            key={c}
            disabled={busy}
            onClick={() => send(`${c}을(를) 작성해줘`)}
            className="text-[10.5px] font-semibold text-accent bg-accentsoft border border-accentline rounded-full px-2.5 py-1 hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
          >
            {c}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[92%] ${m.role === "user" ? "self-end" : "self-start"}`}>
            <div
              className={`text-[11.5px] leading-relaxed px-2.5 py-2 ${
                m.role === "user"
                  ? "bg-accent text-white rounded-[12px_12px_3px_12px]"
                  : m.role === "error"
                    ? "bg-red-50 text-red-700 border border-red-200 rounded-[12px_12px_12px_3px]"
                    : "bg-paper text-ink border border-line rounded-[12px_12px_12px_3px]"
              }`}
            >
              {m.text}
            </div>
            {m.prevDoc && (
              <button
                onClick={() => useCanvasStore.getState().loadDoc(m.prevDoc!)}
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-inksoft border border-line rounded-md px-1.5 py-0.5 hover:border-accentline hover:text-accent transition-colors"
              >
                <IcRestore size={11} /> 이전 문서로 되돌리기
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="self-start flex gap-1 px-3 py-2.5 bg-paper border border-line rounded-[12px_12px_12px_3px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[5px] h-[5px] rounded-full bg-inkfaint"
                style={{ animation: `aiDot 1s ${i * 0.18}s infinite ease-in-out` }}
              />
            ))}
            <style>{`@keyframes aiDot { 0%,100% { opacity:.25; transform: translateY(0);} 50% { opacity:1; transform: translateY(-2px);} }`}</style>
          </div>
        )}
      </div>

      <div className="flex gap-1.5 mt-2.5">
        <input
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // 캔버스 Delete/Ctrl+Z 단축키와 충돌 방지
            if (e.key === "Enter") send();
          }}
          placeholder={busy ? "작성 중…" : "예: 분기 보고서 만들어줘"}
          className="flex-1 h-9 rounded-lg border border-line px-2.5 text-[12px] text-ink outline-none focus:border-accent transition-colors bg-surface disabled:bg-paper"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          aria-label="보내기"
          className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center hover:bg-accenthover transition-colors disabled:bg-line disabled:cursor-default shrink-0"
        >
          <IcSend size={14} />
        </button>
      </div>
      <p className="text-[10px] text-inkfaint leading-relaxed mt-1.5">
        생성 시 캔버스가 트리 문서로 교체됩니다. 각 응답의 '되돌리기'로 복구할 수 있어요.
      </p>
      </>
      )}
    </div>
  );
}

// 서식 검사 아이콘 (체크리스트 느낌)
function LintGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.2h6M2 7h6M2 10.8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9.6 9.4l1.4 1.4 2.2-2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SEV_STYLE: Record<Finding["severity"], { dot: string; label: string }> = {
  error: { dot: "#D64550", label: "오류" },
  warning: { dot: "#C77A28", label: "주의" },
  info: { dot: "#2B5CE6", label: "참고" },
};

// ── 공문서 린터 뷰 — 행정 서식 오류 검사 + 자동 수정 ──
function LintView() {
  const doc = useCanvasStore((s) => s.doc);
  // 문서가 바뀔 때마다 재검사 (자동 수정 후 즉시 갱신)
  const findings = useMemo(() => lintDoc(doc), [doc]);
  const [snap, setSnap] = useState<CanvasDoc | null>(null); // 되돌리기 스냅샷

  const applyFix = (f: Finding) => {
    if (!f.fix) return;
    const cur = useCanvasStore.getState().doc;
    setSnap(cur);
    useCanvasStore.getState().loadDoc(f.fix(cur));
  };
  const applyAll = () => {
    const cur = useCanvasStore.getState().doc;
    setSnap(cur);
    useCanvasStore.getState().loadDoc(fixAll(cur));
  };

  const fixableCount = findings.filter((f) => f.fix).length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 요약 배너 */}
      {findings.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center px-4">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-successsoft text-success">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17l9-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <p className="text-[12.5px] font-semibold text-ink">행정 서식 표준을 통과했습니다</p>
          <p className="text-[11px] text-inkfaint leading-relaxed">개요 번호·날짜·끝 표시·표 정렬 규칙을 모두 만족해요.</p>
          {snap && (
            <button onClick={() => { useCanvasStore.getState().loadDoc(snap); setSnap(null); }} className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-inksoft border border-line rounded-md px-2 py-1 hover:border-accentline hover:text-accent transition-colors">
              <IcRestore size={11} /> 수정 전으로 되돌리기
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11.5px] font-semibold text-ink">반려 위험 {findings.length}건</span>
            <button onClick={applyAll} disabled={!fixableCount} className="ml-auto text-[11px] font-bold text-accent bg-accentsoft border border-accentline rounded-md px-2 py-1 hover:bg-accent hover:text-onaccent transition-colors disabled:opacity-40">
              모두 수정 ({fixableCount})
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
            {findings.map((f) => {
              const sv = SEV_STYLE[f.severity];
              return (
                <div key={f.key} className="rounded-lg border border-line p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: sv.dot }} />
                    <span className="text-[10px] font-bold" style={{ color: sv.dot }}>{sv.label}</span>
                    <span className="text-[12px] font-semibold text-ink">{f.title}</span>
                  </div>
                  <p className="text-[11px] text-inksoft leading-relaxed pl-3.5">{f.detail}</p>
                  {f.fix && (
                    <button
                      onClick={() => applyFix(f)}
                      className="self-start ml-3.5 text-[11px] font-semibold text-accent border border-accentline rounded-md px-2 py-0.5 hover:bg-accentsoft transition-colors"
                    >
                      자동 수정
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {snap && (
            <button onClick={() => { useCanvasStore.getState().loadDoc(snap); setSnap(null); }} className="mt-2 inline-flex items-center justify-center gap-1 text-[10.5px] font-semibold text-inksoft border border-line rounded-md px-2 py-1 hover:border-accentline hover:text-accent transition-colors">
              <IcRestore size={11} /> 수정 전으로 되돌리기
            </button>
          )}
        </>
      )}
      <p className="text-[10px] text-inkfaint leading-relaxed mt-2">
        현장 5대 반려 포인트(개요 번호·줄 간격·날짜·끝 표시·표 정렬)를 출력 전에 잡아줍니다.
      </p>
    </div>
  );
}
