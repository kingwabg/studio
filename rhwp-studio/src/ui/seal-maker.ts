/**
 * 도장 만들기 — 이름을 넣으면 도장 이미지를 그려 문서에 넣는다.
 * (사용자 요청 2026-08-01: 전자서명 도구 묶음의 하나)
 *
 * 전부 로컬이다 — 캔버스로 그려 PNG 로 넣을 뿐, 아무 데도 보내지 않는다.
 * 배치: 2자 이름은 세로, 3자는 이름 + 印, 4자는 2×2.
 */
import { ModalDialog } from './dialog';
import type { CommandServices } from '@/command/types';

const SIZE = 300; // 렌더 해상도(px) — 인쇄에서 깨지지 않게 크게 그리고 작게 넣는다
const INSERT_PX = 57; // 문서 안 크기 ≈ 15mm (96dpi)

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

export class SealMakerDialog extends ModalDialog {
  private nameInput!: HTMLInputElement;
  private canvas!: HTMLCanvasElement;
  private shape: Shape = 'circle';

  constructor(private services: CommandServices) {
    super('도장 만들기', 360);
  }

  /** 확인 버튼은 안 쓴다 — 넣기는 본문 버튼이 맡는다 */
  protected onConfirm(): boolean { return true; }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'seal-body';

    const row = document.createElement('div');
    row.className = 'seal-row';
    this.nameInput = document.createElement('input');
    this.nameInput.className = 'seal-name';
    this.nameInput.placeholder = '이름 (1~4자)';
    this.nameInput.maxLength = 4;
    this.nameInput.addEventListener('input', () => this.paint());
    const shapeSel = document.createElement('select');
    shapeSel.className = 'seal-shape';
    shapeSel.innerHTML = '<option value="circle">원형</option><option value="square">사각</option>';
    shapeSel.addEventListener('change', () => { this.shape = shapeSel.value as Shape; this.paint(); });
    row.append(this.nameInput, shapeSel);
    body.appendChild(row);

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.className = 'seal-preview';
    body.appendChild(this.canvas);

    const foot = document.createElement('div');
    foot.className = 'seal-foot';
    const insert = document.createElement('button');
    insert.className = 'dialog-btn dialog-btn-primary';
    insert.textContent = '문서에 넣기';
    insert.addEventListener('click', () => void this.insert());
    const close = document.createElement('button');
    close.className = 'dialog-btn';
    close.textContent = '닫기';
    close.addEventListener('click', () => this.hide());
    foot.append(insert, close);
    body.appendChild(foot);

    return body;
  }

  show(): void {
    super.show();
    this.paint();
    this.nameInput.focus();
  }

  private paint(): void {
    drawSeal(this.canvas, this.nameInput.value || '이름', this.shape);
  }

  private async insert(): Promise<void> {
    const name = this.nameInput.value.trim();
    if (!name) { this.nameInput.focus(); return; }
    const ih = this.services.getInputHandler() as any;
    if (!ih || this.services.wasm.pageCount === 0) return;
    const blob: Blob = await new Promise((r) => this.canvas.toBlob((b) => r(b!), 'image/png'));
    const data = new Uint8Array(await blob.arrayBuffer());
    const pos = ih.getCursorPosition();
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'insertSeal',
      operation: (wasm: typeof this.services.wasm) => {
        const r = wasm.insertPicture(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, '',
          data, INSERT_PX, INSERT_PX, SIZE, SIZE, 'png', `도장: ${name}`);
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
