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

const SIZE = 300; // 도장 렌더 해상도(px)
const INSERT_H = 57; // 문서 안 높이 ≈ 15mm (96dpi) — 폭은 그림 비율대로 따라간다

type Shape = 'circle' | 'square';

function drawSeal(canvas: HTMLCanvasElement, name: string, shape: Shape): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const red = '#c0392b';
  ctx.strokeStyle = red;
  ctx.fillStyle = red;
  ctx.lineWidth = 10;

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(8, 8, SIZE - 16, SIZE - 16);
  }

  // 글자 배치 — 도장은 오른쪽→왼쪽·위→아래가 전통이지만 가독성을 위해 좌→우로 둔다.
  const chars = [...name.trim()].slice(0, 4);
  if (chars.length === 3) chars.push('印');
  const grid = chars.length <= 2
    ? chars.map((c, i) => ({ c, x: 0.5, y: chars.length === 1 ? 0.5 : 0.30 + i * 0.40, s: 0.34 }))
    : chars.map((c, i) => ({ c, x: 0.30 + (i % 2) * 0.40, y: 0.30 + Math.floor(i / 2) * 0.40, s: 0.30 }));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of grid) {
    ctx.font = `bold ${Math.round(SIZE * g.s)}px "HCR Batang", "함초롬바탕", serif`;
    ctx.fillText(g.c, SIZE * g.x, SIZE * g.y);
  }
}

function createSealTab(onChange: () => void): SignTab {
  const el = document.createElement('div');
  el.className = 'sgn-panel sgn-seal';

  const row = document.createElement('div');
  row.className = 'sgn-row';
  const input = document.createElement('input');
  input.className = 'sgn-input';
  input.placeholder = '이름 (1~4자)';
  input.maxLength = 4;
  const shapeSel = document.createElement('select');
  shapeSel.className = 'sgn-select';
  shapeSel.innerHTML = '<option value="circle">원형</option><option value="square">사각</option>';
  row.append(input, shapeSel);

  const stage = document.createElement('div');
  stage.className = 'sgn-stage sgn-stage-sm';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.className = 'sgn-canvas sgn-canvas-sq';
  const hint = document.createElement('div');
  hint.className = 'sgn-placeholder';
  hint.textContent = '이름을 넣으면 도장이 만들어집니다';
  stage.append(canvas, hint);

  el.append(row, stage);

  const repaint = () => {
    drawSeal(canvas, input.value, shapeSel.value as Shape);
    hint.hidden = !!input.value.trim();
    onChange();
  };
  input.addEventListener('input', repaint);
  shapeSel.addEventListener('change', repaint);

  return {
    el,
    canvas,
    label: '도장',
    sub: '개인·법인 도장을 만듭니다',
    foot: '2자는 세로, 3자는 이름 뒤에 印, 4자는 2×2 로 놓입니다.',
    resetLabel: '지우기',
    isEmpty: () => !input.value.trim(),
    clear: () => { input.value = ''; repaint(); input.focus(); },
    onShow: () => { repaint(); input.focus(); },
  };
}

/**
 * 잉크가 있는 부분만 잘라낸 캔버스.
 * 왜 필요한가: 서명은 넓은 판 한구석에 그려지는 게 보통이라, 그대로 넣으면 문서에서
 * **투명한 여백만 커다랗게** 자리를 차지하고 글씨는 좁쌀만 해진다.
 */
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

    body.append(lead, this.tabBar, this.panels, actions, this.footNote);
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
    const ih = this.services.getInputHandler() as any;
    if (!ih || this.services.wasm.pageCount === 0) return;
    const { data, w, h } = await this.blob();
    // 높이를 기준으로 맞추고 폭은 비율대로 — 가로로 긴 서명이 눌리지 않게.
    const drawH = INSERT_H;
    const drawW = Math.max(8, Math.round((w / h) * INSERT_H));
    const pos = ih.getCursorPosition();
    const label = this.tabs[this.active].label;
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'insertSeal',
      operation: (wasm: typeof this.services.wasm) => {
        const r = wasm.insertPicture(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, '',
          data, drawW, drawH, w, h, 'png', `${label}: 서명`);
        // ⚠ insertPicture 는 **떠 있는 그림**으로 넣는다 — 글자취급으로 바꿔야 서명란에
        //   글자처럼 앉는다(드롭 경로도 같은 후처리를 한다. 이걸 빼먹어 논리 길이 0으로
        //   "안 들어갔다"고 오판했다, 2026-08-01 실측).
        if (r.ok) {
          wasm.setPictureProperties(pos.sectionIndex, r.paraIdx ?? pos.paragraphIndex,
            r.controlIdx, { treatAsChar: true });
        }
        return null;
      },
    });
    this.services.eventBus.emit('document-changed');
    this.hide();
  }
}
