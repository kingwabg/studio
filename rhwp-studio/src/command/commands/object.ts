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

export const objectCommands: CommandDef[] = [
  {
    id: 'object:duplicate',
    label: '개체 복제',
    shortcutLabel: 'Ctrl+D',
    canExecute: (ctx) => ctx.hasDocument && ctx.inPictureObjectSelection,
    execute(services) {
      services.getInputHandler()?.duplicateSelectedObjects();
    },
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
