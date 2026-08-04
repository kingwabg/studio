/**
 * [캔버스 한컴 포크] AI 문서 에이전트 — 채팅으로 시키면 문서를 읽고 고친다.
 * (참고 모델: claw-hwp — "한국어로 말하면 AI가 rhwp 함수를 불러 문서를 다룬다")
 *
 * 구조 = 도구 호출 루프:
 *   사용자 요청 → 모델이 {"tool":…} 로 문서를 읽거나 고침 → 결과를 다시 모델에 →
 *   … 반복(상한 있음) → 마지막에 사람이 읽는 보고로 종료.
 *
 * 원칙:
 * ① 도구는 여기 등록된 것만 — 모델이 임의 함수명을 불러도 무시된다.
 * ② 쓰기는 **턴마다 스냅샷 1회** — Ctrl+Z 한 번으로 그 턴의 수정 전체가 원복된다.
 * ③ 읽기 도구가 처음 돌기 전에 **동의**를 받는다(문서 내용이 외부 모델로 나가는 경로).
 *    동의는 패널이 받고, 여기는 동의 없인 부르지 않는 계약이다.
 * ④ 이미 값이 있는 셀을 덮으려면 모델이 replace 를 명시해야 한다 — 기본은 빈 칸만.
 */
import type { CanvaServices } from './canva-services';

/** 한 턴에서 도구를 부를 수 있는 최대 횟수 — 폭주 방지. 6이면 읽기 2~3 + 쓰기 1~2 로 충분하다. */
const MAX_ROUNDS = 6;
/** 셀·문단 텍스트 조회 상한. */
const READ_LIMIT = 400;
/** 도구 결과로 모델에 돌려주는 최대 글자 — 프롬프트 폭주 방지. */
const RESULT_LIMIT = 4000;

export interface AgentStep { kind: 'tool' | 'final'; name?: string; summary: string; }
export interface AgentResult {
  finalText: string;
  steps: AgentStep[];
  /** 이번 턴에 실제로 문서를 고쳤는가 — 패널이 "Ctrl+Z로 취소" 안내를 붙일 근거. */
  wrote: boolean;
}

export const AGENT_PROMPT =
  '당신은 한글(HWP) 문서를 직접 다루는 에이전트입니다. 사용자의 요청을 완수하기 위해 ' +
  '아래 도구를 JSON 한 개로 호출하세요. 도구 결과를 받으면 다음 행동을 정합니다.\n' +
  '도구 목록:\n' +
  '· {"tool":"doc_outline"} — 문서 구조(문단 수·표 목록과 크기)를 본다. 항상 이것부터.\n' +
  '· {"tool":"read_paragraphs","start":0,"count":10} — 본문 문단 텍스트를 읽는다.\n' +
  '· {"tool":"read_table","table":0} — 표의 칸 내용을 읽는다(칸번호\\t행열\\t내용).\n' +
  '· {"tool":"fill_cells","table":0,"fills":[{"cell":5,"text":"값"}]} — 표의 **빈 칸**에 쓴다.\n' +
  '· {"tool":"replace_cell","table":0,"cell":5,"text":"값"} — 칸 내용을 **지우고 다시** 쓴다. ' +
  '사용자가 고치라고 명시했을 때만.\n' +
  '· {"tool":"insert_text","paragraph":2,"text":"내용"} — 본문 문단 끝에 텍스트를 넣는다.\n' +
  '규칙:\n' +
  '① 반드시 JSON 하나만 출력. 설명을 붙이지 마세요.\n' +
  '② 수치·금액·날짜는 문서나 사용자가 준 것만 쓰고, 모르면 [칸이름] 형태로 남기세요. 지어내지 마세요.\n' +
  '③ 작업이 끝나면 {"tool":"done","report":"무엇을 했는지 한국어 2~3문장"} 으로 마칩니다.\n' +
  '④ 도구 결과에 ERROR 가 오면 같은 호출을 반복하지 말고 다른 방법을 쓰거나 done 으로 사유를 보고하세요.';

interface TableRef { para: number; controlIdx: number; rowCount: number; colCount: number; }

function listTables(services: CanvaServices): TableRef[] {
  try { return services.wasm.getTables(0) ?? []; } catch { return []; }
}

function readCell(services: CanvaServices, t: TableRef, cellIdx: number): string {
  try {
    return (services.wasm.getTextInCell(0, t.para, t.controlIdx, cellIdx, 0, 0, READ_LIMIT) ?? '').trim();
  } catch { return ''; }
}

/** 도구 실행. 결과는 모델에게 그대로 돌아간다 — 사람이 아니라 모델이 읽는 문자열이다. */
function runTool(services: CanvaServices, name: string, args: Record<string, unknown>,
  state: { wrote: boolean }): string {
  const wasm = services.wasm;
  const tables = listTables(services);
  const pickTable = (): TableRef | string => {
    const i = Number(args.table);
    if (!Number.isInteger(i) || i < 0 || i >= tables.length) return `ERROR: 표 ${i} 없음 (0~${tables.length - 1})`;
    return tables[i];
  };

  switch (name) {
    case 'doc_outline': {
      const paras = (() => { try { return wasm.getParagraphCount(0); } catch { return 0; } })();
      const t = tables.map((x, i) => `표${i}: ${x.rowCount}행×${x.colCount}열`).join('\n');
      return `문단 ${paras}개\n${t || '표 없음'}`;
    }
    case 'read_paragraphs': {
      const start = Math.max(0, Number(args.start) || 0);
      const count = Math.min(20, Math.max(1, Number(args.count) || 10));
      const total = (() => { try { return wasm.getParagraphCount(0); } catch { return 0; } })();
      const out: string[] = [];
      for (let p = start; p < Math.min(start + count, total); p++) {
        try {
          const len = wasm.getParagraphLength(0, p);
          out.push(`[${p}] ${wasm.getTextRange(0, p, 0, Math.min(len, READ_LIMIT)).trim()}`);
        } catch { out.push(`[${p}] ERROR`); }
      }
      return out.join('\n') || 'ERROR: 읽을 문단 없음';
    }
    case 'read_table': {
      const t = pickTable();
      if (typeof t === 'string') return t;
      const rows: string[] = [];
      const total = t.rowCount * t.colCount;
      for (let i = 0; i < total; i++) {
        const v = readCell(services, t, i);
        rows.push(`${i}\t${Math.floor(i / t.colCount) + 1}행${(i % t.colCount) + 1}열\t${v || '(빈칸)'}`);
      }
      return rows.join('\n');
    }
    case 'fill_cells': {
      const t = pickTable();
      if (typeof t === 'string') return t;
      const fills = Array.isArray(args.fills) ? args.fills : [];
      let ok = 0; const skipped: number[] = [];
      const ih = services.getInputHandler() as any;
      if (!ih) return 'ERROR: 편집기 없음';
      ih.executeOperation({
        kind: 'snapshot', operationType: 'aiAgentFill',
        operation: () => {
          for (const f of fills as Array<{ cell?: unknown; text?: unknown }>) {
            const cell = Number(f?.cell);
            const text = typeof f?.text === 'string' ? f.text.trim() : '';
            if (!Number.isInteger(cell) || cell < 0 || cell >= t.rowCount * t.colCount || !text) continue;
            if (readCell(services, t, cell)) { skipped.push(cell); continue; } // 기본은 빈 칸만
            try { wasm.insertTextInCell(0, t.para, t.controlIdx, cell, 0, 0, text); ok++; } catch { /* 결과 수치로 보고 */ }
          }
        },
      });
      if (ok) state.wrote = true;
      return `기록 ${ok}칸` + (skipped.length ? ` / 건너뜀(이미 값 있음): ${skipped.join(',')} — 덮으려면 replace_cell` : '');
    }
    case 'replace_cell': {
      const t = pickTable();
      if (typeof t === 'string') return t;
      const cell = Number(args.cell);
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!Number.isInteger(cell) || cell < 0 || cell >= t.rowCount * t.colCount) return 'ERROR: cell 범위 밖';
      if (!text) return 'ERROR: text 비어 있음';
      const ih = services.getInputHandler() as any;
      if (!ih) return 'ERROR: 편집기 없음';
      let err = '';
      ih.executeOperation({
        kind: 'snapshot', operationType: 'aiAgentReplace',
        operation: () => {
          try {
            const old = readCell(services, t, cell);
            if (old) wasm.deleteTextInCell(0, t.para, t.controlIdx, cell, 0, 0, old.length + 8);
            wasm.insertTextInCell(0, t.para, t.controlIdx, cell, 0, 0, text);
          } catch (e) { err = String(e).slice(0, 80); }
        },
      });
      if (err) return `ERROR: ${err}`;
      state.wrote = true;
      return `교체 완료: 칸 ${cell}`;
    }
    case 'insert_text': {
      const p = Number(args.paragraph);
      const text = typeof args.text === 'string' ? args.text : '';
      if (!Number.isInteger(p) || p < 0) return 'ERROR: paragraph 범위 밖';
      if (!text.trim()) return 'ERROR: text 비어 있음';
      const ih = services.getInputHandler() as any;
      if (!ih) return 'ERROR: 편집기 없음';
      let err = '';
      ih.executeOperation({
        kind: 'snapshot', operationType: 'aiAgentInsert',
        operation: () => {
          try {
            const len = wasm.getParagraphLength(0, p);
            wasm.insertText(0, p, len, text);
          } catch (e) { err = String(e).slice(0, 80); }
        },
      });
      if (err) return `ERROR: ${err}`;
      state.wrote = true;
      return `문단 ${p} 끝에 ${text.length}자 삽입`;
    }
    default:
      return `ERROR: 없는 도구 "${name}"`;
  }
}

/** 모델 출력에서 도구 호출 JSON 을 뽑는다. 없으면 null(=일반 답변으로 취급). */
export function parseToolCall(raw: string): { tool: string; args: Record<string, unknown> } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (typeof o?.tool !== 'string') return null;
    return { tool: o.tool, args: o };
  } catch { return null; }
}

/**
 * 에이전트 턴 실행. callModel 은 패널이 준다(모델 선택·프록시 재사용).
 * onStep 으로 진행을 채팅에 흘린다 — 몇 초씩 걸리는 루프라 무소식이면 죽은 줄 안다.
 */
export async function runAgentTurn(
  services: CanvaServices,
  userText: string,
  callModel: (systemPrompt: string, userText: string) => Promise<string>,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const state = { wrote: false };
  // 대화 맥락 — 모델에 보내는 것은 요청 + 도구 결과 이력뿐(문서 전문을 통째로 보내지 않는다).
  let transcript = `사용자 요청: ${userText}`;

  let nudged = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await callModel(AGENT_PROMPT, transcript);
    const call = parseToolCall(reply);

    if (!call) {
      // ⚠ JSON 이 아니면 **한 번은 되묻는다**(2026-08-05 실사고). 추론 모델이 생각을 본문으로
      //   흘려 잘린 영어 사고문이 오는 일이 있었는데, 그걸 그대로 "최종 답변"으로 띄우니
      //   사용자는 영문 독백을 보고 표는 그대로였다. 한 번 더 형식을 못박아 요구한다.
      if (!nudged) {
        nudged = true;
        transcript += '\n\n[형식 오류] 방금 응답에 JSON 이 없었다. 설명·생각을 쓰지 말고 '
          + '도구 JSON 한 개만 출력하라. 더 할 일이 없으면 {"tool":"done","report":"..."} 로 마쳐라.';
        continue;
      }
      const step: AgentStep = { kind: 'final', summary: reply.trim() };
      steps.push(step);
      return { finalText: reply.trim(), steps, wrote: state.wrote };
    }

    if (call.tool === 'done') {
      const report = typeof call.args?.report === 'string' ? String(call.args.report) : reply.trim();
      const step: AgentStep = { kind: 'final', summary: report };
      steps.push(step);
      return { finalText: report, steps, wrote: state.wrote };
    }

    const result = runTool(services, call.tool, call.args, state).slice(0, RESULT_LIMIT);
    const step: AgentStep = { kind: 'tool', name: call.tool, summary: result.split('\n')[0].slice(0, 80) };
    steps.push(step);
    onStep?.(step);
    transcript += `\n\n[${call.tool} 결과]\n${result}`;
  }

  const timeout: AgentStep = { kind: 'final', summary: '작업 횟수 상한에 닿아 멈췄습니다. 요청을 나눠서 다시 시도해 주세요.' };
  steps.push(timeout);
  return { finalText: timeout.summary, steps, wrote: state.wrote };
}
