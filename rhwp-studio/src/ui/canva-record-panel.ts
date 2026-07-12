/**
 * [캔버스 한컴 포크] 우측 레일 [녹음] 탭 — Web Speech 받아쓰기 → 전사록 편집 →
 * 기존 AI 문서 생성 파이프라인(LAYOUT_PROMPT/parseAiLayout/applyAiLayout)으로 회의록 배치.
 * P1-9 v1: 화자 자동 분리 없음(줄 앞 "이름:" 수동 태그). 전략·로드맵은 docs/product-spec.md P1-9.
 * 전송 투명성(아키텍처 원칙 2 예외): 첫 사용 시 음성 전송 동의 카드(문서 검토 AI와 같은 패턴,
 * 세션 메모리만 — localStorage 금지=매 세션 재확인), 회의록 생성 버튼 옆에도 전송 안내 문구.
 */
import type { CanvaServices } from './canva-services';
import { SttSession, type SttState } from './canva-record-stt';
import { mkEl, mkButton } from './canva-dom';
import { callMiniMax, aiErrorHint } from './canva-ai-client';
import { parseAiLayout, applyAiLayout, type AiLayout } from './canva-ai-layout';
import { LAYOUT_PROMPT } from './canva-ai-panel';

const ICON_MIC =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M7 4l13 8-13 8V4z"/></svg>';
const ICON_STOP =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

// 동의는 세션 메모리(모듈 변수)만 — localStorage 금지(원칙: 매 세션 재확인이 전송 투명성에 부합).
let sessionConsented = false;

type Phase = 'idle' | 'consent' | 'recording' | 'stopped';

export class CanvaRecordPanel {
  private stt: SttSession | null = null;
  private phase: Phase = 'idle';
  private elapsedSec = 0;
  private timerId: number | null = null;

  private idleSection!: HTMLElement;
  private consentCard!: HTMLElement;
  private bar!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private transcriptWrap!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private interimLine!: HTMLElement;
  private resultActions!: HTMLElement;
  private genResult!: HTMLElement;
  private errBox!: HTMLElement;

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
  }

  private render(): void {
    const pane = mkEl('div', 'canva-record-pane');

    this.errBox = mkEl('div', 'canva-record-err');
    this.errBox.hidden = true;
    pane.appendChild(this.errBox);

    // ── 대기 화면 ──
    this.idleSection = mkEl('div', 'canva-record-idle');
    const hint = mkEl('div', 'canva-hint', '회의 중 발언을 실시간으로 받아쓰고, 전사록을 다듬어 AI로 회의록을 만듭니다.');
    const startBtn = mkButton('canva-full-btn', { html: `${ICON_MIC}<span>녹음 시작</span>` });
    startBtn.addEventListener('click', () => this.requestStart());
    this.idleSection.append(hint, startBtn);
    pane.appendChild(this.idleSection);

    // ── 전송 동의 카드 (원칙 2 예외 패턴 — 문서 검토 AI 동의 카드와 같은 투명성 톤) ──
    this.consentCard = mkEl('div', 'canva-record-consent');
    const cTitle = mkEl('div', 'canva-record-consent-title', 'AI에 보낼 내용');
    const cBody = mkEl('div', 'canva-record-consent-body', '음성이 브라우저 음성 인식(구글 서버)으로 전송됩니다. 계속할까요?');
    const cActions = mkEl('div', 'canva-record-consent-actions');
    const cCancel = mkButton('canva-record-btn', { text: '취소' });
    const cStart = mkButton('canva-record-btn canva-record-btn-primary', { text: '녹음 시작' });
    cCancel.addEventListener('click', () => this.setPhase('idle'));
    cStart.addEventListener('click', () => { sessionConsented = true; this.beginRecording(); });
    cActions.append(cCancel, cStart);
    this.consentCard.append(cTitle, cBody, cActions);
    pane.appendChild(this.consentCard);

    // ── 녹음 상태 바 ──
    this.bar = mkEl('div', 'canva-record-bar');
    const status = mkEl('div', 'canva-record-status');
    this.statusDot = mkEl('span', 'canva-record-dot');
    this.statusText = mkEl('span', 'canva-record-statustext', '00:00');
    status.append(this.statusDot, this.statusText);
    const controls = mkEl('div', 'canva-record-controls');
    this.pauseBtn = mkButton('canva-icon-btn', { html: ICON_PAUSE, title: '일시정지' });
    this.stopBtn = mkButton('canva-icon-btn', { html: ICON_STOP, title: '종료' });
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.finishRecording());
    controls.append(this.pauseBtn, this.stopBtn);
    this.bar.append(status, controls);
    pane.appendChild(this.bar);

    // ── 전사록 (편집 가능 — 확정 발언은 줄 단위 append, interim은 아래 회색 줄) ──
    this.transcriptWrap = mkEl('div', 'canva-record-transcript-wrap');
    this.textarea = document.createElement('textarea');
    this.textarea.className = 'canva-record-textarea';
    this.textarea.placeholder = '받아쓴 내용이 여기 쌓입니다. 직접 수정할 수 있습니다.';
    this.interimLine = mkEl('div', 'canva-record-interim');
    const tHint = mkEl('div', 'canva-hint', "발언자는 줄 앞에 '이름:' 형식으로 직접 적어주세요.");
    this.transcriptWrap.append(this.textarea, this.interimLine, tHint);
    pane.appendChild(this.transcriptWrap);

    // ── 종료 후 액션 ──
    this.resultActions = mkEl('div', 'canva-record-result-actions');
    const genBtn = mkButton('canva-ai-act', { text: '회의록 생성' });
    const insertBtn = mkButton('canva-ai-act', { text: '본문 삽입' });
    const genHint = mkEl('div', 'canva-hint', '생성 시 전사록이 AI(MiniMax)로 전송됩니다.');
    genBtn.addEventListener('click', () => void this.generateMinutes());
    insertBtn.addEventListener('click', () => this.insertTranscript());
    const btnRow = mkEl('div', 'canva-btn-row');
    btnRow.append(genBtn, insertBtn);
    this.resultActions.append(btnRow, genHint);
    pane.appendChild(this.resultActions);

    this.genResult = mkEl('div', 'canva-record-genresult');
    pane.appendChild(this.genResult);

    this.root.appendChild(pane);
    this.setPhase('idle');
  }

  // 탭 전환과 동일한 원칙: 인라인 display 금지, hidden 속성 + CSS [hidden] 규칙으로만 전환.
  private setPhase(p: Phase): void {
    this.phase = p;
    this.idleSection.hidden = p !== 'idle';
    this.consentCard.hidden = p !== 'consent';
    this.bar.hidden = p === 'idle' || p === 'consent';
    this.transcriptWrap.hidden = p === 'idle' || p === 'consent';
    this.resultActions.hidden = p !== 'stopped';
    this.stopBtn.hidden = p === 'stopped';
    this.pauseBtn.hidden = p === 'stopped';
  }

  private requestStart(): void {
    this.errBox.hidden = true;
    if (sessionConsented) { this.beginRecording(); return; }
    this.setPhase('consent');
  }

  private beginRecording(): void {
    this.textarea.value = '';
    this.interimLine.textContent = '';
    this.elapsedSec = 0;
    this.statusText.textContent = '00:00';
    this.genResult.innerHTML = '';
    this.stt = new SttSession({
      onFinal: (text) => this.appendFinal(text),
      onInterim: (text) => { this.interimLine.textContent = text; },
      onError: (err) => this.showError(err),
      onState: (s) => this.onSttState(s),
    });
    this.setPhase('recording');
    this.stt.start();
    if (this.phase === 'recording') this.startTimer(); // start()가 동기 실패해 phase가 바뀌었으면 타이머 생략
  }

  private appendFinal(text: string): void {
    if (!text) return;
    this.interimLine.textContent = '';
    const sep = this.textarea.value && !this.textarea.value.endsWith('\n') ? '\n' : '';
    this.textarea.value += sep + text;
    this.textarea.scrollTop = this.textarea.scrollHeight;
  }

  private onSttState(s: SttState): void {
    this.statusDot.classList.toggle('is-live', s === 'listening');
    this.pauseBtn.innerHTML = s === 'paused' ? ICON_PLAY : ICON_PAUSE;
    this.pauseBtn.title = s === 'paused' ? '재개' : '일시정지';
    if (s === 'error') { this.stopTimer(); this.setPhase('stopped'); }
  }

  private togglePause(): void {
    if (!this.stt) return;
    if (this.stt.getState() === 'paused') { this.stt.resume(); this.startTimer(); }
    else { this.stt.pause(); this.stopTimer(); }
  }

  private finishRecording(): void {
    this.stt?.stop();
    this.stopTimer();
    this.setPhase('stopped');
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerId = window.setInterval(() => {
      this.elapsedSec++;
      this.statusText.textContent = formatElapsed(this.elapsedSec);
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerId !== null) { window.clearInterval(this.timerId); this.timerId = null; }
  }

  private showError(err: string): void {
    this.errBox.hidden = false;
    this.errBox.textContent = err;
  }

  // 기존 AI 패널의 "본문에 삽입"과 동일한 삽입 경로(insertPlainTextAtCursor) 재사용.
  private insertTranscript(): void {
    const text = this.textarea.value.trim();
    if (!text) return;
    const ih = this.services.getInputHandler();
    if (ih && this.services.wasm.pageCount > 0) {
      (ih as any).insertPlainTextAtCursor(text);
    }
  }

  // 전사록 → LAYOUT_PROMPT(AI 문서 생성과 동일 시스템 프롬프트) → 배치 미리보기 → 승인 → applyAiLayout.
  private async generateMinutes(): Promise<void> {
    const transcript = this.textarea.value.trim();
    if (!transcript) return;
    this.genResult.innerHTML = '';
    const thinking = mkEl('div', 'canva-hint', '회의록 설계 중…');
    this.genResult.appendChild(thinking);
    try {
      const userMsg =
        '다음 회의 전사록을 바탕으로 회의록 문서를 만들어줘. 제목·일시·참석자·안건별 논의·결정사항·할 일 구조로:\n\n' +
        transcript;
      const reply = await callMiniMax(LAYOUT_PROMPT, userMsg);
      const layout = parseAiLayout(reply);
      thinking.remove();
      if (!layout) {
        this.genResult.appendChild(mkEl('div', 'canva-record-err', '회의록 배치를 해석하지 못했습니다. 다시 시도해 주세요.'));
        return;
      }
      this.renderLayoutPreview(layout);
    } catch (e) {
      thinking.remove();
      const detail = e instanceof Error ? e.message : String(e);
      this.genResult.appendChild(mkEl('div', 'canva-record-err', `회의록 생성에 실패했습니다. ${detail}${aiErrorHint(detail)}`));
    }
  }

  // 요소 개수 요약 + [캔버스에 배치] 승인 버튼 (적용은 단일 스냅샷 — Ctrl+Z 일괄 취소 유지).
  private renderLayoutPreview(layout: AiLayout): void {
    const texts = layout.elements.filter((e) => e.type === 'text').length;
    const tables = layout.elements.filter((e) => e.type === 'table').length;
    const summary = mkEl('div', 'canva-hint', `배치 계획 — 텍스트 ${texts} · 표 ${tables}`);
    const apply = mkButton('canva-ai-act', { text: '캔버스에 배치' });
    apply.addEventListener('click', () => {
      const done = applyAiLayout(this.services, layout);
      apply.disabled = true;
      apply.textContent = '배치됨';
      this.genResult.appendChild(mkEl('div', 'canva-hint', `캔버스에 배치했습니다 — 텍스트 ${done.texts} · 표 ${done.tables} (Ctrl+Z로 취소 가능)`));
    });
    this.genResult.append(summary, apply);
  }
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
