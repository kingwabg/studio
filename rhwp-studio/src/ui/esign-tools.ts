/**
 * 전자서명 도구 3종 — 유효성 체크리스트 · 동의율 시뮬레이터 · NDA 생성기.
 * (사용자 요청 2026-08-01 — 도장 만들기는 별도 파일 ui/seal-maker.ts)
 *
 * 셋 다 **전부 로컬**이다. 체크리스트는 전자서명법 요건의 자가 점검이고,
 * 시뮬레이터는 공개된 응답률 경험치 기반 추정이며, NDA 는 고정 서식을
 * 서식 삽입기(ai-doc-insert)로 넣는다 — AI 호출이 없어 즉시·무료다.
 */
import { ModalDialog } from './dialog';
import { insertFormatted } from './ai-doc-insert';
import type { CommandServices } from '@/command/types';

/* ── ① 전자서명 유효성 체크리스트 ─────────────────────────── */

/**
 * 전자서명법(제3조)·개인정보보호법 관점의 자가 점검 항목.
 * ⚠ 법률 자문이 아니다 — 항목 자체가 그렇게 말한다. 체크 상태는 저장하지 않는다
 *   (문서마다 다시 점검하는 것이 목적이라 저장이 오히려 해롭다).
 */
const CHECKLIST: Array<{ text: string; hint: string }> = [
  { text: '서명자가 누구인지 특정된다', hint: '이름+연락처(본인 명의 휴대전화) 또는 본인인증' },
  { text: '서명 의사가 문서에 드러난다', hint: '"동의합니다" 문구 + 서명란 — 빈 서명만으로는 약하다' },
  { text: '서명 후 문서가 바뀌지 않았음을 증명할 수 있다', hint: '완료 PDF 보관 + 감사추적기록(누가 언제)' },
  { text: '서명자에게 사본이 전달된다', hint: '완료 시 상대방도 PDF 를 받는 설정' },
  { text: '개인정보 수집 항목이 최소인가', hint: '서명에 꼭 필요한 것만 — 이름·연락처 외 요구하지 않기' },
  { text: '보관 기간과 파기 시점이 정해져 있다', hint: '동의서 유형별 보존 연한을 문서에 명시' },
  { text: '미성년 관련 문서면 법정대리인 서명인가', hint: '아동 본인이 아니라 보호자가 서명해야 한다' },
];

export class EsignChecklistDialog extends ModalDialog {
  constructor() {
    super('전자서명 유효성 체크리스트', 460);
  }

  protected onConfirm(): boolean { return true; }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'esign-check';
    const intro = document.createElement('p');
    intro.className = 'esign-check-intro';
    intro.textContent =
      '전자서명법·개인정보보호법 관점의 자가 점검입니다. 법률 자문을 대신하지 않습니다.';
    body.appendChild(intro);
    for (const item of CHECKLIST) {
      const row = document.createElement('label');
      row.className = 'esign-check-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      const wrap = document.createElement('div');
      const t = document.createElement('div');
      t.className = 'esign-check-text';
      t.textContent = item.text;
      const h = document.createElement('div');
      h.className = 'esign-check-hint';
      h.textContent = item.hint;
      wrap.append(t, h);
      row.append(box, wrap);
      body.appendChild(row);
    }
    return body;
  }
}

/* ── ② 동의율 시뮬레이터 ─────────────────────────────────── */

/**
 * 발송 조건으로 예상 완료 건수를 추정한다.
 * ⚠ 모델은 경험치다(알림톡 기본 55%·문자 45%, 리마인드마다 남은 미응답의 25% 추가 회수,
 *   기한 7일 미만이면 감쇠). 정밀 예측이 아니라 "몇 건은 전화로 챙겨야 하나"의 감을 주는 것 —
 *   화면에도 추정임을 명시한다.
 */
export function estimateConsent(n: number, channel: 'alimtalk' | 'sms', reminders: number, days: number): {
  rate: number; done: number; remain: number;
} {
  const base = channel === 'alimtalk' ? 0.55 : 0.45;
  let rate = base;
  for (let i = 0; i < Math.min(reminders, 3); i++) rate += (1 - rate) * 0.25;
  if (days < 7) rate *= 0.85;
  rate = Math.min(rate, 0.97);
  const done = Math.round(n * rate);
  return { rate, done, remain: n - done };
}

export class ConsentSimDialog extends ModalDialog {
  private out!: HTMLElement;
  private n!: HTMLInputElement;
  private ch!: HTMLSelectElement;
  private rem!: HTMLInputElement;
  private days!: HTMLInputElement;

  constructor() {
    super('동의율 시뮬레이터', 400);
  }

  protected onConfirm(): boolean { return true; }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'consent-sim';
    const mk = (label: string, el: HTMLElement) => {
      const row = document.createElement('label');
      row.className = 'consent-row';
      const s = document.createElement('span');
      s.textContent = label;
      row.append(s, el);
      return row;
    };
    this.n = Object.assign(document.createElement('input'), { type: 'number', value: '30' });
    this.ch = document.createElement('select');
    this.ch.innerHTML = '<option value="alimtalk">알림톡</option><option value="sms">문자</option>';
    this.rem = Object.assign(document.createElement('input'), { type: 'number', value: '1' });
    this.days = Object.assign(document.createElement('input'), { type: 'number', value: '7' });
    body.append(
      mk('대상 인원', this.n), mk('발송 채널', this.ch),
      mk('리마인드 횟수', this.rem), mk('기한(일)', this.days),
    );
    this.out = document.createElement('div');
    this.out.className = 'consent-out';
    body.appendChild(this.out);
    const note = document.createElement('p');
    note.className = 'consent-note';
    note.textContent = '⚠ 경험치 기반 추정입니다 — "몇 건은 전화로 챙겨야 하나"의 감을 잡는 용도입니다.';
    body.appendChild(note);
    for (const el of [this.n, this.ch, this.rem, this.days]) el.addEventListener('input', () => this.paint());
    return body;
  }

  show(): void {
    super.show();
    this.paint();
  }

  private paint(): void {
    const r = estimateConsent(
      Math.max(1, Number(this.n.value) || 0),
      this.ch.value as 'alimtalk' | 'sms',
      Number(this.rem.value) || 0,
      Number(this.days.value) || 7,
    );
    this.out.innerHTML =
      `<b>예상 완료율 ${(r.rate * 100).toFixed(0)}%</b> — ` +
      `완료 약 ${r.done}명 · <b>미응답 약 ${r.remain}명</b>(개별 연락 필요)`;
  }
}

/* ── ③ NDA 생성기 ────────────────────────────────────────── */

/**
 * 고정 서식 + 빈칸 입력 → 서식 삽입기(제목·소제목·본문 위계)로 문서에 넣는다.
 * AI 를 부르지 않는 이유: NDA 는 문구가 보수적이어야 하고, 고정 서식이면 즉시·무료·
 * 오프라인이다. 다듬고 싶으면 넣은 뒤 [문장 다듬기]를 쓰면 된다.
 */
function ndaText(a: string, b: string, purpose: string, years: string): string {
  return [
    '비밀유지계약서(NDA)',
    `${a}(이하 "갑")과 ${b}(이하 "을")은 ${purpose}(이하 "목적 업무")와 관련하여 다음과 같이 비밀유지계약을 체결한다.`,
    '1. 비밀정보의 정의',
    '본 계약에서 비밀정보란 목적 업무와 관련하여 서면·구두·전자적 방법으로 제공되는 일체의 기술·경영·개인정보로서, 제공 시 비밀임이 표시되었거나 통념상 비밀로 취급되어야 할 정보를 말한다.',
    '2. 비밀유지 의무',
    '가. 각 당사자는 상대방의 비밀정보를 목적 업무 수행 외의 용도로 사용하지 아니한다.',
    '나. 각 당사자는 상대방의 사전 서면 동의 없이 비밀정보를 제3자에게 공개하지 아니한다.',
    '다. 법령 또는 법원의 명령에 따라 공개가 요구되는 경우, 지체 없이 상대방에게 통지한다.',
    '3. 비밀유지 기간',
    `본 계약의 비밀유지 의무는 계약 체결일로부터 ${years}년간 유효하다.`,
    '4. 자료의 반환·파기',
    '목적 업무 종료 또는 상대방의 요청 시, 제공받은 비밀정보와 그 사본을 반환하거나 파기하고 그 사실을 확인해 준다.',
    '5. 손해배상',
    '본 계약을 위반하여 상대방에게 손해가 발생한 경우, 위반 당사자는 그 손해를 배상한다.',
    '',
    `${a} (갑)     (서명/인)`,
    `${b} (을)     (서명/인)`,
  ].join('\n');
}

export class NdaGeneratorDialog extends ModalDialog {
  private a!: HTMLInputElement;
  private b!: HTMLInputElement;
  private purpose!: HTMLInputElement;
  private years!: HTMLInputElement;

  constructor(private services: CommandServices) {
    super('NDA 생성기', 420);
    this.confirmLabel = '문서에 넣기';
  }

  /** 확인 = 문서에 넣기 */
  protected onConfirm(): boolean {
    const ih = this.services.getInputHandler();
    if (!ih || this.services.wasm.pageCount === 0) return true;
    insertFormatted(ih as never, ndaText(
      this.a.value.trim() || '[기관명]',
      this.b.value.trim() || '[상대방]',
      this.purpose.value.trim() || '[목적 업무]',
      this.years.value || '3',
    ));
    this.services.eventBus.emit('document-changed');
    return true;
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'consent-sim';
    const mk = (label: string, el: HTMLElement) => {
      const row = document.createElement('label');
      row.className = 'consent-row';
      const s = document.createElement('span');
      s.textContent = label;
      row.append(s, el);
      return row;
    };
    this.a = Object.assign(document.createElement('input'), { placeholder: '예: 서창지역아동센터' });
    this.b = Object.assign(document.createElement('input'), { placeholder: '예: ○○업체 / 자원봉사자 성명' });
    this.purpose = Object.assign(document.createElement('input'), { placeholder: '예: 급식 위탁 운영' });
    this.years = Object.assign(document.createElement('input'), { type: 'number', value: '3' });
    body.append(
      mk('갑 (기관)', this.a), mk('을 (상대방)', this.b),
      mk('목적 업무', this.purpose), mk('유지 기간(년)', this.years),
    );
    return body;
  }
}
