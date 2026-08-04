/**
 * [캔버스 한컴 포크] 우측 AI 문서 도우미 (캔바식).
 * 같은 출처 /api/ai 로 호출 — 호스트(sc-) 프록시 또는 vite 직결이 NVIDIA NIM 으로 태운다.
 * 키는 서버측 Bearer 주입(브라우저 노출 없음). 응답은 "본문에 삽입"으로 커서 위치에 넣는다.
 * ⚠ 백엔드(키/크레딧)는 실행 환경 의존 — 실패 시 채팅에 정직하게 오류를 표시한다.
 */
import type { CanvaServices } from './canva-services';
import { parseAiLayout, applyAiLayout, type AiLayout } from './canva-ai-layout';
import { callAi, aiErrorHint, getSelectedModel, setSelectedModel, markHostProxy } from './canva-ai-client';
import { mkEl, mkButton } from './canva-dom';
import { gatherTextElements, runDocReview, applyFinding, jumpToElement } from './canva-ai-review';
import { renderSendPreview, renderReviewFindings } from './canva-ai-review-ui';
import { insertFormatted } from './ai-doc-insert';
import { openTableFill } from './table-fill';
import { runAgentTurn } from './canva-ai-agent';
/**
 * 문서 모드의 작성법 — **본문에 바로 넣을 글**을 쓴다.
 *
 * ⚠ "되묻지 마세요" 를 못 박은 이유(2026-08-01 실측): "사업 계획서를 작성해줘" 에
 *   "어떤 사업인지 알려 달라"고 되물었다. 문서 도우미가 되물으면 아무것도 안 써지고,
 *   사용자는 두 번 말해야 한다. 정보가 없으면 **표준 목차로 초안**을 쓰고, 채워야 할
 *   자리를 대괄호로 남기는 편이 훨씬 쓸모 있다.
 */
const SYSTEM_PROMPT =
  '당신은 한국어 문서(HWPX) 편집을 돕는 작성 도우미입니다. ' +
  '사용자의 요청에 따라 문서에 바로 넣을 수 있는 깔끔한 한국어 본문을 작성하세요.\n' +
  '규칙:\n' +
  '① **되묻지 마세요.** 정보가 부족하면 그 문서의 표준 목차로 초안을 쓰고, 채워야 할 곳은 ' +
  '[기관명] [기간] 처럼 대괄호로 남깁니다.\n' +
  '② 제목 → 소제목 → 문단 순서로 구조를 갖춰 씁니다. 소제목은 「1. 」 「가. 」 같은 번호를 붙입니다.\n' +
  '③ 마크다운(#, **, - )을 쓰지 마세요. 한글 문서에 그대로 들어갑니다.\n' +
  '④ 표가 필요하면 각 줄을 | 로 구분해 씁니다. 첫 줄이 머리글입니다.\n' +
  '   예: |항목|내용|  다음 줄 |사업비|1,000천원|\n' +
  '⑤ 설명·인사말 없이 문서에 들어갈 내용만 출력합니다.\n' +
  '⑥ 예외 — 사용자가 **문서에 이미 있는 표의 빈칸을 채워 달라**고 하면(예: "표 채워줘", ' +
  '"예산표 빈칸 완성해줘") 본문을 쓰지 말고 정확히 다음 JSON 만 출력합니다: ' +
  '{"tool":"table-fill","hint":"<사용자 요청에서 채우기 방식에 대한 지시만 요약>"}';

// 캔버스식 문서 생성 — A4 지면 배치 계획(JSON)을 설계시킨다 (inline-ai의 문서 생성을 캔버스 문법으로)
// [캔버스 한컴 포크] export — 녹음→회의록(canva-record-panel.ts)이 같은 배치 파이프라인을 재사용(중복 2회 룰 회피)
export const LAYOUT_PROMPT =
  '당신은 한국어 문서 레이아웃 설계자입니다. 사용자의 요청을 A4(210×297mm) 지면 위 요소 배치로 설계해 JSON만 출력하세요.\n' +
  '형식: {"elements":[{"type":"text","x":20,"y":20,"w":170,"text":"내용 (줄바꿈은 \\n)"},{"type":"table","x":20,"y":60,"rows":[["헤더1","헤더2"],["값1","값2"]]}]}\n' +
  '규칙: 좌표/폭은 mm 숫자. 여백 20mm 안쪽(x 20~190, y 20~277)에 배치. 문서 제목은 맨 위 text 요소.\n' +
  '표는 rows 2차원 배열(첫 행=헤더, 빈 값은 ""), 셀 텍스트는 짧게. 요소는 2~8개.\n' +
  '설명·코드펜스 없이 JSON 하나만 출력합니다.';

interface Msg { role: 'user' | 'ai'; text: string; err?: boolean; }

/** 지금 편집기가 캔버스 모드인가 — 저장된 값이 없으면 캔버스로 본다(기본 화면). */
function readCanvasMode(): boolean {
  try {
    return localStorage.getItem('rhwpCanvasMode') !== '0';
  } catch {
    return true;
  }
}

export class CanvaAiPanel {
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private modelBadge!: HTMLElement;
  private busy = false;
  /**
   * 캔버스식(지면 배치) 모드인가.
   * ⚠ 편집기의 캔버스/문서 전환을 **따라간다**(사용자 지적 2026-08-01: "캔버스·문서
   *   둘 다 작성법이 달라야 한다"). 손으로 바꿀 수도 있지만, 모드를 전환하면 다시 맞춘다 —
   *   문서 탭에서 지면 배치 JSON 이 나오면 아무 쓸모가 없다.
   */
  private genMode = readCanvasMode();
  /** 문서 작업(에이전트) 모드 — 켜지면 genMode 보다 우선한다. */
  private agentMode = false;
  /** 문서 내용이 외부 모델로 나가는 경로라 첫 사용 때 1회 동의를 받는다(세션 한정). */
  private agentConsent = false;
  // 상단 기능 버튼 줄: 문서 생성 ↔ 일반 글쓰기 ↔ 문서 작업(모드 토글) + 문서 검토(실행)
  private genBtn!: HTMLButtonElement;
  private plainBtn!: HTMLButtonElement;
  private agentBtn!: HTMLButtonElement;

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
    // 편집기 모드가 바뀌면 작성법도 따라 바꾼다.
    window.addEventListener('rhwp-canvas-mode', (e) => {
      this.genMode = Boolean((e as CustomEvent<boolean>).detail);
      this.syncMode();
    });
  }

  private render(): void {
    const pane = mkEl('div', 'canva-ai-pane');

    // ── 머리말: 뒤로가기 + 스파클 + 도구 제목 + 모델 칩 (디자인 갱신 2026-07-30) ──
    const head = mkEl('div', 'canva-ai-head');
    const back = mkButton('canva-ai-back', { title: '속성으로 돌아가기', html: '<i class="ph ph-arrow-left"></i>' });
    back.addEventListener('click', () => this.services.eventBus.emit('ai-panel-close'));
    this.modelBadge = mkEl('span', 'canva-ai-model', 'AI');
    head.append(
      back,
      mkEl('i', 'ph-duotone ph-sparkle canva-ai-spark'),
      mkEl('span', 'canva-ai-title', 'AI 도우미'),
      this.modelBadge,
    );
    pane.appendChild(head);

    // ── 모드 카드 3종 (아이콘 위·라벨 아래) — 앞의 둘은 모드 토글, 검토는 실행 ──
    const modes = mkEl('div', 'canva-ai-modes');
    const card = (label: string, icon: string, title: string) => {
      const b = mkButton('canva-ai-modebtn', { title });
      b.innerHTML = `<i class="ph-duotone ph-${icon}"></i><span>${label}</span>`;
      return b;
    };
    this.genBtn = card('문서 생성', 'article', '캔버스식 문서 생성: 지면에 제목·본문·표를 배치합니다');
    this.plainBtn = card('일반 글쓰기', 'pencil-simple', '일반 글쓰기: 텍스트 답변을 커서 위치에 삽입합니다');
    // 문서 작업(에이전트) — AI가 문서를 직접 읽고 고친다(canva-ai-agent). claw-hwp식 대화 조작.
    this.agentBtn = card('문서 작업', 'robot', '문서 작업: AI가 열린 문서를 읽고 표·본문을 직접 고칩니다');
    this.genBtn.addEventListener('click', () => { this.genMode = true; this.agentMode = false; this.syncMode(); });
    this.plainBtn.addEventListener('click', () => { this.genMode = false; this.agentMode = false; this.syncMode(); });
    this.agentBtn.addEventListener('click', () => { this.agentMode = true; this.syncMode(); });
    // 문서 검토 — 프롬프트가 아니라 버튼 동작(수집→동의→검토→findings)이라 모드가 아닌 실행 버튼.
    const reviewBtn = card('문서 검토', 'check-circle', '문서 전체 검토 (표현·오탈자)');
    reviewBtn.classList.add('canva-ai-modebtn-action');
    reviewBtn.addEventListener('click', () => void this.reviewFlow());
    modes.append(this.genBtn, this.plainBtn, this.agentBtn, reviewBtn);
    pane.appendChild(modes);

    this.log = mkEl('div', 'canva-ai-log');
    pane.appendChild(this.log);

    this.pushMsg({ role: 'ai', text: '안녕하세요! 위 버튼으로 기능을 고르세요.\n· 문서 생성 — 지면에 제목·본문·표를 배치\n· 일반 글쓰기 — 텍스트를 커서 위치에 삽입\n· 문서 작업 — AI가 문서를 읽고 표·본문을 직접 고침\n· 문서 검토 — 문서 전체의 표현·오탈자를 점검' });

    const bar = mkEl('div', 'canva-ai-input-bar');
    this.input = document.createElement('textarea');
    this.input.rows = 1;
    this.input.placeholder = '무엇을 써 드릴까요?';
    this.input.addEventListener('input', () => this.autosize());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); }
    });
    this.sendBtn = mkButton('canva-ai-send', {
      title: '보내기',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-6-7-2z"/></svg>',
    });
    this.sendBtn.addEventListener('click', () => void this.send());
    bar.append(this.input, this.sendBtn);
    pane.appendChild(bar);
    // ── 모델 버튼(채팅 아래) — 호스트의 공급자 목록에서 고른다. 단독 실행이면 숨김. ──
    pane.appendChild(this.buildModelBar());
    this.syncMode();

    this.root.appendChild(pane);
  }

  getModelBadge(): HTMLElement { return this.modelBadge; }

  private autosize(): void {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 96) + 'px';
  }

  private pushMsg(m: Msg): HTMLElement {
    const el = mkEl('div', `canva-ai-msg ${m.role}${m.err ? ' err' : ''}`);
    const bubble = mkEl('div', 'bubble', m.text);
    el.appendChild(bubble);
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }

  private syncMode(): void {
    this.genBtn.classList.toggle('is-active', !this.agentMode && this.genMode);
    this.plainBtn.classList.toggle('is-active', !this.agentMode && !this.genMode);
    this.agentBtn.classList.toggle('is-active', this.agentMode);
    this.input.placeholder = this.agentMode
      ? '문서에 무엇을 할까요? (예: 표1 빈칸 채워줘)'
      : this.genMode ? '어떤 문서를 만들까요?' : '무엇을 써 드릴까요?';
  }

  /**
   * 문서 작업(에이전트) 턴 — AI가 도구 호출로 문서를 읽고 고친다.
   * ⚠ 문서 내용이 외부 모델로 나가는 경로: 첫 사용에서 1회 동의를 받는다(문서 검토와 같은 규약).
   */
  private async sendAgent(text: string): Promise<void> {
    if (!this.agentConsent) {
      const msgEl = this.pushMsg({
        role: 'ai',
        text: '문서 작업은 표·본문 내용을 AI로 전송해 진행합니다. 계속할까요?',
      });
      const actions = mkEl('div', 'canva-ai-actions');
      const ok = mkButton('canva-ai-act', { text: '동의하고 진행' });
      const no = mkButton('canva-ai-act', { text: '취소' });
      ok.addEventListener('click', () => { this.agentConsent = true; actions.remove(); void this.sendAgent(text); });
      no.addEventListener('click', () => { actions.remove(); this.pushMsg({ role: 'ai', text: '취소했습니다. 아무것도 전송하지 않았습니다.' }); });
      actions.append(ok, no);
      msgEl.appendChild(actions);
      return;
    }

    this.setBusy(true);
    const thinking = this.pushMsg({ role: 'ai', text: '문서를 살펴보는 중…' });
    try {
      const result = await runAgentTurn(
        this.services, text,
        (sys, user) => this.callModel(user, sys),
        (step) => { thinking.querySelector('.bubble')!.textContent = `작업 중 — ${step.name}: ${step.summary}`; },
      );
      thinking.remove();
      this.pushMsg({
        role: 'ai',
        text: result.finalText + (result.wrote ? '\n\n(방금 수정은 Ctrl+Z 로 한 번에 되돌릴 수 있습니다)' : ''),
      });
    } catch (e) {
      thinking.remove();
      const detail = e instanceof Error ? e.message : String(e);
      this.pushMsg({ role: 'ai', err: true, text: `문서 작업에 실패했습니다.\n${detail}${aiErrorHint(detail)}` });
    } finally {
      this.setBusy(false);
    }
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    if (this.agentMode) {
      this.input.value = '';
      this.autosize();
      this.pushMsg({ role: 'user', text });
      void this.sendAgent(text);
      return;
    }
    this.input.value = '';
    this.autosize();
    this.pushMsg({ role: 'user', text });
    this.setBusy(true);
    const thinking = this.pushMsg({ role: 'ai', text: this.genMode ? '지면 배치 설계 중…' : '작성 중…' });
    try {
      const reply = await this.callModel(text, this.genMode ? LAYOUT_PROMPT : SYSTEM_PROMPT);
      thinking.remove();
      if (this.genMode) {
        const layout = parseAiLayout(reply);
        if (layout) {
          this.addLayoutMsg(layout);
        } else {
          // 배치 JSON 파싱 실패 → 원문을 일반 답변으로 표시
          const msgEl = this.pushMsg({ role: 'ai', text: reply });
          this.addInsertAction(msgEl, reply);
        }
      } else if (this.tryToolCall(reply)) {
        // 표 채우기 대화상자가 이어받았다 — 채팅에는 안내만 남긴다.
      } else {
        const msgEl = this.pushMsg({ role: 'ai', text: reply });
        this.addInsertAction(msgEl, reply);
      }
    } catch (e) {
      thinking.remove();
      const detail = e instanceof Error ? e.message : String(e);
      this.pushMsg({ role: 'ai', err: true, text: `AI 호출에 실패했습니다.\n${detail}${aiErrorHint(detail)}` });
    } finally {
      this.setBusy(false);
    }
  }

  // 배치 계획 버블: 요약 + [캔버스에 배치] (적용 전 승인 단계 — 적용 후엔 Ctrl+Z로 일괄 취소 가능)
  private addLayoutMsg(layout: AiLayout): void {
    const texts = layout.elements.filter((e) => e.type === 'text').length;
    const tables = layout.elements.filter((e) => e.type === 'table').length;
    const preview = layout.elements
      .map((e) => (e.type === 'text' ? `· 텍스트 (${e.x},${e.y}) "${e.text.split('\n')[0].slice(0, 24)}"` : `· 표 (${e.x},${e.y}) ${e.rows.length}×${e.rows[0].length}`))
      .join('\n');
    const msgEl = this.pushMsg({ role: 'ai', text: `배치 계획 — 텍스트 ${texts} · 표 ${tables}\n${preview}` });
    const actions = mkEl('div', 'canva-ai-actions');
    const apply = mkButton('canva-ai-act', { text: '캔버스에 배치' });
    apply.addEventListener('click', () => {
      const done = applyAiLayout(this.services, layout);
      apply.disabled = true;
      apply.textContent = '배치됨';
      this.pushMsg({ role: 'ai', text: `캔버스에 배치했습니다 — 텍스트 ${done.texts} · 표 ${done.tables} (Ctrl+Z로 취소 가능)` });
    });
    actions.appendChild(apply);
    msgEl.appendChild(actions);
  }

  private addInsertAction(msgEl: HTMLElement, text: string): void {
    const actions = mkEl('div', 'canva-ai-actions');
    // 제목·소제목에 서식을 입혀 넣는다 — 통째로 넣으면 사용자가 한 줄씩 다시 굵게 만들어야 한다.
    const insert = mkButton('canva-ai-act', { text: '본문에 삽입' });
    insert.addEventListener('click', () => {
      const ih = this.services.getInputHandler();
      if (!ih || this.services.wasm.pageCount === 0) return;
      const n = insertFormatted(ih as never, text);
      if (n === 0) return;
      this.services.eventBus.emit('document-changed');
      this.pushMsg({ role: 'ai', text: `본문에 넣었습니다 — ${n}줄 (Ctrl+Z로 취소 가능)` });
    });
    // 서식 없이 넣고 싶을 때 — 원문 그대로
    const plain = mkButton('canva-ai-act', { text: '서식 없이' });
    plain.addEventListener('click', () => {
      const ih = this.services.getInputHandler();
      if (ih && this.services.wasm.pageCount > 0) (ih as any).insertPlainTextAtCursor(text);
    });
    const copy = mkButton('canva-ai-act', { text: '복사' });
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(text); });
    actions.append(insert, plain, copy);
    msgEl.appendChild(actions);
  }

  // 로그에 빈 컨테이너 버블 하나 추가 (검토 UI가 여기에 렌더) — pushMsg는 텍스트 전용이라 별도.
  private pushPanel(): HTMLElement {
    const el = mkEl('div', 'canva-ai-msg ai');
    const bubble = mkEl('div', 'bubble');
    el.appendChild(bubble);
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    return bubble;
  }

  // 문서 전체 검토 흐름: 수집 → 전송 동의 → 검토 → findings 리스트(각 적용=스냅샷).
  // 검토는 문서 전체를 보내는 기능이라, 전송 전 "보낼 내용"을 명시하고 동의를 받는다(원칙 2).
  private async reviewFlow(): Promise<void> {
    if (this.busy || this.services.wasm.pageCount === 0) return;
    const elements = gatherTextElements(this.services);
    if (!elements.length) {
      this.pushMsg({ role: 'ai', text: '검토할 텍스트가 없습니다. 먼저 글상자나 표를 만들어 주세요.' });
      return;
    }
    const chars = elements.reduce((s, e) => s + e.text.length, 0);
    const card = this.pushPanel();
    renderSendPreview(card, { count: elements.length, chars }, {
      onCancel: () => card.remove(),
      onConfirm: () => void this.runReview(card),
    });
  }

  private async runReview(card: HTMLElement): Promise<void> {
    card.remove();
    this.setBusy(true);
    const thinking = this.pushMsg({ role: 'ai', text: '문서 검토 중…' });
    try {
      const result = await runDocReview(this.services);
      thinking.remove();
      const list = this.pushPanel();
      renderReviewFindings(list, result, {
        onApply: (f) => { applyFinding(this.services, f, result.elements); },
        onIgnore: () => { /* UI에서 행 상태만 갱신 */ },
        onJumpTo: (f) => { jumpToElement(this.services, f, result.elements); },
      });
    } catch (e) {
      thinking.remove();
      const detail = e instanceof Error ? e.message : String(e);
      this.pushMsg({ role: 'ai', err: true, text: `문서 검토에 실패했습니다.\n${detail}${aiErrorHint(detail)}` });
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * 모델이 도구 호출(JSON)로 답했으면 실행한다. 지금 도구는 표 채우기 하나 —
   * 대화상자가 문서 파악→제안→확인을 그대로 맡으니 패널은 여는 것까지만 한다.
   */
  private tryToolCall(reply: string): boolean {
    const t = reply.trim();
    if (!t.includes('"tool"')) return false;
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return false;
    try {
      const o = JSON.parse(t.slice(a, b + 1)) as { tool?: string; hint?: string };
      if (o.tool !== 'table-fill') return false;
      this.pushMsg({ role: 'ai', text: '문서의 표 빈칸을 살펴보겠습니다 — 제안을 확인하고 적용해 주세요.' });
      openTableFill(this.services as never, typeof o.hint === 'string' ? o.hint : '');
      return true;
    } catch {
      return false;
    }
  }

  private async callModel(userText: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
    // 공용 클라이언트(canva-ai-client) — AI 수정 대화상자와 공유.
    // 배지는 모델 버튼이 그린다(하드코딩 모델명은 호스트 배포에서 거짓말이었다).
    return callAi(systemPrompt, userText);
  }

  /**
   * 모델 선택 줄 — 목록은 호스트 `/api/ai-providers` 가 정본(설정 화면과 같은 원천).
   * 선택은 localStorage 에 남아 다음 열 때도 유지. 프록시가 허용 목록으로 재검증하므로
   * 여기 값은 UI 편의일 뿐 보안 경계가 아니다.
   */
  private buildModelBar(): HTMLElement {
    const wrap = mkEl('div', 'canva-ai-modelbar');
    const chip = mkButton('canva-ai-modelchip', { title: 'AI 모델 고르기' });
    const menu = mkEl('div', 'canva-ai-modelmenu');
    menu.hidden = true;
    const paint = (label: string) => {
      chip.innerHTML = `<i class="ph ph-cpu"></i><span>${label}</span><i class="ph ph-caret-up"></i>`;
      this.modelBadge.textContent = label;
    };
    wrap.append(chip, menu);
    void (async () => {
      try {
        const res = await fetch('/api/ai-providers');
        if (!res.ok) throw new Error(String(res.status));
        const list = ((await res.json()) as {
          providers?: Array<{ name: string; model: string; enabled: boolean; isDefault: boolean }>;
        }).providers?.filter((x) => x.enabled) ?? [];
        if (!list.length) { wrap.hidden = true; return; }
        // 호스트가 있다 — 이제 model 을 비워 보내면 호스트 기본 공급자(키 저장된 것)를 쓴다.
        markHostProxy();
        const chosen = getSelectedModel();
        const cur = list.find((x) => x.model === chosen) ?? list.find((x) => x.isDefault) ?? list[0];
        paint(cur.name);
        for (const it of list) {
          const b = mkButton('canva-ai-modelitem', { text: '' });
          b.innerHTML = `<b>${it.name}</b><small>${it.model}</small>`;
          b.classList.toggle('is-active', it.model === cur.model);
          b.addEventListener('click', () => {
            setSelectedModel(it.model);
            paint(it.name);
            menu.hidden = true;
            menu.querySelectorAll('.canva-ai-modelitem').forEach((x) =>
              x.classList.toggle('is-active', x === b));
          });
          menu.appendChild(b);
        }
        chip.addEventListener('click', () => { menu.hidden = !menu.hidden; });
      } catch {
        // 단독 실행(호스트 없음) — 모델은 NVIDIA 기본값 고정이므로 버튼을 숨긴다
        wrap.hidden = true;
      }
    })();
    return wrap;
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.sendBtn.disabled = b;
  }
}
