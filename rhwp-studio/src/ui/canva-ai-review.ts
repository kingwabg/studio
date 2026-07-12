/**
 * [캔버스 한컴 포크] "문서 전체 검토 AI" — 코어 로직.
 * 문서의 모든 텍스트 글상자를 모아 M3에 "표현/오탈자" 관점 검토를 맡기고,
 * 사용자가 승인한 finding만 개별 적용한다. UI(패널/목록/미리보기)는 별도 파일에서 병렬 개발.
 * 글상자 읽기/교체·계약 타입은 canva-ai-doc.ts를 그대로 재사용(중복 2회 룰 — 이미 추출됨).
 */
import type { CanvaServices } from './canva-services';
import {
  readShapeText,
  replaceShapeText,
  type ShapeRef,
  type DocTextElement,
  type ReviewKind,
  type ReviewFinding,
  type DocReviewResult,
} from './canva-ai-doc';
import { callMiniMax } from './canva-ai-client';

const REVIEW_PROMPT =
  '당신은 한국어 문서 교정 도우미입니다. 문서에서 뽑은 글상자들을 "표현"(어색한 표현을 자연스럽게) ' +
  '과 "오탈자"(맞춤법·오타) 관점으로 검토하세요.\n' +
  '출력은 JSON 하나만: {"findings":[{"elementId":0,"kind":"표현","original":"...","suggestion":"<수정된 전체 텍스트>","reason":"..."}]}\n' +
  '규칙: 개체(elementId)당 finding은 최대 1개. suggestion은 그 개체의 수정된 "전체" 텍스트(부분 교체 아님). ' +
  '문제 없는 개체는 findings에서 아예 제외. reason은 한 줄. 설명·코드펜스 없이 JSON만 출력합니다.';

interface RawCtrl {
  type: string;
  secIdx?: number; paraIdx?: number; controlIdx?: number;
  cells?: Array<{ row: number; col: number; cellIdx: number }>;
}

/**
 * 전 페이지를 스캔해 검토 가능한 텍스트를 모두 수집한다:
 *  - 글상자(type:'shape') — 셀 1개(cellIdx 0)
 *  - 표(type:'table') — 각 셀(cellIdx별)을 개별 요소로 (⚠ 이전엔 표를 통째로 건너뛰어
 *    표 안 텍스트가 검토 대상에서 빠졌음 — 이 함수가 그 원인이었다)
 * 이미지·수식·선 등 텍스트 없는 개체는 readShapeText가 빈 문자열/예외라 자동 제외(버그 아님 —
 * 검토할 '표현·오탈자'가 없다). sec/ppi/ci/cellIdx로 중복 제거.
 */
export function gatherTextElements(services: CanvaServices): DocTextElement[] {
  const wasm = services.wasm;
  const elements: DocTextElement[] = [];
  const seen = new Set<string>();
  const pageCount = Math.max(0, wasm.pageCount ?? 0);

  // 하나의 셀(글상자든 표셀이든)을 읽어 비어있지 않으면 요소로 추가.
  const pushCell = (ref: ShapeRef, context?: string) => {
    const key = `${ref.sec}:${ref.ppi}:${ref.ci}:${ref.cellIdx ?? 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    let text = '';
    try {
      text = readShapeText(wasm, ref);
    } catch {
      return; // 셀 API가 안 먹는 컨트롤(이미지 등) — 제외
    }
    if (!text.trim()) return; // 빈 셀은 검토 대상 아님
    elements.push({ id: elements.length, ref, text, context });
  };

  for (let pg = 0; pg < pageCount; pg++) {
    let layout: { controls: unknown[] } | undefined;
    try {
      layout = wasm.getPageControlLayout(pg);
    } catch {
      continue; // 페이지 조회 실패 — 다음 페이지로
    }
    for (const raw of layout?.controls ?? []) {
      const ctrl = raw as RawCtrl;
      if (ctrl.paraIdx === undefined || ctrl.controlIdx === undefined) continue;
      const base = { sec: ctrl.secIdx ?? 0, ppi: ctrl.paraIdx, ci: ctrl.controlIdx };

      if (ctrl.type === 'shape') {
        pushCell({ ...base }, '글상자'); // cellIdx 생략 = 0
      } else if (ctrl.type === 'table' && Array.isArray(ctrl.cells)) {
        for (const cell of ctrl.cells) {
          pushCell({ ...base, cellIdx: cell.cellIdx }, `표 ${cell.row + 1}행 ${cell.col + 1}열`);
        }
      }
      // 그 외(이미지·선 등)는 텍스트가 없어 건너뜀
    }
  }
  return elements;
}

/** 문서 검토 1회 실행: 수집 → 간결한 payload 구성 → M3 호출 → findings 방어적 파싱. */
export async function runDocReview(services: CanvaServices): Promise<DocReviewResult> {
  const elements = gatherTextElements(services);
  const chars = elements.reduce((sum, el) => sum + el.text.length, 0);
  const sentSummary = { count: elements.length, chars };
  if (elements.length === 0) return { elements, findings: [], sentSummary };

  const payload = { elements: elements.map((el) => ({ id: el.id, text: el.text })) };
  let raw: string;
  try {
    // 개체별로 "수정된 전체 텍스트"를 되돌려받아야 해서 기본값(2048)보다 넉넉히 잡는다.
    raw = await callMiniMax(REVIEW_PROMPT, JSON.stringify(payload), 4096);
  } catch (e) {
    console.warn('[ai-review] 검토 요청 실패:', e);
    return { elements, findings: [], sentSummary };
  }
  return { elements, findings: parseFindings(raw, elements), sentSummary };
}

function isReviewKind(v: unknown): v is ReviewKind {
  return v === '표현' || v === '오탈자';
}

/** 모델 출력에서 findings 배열을 관대하게 파싱 (코드펜스/사족/미지 elementId 방어). */
function parseFindings(raw: string, elements: DocTextElement[]): ReviewFinding[] {
  const validIds = new Set(elements.map((el) => el.id));
  const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(arr)) return [];

  const findings: ReviewFinding[] = [];
  const seenElementId = new Set<number>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const elementId = Number(rec.elementId);
    if (!Number.isFinite(elementId) || !validIds.has(elementId)) continue;
    if (seenElementId.has(elementId)) continue; // 개체당 finding 최대 1개(v1 규약)

    if (!isReviewKind(rec.kind)) continue;
    const suggestion = rec.suggestion;
    if (typeof suggestion !== 'string' || !suggestion.trim()) continue;

    seenElementId.add(elementId);
    findings.push({
      elementId,
      kind: rec.kind,
      original: typeof rec.original === 'string' ? rec.original : '',
      suggestion,
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    });
  }
  return findings;
}

/** finding 하나를 문서에 적용 (단일 스냅샷 = Ctrl+Z 한 번에 취소). 성공하면 true. */
export function applyFinding(
  services: CanvaServices,
  finding: ReviewFinding,
  elements: DocTextElement[],
): boolean {
  const el = elements.find((e) => e.id === finding.elementId);
  if (!el) return false;
  const ih = services.getInputHandler() as any;
  if (!ih) return false;
  const wasm = services.wasm;

  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'aiDocReviewApply',
    operation: () => {
      replaceShapeText(wasm, el.ref, finding.suggestion);
      return ih.cursor.getPosition();
    },
  });
  ih.eventBus.emit('document-changed');
  return true;
}

/**
 * finding이 가리키는 글상자로 이동 + 선택한다.
 * goto-dialog.ts와 같은 패턴(moveCursorTo)으로 앵커 문단에 캐럿을 두어 스크롤을 유도한 뒤,
 * input-handler.ts의 공개 API selectPictureObject로 글상자를 선택 상태로 만든다.
 * 두 API 모두 명확한 공개 메서드라 사용 — 실패해도(예: 다른 편집 모드 중) 조용히 무시한다.
 */
export function jumpToElement(
  services: CanvaServices,
  finding: ReviewFinding,
  elements: DocTextElement[],
): void {
  const el = elements.find((e) => e.id === finding.elementId);
  if (!el) return;
  const ih = services.getInputHandler() as any;
  if (!ih) return;
  const isTable = (el.context ?? '').startsWith('표'); // 표 셀은 개체 종류가 'table'
  try {
    ih.moveCursorTo?.({ sectionIndex: el.ref.sec, paragraphIndex: el.ref.ppi, charOffset: 0 });
    ih.selectPictureObject?.(el.ref.sec, el.ref.ppi, el.ref.ci, isTable ? 'table' : 'shape');
  } catch {
    // no-op — 이동/선택 실패는 검토 흐름을 막을 이유가 아니다.
  }
}
