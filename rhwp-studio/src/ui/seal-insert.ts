/**
 * 도장·템플릿을 문서에 넣는 공통 경로 (2026-08-04).
 *
 * 왜 생겼나: 「문서에 넣기」가 **아무 말 없이 아무 일도 안 하는** 신고를 받았다.
 * 추적해 보니 input-handler 의 편집 모드 관문에 걸려 있었다:
 *
 *     if (this.editMode !== 'form') return true;
 *     if (desc.kind === 'snapshot') return false;   // ← 양식 모드에선 스냅샷 전부 차단
 *
 * 그림 삽입은 스냅샷 연산이라 **양식 모드에서 통째로 막힌다**. 게다가 executeOperation
 * 이 조용히 return 하고, 우리 쪽은 성공한 줄 알고 모달을 닫아 버려 증상이 "그냥 안 됨"
 * 이었다 — 실패를 성공처럼 보이게 하는 것이 가장 나쁘다.
 *
 * 여기서 하는 일 둘:
 *   ① 양식 모드면 **넣는 동안만** 일반 모드로 바꿨다가 되돌린다. 양식에 도장을 찍는 것은
 *      막을 일이 아니다(오히려 서명·날인은 양식 문서에서 제일 많이 한다).
 *      정책 자체(input-handler)는 다른 작업자 영역이라 건드리지 않는다.
 *   ② 실제로 들어갔는지 **확인해서 돌려준다**. 안 들어갔으면 부르는 쪽이 알려야 한다.
 */
import type { CommandServices } from '@/command/types';

/**
 * 1 화면 px = 75 HWPUNIT (7200/96).
 *
 * ⚠ **이 환산이 빠져 있어서 그림이 안 보였다**(2026-08-04 실측). insertPicture 의
 *   width/height 는 px 가 아니라 **HWPUNIT** 이다. 도장은 57 을 그대로 넘겨
 *   57 HWPUNIT = 0.76px 짜리로 들어갔다 — 문서 레이아웃에는 image 컨트롤이 잡히는데
 *   화면엔 아무것도 안 보여서 "삽입이 안 된다"로 보였다(엔진은 ok 를 돌려준다).
 *   드롭 경로(input-handler.ts fitDroppedImageSizeRaw)는 처음부터 PX_TO_HWPUNIT 을
 *   곱하고 있었다 — 우리만 빠뜨렸다.
 */
const PX_TO_HWPUNIT = 7200 / 96;

export type InsertPictureArgs = {
  data: Uint8Array;
  /** 문서에 앉힐 크기(**px @96dpi** — HWPUNIT 환산은 여기서 한다) */
  drawW: number;
  drawH: number;
  /** 원본 픽셀 크기 */
  naturalW: number;
  naturalH: number;
  description: string;
  /**
   * 글자처럼 배치(inline)할지. 기본은 **false = 떠 있는 그림**.
   *
   * ⚠ treatAsChar 를 켜면 **드래그로 못 옮긴다** — 본문 흐름에 실려 글자처럼 앉기 때문이다
   *   (input-handler-picture.ts:601 \"본문 배치 개체는 offset 이동 불가\").
   *   도장은 원하는 자리에 얹는 물건이라 옮길 수 있어야 한다(2026-08-04 사용자 신고
   *   \"왜 이동이 안되지\"). 서명란 칸 안에 글자처럼 앉히고 싶을 때만 켠다.
   */
  inline?: boolean;
};

/**
 * 그림 하나를 커서 자리에 넣는다. 성공하면 true.
 * 실패 이유를 부르는 쪽이 사람 말로 옮길 수 있도록 boolean 만 돌려준다.
 */
export function insertPictureAtCursor(services: CommandServices, a: InsertPictureArgs): boolean {
  const ih = services.getInputHandler() as any;
  if (!ih || services.wasm.pageCount === 0) return false;

  const wasForm = typeof ih.isFormMode === 'function' && ih.isFormMode();
  if (wasForm) services.setEditMode('normal');
  try {
    const pos = ih.getCursorPosition();
    let ok = false;
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'insertPicture',
      operation: (wasm: typeof services.wasm) => {
        const r = wasm.insertPicture(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, '',
          a.data,
          Math.round(a.drawW * PX_TO_HWPUNIT), Math.round(a.drawH * PX_TO_HWPUNIT),
          a.naturalW, a.naturalH, 'png', a.description);
        // ⚠ insertPicture 는 **떠 있는 그림**으로 넣는다 — 글자취급으로 바꿔야 서명란에
        //   글자처럼 앉는다(드롭 경로도 같은 후처리를 한다. 이걸 빼먹어 논리 길이 0으로
        //   "안 들어갔다"고 오판했다, 2026-08-01 실측).
        if (r.ok) {
          // insertPicture 는 **떠 있는 그림**으로 넣는다 — 글자취급은 요청할 때만 켠다.
          if (a.inline) {
            wasm.setPictureProperties(pos.sectionIndex, r.paraIdx ?? pos.paragraphIndex,
              r.controlIdx, { treatAsChar: true });
          }
          ok = true;
        }
        return null;
      },
    });
    if (ok) services.eventBus.emit('document-changed');
    return ok;
  } finally {
    // 어떤 경로로 나가든 모드는 원래대로 — 사용자가 양식 모드로 두고 있었다면 그 상태가 맞다.
    if (wasForm) services.setEditMode('form');
  }
}
