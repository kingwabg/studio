/**
 * [캔버스 한컴 포크] "문서 전체 검토 AI" — 검토 UI 렌더링(순수 렌더링, 코어 로직 없음).
 * 코어(wasm 접근·MiniMax 호출·검토 실행)는 별도 에이전트(A)가 병렬 개발 — 이 파일은
 * canva-ai-doc.ts의 계약 타입만 소비해 DOM을 그리고 handlers를 호출한다.
 * 흐름: renderSendPreview(전송 동의) → [검토 시작] → 코어가 검토 실행 →
 *       renderReviewFindings(결과 리스트) → 행별 [적용]/[무시]/클릭(onJumpTo).
 *
 * jsdiff 도입 판단: 채택. before/after를 단어 단위로 대조해야 "무엇이 바뀌는지"가
 * 한눈에 들어와 사용자가 안심하고 [적용]을 누를 수 있다 — 이 기능의 신뢰(전송 투명성 +
 * 수정 근거 확인) 요구와 정확히 맞아떨어진다. diff 패키지(MIT, gzip ~4KB)는 단일 목적이라
 * 유지비가 낮고, rhwp-studio는 이미 canvaskit-wasm 등 런타임 의존성을 가지므로 "제품
 * 내보내기 코어 의존성 0" 원칙(src/hwpx/exportCore.js 전용 규율)과 충돌하지 않는다.
 * → package.json/lock 갱신(diff, @types/diff) — tech-choices 원장 등재는 보고에 명시.
 */
import { mkEl, mkButton } from './canva-dom';
import type { DocReviewResult, ReviewFinding, ReviewKind } from './canva-ai-doc';
import { diffWords, type Change } from 'diff';

/** 한국어는 공백만으로 단어 경계를 잡으면 부정확 — Intl.Segmenter(word) 가 있으면 우선 사용.
 *  구형 브라우저 등 미지원 환경은 조용히 undefined로 폴백(diffWords 기본 정규식 분리). */
const koSegmenter: any = (() => {
  try {
    const Seg = (Intl as any)?.Segmenter;
    return Seg ? new Seg('ko', { granularity: 'word' }) : undefined;
  } catch { return undefined; }
})();

// ── 아이콘 (이모지 금지 — 인라인 SVG, 1.4px 스트로크) ──
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12l16-8-6 16-3-6-7-2z"/></svg>';

// ── 공용 인라인 스타일 조각 (canva-sidebars.css는 다른 기능 파일 — 이 UI는 이 파일 하나로
//    완결되게 스타일을 인라인 부여한다. canva-ai-edit-dialog.ts와 동일한 방식) ──
const CARD_CSS =
  'border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);padding:12px 14px;';
const BADGE_CSS =
  'display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;flex-shrink:0;';
// ⚠ 새 시맨틱 색(추가 강조용 초록) — krds-theme.css에 아직 없음. 이 작업은 UI 렌더 파일
//   단독 생성이 스코프라 design/tokens.md 갱신은 범위 밖 — 카탈로그 미러 미동기화(보고에 명시).
const DIFF_INS_BG = '#e6f4ea';
const DIFF_INS_TEXT = '#1a7f37';

export interface SendPreviewHandlers { onConfirm: () => void; onCancel: () => void; }
export interface ReviewFindingsHandlers {
  onApply: (f: ReviewFinding) => void;
  onIgnore: (f: ReviewFinding) => void;
  onJumpTo: (f: ReviewFinding) => void;
}

/**
 * 전송 동의 카드 — "AI에 보낼 내용: 글상자 N개 · 총 M자" + [검토 시작]/[취소].
 * 전송 투명성: 사용자가 무엇이 나가는지 보고 동의해야 검토가 시작된다.
 */
export function renderSendPreview(
  container: HTMLElement,
  sentSummary: { count: number; chars: number },
  handlers: SendPreviewHandlers,
): void {
  container.innerHTML = '';

  const card = mkEl('div', 'canva-review-send');
  card.style.cssText = CARD_CSS + 'display:flex;flex-direction:column;gap:8px;';

  const head = mkEl('div', 'canva-review-send-head');
  head.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ui-text);';
  const icon = mkEl('span', 'canva-review-send-icon');
  icon.style.cssText = 'width:15px;height:15px;color:var(--ui-link);display:inline-flex;';
  icon.innerHTML = ICON_SEND;
  head.append(icon, mkEl('span', '', 'AI에 보낼 내용'));
  card.appendChild(head);

  const summary = mkEl(
    'div',
    'canva-review-send-summary',
    `글상자 ${sentSummary.count}개 · 총 ${sentSummary.chars}자`,
  );
  summary.style.cssText = 'font-size:13px;font-weight:600;color:var(--ui-text);';
  card.appendChild(summary);

  const hint = mkEl(
    'div',
    'canva-review-send-hint',
    '문서 안의 글상자 텍스트가 검토를 위해 AI로 전송됩니다. 계속하시겠습니까?',
  );
  hint.style.cssText = 'font-size:11.5px;color:var(--ui-text-hint);line-height:1.5;';
  card.appendChild(hint);

  const actions = mkEl('div', 'canva-review-send-actions');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px;';
  const confirmBtn = mkButton('canva-review-btn canva-review-btn-primary', { text: '검토 시작' });
  const cancelBtn = mkButton('canva-review-btn', { text: '취소' });
  styleActionBtn(confirmBtn, true);
  styleActionBtn(cancelBtn, false);
  confirmBtn.addEventListener('click', handlers.onConfirm);
  cancelBtn.addEventListener('click', handlers.onCancel);
  actions.append(cancelBtn, confirmBtn);
  card.appendChild(actions);

  container.appendChild(card);
}

function styleActionBtn(b: HTMLButtonElement, primary: boolean): void {
  b.style.cssText = primary
    ? 'font-size:12px;font-weight:700;padding:6px 14px;border-radius:6px;border:none;background:var(--ui-link);color:var(--ui-text-on-accent);cursor:pointer;'
    : 'font-size:12px;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid var(--ui-border);background:var(--ui-surface);color:var(--ui-text-secondary);cursor:pointer;';
}

/**
 * 검토 결과 리스트 렌더 — findings가 비면 "문제를 찾지 못했습니다" 안내.
 * 각 행은 자체 상태(pending/applied/ignored)를 클로저로 들고, onApply/onIgnore 후
 * 해당 행만 갱신한다(전체 재렌더 금지 — 다른 행의 진행 상태가 날아가지 않게).
 */
export function renderReviewFindings(
  container: HTMLElement,
  result: DocReviewResult,
  handlers: ReviewFindingsHandlers,
): void {
  container.innerHTML = '';

  const summary = mkEl(
    'div',
    'canva-review-summary',
    `전송 글상자 ${result.sentSummary.count}개 · 총 ${result.sentSummary.chars}자 · 발견 ${result.findings.length}건`,
  );
  summary.style.cssText = 'font-size:11.5px;color:var(--ui-text-hint);padding:2px 2px 10px;';
  container.appendChild(summary);

  if (result.findings.length === 0) {
    const empty = mkEl('div', 'canva-review-empty');
    empty.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;color:var(--ui-text-hint);';
    const icon = mkEl('div', 'canva-review-empty-icon');
    icon.style.cssText = 'width:28px;height:28px;color:var(--ui-link);';
    icon.innerHTML = ICON_CHECK;
    empty.append(icon, mkEl('div', '', '문제를 찾지 못했습니다'));
    container.appendChild(empty);
    return;
  }

  const list = mkEl('div', 'canva-review-list');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  for (const finding of result.findings) {
    list.appendChild(buildFindingRow(finding, handlers));
  }
  container.appendChild(list);
}

function buildFindingRow(finding: ReviewFinding, handlers: ReviewFindingsHandlers): HTMLElement {
  let status: 'pending' | 'applied' | 'ignored' = 'pending';

  const row = mkEl('div', 'canva-review-row');
  row.style.cssText = CARD_CSS + 'display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:opacity .15s;';

  // 헤더: kind 배지 + reason + (해결 후) 상태 라벨
  const header = mkEl('div', 'canva-review-row-header');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const badge = mkEl('span', 'canva-review-badge', finding.kind);
  styleKindBadge(badge, finding.kind);
  const reason = mkEl('span', 'canva-review-reason', finding.reason);
  reason.style.cssText = 'font-size:12px;color:var(--ui-text-secondary);flex:1;min-width:0;';
  const statusLabel = mkEl('span', 'canva-review-status');
  statusLabel.style.cssText = 'font-size:10.5px;font-weight:700;color:var(--ui-text-hint);flex-shrink:0;';
  statusLabel.hidden = true;
  header.append(badge, reason, statusLabel);

  // before/after 대조 (단어 단위 diff)
  const diffBox = buildDiffView(finding.original, finding.suggestion);

  // 액션: [적용]/[무시]
  const actions = mkEl('div', 'canva-review-actions');
  actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
  const applyBtn = mkButton('canva-review-act', { text: '적용' });
  const ignoreBtn = mkButton('canva-review-act', { text: '무시' });
  styleActBtn(applyBtn, true);
  styleActBtn(ignoreBtn, false);
  actions.append(ignoreBtn, applyBtn);

  row.append(header, diffBox, actions);

  const resolve = (next: 'applied' | 'ignored') => {
    if (status !== 'pending') return;
    status = next;
    row.style.opacity = '0.55';
    statusLabel.hidden = false;
    statusLabel.textContent = next === 'applied' ? '적용됨' : '무시';
    statusLabel.style.color = next === 'applied' ? DIFF_INS_TEXT : 'var(--ui-text-hint)';
    applyBtn.disabled = true;
    ignoreBtn.disabled = true;
  };

  applyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onApply(finding);
    resolve('applied');
  });
  ignoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onIgnore(finding);
    resolve('ignored');
  });
  row.addEventListener('click', () => handlers.onJumpTo(finding));

  return row;
}

function styleKindBadge(el: HTMLElement, kind: ReviewKind): void {
  el.style.cssText =
    BADGE_CSS + (kind === '오탈자'
      ? 'background:var(--ui-danger-soft);color:var(--ui-danger);'
      : 'background:var(--ui-accent-bg);color:var(--ui-link);');
}

function styleActBtn(b: HTMLButtonElement, primary: boolean): void {
  b.style.cssText = primary
    ? 'font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid var(--ui-link);background:var(--ui-accent-bg-light);color:var(--ui-link);cursor:pointer;'
    : 'font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid var(--ui-border);background:var(--ui-surface);color:var(--ui-text-secondary);cursor:pointer;';
  b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.filter = 'brightness(0.97)'; });
  b.addEventListener('mouseleave', () => { b.style.filter = ''; });
}

/**
 * 수정 전/후를 "수정 전" · "수정 후" 두 줄로 나란히 보여준다(요구사항의 before/after 명시와
 * 일치). diffWords 결과를 두 줄에 나눠 붙이되 각 토큰의 강조는 공유한다:
 * 삭제된 토큰 = "수정 전"에만 취소선+회색, 추가된 토큰 = "수정 후"에만 초록 강조,
 * 공통 토큰은 두 줄 모두에 그대로 노출(맥락 유지 — 어디가 바뀌었는지 한눈에 비교).
 */
function buildDiffView(original: string, suggestion: string): HTMLElement {
  const wrap = mkEl('div', 'canva-review-diff');
  wrap.style.cssText =
    'display:flex;flex-direction:column;gap:4px;font-size:12.5px;line-height:1.55;' +
    'background:var(--ui-bg-light);border:1px solid var(--ui-border-light);border-radius:6px;padding:8px 10px;';

  const beforeText = mkEl('span', 'canva-review-diff-text');
  const afterText = mkEl('span', 'canva-review-diff-text');
  const beforeRow = buildDiffLine('수정 전', beforeText);
  const afterRow = buildDiffLine('수정 후', afterText);

  let parts: Change[];
  try {
    parts = diffWords(original, suggestion, koSegmenter ? { intlSegmenter: koSegmenter } : undefined);
  } catch {
    // Intl.Segmenter 결과가 diffWords 기대와 어긋나는 극단적 입력 등 — 기본 분리로 재시도.
    parts = diffWords(original, suggestion);
  }
  for (const part of parts) {
    if (part.removed) {
      beforeText.appendChild(mkDiffSpan(part.value, false));
    } else if (part.added) {
      afterText.appendChild(mkDiffSpan(part.value, true));
    } else {
      beforeText.appendChild(document.createTextNode(part.value));
      afterText.appendChild(document.createTextNode(part.value));
    }
  }

  wrap.append(beforeRow, afterRow);
  return wrap;
}

function buildDiffLine(label: string, textEl: HTMLElement): HTMLElement {
  const row = mkEl('div', 'canva-review-diff-row');
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;white-space:pre-wrap;word-break:break-word;';
  const labelEl = mkEl('span', 'canva-review-diff-label', label);
  labelEl.style.cssText = 'flex-shrink:0;font-size:10.5px;font-weight:700;color:var(--ui-text-hint);padding-top:1px;min-width:36px;';
  row.append(labelEl, textEl);
  return row;
}

function mkDiffSpan(value: string, added: boolean): HTMLElement {
  const span = mkEl('span', 'canva-review-diff-ins-or-del', value);
  span.style.cssText = added
    ? `background:${DIFF_INS_BG};color:${DIFF_INS_TEXT};border-radius:3px;padding:0 2px;`
    : 'color:var(--ui-text-hint);text-decoration:line-through;';
  return span;
}
