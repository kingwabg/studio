/**
 * 도장 실측 템플릿 — 인쇄해서 **실제 도장을 찍어** 크기를 재는 종이를 만든다 (2026-08-04).
 *
 * 왜 필요한가: 화면의 도장 크기는 아무 의미가 없다. 문서에 넣을 도장을 실물과 같은
 * 크기로 맞추려면 실물이 몇 mm 인지부터 알아야 하는데, 자로 재면 테두리 두께 때문에
 * 늘 몇 mm 씩 어긋난다. 규격 원/사각을 인쇄해 **그 위에 찍어 보고 딱 맞는 칸을 고르는**
 * 것이 가장 정확하다(도장 제작소가 쓰는 방법이다).
 *
 * ⚠ 이 도구의 성패는 **인쇄 배율** 하나에 달렸다. 「페이지에 맞춤」으로 인쇄하면 전부
 *   틀린 크기가 나온다. 그래서 종이 위에 100mm 검산자를 같이 찍고, 실제 자로 재서
 *   100mm 가 아니면 쓰지 말라고 종이 자체에 적어 둔다 — 화면 안내는 인쇄물에 안 따라간다.
 *
 * 전부 로컬이다. 캔버스로 그려 PNG 로 내려받거나 문서에 넣을 뿐 아무 데도 보내지 않는다.
 */
import { ModalDialog } from './dialog';
import type { CommandServices } from '@/command/types';

/** 화면·인쇄 공통 기준. 96dpi 에서 1mm = 3.7795px 이고, 문서 삽입 크기도 이 단위다. */
const PX_PER_MM_96 = 96 / 25.4;
/** 그릴 때는 4배로 그려 인쇄 해상도(≈384dpi)를 확보한다 — 얇은 선이 뭉개지지 않게. */
const SS = 4;

/** 인쇄 가능 영역(A4 210×297 에서 여백 20mm 를 뺀 값) */
const SHEET_W_MM = 170;
const SHEET_H_MM = 257;

/** 원형 도장 지름(mm) — 막도장 12, 개인 인감 15, 법인 21~30 언저리를 모두 덮는다 */
const CIRCLE_MM = [9, 12, 15, 18, 21, 24, 27, 30];
/** 사각 도장 한 변(mm) */
const SQUARE_MM = [12, 15, 18, 21, 24, 30];

const INK = '#1a1a1a';
const GUIDE = '#9aa0a6';

function mm(v: number): number {
  return v * PX_PER_MM_96 * SS;
}

/** 규격 한 칸 — 테두리 실선 + 안쪽 「스탬핑 영역」 점선 + mm 라벨 */
function drawCell(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, sizeMm: number, round: boolean,
): void {
  const r = mm(sizeMm) / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, mm(0.2));
  ctx.setLineDash([]);
  ctx.beginPath();
  if (round) ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else ctx.rect(cx - r, cy - r, r * 2, r * 2);
  ctx.stroke();

  // 안쪽 점선 = 실제 인주가 닿는 자리. 실선에 딱 맞추면 어디에 맞춰야 할지 헷갈린다.
  const inner = r - mm(0.9);
  if (inner > mm(1)) {
    ctx.strokeStyle = GUIDE;
    ctx.setLineDash([mm(0.8), mm(0.8)]);
    ctx.beginPath();
    if (round) ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    else ctx.rect(cx - inner, cy - inner, inner * 2, inner * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = INK;
  ctx.font = `${mm(3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${sizeMm}mm`, cx, cy + r + mm(1.8));
}

/** 100mm 검산자 — 인쇄 배율이 맞는지 실제 자로 재 보라고 넣는다 */
function drawScaleBar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const len = mm(100);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, mm(0.25));
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();
  for (let i = 0; i <= 100; i += 10) {
    const tx = x + mm(i);
    const h = i % 50 === 0 ? mm(3) : mm(1.8);
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y - h);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = `${mm(3.2)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('← 이 선이 자로 재서 정확히 100mm 여야 합니다 (아니면 인쇄 배율을 100%로)', x, y + mm(1.6));
}

/** 실측 종이 한 장을 그린다. 반환 캔버스는 인쇄 해상도(4배)다. */
export function drawRulerSheet(canvas: HTMLCanvasElement): void {
  canvas.width = Math.round(mm(SHEET_W_MM));
  canvas.height = Math.round(mm(SHEET_H_MM));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = mm(10);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${mm(6)}px sans-serif`;
  ctx.fillText('도장 실측 템플릿', mm(4), y);
  y += mm(9);
  ctx.font = `${mm(3.4)}px sans-serif`;
  ctx.fillText('규격 칸 위에 실제 도장을 찍어, 인주 자국이 꼭 맞는 칸의 mm 가 도장 크기입니다.', mm(4), y);
  y += mm(6);

  drawScaleBar(ctx, mm(4), y + mm(4));
  y += mm(14);

  const section = (title: string, sizes: number[], round: boolean, startY: number): number => {
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${mm(4.2)}px sans-serif`;
    ctx.fillText(title, mm(4), startY);
    let cy = startY + mm(12);
    let cx = mm(4);
    let rowMax = 0;
    for (const s of sizes) {
      const cell = mm(s) + mm(10); // 칸 사이 여백 — 찍을 때 손이 들어갈 자리
      if (cx + cell > mm(SHEET_W_MM)) { cx = mm(4); cy += rowMax + mm(12); rowMax = 0; }
      drawCell(ctx, cx + cell / 2, cy + mm(s) / 2, s, round);
      cx += cell;
      rowMax = Math.max(rowMax, mm(s));
    }
    return cy + rowMax + mm(14);
  };

  y = section('원형', CIRCLE_MM, true, y);
  y = section('사각형', SQUARE_MM, false, y);

  ctx.fillStyle = GUIDE;
  ctx.font = `${mm(3)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('점선 = 인주가 닿는 영역. 실선에 정확히 맞지 않아도 점선 안에 들어오면 그 규격입니다.',
    mm(4), Math.min(y, mm(SHEET_H_MM - 8)));
}

export class SealRulerDialog extends ModalDialog {
  private canvas!: HTMLCanvasElement;

  constructor(private services: CommandServices) {
    super('도장 실측 템플릿', 640);
    this.titleIcon = 'stamp';
    this.confirmLabel = '문서에 넣기';
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'sgn-panel';

    const intro = document.createElement('p');
    intro.className = 'sgn-intro';
    intro.textContent =
      '인쇄해서 실제 도장을 찍어 보세요. 자국이 꼭 맞는 칸의 mm 가 도장 크기입니다. ' +
      '인쇄할 때 「페이지에 맞춤」을 끄고 100% 배율로 뽑아야 정확합니다.';

    const stage = document.createElement('div');
    stage.className = 'sgn-stage';
    this.canvas = document.createElement('canvas');
    // 미리보기는 폭에 맞춰 줄여 보여 준다 — 실제 크기는 인쇄물에서 나온다.
    this.canvas.style.width = '100%';
    this.canvas.style.height = 'auto';
    this.canvas.style.background = '#fff';
    drawRulerSheet(this.canvas);
    stage.appendChild(this.canvas);

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'sgn-btn';
    dl.textContent = 'PNG 다운로드';
    dl.addEventListener('click', () => this.download());

    const row = document.createElement('div');
    row.className = 'sgn-row';
    row.style.justifyContent = 'flex-end';
    row.appendChild(dl);

    body.append(intro, stage, row);
    return body;
  }

  private download(): void {
    const a = document.createElement('a');
    a.download = '도장-실측-템플릿.png';
    a.href = this.canvas.toDataURL('image/png');
    a.click();
  }

  protected onConfirm(): boolean {
    void this.insert();
    return false; // insert() 가 비동기라 스스로 닫는다
  }

  private async insert(): Promise<void> {
    const ih = this.services.getInputHandler() as any;
    if (!ih || this.services.wasm.pageCount === 0) return;
    const blob: Blob = await new Promise((r) => this.canvas.toBlob((x) => r(x!), 'image/png'));
    const data = new Uint8Array(await blob.arrayBuffer());

    // ⚠ 삽입 크기는 **mm 를 96dpi px 로 환산한 값**이어야 인쇄물이 실제 크기로 나온다.
    //   캔버스는 4배로 그렸지만(인쇄 선명도), 문서에 앉히는 크기는 원래 mm 그대로다.
    const drawW = Math.round(SHEET_W_MM * PX_PER_MM_96);
    const drawH = Math.round(SHEET_H_MM * PX_PER_MM_96);
    const pos = ih.getCursorPosition();
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'insertSealRuler',
      operation: (wasm: typeof this.services.wasm) => {
        const r = wasm.insertPicture(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, '',
          data, drawW, drawH, this.canvas.width, this.canvas.height, 'png', '도장 실측 템플릿');
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
