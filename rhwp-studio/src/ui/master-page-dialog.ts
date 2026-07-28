/**
 * 바탕쪽 편집 대화상자 — 한컴 [쪽-바탕쪽] 대응 (v1: 텍스트 편집).
 *
 * 바탕쪽은 모든 쪽 뒤에 깔리는 공통 배경(기관 서식틀 등)이다. 엔진은 파싱·보존·직렬화·
 * 렌더까지 이미 갖췄고 **편집 API만 없었다**(조사 2026-07-28) → getMasterPages /
 * setMasterPageText 로 문단 텍스트를 고친다.
 *
 * v2 후보: 바탕쪽 안에서 실제 캐럿 편집(머리말/꼬리말 편집 모드를 (구역, mp_index)로
 * 복제). v1은 도형·표 없이 텍스트만 다룬다.
 */
import { ModalDialog } from './dialog';
import type { CommandServices } from '@/command/types';

const APPLY_LABEL: Record<string, string> = {
  both: '양쪽',
  odd: '홀수 쪽',
  even: '짝수 쪽',
};

export class MasterPageDialog extends ModalDialog {
  private select!: HTMLSelectElement;
  private textArea!: HTMLTextAreaElement;
  private infoLabel!: HTMLSpanElement;
  private pages: Array<{ index: number; applyTo: string; isExtension: boolean; text: string }> = [];

  constructor(private services: CommandServices) {
    super('바탕쪽', 460);
    this.titleIcon = 'stack-simple';
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'dialog-body';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    const label = document.createElement('label');
    label.textContent = '바탕쪽';
    label.style.fontSize = '12px';
    this.select = document.createElement('select');
    this.select.addEventListener('change', () => this.onSelect());
    this.infoLabel = document.createElement('span');
    this.infoLabel.style.cssText = 'font-size:11px;color:#666;';
    row.append(label, this.select, this.infoLabel);
    body.appendChild(row);

    this.textArea = document.createElement('textarea');
    this.textArea.rows = 8;
    this.textArea.style.cssText = 'width:100%;font-family:inherit;font-size:12px;resize:vertical;';
    body.appendChild(this.textArea);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;font-size:11px;color:#666;';
    hint.textContent = '줄바꿈 하나가 문단 하나입니다. 도형·표는 이 창에서 다루지 않습니다.';
    body.appendChild(hint);

    this.refresh();
    return body;
  }

  private wasm(): any {
    return (this.services.getInputHandler() as any)?.wasm;
  }

  private refresh(): void {
    const w = this.wasm();
    this.pages = w ? w.getMasterPages(0) : [];
    this.select.innerHTML = '';
    for (const p of this.pages) {
      const o = document.createElement('option');
      o.value = String(p.index);
      o.textContent = `${APPLY_LABEL[p.applyTo] ?? p.applyTo}${p.isExtension ? ' (확장)' : ''}`;
      this.select.appendChild(o);
    }
    if (this.pages.length === 0) {
      const o = document.createElement('option');
      o.textContent = '이 문서에는 바탕쪽이 없습니다';
      this.select.appendChild(o);
      this.select.disabled = true;
      this.textArea.disabled = true;
      return;
    }
    this.onSelect();
  }

  private onSelect(): void {
    const idx = parseInt(this.select.value, 10);
    const p = this.pages.find((x) => x.index === idx);
    this.textArea.value = p?.text ?? '';
    this.infoLabel.textContent = p ? `문단 ${p.text.split('\n').length}개` : '';
  }

  protected onConfirm(): void | boolean {
    if (this.pages.length === 0) return true;
    const ih = this.services.getInputHandler() as any;
    const idx = parseInt(this.select.value, 10);
    const text = this.textArea.value;
    try {
      // 스냅샷 연산으로 감싸 되돌리기를 지원한다
      ih.executeOperation({
        kind: 'snapshot',
        operationType: 'setMasterPageText',
        operation: (wasm: any) => {
          const r = wasm.setMasterPageText(0, idx, text);
          if (!r?.ok) console.warn('[master-page] 편집 실패:', r?.error);
          return ih.cursor.getPosition();
        },
      });
      ih.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[master-page] 편집 실패:', err);
    }
    return true;
  }
}
