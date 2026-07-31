/**
 * 서식 규정 검사 — 「우리 센터 서식」과 다른 곳을 찾아낸다.
 * 스펙: studio `docs/plans/format-linter.md` (2차 = 규칙 5종)
 *
 * 맞춤법(ui/spell-dialog.ts)과 **같은 파이프라인**을 탄다: 여기서도 위반 하나 =
 * `{문단, 시작, 끝, 메시지, 고침}` 한 건이고, 밑줄·카드·적용은 lint/overlay.ts 가 맡는다.
 *
 * ⚠ 오탐이 나면 규칙을 느슨하게 고치지 말고 **뺀다**(스펙 중단 규칙).
 * 검사기는 오탐 하나가 신뢰를 통째로 깎는다.
 */
import type { CharProperties } from '@/core/types';

/** 센터 기본 서식 1벌 — 3차에서 센터별 편집으로 갈아끼운다(지금은 코드가 정본). */
export interface FormatSpec {
  /** 본문 글꼴 */
  fontName: string;
  /** 본문 글자 크기(pt) */
  bodyPt: number;
  /**
   * 표 안 글자 최대 크기(pt).
   * ⚠ 기본값을 본문과 같은 10 으로 둔다 — 9 로 두면 **새로 만든 표가 전부 지적**된다
   *   (엔진 기본 표 글자가 10pt). 규칙이 늘 켜져 있으면 아무도 안 본다.
   *   센터 규격이 9pt 라면 3차(센터별 규격 편집)에서 낮춘다.
   */
  tableMaxPt: number;
  /** 표 머리글(첫 행)은 굵게 */
  headerBold: boolean;
  /** 이 글자 수 이상인 문단을 통째로 굵게 하면 지적 — 짧은 제목 줄은 봐준다 */
  boldBodyMinChars: number;
}

export const DEFAULT_SPEC: FormatSpec = {
  fontName: '함초롬바탕',
  bodyPt: 10,
  tableMaxPt: 10,
  headerBold: true,
  boldBodyMinChars: 30,
};

/** 셀 좌표 — 표 안 위반의 밑줄을 그리는 데 필요하다 */
export interface CellRef { ppi: number; ci: number; cei: number; cpi: number }

export interface FormatHit {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  length: number;
  msg: string;
  /** 사용자에게 보여줄 "지금 → 규격" */
  detail: string;
  /** 고침 = 이 글자 속성을 그 범위에 적용 */
  props: Partial<CharProperties>;
  cell?: CellRef;
}

interface W {
  getSectionCount?(): number;
  getParagraphCount(sec: number): number;
  getParagraphLength(sec: number, para: number): number;
  getCharPropertiesAt(sec: number, para: number, off: number): CharProperties;
  getTables(sec: number): Array<{ para: number; controlIdx: number; rowCount: number; colCount: number }>;
  getTableCellBboxes(sec: number, ppi: number, ci: number): Array<{ cellIdx: number; row: number; col: number }>;
  getCellParagraphLength(sec: number, ppi: number, ci: number, cei: number, cpi: number): number;
  getCellCharPropertiesAt(sec: number, ppi: number, ci: number, cei: number, cpi: number, off: number): CharProperties;
}

/** 한 문단을 서식이 바뀌는 지점으로 잘라 구간 목록을 만든다(지수 점프 + 이분 탐색). */
function runsOf(w: W, sec: number, para: number, len: number): Array<{ from: number; to: number; p: CharProperties }> {
  const out: Array<{ from: number; to: number; p: CharProperties }> = [];
  const cache = new Map<number, string>();
  const sig = (off: number): string => {
    const hit = cache.get(off);
    if (hit !== undefined) return hit;
    const p = w.getCharPropertiesAt(sec, para, off);
    const v = `${p.fontSize}|${p.bold}|${(p as { fontFamily?: string }).fontFamily ?? ''}`;
    cache.set(off, v);
    return v;
  };
  let i = 0;
  // 구간이 이보다 많은 문단은 서식이 뒤죽박죽이라 지적해도 도움이 안 된다 — 앞쪽만 본다.
  const MAX_RUNS = 12;
  while (i < len && out.length < MAX_RUNS) {
    const s0 = sig(i);
    let j = i;
    let step = 1;
    while (j + step < len && sig(j + step) === s0) { j += step; step *= 2; }
    let lo = j;
    let hi = Math.min(j + step, len - 1);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sig(mid) === s0) lo = mid; else hi = mid - 1;
    }
    out.push({ from: i, to: lo + 1, p: w.getCharPropertiesAt(sec, para, i) });
    i = lo + 1;
  }
  return out;
}

function famOf(p: CharProperties): string {
  const x = p as unknown as { fontFamily?: string; fontFamilies?: string[] };
  return String(x.fontFamily ?? x.fontFamilies?.[0] ?? '');
}

/** 문서 전체를 서식 규격으로 훑는다. 표 밖 문단 + 표 셀 둘 다. */
export function scanFormat(w: W, spec: FormatSpec = DEFAULT_SPEC): FormatHit[] {
  const hits: FormatHit[] = [];
  const secCount = w.getSectionCount?.() ?? 1;
  for (let sec = 0; sec < secCount; sec++) {
    scanBody(w, spec, sec, hits);
    scanTables(w, spec, sec, hits);
  }
  return hits;
}

function scanBody(w: W, spec: FormatSpec, sec: number, hits: FormatHit[]): void {
  const paraCount = w.getParagraphCount(sec);
  for (let para = 0; para < paraCount; para++) {
    let len = 0;
    try { len = w.getParagraphLength(sec, para); } catch { continue; }
    if (!len) continue;
    let runs: Array<{ from: number; to: number; p: CharProperties }> = [];
    try { runs = runsOf(w, sec, para, len); } catch { continue; }

    for (const r of runs) {
      const base = { sectionIndex: sec, paragraphIndex: para, charOffset: r.from, length: r.to - r.from };
      const fam = famOf(r.p);
      if (fam && fam !== spec.fontName) {
        hits.push({ ...base, msg: '본문 글꼴이 규격과 다릅니다',
          detail: `${fam} → ${spec.fontName}`, props: { fontFamily: spec.fontName } as Partial<CharProperties> });
      }
      const pt = r.p.fontSize !== undefined ? r.p.fontSize / 100 : spec.bodyPt;
      if (pt !== spec.bodyPt) {
        hits.push({ ...base, msg: '본문 글자 크기가 규격과 다릅니다',
          detail: `${pt}pt → ${spec.bodyPt}pt`, props: { fontSize: spec.bodyPt * 100 } });
      }
      // 굵게는 제목 줄에 정당하게 쓰인다 — 긴 문장을 통째로 굵게 한 것만 지적한다.
      if (r.p.bold && r.to - r.from >= spec.boldBodyMinChars) {
        hits.push({ ...base, msg: '본문을 길게 굵게 쓰지 않습니다',
          detail: '굵게 → 보통', props: { bold: false } });
      }
    }
  }
}

function scanTables(w: W, spec: FormatSpec, sec: number, hits: FormatHit[]): void {
  let tables: Array<{ para: number; controlIdx: number }> = [];
  try { tables = w.getTables(sec); } catch { return; }
  for (const t of tables) {
    let cells: Array<{ cellIdx: number; row: number }> = [];
    try { cells = w.getTableCellBboxes(sec, t.para, t.controlIdx); } catch { continue; }
    const seen = new Set<number>();
    for (const c of cells) {
      if (seen.has(c.cellIdx)) continue;
      seen.add(c.cellIdx);
      // 셀 첫 문단의 첫 글자만 본다 — 셀 전체를 구간 분해하면 표 하나에 수백 회 조회가 된다.
      // (v1 한계: 셀 중간부터 다른 서식이면 놓친다. 놓친 것은 커서를 넣으면 패널이 잡는다.)
      let len = 0;
      try { len = w.getCellParagraphLength(sec, t.para, t.controlIdx, c.cellIdx, 0); } catch { continue; }
      if (!len) continue;
      let p: CharProperties;
      try { p = w.getCellCharPropertiesAt(sec, t.para, t.controlIdx, c.cellIdx, 0, 0); } catch { continue; }
      const cell: CellRef = { ppi: t.para, ci: t.controlIdx, cei: c.cellIdx, cpi: 0 };
      const base = { sectionIndex: sec, paragraphIndex: t.para, charOffset: 0, length: len, cell };

      if (spec.headerBold && c.row === 0 && !p.bold) {
        hits.push({ ...base, msg: '표 머리글은 굵게 씁니다', detail: '보통 → 굵게', props: { bold: true } });
      }
      const pt = p.fontSize !== undefined ? p.fontSize / 100 : spec.tableMaxPt;
      if (pt > spec.tableMaxPt) {
        hits.push({ ...base, msg: '표 안 글자가 규격보다 큽니다',
          detail: `${pt}pt → ${spec.tableMaxPt}pt`, props: { fontSize: spec.tableMaxPt * 100 } });
      }
    }
  }
}
