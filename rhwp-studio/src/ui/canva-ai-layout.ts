/**
 * [캔버스 한컴 포크] AI 문서 생성(캔버스식) — M3의 배치 계획(JSON)을 지면 요소로 실체화.
 * inline-ai의 "AI가 문서·표를 만들어 채움"을 캔버스 문법으로: 본문 타이핑이 아니라
 * A4(mm 좌표) 위에 글상자/표를 배치한다. 전부 기존 검증 API 재사용:
 * createShapeControl(글상자) · insertTextInCell/splitParagraphInCell(내용) ·
 * createTable+getTableBBox+moveTableOffset(표 생성·채움·위치). 한 번의 snapshot으로 Ctrl+Z 일괄 취소.
 */
import type { CanvaServices } from './canva-services';

export interface AiTextEl { type: 'text'; x: number; y: number; w: number; text: string; }
export interface AiTableEl { type: 'table'; x: number; y: number; rows: string[][]; }
export type AiLayoutEl = AiTextEl | AiTableEl;
export interface AiLayout { elements: AiLayoutEl[]; }

const MM_TO_HWP = 283.465; // 1mm = 283.465 HWPUNIT
const MM_TO_PX = 96 / 25.4; // 1mm = 3.7795px (bbox 좌표계)
const PX_TO_HWP = 75; // 1px = 75 HWPUNIT

/** 모델 출력에서 배치 JSON을 관대하게 파싱 (코드펜스/사족 방어) */
export function parseAiLayout(raw: string): AiLayout | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!Array.isArray(j.elements)) return null;
    const els: AiLayoutEl[] = [];
    for (const e of j.elements) {
      if (e?.type === 'text' && typeof e.text === 'string' && e.text.trim()) {
        els.push({ type: 'text', x: num(e.x, 20), y: num(e.y, 20), w: num(e.w, 170), text: e.text });
      } else if (e?.type === 'table' && Array.isArray(e.rows) && e.rows.length && Array.isArray(e.rows[0])) {
        const cols = Math.max(...e.rows.map((r: unknown[]) => (Array.isArray(r) ? r.length : 0)));
        if (cols < 1) continue;
        const rows = e.rows.map((r: unknown[]) =>
          Array.from({ length: cols }, (_, i) => String((Array.isArray(r) ? r[i] : '') ?? '')));
        els.push({ type: 'table', x: num(e.x, 20), y: num(e.y, 40), rows });
      }
    }
    return els.length ? { elements: els } : null;
  } catch {
    return null;
  }
}

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 배치 계획을 문서에 적용. 반환 = 실제 배치된 개수. */
export function applyAiLayout(services: CanvaServices, layout: AiLayout): { texts: number; tables: number } {
  const ih = services.getInputHandler() as any;
  const wasm = services.wasm;
  const done = { texts: 0, tables: 0 };
  if (!ih || wasm.pageCount === 0) return done;

  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'aiCanvasLayout',
    operation: () => {
      // phase A: 생성만 — 표는 인라인 컨트롤이라 다음 생성이 앞 표의 흐름 위치를 민다.
      //          (생성→즉시 이동을 반복하면 위치가 어긋난다 — 실측으로 확인된 함정)
      const pendingTables: AiTableEl[] = [];
      for (const el of layout.elements) {
        try {
          if (el.type === 'text') {
            placeText(wasm, el);
            done.texts++;
          } else {
            createAndFillTable(wasm, el);
            pendingTables.push(el);
          }
        } catch (e) {
          console.warn('[ai-layout] 요소 생성 실패:', el.type, e);
        }
      }
      // phase B: 흐름이 확정된 뒤 표 위치 일괄 해결
      done.tables = resolveTablePositions(wasm, pendingTables);
      return ih.cursor.getPosition();
    },
  });
  services.eventBus.emit('document-changed');
  return done;
}

/** 텍스트 요소 → floating 글상자 + 여러 문단 채움 */
function placeText(wasm: any, el: AiTextEl): void {
  const lines = el.text.split(/\r?\n/);
  const wMm = clamp(el.w, 20, 190);
  const hMm = Math.max(12, lines.length * 8 + 4); // 10pt·행간 160% 근사 8mm/줄
  const x = clamp(el.x, 0, 210 - wMm);
  const y = clamp(el.y, 0, 297 - hMm);
  const res = wasm.createShapeControl({
    sectionIdx: 0,
    paraIdx: 0,
    charOffset: 0,
    width: Math.round(wMm * MM_TO_HWP),
    height: Math.round(hMm * MM_TO_HWP),
    horzOffset: Math.round(x * MM_TO_HWP),
    vertOffset: Math.round(y * MM_TO_HWP),
    shapeType: 'textbox',
    treatAsChar: false,
    textWrap: 'InFrontOfText',
  });
  if (!res.ok) throw new Error('글상자 생성 실패');
  const ppi = res.paraIdx;
  const ci = res.controlIdx;
  // 줄마다: 삽입 → (마지막 줄 아니면) 그 끝에서 문단 분할
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]) wasm.insertTextInCell(0, ppi, ci, 0, k, 0, lines[k]);
    if (k < lines.length - 1) wasm.splitParagraphInCell(0, ppi, ci, 0, k, lines[k].length);
  }
}

/** phase A: 표 생성 + 셀 채움 (위치는 phase B에서) */
function createAndFillTable(wasm: any, el: AiTableEl): void {
  const r = el.rows.length;
  const c = el.rows[0].length;
  // 글자취급 아님(floating) 명시 — 위치는 phase B에서 Paper 기준 절대 오프셋으로 지정
  const res = wasm.createTableEx({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: r, colCount: c, treatAsChar: false });
  if (!res.ok) throw new Error('표 생성 실패');
  const ppi = res.paraIdx;
  const ci = res.controlIdx;
  // [캔버스 한컴 포크] AI 생성 표도 기본 테두리를 진한 검은 실선으로(엔진 기본 0.12mm가 흐림)
  wasm.applyDefaultTableBorders(0, ppi, ci);
  const bb: any[] = wasm.getTableCellBboxes(0, ppi, ci);
  const seen = new Set<number>();
  for (const b of bb) {
    if (seen.has(b.cellIdx)) continue;
    seen.add(b.cellIdx);
    const text = el.rows[b.row]?.[b.col] ?? '';
    if (text) wasm.insertTextInCell(0, ppi, ci, b.cellIdx, 0, 0, text);
  }
}

/** 문서의 모든 표를 현재 (paraIdx, controlIdx, x, y, 크기, 헤더셀)로 스캔 */
function scanTables(wasm: any): { ppi: number; ci: number; x: number; y: number; r: number; c: number; head: string }[] {
  const found: { ppi: number; ci: number; x: number; y: number; r: number; c: number; head: string }[] = [];
  const pageCount = Math.max(1, wasm.pageCount);
  for (let pg = 0; pg < pageCount; pg++) {
    let layout: any;
    try { layout = wasm.getPageControlLayout(pg); } catch { continue; }
    for (const ctrl of layout?.controls ?? []) {
      if (ctrl.type !== 'table') continue;
      try {
        const dims = wasm.getTableDimensions(0, ctrl.paraIdx, ctrl.controlIdx);
        const len = wasm.getCellParagraphLength(0, ctrl.paraIdx, ctrl.controlIdx, 0, 0);
        const head = len > 0 ? wasm.getTextInCell(0, ctrl.paraIdx, ctrl.controlIdx, 0, 0, 0, len) : '';
        found.push({ ppi: ctrl.paraIdx, ci: ctrl.controlIdx, x: ctrl.x, y: ctrl.y, r: dims.rowCount, c: dims.colCount, head });
      } catch { /* skip */ }
    }
  }
  return found;
}

/** phase B: 표 위치 지정 — Paper 기준 절대 오프셋(setTableProperties).
 *  ⚠ moveTableOffset(Para 기준 상대)은 앵커 문단의 자연 위치·restrictInPage에 클램프되어
 *  위쪽 이동이 무시된다(실측 함정: ok:true인데 렌더 불변, vertOffset만 음수로 누적).
 *  Paper 절대 지정 후 렌더 잔차(표 바깥여백 outerTop/Left ≈1mm)를 스캔으로 1회 보정한다. */
function resolveTablePositions(wasm: any, targets: AiTableEl[]): number {
  if (!targets.length) return 0;
  const TOL_PX = 1.2; // ≈0.3mm
  const done = new Set<AiTableEl>();
  // 각 target의 현재 설정 오프셋(HWPUNIT)을 기억해 잔차 보정에 사용
  const setOfs = new Map<AiTableEl, { h: number; v: number }>();
  for (let pass = 0; pass < 3; pass++) {
    const found = scanTables(wasm);
    const used = new Set<number>();
    let changed = false;
    for (const t of targets) {
      const headWant = t.rows[0][0] ?? '';
      let idx = found.findIndex((f, i) => !used.has(i) && f.r === t.rows.length && f.c === t.rows[0].length && f.head === headWant);
      if (idx < 0) idx = found.findIndex((f, i) => !used.has(i) && f.r === t.rows.length && f.c === t.rows[0].length);
      if (idx < 0) continue;
      used.add(idx);
      const f = found[idx];
      const targetXpx = clamp(t.x, 0, 200) * MM_TO_PX;
      const targetYpx = clamp(t.y, 0, 280) * MM_TO_PX;
      const dxPx = targetXpx - f.x;
      const dyPx = targetYpx - f.y;
      if (Math.abs(dxPx) < TOL_PX && Math.abs(dyPx) < TOL_PX) { done.add(t); continue; }
      const prev = setOfs.get(t) ?? { h: Math.round(targetXpx * PX_TO_HWP), v: Math.round(targetYpx * PX_TO_HWP) };
      // pass 0: 목표 좌표를 그대로 절대 오프셋으로. 이후: 렌더 잔차만큼 오프셋을 보정.
      const next = pass === 0
        ? prev
        : { h: prev.h + Math.round(dxPx * PX_TO_HWP), v: prev.v + Math.round(dyPx * PX_TO_HWP) };
      try {
        wasm.setTableProperties(0, f.ppi, f.ci, {
          vertRelTo: 'Paper', horzRelTo: 'Paper',
          horzOffset: next.h, vertOffset: next.v,
        });
        setOfs.set(t, next);
        done.add(t);
        changed = true;
      } catch (e) {
        console.warn('[ai-layout] 표 위치 지정 실패:', e);
      }
    }
    if (!changed) break; // 전부 허용 오차 안 — 수렴
  }
  return done.size;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
