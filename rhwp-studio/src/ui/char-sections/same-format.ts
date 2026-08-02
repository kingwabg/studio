/**
 * 「같은 서식」 고르기·바꾸기 — "이 문서에서 빨간 굵은 글씨만 전부 찾아 한 번에 바꾸기".
 *
 * 새 엔진 로직은 없다. 구간 탐색은 selection-summary 의 `scanFormatRuns` 를 그대로 쓰고,
 * 서식 적용은 `deps.applyChar`(= emit 'format-char') 한 경로만 탄다.
 *
 * ⚠ 재사용 방식이 한 군데 비틀려 있으니 먼저 읽어라:
 *   `scanFormatRuns` 는 **선택 범위**만 훑는다(문서 전체 스캔 API 가 없다). 그래서 문단마다
 *   "그 문단 전체가 선택된 척" 하는 가짜 CursorLike 를 만들어 넘긴다. 이러면 문단 단위로
 *   예산(구간 8·호출 400)이 새로 잡혀 문서를 끝까지 훑을 수 있고, 문단 경계를 넘는 구간 병합이
 *   생기지 않아 `selectRun`(문단 안 from~to 만 다룬다) 과도 아귀가 맞는다.
 *
 * 알려진 천장(정직하게 화면에도 적는다):
 *  - 커서가 있는 **한 구역(section)** 만 훑는다. `selectRun` 이 run 의 구역이 아니라 커서의
 *    구역으로 이동하므로, 여러 구역을 섞어 모으면 엉뚱한 자리를 잡는다.
 *  - 문단 하나에 서식 구간이 8개를 넘으면 스캐너가 앞부분만 준다(상한이 모듈 상수라 못 바꾼다).
 *  - 표(셀) 안 글자는 못 센다. 배관(`parentParaIndex` 좌표계)이 없다.
 */
import type { CharProperties } from '@/core/types';
import { scanFormatRuns, selectRun, type FormatRun } from '../selection-summary';
import { mkButton, mkEl } from '../canva-dom';
import type { CharSectionDeps } from './types';

/** 세는 구간 상한. 넘으면 조용히 자르지 않고 "앞에서부터 N군데"라고 밝힌다. */
const MAX_RUNS = 500;
/** 훑는 문단 상한 — 문단당 wasm 호출이 수십 번이라 무한정 돌 수는 없다. */
const MAX_PARAS = 3000;
/** 목록으로 보여 줄 개수(그 이상은 패널에서 읽히지 않는다). */
const PREVIEW = 20;

/**
 * 서식 동일성 키. selection-summary 의 비공개 `sig()` 와 **같은 필드**를 본다
 * (그쪽이 export 되지 않아 어쩔 수 없이 한 벌 더 둔다 — 필드가 늘면 같이 고쳐야 한다).
 */
function fmtKey(p: CharProperties): string {
  return [
    p.bold, p.italic, p.underline, p.strikethrough, p.fontSize, p.textColor,
    p.fontFamily ?? p.fontFamilies?.[0], p.shadeColor,
  ].join('|');
}

/** 사람이 읽는 한 줄 요약. 기본값(검정·형광펜 없음)은 말하지 않는다 — 소음이다. */
function describeFormat(p: CharProperties): string {
  const bits: string[] = [];
  const fam = p.fontFamily ?? p.fontFamilies?.[0];
  if (fam) bits.push(String(fam));
  if (p.fontSize) bits.push(`${p.fontSize / 100}pt`);
  if (p.bold) bits.push('굵게');
  if (p.italic) bits.push('기울임');
  if (p.underline) bits.push('밑줄');
  if (p.strikethrough) bits.push('취소선');
  if (p.textColor && p.textColor.toLowerCase() !== '#000000') bits.push(`글자색 ${p.textColor}`);
  if (p.shadeColor && p.shadeColor.toLowerCase() !== '#ffffff') bits.push(`형광펜 ${p.shadeColor}`);
  return bits.join(' · ') || '기본 서식';
}

/** 문단 전체가 선택된 척하는 가짜 커서 — `scanFormatRuns` 를 문단 스캐너로 쓰기 위한 어댑터. */
function paraCursor(sec: number, para: number, len: number) {
  const at = (charOffset: number) => ({ sectionIndex: sec, paragraphIndex: para, charOffset });
  return {
    hasSelection: () => true,
    getSelectionOrdered: () => ({ start: at(0), end: at(len) }),
  };
}

interface ScanResult {
  hits: FormatRun[];
  /** 상한에 걸려 그만뒀다(더 있을 수 있다) */
  capped: boolean;
  /** 어떤 문단은 앞부분만 훑었다(스캐너 자체 상한) */
  partial: boolean;
}

/** 한 구역을 문단마다 훑어 같은 서식 구간을 모은다. */
function scanSection(w: unknown, sec: number, key: string): ScanResult {
  const ww = w as {
    getParagraphCount(sec: number): number;
    getLogicalLength(sec: number, para: number): number;
  };
  const hits: FormatRun[] = [];
  let capped = false;
  let partial = false;

  let total = 0;
  try { total = ww.getParagraphCount(sec); } catch { return { hits, capped, partial }; }
  const limit = Math.min(total, MAX_PARAS);
  if (limit < total) capped = true;

  for (let para = 0; para < limit; para++) {
    let len = 0;
    try { len = ww.getLogicalLength(sec, para); } catch { continue; }
    if (len <= 0) continue;
    const scan = scanFormatRuns(paraCursor(sec, para, len), w as never);
    if (scan.truncated) partial = true;
    for (const run of scan.runs) {
      if (fmtKey(run.props) !== key) continue;
      if (hits.length >= MAX_RUNS) return { hits, capped: true, partial };
      hits.push(run);
    }
  }
  return { hits, capped, partial };
}

export function buildSameFormatSection(host: HTMLElement, deps: CharSectionDeps): void {
  const sec = deps.section('같은 서식');
  // 계약상 section() 이 host 에 붙여 주지만, 안 붙었으면 통째로 안 보인다 — 싸게 방어한다.
  if (!sec.parentNode) host.appendChild(sec);

  const wasm = deps.services.wasm as unknown as {
    getCharPropertiesAt(s: number, p: number, o: number): CharProperties;
    getLogicalLength(s: number, p: number): number;
  };
  const ih = deps.services.getInputHandler() as any;
  const cursor = ih?.cursor;

  /**
   * 기준 서식은 **문서에서 다시 읽는다**. deps.charProps 는 대기 서식이 섞일 수 있어
   * 스캔 결과(같은 getCharPropertiesAt)와 키가 어긋나 "0군데"가 나올 수 있다.
   */
  const readTarget = (): { sec: number; props: CharProperties } | null => {
    const pos = cursor?.getPosition?.();
    if (!pos || pos.parentParaIndex !== undefined) return null; // 셀 안은 배관 없음
    const selStart = cursor?.hasSelection?.() ? cursor.getSelectionOrdered?.()?.start : null;
    const p = selStart ?? pos;
    try {
      const len = wasm.getLogicalLength(p.sectionIndex, p.paragraphIndex);
      if (len <= 0) return null;
      // 커서가 문단 끝이면 앞 글자를 본다(그 자리에 글자가 없다).
      const off = Math.min(Math.max(0, p.charOffset), len - 1);
      return { sec: p.sectionIndex, props: wasm.getCharPropertiesAt(p.sectionIndex, p.paragraphIndex, off) };
    } catch {
      return null;
    }
  };

  const target = readTarget();
  const summary = mkEl('div', 'canva-hint',
    target ? describeFormat(target.props) : (deps.charProps ? describeFormat(deps.charProps) : '커서를 글자 위에 두세요.'));
  summary.style.color = 'var(--color-text)';
  sec.appendChild(summary);

  const findRow = mkEl('div', 'canva-chip-row');
  const findBtn = mkButton('canva-chip', { text: '같은 서식 찾기' });
  findRow.appendChild(findBtn);
  sec.appendChild(findRow);

  const status = mkEl('div', 'canva-hint');
  sec.appendChild(status);

  const list = mkEl('div', 'canva-chip-row');
  sec.appendChild(list);

  const actions = mkEl('div', 'canva-chip-row');
  const unboldBtn = mkButton('canva-chip', { text: '굵기 해제' });
  const blackBtn = mkButton('canva-chip', { text: '글자색 검정' });
  actions.append(unboldBtn, blackBtn);
  actions.hidden = true;
  sec.appendChild(actions);

  const undoNote = mkEl('div', 'canva-hint', '되돌리기(Ctrl+Z)는 구간 수만큼 눌러야 할 수 있습니다.');
  undoNote.hidden = true;
  sec.appendChild(undoNote);

  // ⚠ target 이 없다고 여기서 버튼을 잠그면 안 된다 — 이 섹션은 **탭을 열 때 한 번** 그려지고
  //   커서가 움직여도 다시 안 그려진다. 문서가 비었을 때 열었다면 영영 잠긴 채로 남는다
  //   (실측 2026-08-03: 글을 쓰고 커서를 올려도 "커서를 글자 위에 두세요"가 안 사라졌다).
  //   그래서 **누를 때마다 커서를 다시 읽는다**.
  let hits: FormatRun[] = [];

  /** 버튼은 mousedown+preventDefault — 포커스가 편집기를 떠나면 format-char 가 무시된다. */
  const onPress = (b: HTMLButtonElement, fn: () => void) => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); if (!b.disabled) fn(); });
  };

  const paint = (r: ScanResult): void => {
    hits = r.hits;
    list.replaceChildren();
    const notes: string[] = [];
    if (r.capped) notes.push(`앞에서부터 ${MAX_RUNS.toLocaleString('ko-KR')}군데까지만 셌습니다 — 더 있을 수 있습니다`);
    if (r.partial) notes.push('서식이 잘게 쪼개진 문단은 앞부분만 훑었습니다');
    const head = hits.length === 0 ? '같은 서식이 이 구역에 없습니다.' : `${hits.length.toLocaleString('ko-KR')}군데`;
    status.textContent = notes.length ? `${head} (${notes.join(' · ')})` : head;

    for (const run of hits.slice(0, PREVIEW)) {
      const chip = mkButton('canva-chip', {
        text: `${run.para + 1}문단 · ${run.sample}`,
        title: `${run.para + 1}번째 문단 ${run.from}~${run.to} (${run.len}자)`,
      });
      onPress(chip, () => selectRun(ih, cursor, run));
      list.appendChild(chip);
    }
    if (hits.length > PREVIEW) {
      list.appendChild(mkEl('span', 'canva-hint', `외 ${hits.length - PREVIEW}군데`));
    }
    actions.hidden = hits.length === 0;
    undoNote.hidden = hits.length === 0;
    unboldBtn.textContent = `굵기 해제 (${hits.length})`;
    blackBtn.textContent = `글자색 검정 (${hits.length})`;
  };

  onPress(findBtn, () => {
    // 누르는 순간의 커서를 기준으로 삼는다(빌드 시점 값은 낡았을 수 있다).
    const now = readTarget();
    if (!now) {
      status.textContent = '커서를 글자 위에 두고 다시 눌러 주세요.';
      return;
    }
    summary.textContent = describeFormat(now.props);
    status.textContent = '찾는 중…';
    const key = fmtKey(now.props);
    // 스캔은 동기라 화면이 멎는다 — 한 틱 미뤄 "찾는 중"이 먼저 그려지게 한다.
    setTimeout(() => paint(scanSection(deps.services.wasm, now.sec, key)), 0);
  });

  /** 찾은 구간을 하나씩 골라 같은 패치를 건다(구간마다 커맨드 1개 = 되돌리기 1회). */
  const applyAll = (patch: Partial<CharProperties>): void => {
    if (hits.length === 0) return;
    const back = cursor?.getPosition?.();
    for (const run of hits) {
      selectRun(ih, cursor, run);
      deps.applyChar(patch);
    }
    if (back) {
      cursor?.clearSelection?.();
      cursor?.moveTo?.(back);
      ih?.updateSelection?.();
      ih?.updateCaret?.();
    }
    status.textContent = `${hits.length.toLocaleString('ko-KR')}군데에 적용했습니다.`;
  };

  onPress(unboldBtn, () => applyAll({ bold: false }));
  onPress(blackBtn, () => applyAll({ textColor: '#000000' }));
}
