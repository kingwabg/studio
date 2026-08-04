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
    let nudgeCount = 0;

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
        // JSON 이 아니면 두 번까지 형식을 못박아 되묻는다(문서 작업 에이전트의 실사고 이관).
        if (nudgeCount < 2) {
          nudgeCount += 1;
          transcript += '\n\n[형식 오류] 방금 응답에 도구 JSON 이 없었다. 설명·본문을 직접 쓰지 말고 '
            + '반드시 {"tool":"add_section",…} 같은 도구 JSON 한 개만 출력하라.';
          continue;
        }
        /**
         * 그래도 본문을 뱉으면 **지면으로 구조한다**(사용자 신고 2026-08-05: "채팅창에
         * 만들었어"). 작은 모델은 형식을 끝내 안 지키기도 하는데, 그때 내용을 채팅에
         * 버리면 사용자는 지면이 비어 있는 것만 본다 — 문서 도우미의 실패 중 최악이다.
         */
        const body = reply.trim();
        if (body.length > 120) {
          const paras = body.split(/\n{2,}|\n/).map((t) => t.trim()).filter(Boolean).slice(0, 40);
          runWriterTool(this.doc, 'add_section', {
            heading: '작성 내용', level: 1,
            blocks: paras.map((t) => ({ type: 'para', text: t })),
          });
          doRealize();
          const note = '모델이 도구 형식을 지키지 않아, 출력한 내용을 문서 본문으로 직접 옮겼습니다. '
            + '구성이 어색하면 같은 요청을 한 번 더 보내 주세요.';
          steps.push({ kind: 'final', summary: note });
          return { finalText: note, steps, realized };
        }
        const step: WriterStep = { kind: 'final', summary: body };
        steps.push(step);
        return { finalText: body, steps, realized };
      }

      const outcome = runWriterTool(this.doc, call.tool, call.args);

      let result = outcome.result;
      if (outcome.dirty) {
        /**
         * 도구가 문서를 바꿀 때마다 **즉시** 지면에 그린다(사용자 지시 2026-08-05:
         * "만들어지는 과정까지 보이면 좋겠다"). 섹션이 하나 붙을 때마다 지면이 자라는
         * 모습이 보이고, 한 번에 완성본이 뚝 떨어지지 않는다.
         * 비용은 매번 전체 재구축이지만 섹션 수십 개 수준에선 체감이 없다.
         */
        const err = doRealize();
        if (err) result += `\n${err}`;
      }
      if (outcome.wantsReview) {
        if (!this.map) {
          const err = doRealize();
          if (err) result = err;
        }
        if (this.map) result = reviewPages(services.wasm, this.doc, this.map).rendered;
      }

      if (outcome.finished) {
        if (!this.map) doRealize(); // 도구 없이 done 만 온 극단 경로 방어
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

    // 상한에 닿아도 매 도구마다 실체화했으므로 지면에는 이미 남아 있다.
    const timeout: WriterStep = {
      kind: 'final',
      summary: '작성 횟수 상한에 닿아 멈췄습니다. 지금까지 만든 부분은 문서에 있습니다 — 이어서 요청해 주세요.',
    };
    steps.push(timeout);
    return { finalText: timeout.summary, steps, realized };
  }
}
