/**
 * 변경 검토 — AI 가 고친 결과를 **문서 안에서** 이전(빨강 취소선)·새 글(초록 밑줄)로
 * 나란히 보여주고, [진행]을 눌러야 확정한다.
 * (사용자 요청 2026-08-01, 계기 = inline AI "골라서 수정하고 한눈에 비교하기")
 *
 * 별도 비교 창을 만들지 않은 이유: 문서 편집기의 미리보기는 문서 자신이 제일 정확하다 —
 * 글꼴·줄바꿈·쪽 흐름까지 실제 그대로 보이고, 구현도 서식 두 번 칠하는 것뿐이다.
 *
 * 스펙·판정식 = sc-/docs/specs/change-review.md
 */
import { maskNames, unmaskNames } from './sentence-polish';

const RED = '#d93025';   // 이전 글 — 취소선
const GREEN = '#188038'; // 새 글 — 밑줄

interface ReviewWasm {
  replaceText(s: number, p: number, at: number, len: number, next: string): unknown;
  applyCharFormat(s: number, p: number, from: number, to: number, json: string): unknown;
  deleteText?(s: number, p: number, at: number, len: number): unknown;
}

interface Services {
  wasm: unknown;
  getInputHandler(): unknown;
  eventBus: { emit(ev: string): void };
}

export interface ParaReview {
  sec: number;
  para: number;
  oldText: string;
  newText: string;
  /** [재작성] — 문서가 원상태로 돌아간 **뒤에** 불린다 */
  onRewrite?: () => void;
}

let bar: HTMLElement | null = null;

/**
 * 다듬기 결과 반영의 단일 진입점 — 검토가 가능하면 검토로, 아니면 즉시 교체.
 * 즉시 교체 폴백: 인라인 컨트롤이 있는 문단(텍스트≠논리 길이 — 좌표가 어긋난다),
 * 또는 검토 바가 이미 떠 있을 때.
 */
export function applyPolishResult(
  services: Services,
  pos: { sectionIndex: number; paragraphIndex: number },
  oldText: string,
  newText: string,
  onRewrite?: () => void,
): void {
  const w = services.wasm as {
    getLogicalLength?: (s: number, p: number) => number;
  };
  let hasInline = false;
  try {
    hasInline = (w.getLogicalLength?.(pos.sectionIndex, pos.paragraphIndex) ?? oldText.length) !== oldText.length;
  } catch { /* 판별 실패면 보수적으로 즉시 교체 */ hasInline = true; }
  if (!hasInline && !bar) {
    startParaReview(services, {
      sec: pos.sectionIndex, para: pos.paragraphIndex, oldText, newText, onRewrite,
    });
    return;
  }
  const ih = services.getInputHandler() as { executeOperation(d: unknown): unknown } | null;
  ih?.executeOperation({
    kind: 'snapshot',
    operationType: 'polishParagraph',
    operation: (wasm: ReviewWasm) => {
      wasm.replaceText(pos.sectionIndex, pos.paragraphIndex, 0, oldText.length, newText);
      return null;
    },
  });
  services.eventBus.emit('document-changed');
}

/** 검토 바가 이미 떠 있으면 새 검토를 시작하지 않는다 — 좌표가 서로 밟는다. */
export function isReviewOpen(): boolean {
  return !!bar;
}

/**
 * 문단 하나의 교체를 검토 상태로 만든다.
 * 문단은 `이전글새글` 이 되고 이전은 빨강 취소선, 새 글은 초록 밑줄.
 * 전체가 스냅샷 1회 — [취소]는 undo 한 번이다.
 */
export function startParaReview(services: Services, r: ParaReview): void {
  if (bar) return;
  const ih = services.getInputHandler() as {
    executeOperation(d: unknown): unknown;
  } | null;
  if (!ih) return;
  const oldLen = r.oldText.length;
  const newLen = r.newText.length;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'changeReviewStart',
    operation: (wasm: ReviewWasm) => {
      wasm.replaceText(r.sec, r.para, 0, oldLen, r.oldText + r.newText);
      wasm.applyCharFormat(r.sec, r.para, 0, oldLen,
        JSON.stringify({ strikethrough: true, strikeColor: RED, textColor: RED }));
      wasm.applyCharFormat(r.sec, r.para, oldLen, oldLen + newLen,
        JSON.stringify({ underline: true, underlineColor: GREEN, textColor: GREEN }));
      return null;
    },
  });
  services.eventBus.emit('document-changed');
  showBar(services, r);
}

/** 확정 — 빨간 부분을 지우고 초록 서식을 해제한다. */
function accept(services: Services, r: ParaReview): void {
  const ih = services.getInputHandler() as { executeOperation(d: unknown): unknown } | null;
  if (!ih) return;
  const oldLen = r.oldText.length;
  const newLen = r.newText.length;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'changeReviewAccept',
    operation: (wasm: ReviewWasm) => {
      wasm.replaceText(r.sec, r.para, 0, oldLen + newLen, r.newText);
      // ⚠ 해제를 빼먹으면 초록 밑줄이 문서에 영구히 남는다(판정식 2) — 명시적으로 끈다.
      wasm.applyCharFormat(r.sec, r.para, 0, newLen,
        JSON.stringify({ strikethrough: false, underline: false, textColor: '#000000' }));
      return null;
    },
  });
  services.eventBus.emit('document-changed');
  closeBar();
}

/** 취소 — 검토 스냅샷 하나를 undo. */
function cancel(services: Services): void {
  (services as unknown as { commandDispatcher?: { dispatch(id: string): void } });
  // dispatcher 접근이 서비스마다 달라서 이벤트로 통일한다 — window.__dispatcher 는 e2e 전용.
  const d = (window as unknown as { __dispatcher?: { dispatch(id: string): void } }).__dispatcher;
  if (d) d.dispatch('edit:undo');
  services.eventBus.emit('document-changed');
  closeBar();
}

/** 이전↔새 글을 비교한 짧은 조언 — 문서는 안 바꾼다. */
async function fetchAdvice(oldText: string, newText: string): Promise<string> {
  const mask = maskNames(`[이전]\n${oldText}\n\n[수정본]\n${newText}`);
  const res = await fetch('/api/ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: '한국어 문서 첨삭자다. 이전 글과 수정본을 비교해 ①무엇이 좋아졌는지 한 줄 '
            + '②더 다듬을 점 두 가지를 짧게. 총 3줄, 각 줄 40자 이내. 인사말 없이.',
        },
        { role: 'user', content: mask.masked },
      ],
      temperature: 0.4,
      max_tokens: 512,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: string | { message?: string };
  };
  if (!res.ok) {
    const e = typeof json.error === 'string' ? json.error : json.error?.message;
    throw new Error(e ?? String(res.status));
  }
  return unmaskNames((json.choices?.[0]?.message?.content ?? '').trim(), mask);
}

function showBar(services: Services, r: ParaReview): void {
  bar = document.createElement('div');
  bar.className = 'chg-bar';
  const label = document.createElement('span');
  label.className = 'chg-label';
  label.innerHTML = '<s>빨간 줄</s> = 이전 · <u>초록 줄</u> = 새 글 — 검토 중에는 다른 편집을 하지 마세요';
  const advice = document.createElement('div');
  advice.className = 'chg-advice';
  advice.hidden = true;

  const mk = (text: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `dialog-btn ${cls}`;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };
  const go = mk('진행', 'dialog-btn-primary', () => accept(services, r));
  const rewrite = mk('재작성', '', () => {
    // 판정식 4 — 원상 복귀가 먼저, 재호출은 그 뒤.
    cancel(services);
    r.onRewrite?.();
  });
  const adviceBtn = mk('조언 작성', '', () => {
    advice.hidden = false;
    advice.textContent = '조언을 받는 중…';
    fetchAdvice(r.oldText, r.newText)
      .then((t) => { advice.textContent = t; })
      .catch((e) => { advice.textContent = `조언을 받지 못했습니다 — ${String(e).replace(/^Error:\s*/, '')}`; });
  });
  const drop = mk('취소', '', () => cancel(services));

  const row = document.createElement('div');
  row.className = 'chg-row';
  row.append(label, go, rewrite, adviceBtn, drop);
  bar.append(row, advice);
  document.body.appendChild(bar);
}

function closeBar(): void {
  bar?.remove();
  bar = null;
}
