/**
 * [캔버스 한컴 포크] 브라우저 내장 Web Speech(SpeechRecognition) 래퍼 — DOM 조작 없음(순수 로직).
 * P1-9 녹음→회의록 v1의 받아쓰기 코어. ko-KR·continuous·interimResults.
 * ⚠ 크롬은 침묵/시간경과로 세션을 스스로 끝낸다(no-speech 오류 후 onend) → 사용자가 stop()을
 * 부르지 않았으면 onend에서 짧은 백오프 후 자동 재시작한다. stop()은 의도 플래그(intentional)를
 * 꺼서 재시작 루프를 끊는다. pause()는 세션은 끝내되 재시작 의도는 유지(paused 플래그로 구분).
 */

export type SttState = 'idle' | 'listening' | 'paused' | 'stopped' | 'error';

export interface SttSessionOpts {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (err: string) => void;
  onState: (state: SttState) => void;
}

// Web Speech API는 표준 lib.dom.d.ts에 없는 비표준 API — 필요한 최소 형태만 로컬 선언.
interface SpeechRecognitionAlternativeLike { transcript: string; }
interface SpeechRecognitionResultLike { isFinal: boolean; length: number; [i: number]: SpeechRecognitionAlternativeLike; }
interface SpeechRecognitionResultListLike { length: number; [i: number]: SpeechRecognitionResultLike; }
interface SpeechRecognitionEventLike { resultIndex: number; results: SpeechRecognitionResultListLike; }
interface SpeechRecognitionErrorEventLike { error: string; }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// 재시작 백오프 하한 — 재시작 실패(권한 철회 등) 시 연타로 콘솔/CPU를 태우지 않기 위한 최소 간격.
const RESTART_BACKOFF_MS = 350;

export class SttSession {
  private ctor: SpeechRecognitionCtor | null;
  private rec: SpeechRecognitionLike | null = null;
  private intentional = false; // stop() 전인지 — onend 자동 재시작 여부 판단
  private paused = false;
  private state: SttState = 'idle';

  constructor(private opts: SttSessionOpts) {
    this.ctor = getCtor();
  }

  static isSupported(): boolean { return getCtor() !== null; }

  start(): void {
    if (!this.ctor) {
      this.opts.onError('이 브라우저는 음성 인식을 지원하지 않습니다. 최신 Chrome을 사용해 주세요.');
      this.setState('error');
      return;
    }
    this.intentional = true;
    this.paused = false;
    this.spawn();
  }

  private spawn(): void {
    if (!this.ctor) return;
    const rec = new this.ctor();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => this.setState('listening');
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e);
    rec.onend = () => this.handleEnd();
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.opts.onError(`음성 인식 시작 실패: ${String(err)}`);
      this.setState('error');
    }
  }

  private handleResult(e: SpeechRecognitionEventLike): void {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) this.opts.onFinal(text.trim());
      else interim += text;
    }
    if (interim) this.opts.onInterim(interim.trim());
  }

  private handleError(e: SpeechRecognitionErrorEventLike): void {
    // no-speech/aborted는 흔한 무해 이벤트(침묵 타임아웃 등) — onend가 재시작을 처리하므로
    // 사용자에게는 조용히 넘긴다. 그 외(마이크 권한 거부 등)만 노출.
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    this.opts.onError(`음성 인식 오류: ${e.error}`);
  }

  private handleEnd(): void {
    this.rec = null;
    if (!this.intentional || this.paused) {
      this.setState(this.paused ? 'paused' : 'stopped');
      return;
    }
    // 사용자가 멈추지 않았는데 세션이 끝남(침묵/시간경과) → 짧은 백오프 후 자동 재시작.
    window.setTimeout(() => {
      if (!this.intentional || this.paused) return;
      try { this.spawn(); } catch (err) {
        this.opts.onError(`재시작 실패: ${String(err)}`);
        this.setState('error');
      }
    }, RESTART_BACKOFF_MS);
  }

  pause(): void {
    if (!this.intentional) return;
    this.paused = true;
    this.rec?.stop();
  }

  resume(): void {
    if (!this.intentional) return;
    this.paused = false;
    this.spawn();
  }

  stop(): void {
    this.intentional = false;
    this.paused = false;
    if (this.rec) this.rec.stop();
    else this.setState('stopped');
  }

  getState(): SttState { return this.state; }

  private setState(s: SttState): void {
    this.state = s;
    this.opts.onState(s);
  }
}
