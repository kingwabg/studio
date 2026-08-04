/**
 * AI 문서 작성 — 에이전트 루프 (2026-08-05).
 *
 * 문서 작업 에이전트(canva-ai-agent)와 같은 프로토콜(턴마다 도구 JSON 하나)을 쓰되,
 * 도구가 만지는 대상이 다르다: 지면이 아니라 **WriterDocument 모델**이다.
 * 지면은 review_pages/done 때만 실체화한다 — 모델이 진실, 지면은 사본(realize.ts).
 *
 * 문서 작업과 달리 **동의가 필요 없다**: 이 모드는 문서 내용을 밖으로 보내지 않는다.
 * 나가는 것은 사용자 요청과, 모델이 스스로 만든 목차·도구 결과뿐이다.
 */
import { createDocument, type WriterDocument } from './document-model';
import { runWriterTool, WRITER_PROMPT } from './tools';
import { realize, type RealizeMap } from './realize';
import { reviewPages } from './review';

/**
 * 작성은 읽기 에이전트보다 호출이 많다 — get_template + 제목 + 섹션 4~8 + 검토 + done.
 * 16이면 6~8개 섹션 문서까지 수정 1~2회를 포함해 닿는다.
 */
const MAX_ROUNDS = 16;
const RESULT_LIMIT = 4000;

export interface WriterStep { kind: 'tool' | 'final'; name?: string; summary: string; }
export interface WriterTurnResult {
  finalText: string;
  steps: WriterStep[];
  /** 이번 턴에 지면을 실체화했는가 — "Ctrl+Z 로 되돌리기" 안내의 근거 */
  realized: boolean;
}

interface ServicesLike {
  getInputHandler(): unknown;
  eventBus: { emit(ev: string, payload?: unknown): void };
  wasm: { pageCount: number; getCursorRect(sec: number, para: number, off: number): { pageIndex: number } };
}

/** 모델 출력에서 도구 JSON 을 뽑는다 — canva-ai-agent.parseToolCall 과 같은 규약. */
function parseCall(raw: string): { tool: string; args: Record<string, unknown> } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (typeof o?.tool !== 'string') return null;
    return { tool: o.tool, args: o };
  } catch { return null; }
}

/**
 * 한 세션의 작성 상태 — 패널이 하나 들고 턴마다 재사용한다.
 * 모델(WriterDocument)이 턴을 넘어 살아 있어야 "아까 그 문서에서 Ⅱ장만 고쳐줘"가 된다.
 */
export class WriterSession {
  readonly doc: WriterDocument = createDocument();
  private map: RealizeMap | null = null;
  private dirty = false;

  async runTurn(
    services: ServicesLike,
    userText: string,
    callModel: (systemPrompt: string, userText: string) => Promise<string>,
    onStep?: (step: WriterStep) => void,
  ): Promise<WriterTurnResult> {
    const steps: WriterStep[] = [];
    let realized = false;
    let transcript = `사용자 요청: ${userText}`;
    let nudged = false;

    const doRealize = (): string => {
      this.map = realize(services, this.doc);
      if (!this.map) return 'ERROR: 편집기에 문서가 없어 실체화하지 못했습니다';
      realized = true;
      this.dirty = false;
      return '';
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await callModel(WRITER_PROMPT, transcript);
      const call = parseCall(reply);

      if (!call) {
        // JSON 이 아니면 한 번은 형식을 못박아 되묻는다(문서 작업 에이전트의 실사고 이관).
        if (!nudged) {
          nudged = true;
          transcript += '\n\n[형식 오류] 방금 응답에 JSON 이 없었다. 설명을 쓰지 말고 도구 JSON 한 개만 출력하라.';
          continue;
        }
        const step: WriterStep = { kind: 'final', summary: reply.trim() };
        steps.push(step);
        return { finalText: reply.trim(), steps, realized };
      }

      const outcome = runWriterTool(this.doc, call.tool, call.args);
      if (outcome.dirty) this.dirty = true;

      let result = outcome.result;
      if (outcome.wantsReview) {
        // review_pages: 낡았으면 다시 실체화한 뒤 **진짜 조판**을 읽는다.
        if (this.dirty || !this.map) {
          const err = doRealize();
          if (err) result = err;
        }
        if (this.map) result = reviewPages(services.wasm, this.doc, this.map).rendered;
      }

      if (outcome.finished) {
        // 마지막 실체화 — 모델이 고친 것이 지면에 남게.
        if (this.dirty || !this.map) doRealize();
        const step: WriterStep = { kind: 'final', summary: outcome.report ?? result };
        steps.push(step);
        return { finalText: outcome.report ?? result, steps, realized };
      }

      result = result.slice(0, RESULT_LIMIT);
      const step: WriterStep = { kind: 'tool', name: call.tool, summary: result.split('\n')[0].slice(0, 80) };
      steps.push(step);
      onStep?.(step);
      transcript += `\n\n[${call.tool} 결과]\n${result}`;
    }

    // 상한에 닿아도 지금까지 만든 것은 지면에 남긴다 — 절반이라도 사용자 손에.
    if (this.dirty) doRealize();
    const timeout: WriterStep = {
      kind: 'final',
      summary: '작성 횟수 상한에 닿아 멈췄습니다. 지금까지 만든 부분은 문서에 있습니다 — 이어서 요청해 주세요.',
    };
    steps.push(timeout);
    return { finalText: timeout.summary, steps, realized };
  }
}
