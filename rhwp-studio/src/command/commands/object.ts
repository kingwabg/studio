// [캔버스 한컴 포크] 개체(그림/글상자/도형) 정렬 커맨드.
// 다중 선택(Shift+클릭) 상태에서 명령 팔레트/인스펙터로 호출한다.
// 실행 로직은 InputHandler.alignSelectedObjects → object-align.ts(순수)로 위임.
import type { CommandDef } from '../types';
import type { AlignMode } from '@/engine/object-align';

/** 정렬 커맨드 하나를 만든다. 문서가 있을 때만 활성(대상 부족 시 내부에서 안전 무시). */
function alignCmd(id: string, label: string, mode: AlignMode, shortcutLabel?: string): CommandDef {
  return {
    id,
    label,
    shortcutLabel,
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      services.getInputHandler()?.alignSelectedObjects(mode);
    },
  };
}

/**
 * 선택한 개체의 **배치 방식**을 뒤집는다 — 글자취급(본문에 실림) ↔ 떠 있는 그림.
 *
 * ⚠ 왜 명령으로 두나: 「본문 배치(글자취급)」 개체는 **드래그로 못 옮긴다**
 *   (input-handler-picture.ts:601 \"본문 배치 개체는 offset 이동 불가\").
 *   도장을 넣고 \"왜 이동이 안 되지\"로 막힌 실제 신고가 있었다(2026-08-04).
 *   패널에서 한 번에 뒤집을 수 있어야 그 벽을 사용자가 스스로 넘는다.
 */
function toggleInline(services: Parameters<CommandDef['execute']>[0]): void {
  const ih = services.getInputHandler() as any;
  const ref = ih?.cursor?.getSelectedPictureRef?.();
  if (!ref) return;
  const cur = ih.getObjectProperties?.(ref);
  if (!cur) return;
  // [2026-08-13] 스냅샷으로 감싸 ⌘Z 로 되돌릴 수 있게 한다 — 종전엔 직호출이라
  // 배치를 뒤집고 되돌리려 해도 이 변경만 undo 이력에서 빠져 있었다.
  ih.executeOperation?.({
    kind: 'snapshot',
    operationType: 'objectProps',
    operation: () => {
      ih.setObjectProperties?.(ref, { treatAsChar: !cur.treatAsChar });
      return ih.getCursorPosition?.() ?? ih.getPosition?.();
    },
  }) ?? ih.setObjectProperties?.(ref, { treatAsChar: !cur.treatAsChar });
}

export const objectCommands: CommandDef[] = [
  {
    id: 'object:toggle-inline',
    label: '글자처럼 배치 켜기/끄기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) { toggleInline(services); },
  },
  alignCmd('object:align-left', '개체 왼쪽 정렬', 'left'),
  alignCmd('object:align-hcenter', '개체 가로 가운데 정렬', 'hcenter'),
  alignCmd('object:align-right', '개체 오른쪽 정렬', 'right'),
  alignCmd('object:align-top', '개체 위쪽 정렬', 'top'),
  alignCmd('object:align-vcenter', '개체 세로 가운데 정렬', 'vcenter'),
  alignCmd('object:align-bottom', '개체 아래쪽 정렬', 'bottom'),
  alignCmd('object:distribute-h', '개체 가로 간격 분배', 'hdistribute'),
  alignCmd('object:distribute-v', '개체 세로 간격 분배', 'vdistribute'),
];
