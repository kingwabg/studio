/**
 * 도장 만들기 — 서명·도장을 만들어 투명 PNG 로 내려받거나 문서에 넣는다.
 * (사용자 요청 2026-08-01: 전자서명 도구 묶음. 탭 3종은 2026-08-01 재설계)
 *
 * 전부 로컬이다 — 캔버스로 그려 PNG 로 넣을 뿐, 아무 데도 보내지 않는다.
 * 탭마다 하는 일은 다르지만 결과는 똑같이 **투명 캔버스 하나**라(SignTab),
 * 내려받기·문서 삽입은 여기 한 곳에서만 처리한다.
 */
import { ModalDialog } from './dialog';
import type { CommandServices } from '@/command/types';
import type { SignTab } from './sign-tab';
import { createDrawTab } from './sign-draw';
import { createFontTab } from './sign-fonts';
import { createSealTab } from './seal-tab';
import { insertPictureAtCursor } from './seal-insert';
import { showToast } from './toast';

const SIZE = 300; // 도장 렌더 해상도(px)
const INSERT_H = 57; // 문서 안 높이 ≈ 15mm (96dpi) — 폭은 그림 비율대로 따라간다
function trim(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const { width: w, height: h } = src;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) { // 거의 투명한 안티에일리어싱 가장자리는 무시
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src; // 완전히 비었다 — 자를 것이 없다
  const m = Math.round(Math.max(w, h) * 0.02); // 글자가 가장자리에 닿지 않게 여백 한 줌
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export class SealMakerDialog extends ModalDialog {
  private tabs: SignTab[] = [];
  private active = 0;
  private tabBar!: HTMLElement;
  private panels!: HTMLElement;
  private footNote!: HTMLElement;
  private resetBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;

  private inlineBox: HTMLInputElement | null = null;

  constructor(private services: CommandServices) {
    super('도장 만들기', 660);
    this.titleIcon = 'signature';
    this.titleSubject = 'BETA';
    this.confirmLabel = '문서에 넣기';
  }

  /** 확인 = 문서에 넣기. 비어 있으면 대화상자를 유지한다. */
  protected onConfirm(): boolean {
    if (this.tabs[this.active].isEmpty()) return false;
    void this.insert();
    return false; // insert() 가 끝나고 스스로 닫는다(그림 삽입이 비동기다)
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'sgn-body';

    const lead = document.createElement('p');
    lead.className = 'sgn-lead';
    lead.textContent = '직접 쓰거나 이름·법인명을 입력해 투명 배경의 서명과 도장을 PNG로 만듭니다.';

    const sync = () => this.syncActions();
    this.tabs = [createDrawTab(sync), createFontTab(sync), createSealTab(sync)];

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'sgn-tabs';
    this.tabBar.setAttribute('role', 'tablist');
    this.panels = document.createElement('div');
    this.panels.className = 'sgn-panels';

    this.tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'sgn-tab';
      b.setAttribute('role', 'tab');
      b.innerHTML = `<span class="sgn-tab-name"></span><span class="sgn-tab-sub"></span>`;
      b.querySelector('.sgn-tab-name')!.textContent = t.label;
      b.querySelector('.sgn-tab-sub')!.textContent = t.sub;
      b.addEventListener('click', () => this.select(i));
      this.tabBar.appendChild(b);
      t.el.hidden = true;
      this.panels.appendChild(t.el);
    });

    const actions = document.createElement('div');
    actions.className = 'sgn-actions';
    this.resetBtn = document.createElement('button');
    this.resetBtn.className = 'dialog-btn';
    this.resetBtn.addEventListener('click', () => this.tabs[this.active].clear());
    this.saveBtn = document.createElement('button');
    this.saveBtn.className = 'dialog-btn dialog-btn-primary';
    this.saveBtn.textContent = '투명 PNG 다운로드';
    this.saveBtn.addEventListener('click', () => this.download());
    actions.append(this.resetBtn, this.saveBtn);

    this.footNote = document.createElement('p');
    this.footNote.className = 'sgn-foot';

    // 배치 방식 — 기본은 떠 있는 그림(옮길 수 있다). 서명란 칸에 글자처럼 앉히려면 켠다.
    const inline = document.createElement('label');
    inline.className = 'sgn-check';
    inline.title = '켜면 글자처럼 본문에 앉지만 드래그로 옮길 수 없습니다';
    this.inlineBox = document.createElement('input');
    this.inlineBox.type = 'checkbox';
    const inlineText = document.createElement('span');
    inlineText.textContent = '글자처럼 배치 (끄면 자유롭게 이동)';
    inline.append(this.inlineBox, inlineText);

    body.append(lead, this.tabBar, this.panels, actions, inline, this.footNote);
    return body;
  }

  show(): void {
    super.show();
    this.select(this.active);
  }

  private select(i: number): void {
    this.active = i;
    this.tabs.forEach((t, n) => {
      t.el.hidden = n !== i;
      this.tabBar.children[n].classList.toggle('is-on', n === i);
      this.tabBar.children[n].setAttribute('aria-selected', String(n === i));
    });
    this.footNote.textContent = this.tabs[i].foot;
    this.resetBtn.textContent = this.tabs[i].resetLabel;
    this.tabs[i].onShow?.();
    this.syncActions();
  }

  /** 비어 있으면 내려받기·문서에 넣기를 잠근다 — 빈 PNG 를 만들 이유가 없다. */
  private syncActions(): void {
    const empty = this.tabs[this.active].isEmpty();
    this.saveBtn.disabled = empty;
    this.resetBtn.disabled = empty;
    // ⚠ 본문에도 primary 버튼(내려받기)이 있다 — 반드시 **푸터 범위**로 좁혀 고른다.
    const confirm = this.dialog.querySelector<HTMLButtonElement>('.dialog-footer .dialog-btn-primary');
    if (confirm) confirm.disabled = empty;
  }

  private async blob(): Promise<{ data: Uint8Array; w: number; h: number }> {
    const out = trim(this.tabs[this.active].canvas);
    const b: Blob = await new Promise((r) => out.toBlob((x) => r(x!), 'image/png'));
    return { data: new Uint8Array(await b.arrayBuffer()), w: out.width, h: out.height };
  }

  private async download(): Promise<void> {
    const out = trim(this.tabs[this.active].canvas);
    const url = out.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.tabs[this.active].label}.png`;
    a.click();
  }

  private async insert(): Promise<void> {
    const { data, w, h } = await this.blob();
    // 높이를 기준으로 맞추고 폭은 비율대로 — 가로로 긴 서명이 눌리지 않게.
    const drawH = INSERT_H;
    const drawW = Math.max(8, Math.round((w / h) * INSERT_H));
    const label = this.tabs[this.active].label;
    const ok = insertPictureAtCursor(this.services, {
      data, drawW, drawH, naturalW: w, naturalH: h, description: `${label}: 서명`,
      inline: this.inlineBox?.checked ?? false,
    });
    // ⚠ 실패했으면 **닫지 않는다**. 예전엔 무조건 닫아 버려 "그냥 안 됨"으로 보였다.
    if (!ok) {
      showToast({ message: '문서에 넣지 못했습니다 — 편집기에 문서가 열려 있는지 확인해 주세요.', durationMs: 4000 });
      return;
    }
    this.hide();
  }
}
