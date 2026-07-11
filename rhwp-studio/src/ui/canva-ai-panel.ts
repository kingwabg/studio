/**
 * [캔버스 한컴 포크] 우측 AI 문서 도우미 (캔바식).
 * dev 서버 프록시(/api/ai → api.minimax.io, vite.config)로 MiniMax M3 호출 — OpenAI 호환 형식.
 * 키는 서버측 Bearer 주입(브라우저 노출 없음). 응답은 "본문에 삽입"으로 커서 위치에 넣는다.
 * ⚠ 백엔드(키/크레딧)는 실행 환경 의존 — 실패 시 채팅에 정직하게 오류를 표시한다.
 */
import type { CanvaServices } from './canva-services';
import { parseAiLayout, applyAiLayout, type AiLayout } from './canva-ai-layout';
import { callMiniMax, aiErrorHint } from './canva-ai-client';
const SYSTEM_PROMPT =
  '당신은 한국어 문서(HWPX) 편집을 돕는 작성 도우미입니다. ' +
  '사용자의 요청에 따라 문서에 바로 넣을 수 있는 깔끔한 한국어 본문 텍스트를 작성하세요. ' +
  '군더더기 설명 없이 문서에 들어갈 내용만 출력합니다. 표/서식 마크업은 쓰지 않습니다.';

// 캔버스식 문서 생성 — A4 지면 배치 계획(JSON)을 설계시킨다 (inline-ai의 문서 생성을 캔버스 문법으로)
const LAYOUT_PROMPT =
  '당신은 한국어 문서 레이아웃 설계자입니다. 사용자의 요청을 A4(210×297mm) 지면 위 요소 배치로 설계해 JSON만 출력하세요.\n' +
  '형식: {"elements":[{"type":"text","x":20,"y":20,"w":170,"text":"내용 (줄바꿈은 \\n)"},{"type":"table","x":20,"y":60,"rows":[["헤더1","헤더2"],["값1","값2"]]}]}\n' +
  '규칙: 좌표/폭은 mm 숫자. 여백 20mm 안쪽(x 20~190, y 20~277)에 배치. 문서 제목은 맨 위 text 요소.\n' +
  '표는 rows 2차원 배열(첫 행=헤더, 빈 값은 ""), 셀 텍스트는 짧게. 요소는 2~8개.\n' +
  '설명·코드펜스 없이 JSON 하나만 출력합니다.';

interface Msg { role: 'user' | 'ai'; text: string; err?: boolean; }

export class CanvaAiPanel {
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private modelBadge!: HTMLElement;
  private busy = false;
  private genMode = true; // 캔버스식 문서 생성 모드 (기본 ON — 캔버스 탭의 작성법)
  private modeChip!: HTMLButtonElement;

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
  }

  private render(): void {
    const pane = document.createElement('div');
    pane.className = 'canva-ai-pane';

    this.log = document.createElement('div');
    this.log.className = 'canva-ai-log';
    pane.appendChild(this.log);

    this.pushMsg({ role: 'ai', text: '안녕하세요! 만들 문서를 말씀해 주세요 — 지면 위에 제목·본문·표를 배치해 드립니다.\n예) "주간 회의록 만들어줘", "출장 보고서 양식"\n(칩을 눌러 일반 글쓰기 모드로 바꿀 수 있어요)' });

    const bar = document.createElement('div');
    bar.className = 'canva-ai-input-bar';
    // 문서 생성(배치) ↔ 일반 글쓰기 모드 칩
    this.modeChip = document.createElement('button');
    this.modeChip.type = 'button';
    this.modeChip.className = 'canva-ai-mode';
    this.modeChip.addEventListener('click', () => {
      this.genMode = !this.genMode;
      this.syncModeChip();
    });
    bar.appendChild(this.modeChip);
    this.input = document.createElement('textarea');
    this.input.rows = 1;
    this.input.placeholder = '무엇을 써 드릴까요?';
    this.input.addEventListener('input', () => this.autosize());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); }
    });
    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'canva-ai-send';
    this.sendBtn.type = 'button';
    this.sendBtn.title = '보내기';
    this.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-6-7-2z"/></svg>';
    this.sendBtn.addEventListener('click', () => void this.send());
    bar.append(this.input, this.sendBtn);
    pane.appendChild(bar);
    this.syncModeChip();

    this.root.appendChild(pane);

    // 모델 배지 (레일 헤더 우측에 표시하도록 노출)
    this.modelBadge = document.createElement('span');
    this.modelBadge.className = 'canva-ai-model';
    this.modelBadge.textContent = 'MiniMax M3';
  }

  getModelBadge(): HTMLElement { return this.modelBadge; }

  private autosize(): void {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 96) + 'px';
  }

  private pushMsg(m: Msg): HTMLElement {
    const el = document.createElement('div');
    el.className = `canva-ai-msg ${m.role}${m.err ? ' err' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;
    el.appendChild(bubble);
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }

  private syncModeChip(): void {
    this.modeChip.textContent = this.genMode ? '문서 생성' : '일반';
    this.modeChip.classList.toggle('is-gen', this.genMode);
    this.modeChip.title = this.genMode
      ? '캔버스식 문서 생성: 지면에 제목·본문·표를 배치합니다 (클릭해 일반 글쓰기로 전환)'
      : '일반 글쓰기: 텍스트 답변을 받아 커서 위치에 삽입합니다 (클릭해 문서 생성으로 전환)';
    this.input.placeholder = this.genMode ? '어떤 문서를 만들까요?' : '무엇을 써 드릴까요?';
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
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
    const actions = document.createElement('div');
    actions.className = 'canva-ai-actions';
    const apply = document.createElement('button');
    apply.className = 'canva-ai-act';
    apply.type = 'button';
    apply.textContent = '캔버스에 배치';
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
    const actions = document.createElement('div');
    actions.className = 'canva-ai-actions';
    const insert = document.createElement('button');
    insert.className = 'canva-ai-act';
    insert.type = 'button';
    insert.textContent = '본문에 삽입';
    insert.addEventListener('click', () => {
      const ih = this.services.getInputHandler();
      if (ih && this.services.wasm.pageCount > 0) {
        (ih as any).insertPlainTextAtCursor(text);
      }
    });
    const copy = document.createElement('button');
    copy.className = 'canva-ai-act';
    copy.type = 'button';
    copy.textContent = '복사';
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(text); });
    actions.append(insert, copy);
    msgEl.appendChild(actions);
  }

  private async callModel(userText: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
    // 공용 클라이언트(canva-ai-client) — AI 수정 대화상자와 공유
    const out = await callMiniMax(systemPrompt, userText);
    this.modelBadge.textContent = 'MiniMax M3';
    return out;
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.sendBtn.disabled = b;
  }
}
