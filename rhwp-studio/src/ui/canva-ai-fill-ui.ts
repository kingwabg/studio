/**
 * [캔버스 한컴 포크] AI 서식 채우기 — 확인 화면 2개.
 * (실행 설계: docs/plans/ai-form-fill.md)
 *
 *   ① 보내기 전: 무엇이 AI로 나가는지 보여주고 동의를 받는다. 여기서 취소하면 **요청 0건**.
 *   ② 적용 전: "어느 칸에 무엇을" 목록. 개별 해제 가능 — AI 가 숫자를 지어낼 수 있어서다
 *      (공모 신청서에 틀린 수치가 나가면 되돌릴 수 없다).
 *
 * 표시 전용 — 문서를 고치지 않는다(적용은 canva-ai-fill.applyFillPlan).
 */
import { mkEl, mkButton } from './canva-dom';
import type { FormCell, FillItem } from './canva-ai-fill';

const CARD = 'border:1px solid var(--ui-border);border-radius:10px;padding:10px 12px;'
  + 'background:var(--ui-surface);display:flex;flex-direction:column;gap:8px;';
const ROW = 'display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.5;';
const ACTIONS = 'display:flex;gap:8px;justify-content:flex-end;margin-top:2px;';

/** ① 보내기 동의 — 취소하면 아무것도 나가지 않는다. */
export function renderFillConsent(
  container: HTMLElement,
  info: { rowCount: number; colCount: number; emptyCells: FormCell[] },
  handlers: { onConfirm: (excluded: Set<number>) => void; onCancel: () => void },
): void {
  container.innerHTML = '';
  const card = mkEl('div', 'canva-fill-consent');
  card.style.cssText = CARD;

  const head = mkEl('div', 'canva-fill-head', '이 표를 AI로 보냅니다');
  head.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ui-text);';
  card.appendChild(head);

  const hint = mkEl(
    'div',
    'canva-fill-hint',
    `표 ${info.rowCount}행 ${info.colCount}열 중 빈 칸 ${info.emptyCells.length}개의 `
    + '칸 이름만 전송합니다. 문서의 다른 표·글상자는 보내지 않습니다.',
  );
  hint.style.cssText = 'font-size:11.5px;color:var(--ui-text-hint);line-height:1.5;';
  card.appendChild(hint);

  // 뺄 칸 고르기 — 민감한 칸(아동 이름 등)을 사용자가 직접 제외할 수 있게.
  const excluded = new Set<number>();
  const list = mkEl('div', 'canva-fill-list');
  list.style.cssText = 'max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;';
  for (const c of info.emptyCells) {
    const row = mkEl('label', 'canva-fill-row');
    row.style.cssText = ROW + 'cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) excluded.delete(c.cellIdx);
      else excluded.add(c.cellIdx);
    });
    const name = mkEl('span', undefined, `${c.row + 1}행${c.col + 1}열  ${c.label || '(이름없음)'}`);
    name.style.cssText = 'color:var(--ui-text-secondary);';
    row.append(cb, name);
    list.appendChild(row);
  }
  card.appendChild(list);

  const actions = mkEl('div', 'canva-fill-actions');
  actions.style.cssText = ACTIONS;
  const cancel = mkButton('canva-review-btn', { text: '취소' });
  const ok = mkButton('canva-review-btn canva-review-btn-primary', { text: '보내기' });
  cancel.addEventListener('click', () => handlers.onCancel());
  ok.addEventListener('click', () => handlers.onConfirm(excluded));
  actions.append(cancel, ok);
  card.appendChild(actions);

  container.appendChild(card);
}

/** ② 적용 전 — 어느 칸에 무엇을 쓸지. 체크 해제한 항목은 반영하지 않는다. */
export function renderFillPlan(
  container: HTMLElement,
  items: Array<FillItem & { label: string; row: number; col: number }>,
  handlers: { onApply: (accepted: FillItem[]) => void; onCancel: () => void },
): void {
  container.innerHTML = '';
  const card = mkEl('div', 'canva-fill-plan');
  card.style.cssText = CARD;

  const head = mkEl('div', 'canva-fill-head', `채울 칸 ${items.length}개`);
  head.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ui-text);';
  card.appendChild(head);

  const warn = mkEl(
    'div',
    'canva-fill-warn',
    'AI가 만든 값입니다. 숫자·날짜·금액은 반드시 확인하세요.',
  );
  warn.style.cssText = 'font-size:11.5px;color:var(--ui-warn, #b45309);line-height:1.5;';
  card.appendChild(warn);

  const dropped = new Set<number>();
  const list = mkEl('div', 'canva-fill-list');
  list.style.cssText = 'max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
  for (const it of items) {
    const row = mkEl('label', 'canva-fill-row');
    row.style.cssText = ROW + 'cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) dropped.delete(it.cellIdx);
      else dropped.add(it.cellIdx);
    });
    const body = mkEl('span');
    const name = mkEl('span', undefined, `${it.label || `${it.row + 1}행${it.col + 1}열`} `);
    name.style.cssText = 'color:var(--ui-text-hint);';
    const arrow = mkEl('span', undefined, '← ');
    arrow.style.cssText = 'color:var(--ui-text-hint);';
    const val = mkEl('span', undefined, it.text);
    val.style.cssText = 'color:var(--ui-text);font-weight:600;';
    body.append(name, arrow, val);
    row.append(cb, body);
    list.appendChild(row);
  }
  card.appendChild(list);

  const actions = mkEl('div', 'canva-fill-actions');
  actions.style.cssText = ACTIONS;
  const cancel = mkButton('canva-review-btn', { text: '취소' });
  const apply = mkButton('canva-review-btn canva-review-btn-primary', { text: '적용' });
  cancel.addEventListener('click', () => handlers.onCancel());
  apply.addEventListener('click', () => {
    handlers.onApply(items.filter((i) => !dropped.has(i.cellIdx)).map((i) => ({ cellIdx: i.cellIdx, text: i.text })));
  });
  actions.append(cancel, apply);
  card.appendChild(actions);

  container.appendChild(card);
}
