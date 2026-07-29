import type { CommandDef } from '../types';
import { OptionsDialog } from '../../ui/options-dialog';

export const toolCommands: CommandDef[] = [
  {
    id: 'tool:ai-panel',
    label: 'AI 도우미',
    canExecute: () => true,
    execute(services) { services.eventBus.emit('ai-panel-open'); },
  },
  {
    id: 'tool:record-panel',
    label: '음성 녹음',
    canExecute: () => true,
    execute(services) { services.eventBus.emit('record-panel-open'); },
  },
  {
    id: 'tool:command-palette',
    label: '명령 팔레트',
    shortcutLabel: 'Ctrl+Shift+P',
    canExecute: () => true,
    execute(services) { (services.getInputHandler() as any)?.commandPalette?.open(); },
  },
  {
    id: 'tool:options',
    label: '환경 설정',
    execute(services) {
      const dlg = new OptionsDialog(services.eventBus);
      dlg.show();
    },
  },
];
