/**
 * 상용구 대화상자 (한컴 [입력-상용구] 대응)
 *
 * 자주 쓰는 문구를 이름·준말과 함께 저장해두고 커서 위치에 삽입한다.
 * v1은 **평문만** — 서식 포함 조각은 엔진 클립보드 직렬화 API가 필요해 후속(조사 2026-07-28).
 * 저장소는 사용자 설정(localStorage)이라 문서에 딸려 가지 않는다(한컴도 상용구는 문서 밖).
 */
import { ModalDialog } from './dialog';
import { userSettings, type Snippet } from '@/core/user-settings';

export class SnippetDialog extends ModalDialog {
  private listEl!: HTMLSelectElement;
  private nameInput!: HTMLInputElement;
  private abbrevInput!: HTMLInputElement;
  private textArea!: HTMLTextAreaElement;

  /** 확인 시 삽입할 본문 — null 이면 삽입하지 않는다(등록/삭제만 한 경우) */
  private insertText: string | null = null;

  /** 확인(삽입) 콜백 — 호출자가 문서에 넣는다 */
  onInsert: ((text: string) => void) | null = null;

  /** 등록 초기값(선택 텍스트에서 열 때) */
  constructor(private initialText = '') {
    super('상용구', 460);
    this.titleIcon = 'clipboard-text';
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'dialog-body';

    const row = (labelText: string, el: HTMLElement) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
      const label = document.createElement('label');
      label.textContent = labelText;
      label.style.cssText = 'width:64px;flex:none;font-size:12px;';
      wrap.appendChild(label);
      el.style.flex = '1';
      wrap.appendChild(el);
      return wrap;
    };

    // 목록
    this.listEl = document.createElement('select');
    this.listEl.size = 6;
    this.listEl.style.cssText = 'width:100%;margin-bottom:10px;';
    this.listEl.addEventListener('change', () => this.onSelect());
    this.listEl.addEventListener('dblclick', () => {
      // 더블클릭 = 즉시 삽입
      const s = this.current();
      if (s) { this.insertText = s.text; this.hide(); this.onInsert?.(s.text); }
    });
    body.appendChild(this.listEl);

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    body.appendChild(row('이름', this.nameInput));

    this.abbrevInput = document.createElement('input');
    this.abbrevInput.type = 'text';
    this.abbrevInput.placeholder = '선택 — 본문에 치고 확장';
    body.appendChild(row('준말', this.abbrevInput));

    this.textArea = document.createElement('textarea');
    this.textArea.rows = 5;
    this.textArea.value = this.initialText;
    this.textArea.style.cssText = 'width:100%;resize:vertical;font-family:inherit;';
    body.appendChild(row('내용', this.textArea));

    // 등록/삭제 버튼
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const addBtn = document.createElement('button');
    addBtn.className = 'dialog-btn';
    addBtn.textContent = '등록';
    addBtn.addEventListener('click', () => this.register());
    const delBtn = document.createElement('button');
    delBtn.className = 'dialog-btn';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => this.remove());
    btnRow.append(addBtn, delBtn);
    body.appendChild(btnRow);

    this.refresh();
    return body;
  }

  private current(): Snippet | null {
    const name = this.listEl.value;
    return userSettings.getSnippets().find((s) => s.name === name) ?? null;
  }

  private refresh(selectName?: string): void {
    const items = userSettings.getSnippets();
    this.listEl.innerHTML = '';
    for (const s of items) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.abbrev ? `${s.name}  (${s.abbrev})` : s.name;
      this.listEl.appendChild(opt);
    }
    if (selectName) this.listEl.value = selectName;
  }

  private onSelect(): void {
    const s = this.current();
    if (!s) return;
    this.nameInput.value = s.name;
    this.abbrevInput.value = s.abbrev;
    this.textArea.value = s.text;
  }

  private register(): void {
    const name = this.nameInput.value.trim();
    const text = this.textArea.value;
    if (!name || !text) return;
    userSettings.addSnippet({ name, abbrev: this.abbrevInput.value.trim(), text });
    this.refresh(name);
  }

  private remove(): void {
    const s = this.current();
    if (!s) return;
    userSettings.removeSnippet(s.name);
    this.refresh();
  }

  protected onConfirm(): void | boolean {
    // 확인 = 선택 항목 삽입 (선택이 없으면 그냥 닫힘)
    const s = this.current();
    if (s) {
      this.insertText = s.text;
      this.onInsert?.(s.text);
    }
    return true;
  }
}
