/**
 * [캔버스 한컴 포크] AI 서식 채우기 — 이미 있는 표의 빈 칸을 AI가 채운다.
 * (실행 설계: docs/plans/ai-form-fill.md)
 *
 * 문서 생성(canva-ai-layout)이 "빈 지면에 새로 만들기"라면, 이쪽은 "받은 서식의 칸 채우기"다.
 * 공모사업 신청서처럼 남이 만든 .hwp 서식이 대상이라 **표 구조를 절대 건드리지 않는다** —
 * 행·열을 더하거나 병합을 바꾸지 않고, 오직 셀 안에 글자만 넣는다.
 *
 * ⚠ 개인정보: 여기서 만든 페이로드가 그대로 외부 모델로 나간다. 그래서 수집 범위를
 *   **커서가 있는 표 하나**로 못박는다(문서 전체·다른 표·글상자 제외). 보내기 동의와
 *   칸 제외는 canva-ai-fill-ui 가 맡는다.
 * ⚠ 적용은 snapshot 1회 — Ctrl+Z 한 번으로 전부 원복(문서 생성과 같은 규약).
 */
import type { CanvaServices } from './canva-services';

/** 표 한 칸. label = 사람이 읽는 칸 이름(왼쪽/위 칸에서 추론). */
export interface FormCell {
  cellIdx: number;
  row: number;
  col: number;
  label: string;
  value: string;
}

export interface FormTableRef {
  sec: number;
  ppi: number;
  ci: number;
  rowCount: number;
  colCount: number;
}

export interface FormSnapshot {
  ref: FormTableRef;
  cells: FormCell[];
}

export interface FillItem { cellIdx: number; text: string; }
export interface FillPlan { fills: FillItem[]; }

/** 셀 텍스트 조회 상한 — 서식 칸에 소설이 들어있지는 않다. */
const CELL_READ_LIMIT = 300;

/**
 * 커서가 놓인 표를 찾는다. 표 밖이면 null —
 * "아무 표나 하나 골라주는" 편의는 두지 않는다(엉뚱한 표를 보내는 사고가 난다).
 */
export function findCursorTable(services: CanvaServices): FormTableRef | null {
  const ih = services.getInputHandler() as any;
  const pos = ih?.cursor?.getPosition?.();
  if (!pos || pos.parentParaIndex === undefined || pos.controlIndex === undefined) return null;
  if (pos.cellIndex === undefined) return null;
  try {
    const dim = services.wasm.getTableDimensions(pos.sectionIndex, pos.parentParaIndex, pos.controlIndex);
    const rowCount = Number((dim as any)?.rowCount ?? (dim as any)?.rows);
    const colCount = Number((dim as any)?.colCount ?? (dim as any)?.cols);
    if (!Number.isFinite(rowCount) || !Number.isFinite(colCount) || rowCount < 1 || colCount < 1) return null;
    return { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex, rowCount, colCount };
  } catch {
    // 표가 아니거나 조회 실패 — 없다고 단정하지 말고 그냥 대상 없음으로 둔다.
    return null;
  }
}

/**
 * 표의 모든 칸을 읽어 목록으로. 빈 칸에는 label(칸 이름)을 붙여 AI가 무엇을 채울지 알게 한다.
 * label 규칙: 같은 행에서 **왼쪽으로 가장 가까운 글자 있는 칸** → 없으면 같은 열 맨 윗칸.
 * (한국 공모 서식은 대부분 "항목명 | 입력칸" 가로 배치라 왼쪽이 1순위다)
 */
export function collectFormCells(services: CanvaServices, ref: FormTableRef): FormSnapshot {
  const wasm = services.wasm;
  const read = (cellIdx: number): string => {
    try {
      return (wasm.getTextInCell(ref.sec, ref.ppi, ref.ci, cellIdx, 0, 0, CELL_READ_LIMIT) ?? '').trim();
    } catch {
      return '';
    }
  };

  const total = ref.rowCount * ref.colCount;
  const raw: string[] = [];
  for (let i = 0; i < total; i++) raw.push(read(i));

  const cells: FormCell[] = [];
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / ref.colCount);
    const col = i % ref.colCount;
    let label = '';
    for (let c = col - 1; c >= 0; c--) {
      const v = raw[row * ref.colCount + c];
      if (v) { label = v; break; }
    }
    if (!label && row > 0) label = raw[col] ?? '';
    cells.push({ cellIdx: i, row, col, label: label.replace(/\s+/g, ' ').slice(0, 40), value: raw[i] });
  }
  return { ref, cells };
}

/** 모델에게 보낼 사람이 읽는 표 — 빈 칸만 추린다(채울 곳만 알려주면 된다). */
export function describeForModel(snapshot: FormSnapshot): string {
  const empties = snapshot.cells.filter((c) => !c.value);
  const lines = empties.map((c) => `${c.cellIdx}\t${c.row + 1}행${c.col + 1}열\t${c.label || '(이름없음)'}`);
  return [
    `표 크기: ${snapshot.ref.rowCount}행 ${snapshot.ref.colCount}열`,
    '빈 칸 목록 (칸번호 / 위치 / 칸 이름):',
    ...lines,
  ].join('\n');
}

/**
 * 모델 출력 → 채우기 계획. 코드펜스·사족을 관대하게 흘려보낸다(parseAiLayout 과 같은 방어).
 * ⚠ 범위 밖 cellIdx 는 **그 항목만 버리고** 나머지는 살린다 — 하나 틀렸다고 전부 버리면
 *   사용자는 이유도 모른 채 "아무것도 안 됨"을 본다.
 */
export function parseFillPlan(raw: string, cellCount: number): FillPlan | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(j?.fills)) return null;
  const fills: FillItem[] = [];
  const seen = new Set<number>();
  for (const f of j.fills) {
    const idx = Number(f?.cellIdx);
    const text = typeof f?.text === 'string' ? f.text.trim() : '';
    if (!Number.isInteger(idx) || idx < 0 || idx >= cellCount) continue;
    if (!text || seen.has(idx)) continue;   // 같은 칸을 두 번 채우면 앞것만 쓴다
    seen.add(idx);
    fills.push({ cellIdx: idx, text });
  }
  return fills.length ? { fills } : null;
}

/**
 * 계획을 문서에 기록. snapshot 1회 = Ctrl+Z 한 번에 전부 원복.
 * 반환 = 실제로 쓴 칸 수(실패한 칸은 세지 않는다 — 성공으로 부풀리지 않는다).
 */
export function applyFillPlan(services: CanvaServices, ref: FormTableRef, plan: FillPlan): number {
  const ih = services.getInputHandler() as any;
  const wasm = services.wasm;
  if (!ih) return 0;
  let written = 0;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'aiFormFill',
    operation: () => {
      for (const f of plan.fills) {
        try {
          wasm.insertTextInCell(ref.sec, ref.ppi, ref.ci, f.cellIdx, 0, 0, f.text);
          written += 1;
        } catch {
          // 한 칸 실패가 나머지를 막지 않게 — 결과 수치로 사용자에게 알린다.
        }
      }
    },
  });
  return written;
}
