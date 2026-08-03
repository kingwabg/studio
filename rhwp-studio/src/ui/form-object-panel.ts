/**
 * 오른쪽 패널 「양식 개체」 — 개체를 클릭(편집 모드)하면 뜨는 속성판.
 * (사용자 요청 2026-08-03: "개체 선택되면 오른쪽 패널을 개체에 대한 기능을 넣자")
 *
 * 적용은 전부 wasm.setFormObjectProps / setFormValue / deleteFormObject 세 경로.
 * undo 미연동은 값편집(setFormValue)과 같은 기존 천장이다.
 */
import type { CanvaServices } from './canva-services';
import { mkEl, mkButton } from './canva-dom';

const TYPE_LABEL: Record<string, string> = {
  PushButton: '명령 단추',
  CheckBox: '선택 상자',
  ComboBox: '콤보 상자',
  RadioButton: '라디오 단추',
  Edit: '입력 상자',
};

const HWPUNIT_PER_MM = 7200 / 25.4;

/** host 를 비우고 지금 선택된 양식 개체의 속성판을 그린다. 선택이 없으면 false. */
export function buildFormObjectPanel(host: HTMLElement, services: CanvaServices): boolean {
  const ih = services.getInputHandler() as any;
  const sel = ih?.formObjectSelection;
  host.replaceChildren();
  if (!sel?.hit) return false;
  const { sec, para, ci, formType } = sel.hit;
  if (sec === undefined || para === undefined || ci === undefined) return false;

  // 항상 문서에서 다시 읽는다 — 히트 결과는 클릭 시점 스냅숏이다.
  let info: any;
  try {
    info = (services.wasm as any).getFormObjectInfo(sec, para, ci);
  } catch {
    return false;
  }
  if (!info?.ok) return false;

  const section = (label: string): HTMLElement => {
    const s = mkEl('div', 'canva-ins-section');
    const head = mkEl('div', 'canva-section-head');
    head.appendChild(mkEl('span', 'canva-section-label', label));
    s.appendChild(head);
    host.appendChild(s);
    return s;
  };

  const apply = (props: Record<string, unknown>) => {
    try {
      (services.wasm as any).setFormObjectProps(sec, para, ci, props);
      services.eventBus.emit('document-changed');
      ih?.refreshFormObjectSelection?.();
    } catch (err) {
      console.warn('[form-panel] 속성 적용 실패:', err);
    }
  };

  // ── 머리: 종류 + 이름 ──
  const head = section(`양식 개체 — ${TYPE_LABEL[formType ?? ''] ?? formType}`);
  const nameRow = mkEl('div', 'canva-chip-row');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = info.name ?? '';
  nameInput.placeholder = '개체 이름';
  nameInput.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--color-border,#ddd);border-radius:5px;font-size:12px';
  nameInput.addEventListener('change', () => apply({ name: nameInput.value }));
  nameRow.appendChild(nameInput);
  head.appendChild(nameRow);

  // ── 표시 문구: caption 류 / text 류 ──
  const usesCaption = formType === 'PushButton' || formType === 'CheckBox' || formType === 'RadioButton';
  const textSec = section(usesCaption ? '캡션' : '내용');
  const textRow = mkEl('div', 'canva-chip-row');
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = usesCaption ? (info.caption ?? '') : (info.text ?? '');
  textInput.placeholder = usesCaption ? '단추에 표시할 글' : '입력된 내용';
  textInput.style.cssText = nameInput.style.cssText;
  textInput.addEventListener('change', () =>
    apply(usesCaption ? { caption: textInput.value } : { text: textInput.value }));
  textRow.appendChild(textInput);
  textSec.appendChild(textRow);
  textSec.appendChild(mkEl('div', 'canva-hint', '본문에서 개체를 더블클릭해도 바로 고칠 수 있습니다.'));

  // ── 상태(체크/선택) ──
  if (formType === 'CheckBox' || formType === 'RadioButton') {
    const stateSec = section('상태');
    const row = mkEl('div', 'canva-chip-row');
    const onBtn = mkButton('canva-chip', { text: '선택' });
    const offBtn = mkButton('canva-chip', { text: '해제' });
    const paint = (v: number) => {
      onBtn.classList.toggle('is-active', v !== 0);
      offBtn.classList.toggle('is-active', v === 0);
      onBtn.style.borderColor = v !== 0 ? 'var(--color-primary)' : '';
      offBtn.style.borderColor = v === 0 ? 'var(--color-primary)' : '';
    };
    paint(info.value ?? 0);
    onBtn.addEventListener('mousedown', (e) => { e.preventDefault(); apply({ value: 1 }); paint(1); });
    offBtn.addEventListener('mousedown', (e) => { e.preventDefault(); apply({ value: 0 }); paint(0); });
    row.append(onBtn, offBtn);
    stateSec.appendChild(row);
  }

  // ── 그룹(라디오) ──
  if (formType === 'RadioButton') {
    const groupSec = section('그룹 이름');
    const row = mkEl('div', 'canva-chip-row');
    const g = document.createElement('input');
    g.type = 'text';
    g.value = info.properties?.GroupName ?? '';
    g.placeholder = '같은 그룹끼리 하나만 선택됩니다';
    g.style.cssText = nameInput.style.cssText;
    g.addEventListener('change', () => apply({ groupName: g.value }));
    row.appendChild(g);
    groupSec.appendChild(row);
  }

  // ── 크기 (mm) ──
  const sizeSec = section('크기');
  const sizeRow = mkEl('div', 'canva-chip-row');
  const mkSize = (label: string, hwpunit: number, key: 'width' | 'height') => {
    const wrap = mkEl('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px';
    wrap.appendChild(mkEl('span', '', label));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '1';
    inp.step = '0.5';
    inp.value = (hwpunit / HWPUNIT_PER_MM).toFixed(1);
    inp.style.cssText = 'width:64px;padding:4px 6px;border:1px solid var(--color-border,#ddd);border-radius:5px;font-size:12px';
    inp.addEventListener('change', () => {
      const mm = parseFloat(inp.value);
      if (Number.isFinite(mm) && mm > 0) apply({ [key]: Math.round(mm * HWPUNIT_PER_MM) });
    });
    wrap.appendChild(inp);
    wrap.appendChild(mkEl('span', 'canva-hint', 'mm'));
    return wrap;
  };
  sizeRow.append(mkSize('너비', info.width ?? 0, 'width'), mkSize('높이', info.height ?? 0, 'height'));
  sizeSec.appendChild(sizeRow);

  // ── 동작 ──
  const actSec = section('동작');
  const actRow = mkEl('div', 'canva-chip-row');
  const enableBtn = mkButton('canva-chip', { text: info.enabled ? '사용 안 함으로' : '사용함으로' });
  enableBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    apply({ enabled: !info.enabled });
    services.eventBus.emit('form-object-selection-changed', true); // 패널 다시 그리기
  });
  const delBtn = mkButton('canva-chip', { text: '개체 지우기' });
  delBtn.style.color = 'var(--color-danger,#c33)';
  delBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    try {
      (services.wasm as any).deleteFormObject(sec, para, ci);
      ih?.clearFormObjectSelection?.();
      services.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[form-panel] 삭제 실패:', err);
    }
  });
  actRow.append(enableBtn, delBtn);
  actSec.appendChild(actRow);

  const hint = mkEl('div', 'canva-hint',
    '체크·입력 등 실제 동작은 아래 상태바의 「양식 모드」를 켜고 클릭할 때 돕니다.');
  host.appendChild(hint);
  return true;
}
