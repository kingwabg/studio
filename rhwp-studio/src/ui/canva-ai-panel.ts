/**
 * [캔버스 한컴 포크] 우측 AI 문서 도우미 (캔바식).
 * 같은 출처 /api/ai 로 호출 — 호스트(sc-) 프록시 또는 vite 직결이 NVIDIA NIM 으로 태운다.
 * 키는 서버측 Bearer 주입(브라우저 노출 없음). 응답은 "본문에 삽입"으로 커서 위치에 넣는다.
 * ⚠ 백엔드(키/크레딧)는 실행 환경 의존 — 실패 시 채팅에 정직하게 오류를 표시한다.
 */
import type { CanvaServices } from './canva-services';
import { callAi, aiErrorHint, getSelectedModel, setSelectedModel, markHostProxy } from './canva-ai-client';
import { mkEl, mkButton } from './canva-dom';
import { gatherTextElements, runDocReview, applyFinding, jumpToElement } from './canva-ai-review';
import { renderSendPreview, renderReviewFindings } from './canva-ai-review-ui';
import { runAgentTurn } from './canva-ai-agent';
import { WriterSession } from '../ai-writer/writer-agent';


interface Msg { role: 'user' | 'ai'; text: string; err?: boolean; }


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
  /**
   * 모드 — writer(문서 작성) / agent(문서 작업).
   * [2026-08-05 사용자 지시] 「문서 생성」(지면 배치)·「일반 글쓰기」(커서 삽입)는
   * 문서 작업과 성격이 다른 기능이라 폐지 — 16개 도구로 문서를 조립하는
   * 「문서 작성」(ai-writer/)이 그 자리를 대신한다.
   */
  private mode: 'writer' | 'agent' = 'writer';
  /** 작성 세션 — 문서 모델이 턴을 넘어 살아 "Ⅱ장만 고쳐줘"가 되게 한다. */
  private writer = new WriterSession();
  /**
   * 작성 방향 설정 — 첫 요청에서 바로 쓰지 않고 유형·목적·분량·문체를 확인받는다
   * (사용자 지시 2026-08-05: "클로드 코드가 방향 물어보듯 우리도 물어보자").
   * 한 세션에 한 번만 묻는다 — 이후 턴은 같은 방향으로 이어 쓴다.
   */
  private writerSetup: string | null = null;
  /** 문서 내용이 외부 모델로 나가는 경로라 첫 사용 때 1회 동의를 받는다(세션 한정). */
  private agentConsent = false;
  // 상단 기능 버튼 줄: 문서 작성 ↔ 문서 작업(모드 토글) + 문서 검토(실행)
  private writerBtn!: HTMLButtonElement;
  private agentBtn!: HTMLButtonElement;

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
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
    this.writerBtn = card('문서 작성', 'article', '문서 작성: AI가 표준 목차로 보고서·계획서·공문을 조립합니다');
    // 문서 작업(에이전트) — AI가 문서를 직접 읽고 고친다(canva-ai-agent). claw-hwp식 대화 조작.
    this.agentBtn = card('문서 작업', 'robot', '문서 작업: AI가 열린 문서를 읽고 표·본문을 직접 고칩니다');
    this.writerBtn.addEventListener('click', () => { this.mode = 'writer'; this.syncMode(); });
    this.agentBtn.addEventListener('click', () => { this.mode = 'agent'; this.syncMode(); });
    // 문서 검토 — 프롬프트가 아니라 버튼 동작(수집→동의→검토→findings)이라 모드가 아닌 실행 버튼.
    const reviewBtn = card('문서 검토', 'check-circle', '문서 전체 검토 (표현·오탈자)');
    reviewBtn.classList.add('canva-ai-modebtn-action');
    reviewBtn.addEventListener('click', () => void this.reviewFlow());
    modes.append(this.writerBtn, this.agentBtn, reviewBtn);
    pane.appendChild(modes);

    this.log = mkEl('div', 'canva-ai-log');
    pane.appendChild(this.log);

    this.pushMsg({ role: 'ai', text: '안녕하세요! 위 버튼으로 기능을 고르세요.\n· 문서 작성 — 표준 목차로 보고서·계획서·공문을 조립 (빈 문서에서 시작 권장)\n· 문서 작업 — AI가 문서를 읽고 표·본문을 직접 고침\n· 문서 검토 — 문서 전체의 표현·오탈자를 점검' });

    const bar = mkEl('div', 'canva-ai-input-bar');
    this.input = document.createElement('textarea');
    this.input.rows = 1;
    this.input.placeholder = '무엇을 써 드릴까요?';
    this.input.addEventListener('input', () => this.autosize());
    this.input.addEventListener('keydown', (e) => {
      // ⚠ 한글 조합 중 Enter 는 **조합 확정**이지 전송이 아니다(2026-08-05 실사고).
      //   방어가 없으면 "표 빈칸 채우자" 를 치고 Enter 한 번에 두 번 보내진다 —
      //   앞부분이 먼저 나가고, 조합이 끝난 마지막 글자("자")가 또 나간다.
      //   같은 저장소의 goto-dialog.ts:193 · find-dialog.ts:218 이 쓰는 방어와 같다.
      //   keyCode 229 는 isComposing 을 안 주는 구형 IME 폴백.
      if (e.isComposing || e.keyCode === 229) return;
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
    this.writerBtn.classList.toggle('is-active', this.mode === 'writer');
    this.agentBtn.classList.toggle('is-active', this.mode === 'agent');
    this.input.placeholder = this.mode === 'agent'
      ? '문서에 무엇을 할까요? (예: 표1 빈칸 채워줘)'
      : '어떤 문서를 만들까요? (예: 하반기 운영 보고서)';
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
        // 표를 다 읽으면 입력이 길다 — 토큰을 넉넉히 준다(부족하면 답이 잘려 JSON 이 깨진다).
        (sys, user) => this.callModel(user, sys, 4096),
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
    this.input.value = '';
    this.autosize();
    this.pushMsg({ role: 'user', text });
    if (this.mode === 'agent') {
      void this.sendAgent(text);
      return;
    }
    void this.sendWriter(text);
  }

  /**
   * 문서 작성 턴 — AI가 16개 도구로 문서를 조립한다(ai-writer/).
   * 문서 작업과 달리 동의가 없다: 문서 내용이 밖으로 나가지 않는 경로다
   * (나가는 것은 사용자 요청과 모델이 스스로 만든 목차뿐).
   */
  /**
   * 문서 환경설정 카드 — 유형·목적·분량·문체를 칩으로 고르고 「이 설정으로 작성」.
   * 유형은 요청 문장에서 추정해 「추천」 표시를 붙인다(칩 선택이 곧 확정이라 오답이어도 무해).
   * 파일 형식 칩은 두지 않았다 — 여기는 HWP 편집기 안이라 선택지가 하나뿐이다.
   */
  private renderWriterSetup(text: string): void {
    const infer = (): string => {
      if (/계획/.test(text)) return '사업계획서';
      if (/제안|기획/.test(text)) return '제안서';
      if (/회의/.test(text)) return '회의록';
      if (/공문|협조|안내문/.test(text)) return '공문';
      if (/보고/.test(text)) return '보고서';
      return '보고서';
    };
    const groups: Array<{ label: string; options: string[]; pick: string }> = [
      { label: '어떤 문서를 만들까요?', options: ['사업계획서', '보고서', '제안서', '회의록', '공문', '기타'], pick: infer() },
      { label: '주요 목적은?', options: ['대외 제출용', '내부 검토용', '개인·기타'], pick: '대외 제출용' },
      { label: '분량은?', options: ['표준(3~5장)', '간략(1~2장)', '상세(6장 이상)'], pick: '표준(3~5장)' },
      { label: '문체는?', options: ['공식 공문체', '일반 서술체'], pick: '공식 공문체' },
    ];
    const picks = groups.map((g) => g.pick);

    const msgEl = this.pushMsg({ role: 'ai', text: '문서 환경설정 — 방향을 확인하고 시작할게요.' });
    const card = mkEl('div', 'canva-ai-setup');
    groups.forEach((g, gi) => {
      card.appendChild(mkEl('div', 'canva-ai-setup-label', g.label));
      const row = mkEl('div', 'canva-ai-setup-row');
      g.options.forEach((opt) => {
        const chip = mkButton('canva-ai-setup-chip', { text: opt === g.pick ? `${opt} ·추천` : opt });
        chip.classList.toggle('is-on', opt === g.pick);
        chip.addEventListener('click', () => {
          picks[gi] = opt;
          [...row.children].forEach((c) => c.classList.toggle('is-on', (c as HTMLElement).textContent?.startsWith(opt) ?? false));
        });
        row.appendChild(chip);
      });
      card.appendChild(row);
    });
    const go = mkButton('canva-ai-setup-go', { text: '이 설정으로 작성' });
    go.addEventListener('click', () => {
      go.disabled = true;
      // 선택을 모델 지시문으로 — 프롬프트의 문체 규칙(개조식/경어체)과 이어지게 쓴다.
      this.writerSetup = [
        `문서 유형: ${picks[0]}`,
        `용도: ${picks[1]}${picks[1] === '대외 제출용' ? ' (격식을 최대로)' : ''}`,
        `분량: ${picks[2]}`,
        `문체: ${picks[3]}${picks[3] === '일반 서술체' ? ' (개조식 규칙 대신 자연스러운 서술형)' : ''}`,
      ].join(' / ');
      card.remove();
      this.pushMsg({ role: 'ai', text: `설정 확정 — ${this.writerSetup}` });
      void this.sendWriter(text);
    });
    card.appendChild(go);
    msgEl.appendChild(card);
  }

  private async sendWriter(text: string): Promise<void> {
    if (this.services.wasm.pageCount === 0) {
      this.pushMsg({ role: 'ai', text: '문서가 열려 있지 않습니다. 새 문서를 먼저 열어 주세요.' });
      return;
    }
    // 첫 요청이면 방향(유형·목적·분량·문체)을 먼저 확인한다 — 방향이 틀리면 전부 다시 쓴다.
    if (!this.writerSetup) {
      this.renderWriterSetup(text);
      return;
    }
    this.setBusy(true);
    const thinking = this.pushMsg({ role: 'ai', text: '목차를 설계하는 중…' });
    try {
      const result = await this.writer.runTurn(
        this.services, `[작성 방향] ${this.writerSetup}\n요청: ${text}`,
        // 섹션 본문이 길다 — 토큰을 넉넉히(부족하면 JSON 이 잘려 깨진다).
        (sys, user) => this.callModel(user, sys, 4096),
        (step) => { thinking.querySelector('.bubble')!.textContent = `작성 중 — ${step.name}: ${step.summary}`; },
      );
      thinking.remove();
      this.pushMsg({
        role: 'ai',
        text: result.finalText + (result.realized ? '\n\n(문서에 반영됐습니다 — Ctrl+Z 로 한 번에 되돌릴 수 있습니다)' : ''),
      });
    } catch (e) {
      thinking.remove();
      const detail = e instanceof Error ? e.message : String(e);
      this.pushMsg({ role: 'ai', err: true, text: `문서 작성에 실패했습니다.\n${detail}${aiErrorHint(detail)}` });
    } finally {
      this.setBusy(false);
    }
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

  private async callModel(userText: string, systemPrompt: string, maxTokens?: number): Promise<string> {
    // 공용 클라이언트(canva-ai-client) — AI 수정 대화상자와 공유.
    // 배지는 모델 버튼이 그린다(하드코딩 모델명은 호스트 배포에서 거짓말이었다).
    return callAi(systemPrompt, userText, maxTokens);
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
