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

export interface SpellRule {
  /** 전역 정규식 — 반드시 g 플래그 */
  re: RegExp;
  /** 사용자에게 보일 설명 */
  msg: string;
  /** 바꿀 문자열(정규식 치환 형식). 없으면 안내만 하고 자동 교정은 제공하지 않는다 */
  fix?: string;
}

/**
 * 규칙 목록 — 오탐이 적은 것만 담는다. "가끔 맞는 규칙"은 넣지 않는다:
 * 맞춤법 검사기는 오탐 하나가 신뢰를 통째로 깎는다.
 */
export const SPELL_RULES: SpellRule[] = [
  { re: /  +/g, msg: '연속 공백', fix: ' ' },
  { re: /\s+([,.!?])/g, msg: '문장부호 앞 공백', fix: '$1' },
  { re: /([,])(?=\S)/g, msg: '쉼표 뒤 공백 누락', fix: '$1 ' },
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
];

export interface SpellHit {
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
