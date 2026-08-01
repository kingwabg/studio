/**
 * 선택 요약 — 우측 패널 배너의 "무엇이 걸려 있나" 한 줄.
 *
 * [2026-07-31 사용자 지적] 종전엔 커서 위치 문단만 말해서, Ctrl+A 로 문서를 통째로
 * 잡아도 "2번째 문단"이라고 표시했다. 배너의 존재 이유는 **이 패널의 서식이 어디에
 * 걸리는가**를 알려주는 것이므로 선택을 반영해야 한다.
 *
 * 한컴 상태바 오라클(웹한글 실측): 선택하면 `111/153 글자` — 선택 글자수/전체.
 * 문단 번호는 안 준다. 우리는 한 화면에서 **글자 서식(선택 글자에 걸림)** 과
 * **문단 모양(문단 전체에 걸림)** 을 같이 다루므로 두 축을 함께 적는다:
 *   선택 없음 → `1쪽 · 2번째 문단`  ·  한 문단 부분 → `2번째 문단 · 45자`
 *   여러 문단 → `2~4번째 문단 · 118자`
 */
import type { CharProperties } from '@/core/types';

/** 문단 수가 이보다 많으면 글자 수 합산을 생략한다(배너는 커서 이동마다 다시 그린다). */
const COUNT_LIMIT = 200;

interface Pos {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  parentParaIndex?: number;
}

interface WasmLike {
  getLogicalLength(sec: number, para: number): number;
  getCharPropertiesAt(sec: number, para: number, off: number): CharProperties;
  getPageOfPosition?: (sec: number, para: number) => { ok: boolean; page?: number | null };
  logicalToTextOffset?: (sec: number, para: number, off: number) => number;
  getTextRange?: (sec: number, para: number, off: number, count: number) => string;
}

/** 선택 안의 「서식 조각」 — 같은 글자 서식이 이어지는 한 구간. */
export interface FormatRun {
  /** 구간 시작(문단, 논리 오프셋) */
  para: number;
  from: number;
  /** 구간 끝(exclusive) — 문단을 넘지 않는다 */
  to: number;
  /** 글자 수 */
  len: number;
  /** 이 구간의 글자 서식(칩을 이 서식 그대로 그린다) */
  props: CharProperties;
  /** 미리보기용 앞글자 몇 자(없으면 '가') */
  sample: string;
  /** 구간의 실제 글자(견본용 — 칩에는 sample 을 쓴다) */
  text?: string;
}

interface CursorLike {
  getPosition?: () => Pos | undefined;
  hasSelection?: () => boolean;
  getSelectionOrdered?: () => { start: Pos; end: Pos } | null;
  clearSelection?: () => void;
  moveTo?: (pos: Pos) => void;
  setAnchor?: () => void;
}

/**
 * 서식 조각 하나만 선택한다(칩 클릭).
 * ⚠ setAnchor 는 **기존 앵커를 유지**하는 시맨틱(Shift+클릭 확장)이라 먼저 지워야
 * 시작점이 이전 선택에 묶이지 않는다 — 실측으로 겪은 함정.
 */
export function selectRun(
  ih: { updateSelection?: () => void; updateCaret?: () => void },
  cursor: CursorLike,
  run: FormatRun,
): void {
  const sec = cursor.getPosition?.()?.sectionIndex ?? 0;
  cursor.clearSelection?.();
  cursor.moveTo?.({ sectionIndex: sec, paragraphIndex: run.para, charOffset: run.from });
  cursor.setAnchor?.();
  cursor.moveTo?.({ sectionIndex: sec, paragraphIndex: run.para, charOffset: run.to });
  ih.updateSelection?.();
  ih.updateCaret?.();
}

/** 본문 선택의 글자 수. 셀 안 선택은 규격이 달라 null. */
function countChars(w: WasmLike, s: Pos, e: Pos): number | null {
  if (s.parentParaIndex !== undefined || e.parentParaIndex !== undefined) return null;
  if (s.paragraphIndex === e.paragraphIndex) return Math.max(0, e.charOffset - s.charOffset);
  if (e.paragraphIndex - s.paragraphIndex > COUNT_LIMIT) return null;
  try {
    let n = Math.max(0, w.getLogicalLength(s.sectionIndex, s.paragraphIndex) - s.charOffset);
    for (let p = s.paragraphIndex + 1; p < e.paragraphIndex; p++) {
      n += w.getLogicalLength(s.sectionIndex, p);
    }
    return n + Math.max(0, e.charOffset);
  } catch {
    return null;
  }
}

/** 본문 배너 문구. 선택이 없으면 커서 문단, 있으면 걸친 범위 + 글자 수. */
export function describeBodySelection(cursor: CursorLike, w: WasmLike): string {
  const pos = cursor.getPosition?.();
  if (!pos) return '';
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;

  if (!sel) {
    const page = w.getPageOfPosition?.(pos.sectionIndex, pos.paragraphIndex);
    const p = page?.ok && page.page != null ? `${page.page + 1}쪽 · ` : '';
    return `${p}${pos.paragraphIndex + 1}번째 문단`;
  }

  const { start, end } = sel;
  const span = start.paragraphIndex === end.paragraphIndex
    ? `${start.paragraphIndex + 1}번째 문단`
    : `${start.paragraphIndex + 1}~${end.paragraphIndex + 1}번째 문단`;
  const n = countChars(w, start, end);
  // 쪽 접두는 선택에선 뺀다 — 여러 쪽에 걸치면 한 쪽 번호가 거짓이 된다.
  return n === null ? span : `${span} · ${n.toLocaleString('ko-KR')}자`;
}

/** 글자 서식 동일성 판정에 쓰는 서명(값이 같으면 같은 서식으로 본다). */
function sig(p: CharProperties): string {
  const q = p as unknown as Record<string, unknown>;
  return [
    p.bold, p.italic, p.underline, p.strikethrough, p.fontSize, p.textColor,
    q.fontFamily ?? (q.fontFamilies as string[] | undefined)?.[0], q.shadeColor,
  ].join('|');
}

/**
 * 선택 안에 서로 다른 글자 서식이 섞였는가.
 *
 * 전수 비교는 비싸다(배너는 커서 이동마다 갱신) — **표본**으로 판정한다:
 * 선택 시작·끝, 그리고 걸친 문단들의 첫 글자. 표본이 다르면 확실히 섞인 것이고,
 * 같아도 중간이 다를 수 있다(거짓 음성은 견본이 커서 값을 보여주는 종전과 같다).
 */
export function detectMixedFormat(cursor: CursorLike, w: WasmLike): boolean {
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;
  if (!sel) return false;
  const { start, end } = sel;
  if (start.parentParaIndex !== undefined) return false;
  try {
    const samples: string[] = [sig(w.getCharPropertiesAt(start.sectionIndex, start.paragraphIndex, start.charOffset))];
    const last = Math.min(end.paragraphIndex, start.paragraphIndex + COUNT_LIMIT);
    for (let p = start.paragraphIndex + 1; p <= last; p++) {
      samples.push(sig(w.getCharPropertiesAt(start.sectionIndex, p, 0)));
    }
    if (end.charOffset > 0) {
      samples.push(sig(w.getCharPropertiesAt(end.sectionIndex, end.paragraphIndex, Math.max(0, end.charOffset - 1))));
    }
    return new Set(samples).size > 1;
  } catch {
    return false;
  }
}


/** 스캔 상한 — 배너는 커서 이동마다 갱신된다. 넘으면 잘라서 돌려준다. */
const SCAN_PARAS = 20;
const SCAN_RUNS = 8;
const SCAN_CALLS = 400;

/**
 * 선택을 훑어 **서식이 바뀌는 지점**만 끊어 구간 목록을 만든다.
 *
 * 글자마다 조회하면 긴 선택에서 수천 번 호출된다 — 서식 구간은 연속이므로
 * 지수 도약 + 이진 탐색으로 경계만 찾는다(구간 하나당 ~2·log n 회).
 * 상한(문단 20 · 구간 8 · 호출 400)을 넘으면 truncated=true 로 알린다.
 */
export function scanFormatRuns(
  cursor: CursorLike,
  w: WasmLike,
): { runs: FormatRun[]; truncated: boolean } {
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;
  if (!sel || sel.start.parentParaIndex !== undefined) return { runs: [], truncated: false };
  const { start, end } = sel;
  const sec = start.sectionIndex;

  let calls = 0;
  const cache = new Map<string, string>();
  const propsAt = (para: number, off: number): CharProperties => {
    calls++;
    return w.getCharPropertiesAt(sec, para, off);
  };
  const sigAt = (para: number, off: number): string => {
    const key = `${para}:${off}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const v = sig(propsAt(para, off));
    cache.set(key, v);
    return v;
  };

  const runs: FormatRun[] = [];
  let truncated = false;
  const lastPara = Math.min(end.paragraphIndex, start.paragraphIndex + SCAN_PARAS);
  if (lastPara < end.paragraphIndex) truncated = true;

  try {
    for (let para = start.paragraphIndex; para <= lastPara; para++) {
      const from = para === start.paragraphIndex ? start.charOffset : 0;
      const to = para === end.paragraphIndex
        ? end.charOffset
        : w.getLogicalLength(sec, para);
      let i = from;
      while (i < to) {
        if (runs.length >= SCAN_RUNS || calls >= SCAN_CALLS) { truncated = true; break; }
        const s0 = sigAt(para, i);
        // 지수 도약으로 같은 서식의 끝을 넘어선 지점을 먼저 찾는다
        let j = i;
        let step = 1;
        while (j + step < to && sigAt(para, j + step) === s0) { j += step; step *= 2; }
        // 그 사이를 이진 탐색 — lo 가 같은 서식의 마지막 글자
        let lo = j;
        let hi = Math.min(j + step, to - 1);
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (sigAt(para, mid) === s0) lo = mid; else hi = mid - 1;
        }
        const runTo = lo + 1;
        const prev = runs[runs.length - 1];
        // 문단 경계에서 같은 서식이 이어지면 하나로 합친다(칩이 쪼개져 보이지 않게)
        if (prev && sig(prev.props) === s0 && prev.para === para - 1) {
          prev.len += runTo - i;
        } else {
          runs.push({ para, from: i, to: runTo, len: runTo - i, props: propsAt(para, i), sample: '' });
        }
        i = runTo;
      }
      if (runs.length >= SCAN_RUNS || calls >= SCAN_CALLS) break;
    }
    // 칩에 보일 앞글자 — 실제 글자가 있으면 그게 서식보다 잘 읽힌다
    for (const r of runs) {
      r.sample = sampleText(w, sec, r) || '가';
    }
  } catch {
    return { runs, truncated: true };
  }
  return { runs, truncated };
}

/** 구간 앞 2글자. 논리→텍스트 변환이 없으면 빈 문자열(호출부가 '가'로 대체). */
function sampleText(w: WasmLike, sec: number, r: FormatRun): string {
  if (!w.logicalToTextOffset || !w.getTextRange) return '';
  try {
    const t0 = w.logicalToTextOffset(sec, r.para, r.from);
    const t1 = w.logicalToTextOffset(sec, r.para, Math.min(r.to, r.from + 2));
    const n = Math.max(0, t1 - t0);
    return n > 0 ? w.getTextRange(sec, r.para, t0, n).trim() : '';
  } catch {
    return '';
  }
}


/** 견본에 넣을 글자 상한 — 패널이 좁아 그 이상은 읽히지 않는다. */
const SPECIMEN_CHARS = 90;

/**
 * 견본에 그릴 **실제 글자**를 구간별로 돌려준다(사용자 제안 2026-07-31).
 *
 * 선택이 있으면 선택분, 없으면 커서가 있는 문단. 한 가지 서식으로 뭉뚱그리면
 * 굵은 제목이 평범하게 보여 새로운 거짓말이 되므로, 구간마다 자기 서식을 달아
 * 돌려준다(호출부가 span 으로 그린다). 빈 문단이면 빈 배열 → 호출부가 예문으로 대체.
 */
export function currentTextRuns(
  cursor: CursorLike,
  w: WasmLike,
): { runs: FormatRun[]; truncated: boolean } {
  const pos = cursor.getPosition?.();
  if (!pos || pos.parentParaIndex !== undefined) return { runs: [], truncated: false };
  const sel = cursor.hasSelection?.() ? cursor.getSelectionOrdered?.() ?? null : null;

  const wholePara = (): { runs: FormatRun[]; truncated: boolean } => {
    let len = 0;
    try { len = w.getLogicalLength(pos.sectionIndex, pos.paragraphIndex); } catch { return { runs: [], truncated: false }; }
    if (len <= 0) return { runs: [], truncated: false };
    return scanRange(w, pos.sectionIndex, pos.paragraphIndex, 0, len);
  };

  let scan: { runs: FormatRun[]; truncated: boolean };
  if (sel) {
    scan = scanFormatRuns(cursor, w);
    // ⚠ 클릭하는 **순간**에는 길이 0 짜리 선택이 잡힌다 — 그때 빈 결과를 그대로
    //   내보내면 견본이 비었다가 다시 차며 깜빡였다(사용자 지적 2026-08-01
    //   "클릭할 때마다 로딩되듯이"). 빈 선택이면 문단을 보여준다.
    if (scan.runs.length === 0) scan = wholePara();
  } else {
    // 선택 없음 — 커서 문단 전체를 같은 방식으로 훑는다.
    scan = wholePara();
  }

  // 실제 글자 채우기 + 상한에서 자르기
  let budget = SPECIMEN_CHARS;
  const out: FormatRun[] = [];
  for (const r of scan.runs) {
    if (budget <= 0) { scan.truncated = true; break; }
    const take = Math.min(r.len, budget);
    const t = runText(w, pos.sectionIndex, r, take);
    if (t) out.push({ ...r, text: t });
    budget -= take;
    if (take < r.len) { scan.truncated = true; break; }
  }
  return { runs: out, truncated: scan.truncated };
}

/** 한 문단의 [from,to) 를 훑어 서식 구간으로 나눈다(scanFormatRuns 의 문단 1개 판). */
function scanRange(
  w: WasmLike, sec: number, para: number, from: number, to: number,
): { runs: FormatRun[]; truncated: boolean } {
  const runs: FormatRun[] = [];
  let truncated = false;
  let calls = 0;
  const cache = new Map<number, string>();
  const sigAt = (off: number): string => {
    const hit = cache.get(off);
    if (hit !== undefined) return hit;
    calls++;
    const v = sig(w.getCharPropertiesAt(sec, para, off));
    cache.set(off, v);
    return v;
  };
  try {
    let i = from;
    while (i < to) {
      if (runs.length >= SCAN_RUNS || calls >= SCAN_CALLS) { truncated = true; break; }
      const s0 = sigAt(i);
      let j = i;
      let step = 1;
      while (j + step < to && sigAt(j + step) === s0) { j += step; step *= 2; }
      let lo = j;
      let hi = Math.min(j + step, to - 1);
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (sigAt(mid) === s0) lo = mid; else hi = mid - 1;
      }
      const runTo = lo + 1;
      runs.push({
        para, from: i, to: runTo, len: runTo - i,
        props: w.getCharPropertiesAt(sec, para, i), sample: '',
      });
      i = runTo;
    }
  } catch {
    return { runs, truncated: true };
  }
  return { runs, truncated };
}

/** 구간 앞 n글자의 실제 텍스트. */
function runText(w: WasmLike, sec: number, r: FormatRun, n: number): string {
  if (!w.logicalToTextOffset || !w.getTextRange || n <= 0) return '';
  try {
    const t0 = w.logicalToTextOffset(sec, r.para, r.from);
    const t1 = w.logicalToTextOffset(sec, r.para, r.from + n);
    const count = Math.max(0, t1 - t0);
    return count > 0 ? w.getTextRange(sec, r.para, t0, count) : '';
  } catch {
    return '';
  }
}
