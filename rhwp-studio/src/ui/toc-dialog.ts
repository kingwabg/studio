/**
 * 차례(목차) 만들기 대화상자 — 한컴 [도구-차례/색인-차례 만들기] 대응.
 *
 * 원리: 엔진의 구조 추출(getStructure)로 제목 문단을 모으고, 각 제목의 쪽번호를
 * getPageOfPosition 으로 얻어 커서 위치에 목차 문단들을 넣는다. 엔진 수정 0.
 *
 * ⚠ 한계(조사 2026-07-28): 구조 추출의 개요 판정은 **스타일 이름이 아니라 문단모양의
 * 번호 속성**(head_type Outline|Number)이다. 그래서 "제목1" 스타일만 쓰고 번호문단이
 * 아닌 문서는 개요 노드가 0건이 된다 → 스타일 이름 폴백 수집을 함께 돌린다.
 */
import { ModalDialog } from './dialog';
import type { CommandServices } from '@/command/types';

export interface TocEntry {
  level: number;
  heading: string;
  section: number;
  paragraph: number;
  page: number | null;
}

/** 제목 스타일 이름으로 인식할 패턴 — 한컴 기본 스타일명 계열 */
const HEADING_STYLE_RE = /^(개요\s*\d|제목\s*\d?|목차\s*\d)$/;

/** 구조 추출(정본) + 스타일명 폴백으로 제목 문단을 모은다 */
export function collectHeadings(wasm: any, maxDepth: number): TocEntry[] {
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  const push = (level: number, heading: string, section: number, paragraph: number) => {
    if (level > maxDepth) return;
    const key = `${section}:${paragraph}`;
    if (seen.has(key) || !heading.trim()) return;
    seen.add(key);
    out.push({ level, heading: heading.trim(), section, paragraph, page: null });
  };

  // ① 엔진 구조 추출 — 'auto' 가 정본. 개요 번호 문단이 없는 실물 문서(예: 편람류)는
  //   outline 모드가 0건이고 조문(제N장/제N조) 인식이 필요하다(실측: 편람 outline 0 → auto 288).
  try {
    const tree = wasm.getStructure('auto');
    const walk = (nodes: any[]) => {
      for (const n of nodes ?? []) {
        // heading 에 이미 마커가 포함된 경우가 많다(실측: "제1장 행정업무…") → 중복 방지
        const h = String(n.heading ?? '').replace(/\s+/g, ' ').trim();
        const label = n.marker && !h.startsWith(n.marker) ? `${n.marker} ${h}` : h;
        push(n.level ?? 1, label, n.section, n.paragraph);
        if (n.children?.length) walk(n.children);
      }
    };
    // 엔진 반환 형태: {mode, node_count, preamble, roots[]} — roots 가 정본(실측 2026-07-28)
    walk(tree?.roots ?? tree?.nodes ?? []);
  } catch { /* 구조 추출 실패 시 폴백만으로 */ }

  // ② 스타일 이름 폴백 — 번호문단이 아닌 제목 스타일 문서 대비
  try {
    const secCount = wasm.getSectionCount?.() ?? 1;
    for (let sec = 0; sec < secCount; sec++) {
      const paraCount = wasm.getParagraphCount(sec);
      for (let para = 0; para < paraCount; para++) {
        let styleName = '';
        try { styleName = wasm.getStyleAt(sec, para)?.name ?? ''; } catch { continue; }
        const m = styleName.match(HEADING_STYLE_RE);
        if (!m) continue;
        const lvlDigit = styleName.match(/(\d)/);
        const level = lvlDigit ? parseInt(lvlDigit[1], 10) : 1;
        let text = '';
        try {
          const len = wasm.getParagraphLength(sec, para);
          text = len ? (wasm.getTextRange(sec, para, 0, len) ?? '').replace(/\s+/g, ' ') : '';
        } catch { continue; }
        push(level, text, sec, para);
      }
    }
  } catch { /* 폴백 실패는 무시 — ①만으로 진행 */ }

  out.sort((a, b) => a.section - b.section || a.paragraph - b.paragraph);

  // 쪽번호 채우기
  for (const e of out) {
    try {
      const r = wasm.getPageOfPosition(e.section, e.paragraph);
      e.page = r?.ok ? (r.page ?? null) : null;
    } catch { e.page = null; }
  }
  return out;
}

/** 목차 본문 문자열 — 수준별 들여쓰기 + 쪽번호 */
export function formatToc(entries: TocEntry[], showPage: boolean): string {
  return entries.map((e) => {
    const indent = '\t'.repeat(Math.max(0, e.level - 1));
    const page = showPage && e.page != null ? `\t${e.page}` : '';
    return `${indent}${e.heading}${page}`;
  }).join('\n');
}

export class TocDialog extends ModalDialog {
  private depthSelect!: HTMLSelectElement;
  private pageCheck!: HTMLInputElement;
  private previewEl!: HTMLTextAreaElement;

  constructor(private services: CommandServices) {
    super('차례 만들기', 460);
    this.titleIcon = 'list-dashes';
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'dialog-body';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';

    const depthLabel = document.createElement('label');
    depthLabel.textContent = '표시 수준';
    depthLabel.style.fontSize = '12px';
    this.depthSelect = document.createElement('select');
    for (let i = 1; i <= 7; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${i}수준까지`;
      this.depthSelect.appendChild(o);
    }
    this.depthSelect.value = '3';
    this.depthSelect.addEventListener('change', () => this.refresh());

    const pageWrap = document.createElement('label');
    pageWrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;';
    this.pageCheck = document.createElement('input');
    this.pageCheck.type = 'checkbox';
    this.pageCheck.checked = true;
    this.pageCheck.addEventListener('change', () => this.refresh());
    pageWrap.append(this.pageCheck, document.createTextNode('쪽 번호 표시'));

    row.append(depthLabel, this.depthSelect, pageWrap);
    body.appendChild(row);

    this.previewEl = document.createElement('textarea');
    this.previewEl.readOnly = true;
    this.previewEl.rows = 10;
    this.previewEl.style.cssText = 'width:100%;font-family:inherit;font-size:12px;resize:vertical;';
    body.appendChild(this.previewEl);

    this.refresh();
    return body;
  }

  private entries(): TocEntry[] {
    const ih = this.services.getInputHandler() as any;
    if (!ih) return [];
    return collectHeadings(ih.wasm, parseInt(this.depthSelect.value, 10));
  }

  private refresh(): void {
    const list = this.entries();
    this.previewEl.value = list.length
      ? formatToc(list, this.pageCheck.checked)
      : '제목으로 인식된 문단이 없습니다.\n(개요 번호 문단이나 "개요 N"·"제목 N" 스타일을 쓰면 잡힙니다)';
  }

  protected onConfirm(): void | boolean {
    const ih = this.services.getInputHandler() as any;
    const list = this.entries();
    if (!ih || list.length === 0) return true;
    const text = formatToc(list, this.pageCheck.checked);
    // 삽입은 검증된 붙여넣기 경로 재사용 → 되돌리기 자동 지원
    ih.insertPlainTextAtCursor(text);
    return true;
  }
}
