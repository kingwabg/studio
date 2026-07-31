/**
 * 맞춤법 검사 대화상자 (한컴 [도구-맞춤법 검사] 대응) — 모달리스
 *
 * ⚠ 설계 원칙(2026-07-28 확정): 문서 텍스트를 **외부로 보내지 않는다**. 이 편집기가
 * 아동 민감정보 문서를 다루기 때문(sc- CLAUDE.md '개인정보·보안 실태'). 그래서 v1은
 * 의존성 0의 **규칙 기반**이다 — LLM/외부 API 경로를 여기에 붙이지 말 것.
 *
 * v2 후보: 로컬 사전(어절 조회). 한국어는 교착어라 형태소 분석 없이는 오탐이 커서,
 * 규칙 파이프라인이 자리잡은 뒤 룰 소스 하나로 추가하는 편이 안전하다.
 */
import type { CommandServices } from '@/command/types';

/**
 * 규칙 종류 — 밑줄 색과 패널 묶음이 이걸 따른다.
 * 철자는 "틀렸다", 문장은 "이렇게 쓰면 낫다" — 사용자가 받아들이는 무게가 달라서
 * 같은 빨간 줄로 그으면 권장까지 오류로 읽힌다.
 */
export type SpellCat = '철자' | '문법' | '문장';

export interface SpellRule {
  /** 전역 정규식 — 반드시 g 플래그 */
  re: RegExp;
  /** 사용자에게 보일 설명 */
  msg: string;
  /** 바꿀 문자열(정규식 치환 형식). 없으면 안내만 하고 자동 교정은 제공하지 않는다 */
  fix?: string;
  /** 없으면 '철자' */
  cat?: SpellCat;
}

/**
 * 규칙 목록 — 오탐이 적은 것만 담는다. "가끔 맞는 규칙"은 넣지 않는다:
 * 맞춤법 검사기는 오탐 하나가 신뢰를 통째로 깎는다.
 */
export const SPELL_RULES: SpellRule[] = [
  // ⚠ '연속 공백' 규칙은 **뺐다**(2026-07-31 실측). 실제 공문에서 걸린 것이 전부
  //   개조식 들여쓰기("   * 사회보장성기금…")였다 — 한 칸으로 줄이면 문서 모양이 무너진다.
  //   한글 문서는 정렬 목적의 연속 공백이 흔해 타자 실수와 구분할 수 없다(중단 규칙대로 뺀다).
  { re: /(?<=\S)\s+([,.!?])/g, msg: '문장부호 앞 공백', fix: '$1' },
  // ⚠ 숫자 사이 쉼표(1,842)는 건드리지 않는다 — 실측에서 걸린 21건이 전부 천 단위
  //   구분 쉼표였고, 고치면 "1, 842" 로 **숫자를 망가뜨린다**(2026-07-31).
  { re: /(?<![0-9]),(?=\S)/g, msg: '쉼표 뒤 공백 누락', fix: ', ' },
  { re: /되요/g, msg: "'돼요'가 맞습니다", fix: '돼요' },
  { re: /됬/g, msg: "'됐'이 맞습니다", fix: '됐' },
  { re: /안되(?=[.\s,]|$)/g, msg: "'안 돼'가 맞습니다", fix: '안 돼' },
  { re: /할려고/g, msg: "'하려고'가 맞습니다", fix: '하려고' },
  { re: /김치찌게/g, msg: "'김치찌개'가 맞습니다", fix: '김치찌개' },
  { re: /어떻해/g, msg: "'어떡해'가 맞습니다", fix: '어떡해' },
  { re: /역활/g, msg: "'역할'이 맞습니다", fix: '역할' },
  { re: /오랫만/g, msg: "'오랜만'이 맞습니다", fix: '오랜만' },
  { re: /왠만/g, msg: "'웬만'이 맞습니다", fix: '웬만' },
  { re: /며칠전/g, msg: "'며칠 전'이 맞습니다", fix: '며칠 전' },
  { re: /들어나/g, msg: "'드러나'가 맞습니다", fix: '드러나' },
  { re: /갯수/g, msg: "'개수'가 맞습니다", fix: '개수' },
  { re: /뒤치닥/g, msg: "'뒤치다꺼리'가 맞습니다", fix: '뒤치다꺼' },
  { re: /페이지수/g, msg: "'쪽수'를 권장합니다", fix: '쪽수' },

  // ── 아래는 센터 업무 문서(일지·공문·평가 서류) 기준 확장 (2026-07-31, 사용자 결정) ──
  // 채택 기준: **항상 틀린 것만**. 문맥에 따라 맞을 수 있는 말(결재/결제, 틀리다/다르다,
  // -로서/-로써, -던지/-든지, 간간이/간간히)은 넣지 않는다 — 오탐 하나가 검사기 신뢰를
  // 통째로 깎는다. 규칙을 늘릴 땐 tests/spell-rules.test.ts 에 정상 문장을 함께 추가할 것.

  // 종결·어미
  { re: /읍니다/g, msg: "'습니다'가 맞습니다(옛 표기)", fix: '습니다' },
  { re: /슴니다/g, msg: "'습니다'가 맞습니다", fix: '습니다' },
  { re: /십시요/g, msg: "'십시오'가 맞습니다", fix: '십시오' },
  { re: /있슴/g, msg: "'있음'이 맞습니다", fix: '있음' },
  { re: /없슴/g, msg: "'없음'이 맞습니다", fix: '없음' },
  { re: /했슴/g, msg: "'했음'이 맞습니다", fix: '했음' },
  { re: /알맞는/g, msg: "'알맞은'이 맞습니다", fix: '알맞은' },
  { re: /걸맞는/g, msg: "'걸맞은'이 맞습니다", fix: '걸맞은' },
  { re: /삼가해/g, msg: "'삼가'가 맞습니다(삼가다)", fix: '삼가' },
  { re: /삼가하시/g, msg: "'삼가시'가 맞습니다(삼가다)", fix: '삼가시' },
  { re: /안절부절하/g, msg: "'안절부절못하'가 맞습니다", fix: '안절부절못하' },

  // 낱말
  { re: /웬지/g, msg: "'왠지'가 맞습니다", fix: '왠지' },
  { re: /몇일/g, msg: "'며칠'이 맞습니다", fix: '며칠' },
  { re: /오랬만/g, msg: "'오랜만'이 맞습니다", fix: '오랜만' },
  { re: /희안/g, msg: "'희한'이 맞습니다", fix: '희한' },
  { re: /서슴치/g, msg: "'서슴지'가 맞습니다", fix: '서슴지' },
  { re: /통채로/g, msg: "'통째로'가 맞습니다", fix: '통째로' },
  { re: /널부러/g, msg: "'널브러'가 맞습니다", fix: '널브러' },
  { re: /어떡게/g, msg: "'어떻게'가 맞습니다", fix: '어떻게' },
  { re: /어의없/g, msg: "'어이없'이 맞습니다", fix: '어이없' },
  { re: /설레임/g, msg: "'설렘'이 맞습니다", fix: '설렘' },
  { re: /눈쌀/g, msg: "'눈살'이 맞습니다", fix: '눈살' },
  { re: /뒤쳐지/g, msg: "'뒤처지'가 맞습니다", fix: '뒤처지' },

  // 부사 '-이/-히' — 표준어가 한쪽으로만 정해진 것만
  { re: /일일히/g, msg: "'일일이'가 맞습니다", fix: '일일이' },
  { re: /곰곰히/g, msg: "'곰곰이'가 맞습니다", fix: '곰곰이' },
  { re: /틈틈히/g, msg: "'틈틈이'가 맞습니다", fix: '틈틈이' },
  { re: /번번히/g, msg: "'번번이'가 맞습니다", fix: '번번이' },
  { re: /깨끗히/g, msg: "'깨끗이'가 맞습니다", fix: '깨끗이' },
  { re: /꼼꼼이/g, msg: "'꼼꼼히'가 맞습니다", fix: '꼼꼼히' },
  { re: /솔직이/g, msg: "'솔직히'가 맞습니다", fix: '솔직히' },
  { re: /조용이/g, msg: "'조용히'가 맞습니다", fix: '조용히' },

  // 띄어쓰기 — 의존명사 '수', 부사 '및'
  { re: /할수있/g, msg: "'할 수 있'으로 띄어 씁니다", fix: '할 수 있' },
  { re: /할수없/g, msg: "'할 수 없'으로 띄어 씁니다", fix: '할 수 없' },
  { re: /([가-힣])및/g, msg: "'및' 앞은 띄어 씁니다", fix: '$1 및' },
  { re: /및([가-힣])/g, msg: "'및' 뒤는 띄어 씁니다", fix: '및 $1' },

  // 공문서 표기
  { re: /년도별/g, msg: "'연도별'이 맞습니다", fix: '연도별' },
  { re: /결제선/g, msg: "'결재선'이 맞습니다(문서 승인)", fix: '결재선' },
  { re: /결제권자/g, msg: "'결재권자'가 맞습니다(문서 승인)", fix: '결재권자' },
  { re: /결제란/g, msg: "'결재란'이 맞습니다(문서 승인)", fix: '결재란' },

  // ── 문법 (2026-07-31) ── 이중피동·잘못된 높임처럼 **문법이 틀린** 것
  { re: /되어집/g, msg: '이중피동입니다 — \'됩\'이 맞습니다', fix: '됩', cat: '문법' },
  { re: /되어지/g, msg: '이중피동입니다 — \'되\'로 충분합니다', fix: '되', cat: '문법' },
  { re: /되어졌/g, msg: '이중피동입니다 — \'되었\'이 맞습니다', fix: '되었', cat: '문법' },
  { re: /보여집/g, msg: '이중피동입니다 — \'보입\'이 맞습니다', fix: '보입', cat: '문법' },
  { re: /보여지/g, msg: '이중피동입니다 — \'보이\'가 맞습니다', fix: '보이', cat: '문법' },
  { re: /보여졌/g, msg: '이중피동입니다 — \'보였\'이 맞습니다', fix: '보였', cat: '문법' },
  { re: /쓰여집/g, msg: '이중피동입니다 — \'쓰입\'이 맞습니다', fix: '쓰입', cat: '문법' },
  { re: /쓰여지/g, msg: '이중피동입니다 — \'쓰이\'가 맞습니다', fix: '쓰이', cat: '문법' },
  { re: /잊혀집/g, msg: '이중피동입니다 — \'잊힙\'이 맞습니다', fix: '잊힙', cat: '문법' },
  { re: /잊혀지/g, msg: '이중피동입니다 — \'잊히\'가 맞습니다', fix: '잊히', cat: '문법' },
  { re: /잊혀졌/g, msg: '이중피동입니다 — \'잊혔\'이 맞습니다', fix: '잊혔', cat: '문법' },
  { re: /모여집/g, msg: '이중피동입니다 — \'모입\'이 맞습니다', fix: '모입', cat: '문법' },
  { re: /모여지/g, msg: '이중피동입니다 — \'모이\'가 맞습니다', fix: '모이', cat: '문법' },
  { re: /믿겨집/g, msg: '이중피동입니다 — \'믿깁\'이 맞습니다', fix: '믿깁', cat: '문법' },
  { re: /믿겨지/g, msg: '이중피동입니다 — \'믿기\'가 맞습니다', fix: '믿기', cat: '문법' },
  { re: /나뉘어집/g, msg: '이중피동입니다 — \'나뉩\'이 맞습니다', fix: '나뉩', cat: '문법' },
  { re: /나뉘어지/g, msg: '이중피동입니다 — \'나뉘\'가 맞습니다', fix: '나뉘', cat: '문법' },
  { re: /불리워/g, msg: "'불려'가 맞습니다", fix: '불려', cat: '문법' },
  { re: /말씀이 계시/g, msg: "말씀은 '있으시'로 높입니다(간접높임)", fix: '말씀이 있으시', cat: '문법' },

  // ── 문장 스타일 (2026-07-31) ── 틀린 건 아니지만 공문에서 **이렇게 쓰면 낫다**
  { re: /에 있어서/g, msg: "번역투입니다 — '에서'를 권장합니다", fix: '에서', cat: '문장' },
  { re: /함에 있어/g, msg: "번역투입니다 — '할 때'를 권장합니다", fix: '할 때', cat: '문장' },
  { re: /로 인하여/g, msg: "'때문에'가 읽기 쉽습니다", fix: ' 때문에', cat: '문장' },
  { re: /하도록 하겠습니다/g, msg: "군더더기입니다 — '하겠습니다'", fix: '하겠습니다', cat: '문장' },
  { re: /하도록 하자/g, msg: "군더더기입니다 — '하자'", fix: '하자', cat: '문장' },
  // ⚠ 조사까지 같이 바꿔야 말이 된다 — '과반수 이상이' 를 '과반수' 로만 줄이면 '과반수이'
  //   가 된다. 구체적인 형태를 먼저 두고 일반형을 뒤에 둔다(같은 자리면 앞 규칙이 이긴다).
  { re: /과반수 이상이/g, msg: "'과반수'에 이미 초과의 뜻이 있습니다", fix: '과반수가', cat: '문장' },
  { re: /과반수 이상은/g, msg: "'과반수'에 이미 초과의 뜻이 있습니다", fix: '과반수는', cat: '문장' },
  { re: /과반수 이상/g, msg: "'과반수'에 이미 초과의 뜻이 있습니다", fix: '과반수', cat: '문장' },
  { re: /미리 예약/g, msg: "'예약'에 이미 미리의 뜻이 있습니다", fix: '예약', cat: '문장' },
  { re: /다시 재([가-힣])/g, msg: "'재-'에 이미 다시의 뜻이 있습니다", fix: '재$1', cat: '문장' },
  { re: /매 ([가-힣]+)마다/g, msg: "'매'와 '마다'가 겹칩니다", fix: '$1마다', cat: '문장' },
  { re: /가장 최([고대상])/g, msg: "'최-'에 이미 가장의 뜻이 있습니다", fix: '최$1', cat: '문장' },
];

export interface SpellHit {
  /** 규칙 종류 — 밑줄 색·패널 묶음이 이걸 따른다 */
  cat: SpellCat;
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  /** 원문 조각 */
  text: string;
  msg: string;
  suggestion: string | null;
}

/**
 * 문서 전체를 규칙으로 훑는다. 문단 순회는 diff-engine 의 검증된 루프와 같은 형태.
 * ⚠ 표 셀 안 텍스트는 v1 대상 밖(본문 문단만) — getTextInCell 경로는 v2.
 */
export function scanDocument(wasm: any): SpellHit[] {
  const hits: SpellHit[] = [];
  const secCount = wasm.getSectionCount?.() ?? 1;
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = wasm.getParagraphCount(sec);
    for (let para = 0; para < paraCount; para++) {
      let text = '';
      try {
        const len = wasm.getParagraphLength(sec, para);
        if (!len) continue;
        text = wasm.getTextRange(sec, para, 0, len) ?? '';
      } catch { continue; }
      if (!text) continue;
      for (const rule of SPELL_RULES) {
        rule.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.re.exec(text)) !== null) {
          if (m[0].length === 0) { rule.re.lastIndex++; continue; }
          hits.push({
            cat: rule.cat ?? '철자',
            sectionIndex: sec,
            paragraphIndex: para,
            charOffset: m.index,
            length: m[0].length,
            text: m[0],
            msg: rule.msg,
            suggestion: rule.fix != null ? m[0].replace(new RegExp(rule.re.source), rule.fix) : null,
          });
        }
      }
    }
  }
  // 같은 문단은 뒤에서부터 고쳐야 앞 히트의 charOffset 이 밀리지 않는다.
  hits.sort((a, b) =>
    a.sectionIndex - b.sectionIndex || a.paragraphIndex - b.paragraphIndex || a.charOffset - b.charOffset);
  return hits;
}

export class SpellDialog {
  private _open = false;
  private wrap!: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private statusLabel!: HTMLSpanElement;
  private hits: SpellHit[] = [];
  private selected = -1;
  private keyCapture: ((e: KeyboardEvent) => void) | null = null;

  constructor(private services: CommandServices) {}

  isOpen(): boolean { return this._open; }

  show(): void {
    if (this._open) { this.rescan(); return; }
    this._open = true;
    this.build();
    document.body.appendChild(this.wrap);
    this.keyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); }
    };
    document.addEventListener('keydown', this.keyCapture, true);
    this.rescan();
  }

  hide(): void {
    if (!this._open) return;
    this._open = false;
    if (this.keyCapture) document.removeEventListener('keydown', this.keyCapture, true);
    this.keyCapture = null;
    this.wrap.remove();
  }

  private build(): void {
    this.wrap = document.createElement('div');
    this.wrap.className = 'find-dialog spell-dialog';

    const title = document.createElement('div');
    title.className = 'find-dialog-title';
    title.textContent = '맞춤법 검사';
    this.wrap.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'spell-list';
    this.listEl.style.cssText = 'max-height:240px;overflow:auto;margin:8px 0;min-width:320px;';
    this.wrap.appendChild(this.listEl);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;';
    this.statusLabel = document.createElement('span');
    this.statusLabel.style.cssText = 'flex:1;font-size:12px;';
    const fixBtn = document.createElement('button');
    fixBtn.className = 'dialog-btn';
    fixBtn.textContent = '바꾸기';
    fixBtn.addEventListener('click', () => this.applySelected());
    const rescanBtn = document.createElement('button');
    rescanBtn.className = 'dialog-btn';
    rescanBtn.textContent = '다시 검사';
    rescanBtn.addEventListener('click', () => this.rescan());
    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialog-btn';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', () => this.hide());
    row.append(this.statusLabel, fixBtn, rescanBtn, closeBtn);
    this.wrap.appendChild(row);
  }

  /** 문서를 다시 훑어 목록을 갱신한다 */
  rescan(): void {
    const ih = this.services.getInputHandler() as any;
    if (!ih) return;
    this.hits = scanDocument(ih.wasm);
    this.selected = this.hits.length ? 0 : -1;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    this.hits.forEach((h, i) => {
      const item = document.createElement('div');
      item.className = 'spell-item';
      item.style.cssText =
        `padding:4px 6px;cursor:pointer;font-size:12px;${i === this.selected ? 'background:rgba(0,120,255,.15);' : ''}`;
      item.textContent = `“${h.text}” — ${h.msg}${h.suggestion ? ` → ${h.suggestion}` : ''}`;
      item.addEventListener('click', () => { this.selected = i; this.renderList(); this.gotoSelected(); });
      this.listEl.appendChild(item);
    });
    this.statusLabel.textContent = this.hits.length
      ? `${this.hits.length}건 발견`
      : '맞춤법 오류가 없습니다.';
  }

  /** 선택 항목 위치로 커서를 옮기고 그 범위를 선택 표시한다 */
  private gotoSelected(): void {
    const h = this.hits[this.selected];
    const ih = this.services.getInputHandler() as any;
    if (!h || !ih) return;
    try {
      ih.cursor.moveTo({
        sectionIndex: h.sectionIndex, paragraphIndex: h.paragraphIndex, charOffset: h.charOffset,
      });
      ih.cursor.setAnchor();
      ih.cursor.moveTo({
        sectionIndex: h.sectionIndex, paragraphIndex: h.paragraphIndex,
        charOffset: h.charOffset + h.length,
      });
      ih.active = true;
      ih.updateCaret?.();
      ih.updateSelection?.();
    } catch { /* 위치가 사라졌으면 다음 검사에서 정리된다 */ }
  }

  /** 선택 항목을 제안대로 바꾼다 — 이후 좌표가 밀리므로 재검사한다 */
  applySelected(): void {
    const h = this.hits[this.selected];
    const ih = this.services.getInputHandler() as any;
    if (!h || !ih || h.suggestion == null) return;
    try {
      ih.executeOperation({
        kind: 'snapshot',
        operationType: 'spellFix',
        operation: (wasm: any) => {
          wasm.replaceText(h.sectionIndex, h.paragraphIndex, h.charOffset, h.length, h.suggestion);
          return ih.cursor.getPosition();
        },
      });
      ih.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[spell] 교정 실패:', err);
    }
    // 한 건 고치면 같은 문단 뒤쪽 히트의 오프셋이 밀린다 → 통째로 재검사(가장 안전)
    this.rescan();
  }
}
