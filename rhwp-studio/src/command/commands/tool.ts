import type { CommandDef } from '../types';
import { OptionsDialog } from '../../ui/options-dialog';
import { showToast } from '@/ui/toast';

export const toolCommands: CommandDef[] = [
  // ── 로드맵 자리 표시 ──────────────────────────────
  // 아직 구현이 없는 도구들. **버튼을 없애지 않는다** — 자리를 잡아 두는 것은 제품
  // 결정이지 구현자 판단이 아니다(2026-07-30 사용자 지적). 누르면 준비 중임을 알린다.
  ...([
    ['tool:share', '문서 공유', '문서를 링크로 공유하는 기능'],
    ['tool:coedit', '함께 편집', '여러 사람이 동시에 편집하는 기능'],
    ['tool:dictionary', '사전', '낱말 뜻·유의어를 찾는 기능'],
    ['tool:translate', '번역', '선택 영역을 번역하는 기능'],
    ['tool:script', '스크립트', '문서 자동화 스크립트 실행'],
  ] as const).map(([id, label, what]): CommandDef => ({
    id,
    label,
    canExecute: () => true,
    execute() {
      showToast({ message: `${label} — 준비 중입니다.\n${what}은(는) 아직 만들지 않았습니다.`, durationMs: 4000 });
    },
  })),

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
