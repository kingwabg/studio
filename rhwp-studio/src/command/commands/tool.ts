import type { CommandDef } from '../types';
import { OptionsDialog } from '../../ui/options-dialog';
import { showToast } from '@/ui/toast';

import { SealMakerDialog } from '@/ui/seal-maker';
import { SealRulerDialog } from '@/ui/seal-ruler';
import { EsignChecklistDialog, ConsentSimDialog, NdaGeneratorDialog } from '@/ui/esign-tools';
import { openTableFill } from '@/ui/table-fill';

let sealDialog: SealMakerDialog | null = null;
let rulerDialog: SealRulerDialog | null = null;
let checklistDialog: EsignChecklistDialog | null = null;
let consentDialog: ConsentSimDialog | null = null;
let ndaDialog: NdaGeneratorDialog | null = null;

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
    // 전자서명 도구 4종(2026-08-01) — 전부 로컬, 본문은 ui/seal-maker.ts·ui/esign-tools.ts
    id: 'tool:seal-maker',
    label: '도장 만들기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!sealDialog) sealDialog = new SealMakerDialog(services);
      sealDialog.show();
    },
  },
  {
    // 인쇄해서 실제 도장을 찍어 크기를 재는 종이(2026-08-04 사용자 요청)
    id: 'tool:seal-ruler',
    label: '도장 실측 템플릿',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!rulerDialog) rulerDialog = new SealRulerDialog(services);
      rulerDialog.show();
    },
  },
  {
    id: 'tool:esign-checklist',
    label: '전자서명 체크리스트',
    canExecute: () => true,
    execute() {
      if (!checklistDialog) checklistDialog = new EsignChecklistDialog();
      checklistDialog.show();
    },
  },
  {
    id: 'tool:consent-sim',
    label: '동의율 시뮬레이터',
    canExecute: () => true,
    execute() {
      if (!consentDialog) consentDialog = new ConsentSimDialog();
      consentDialog.show();
    },
  },
  {
    id: 'tool:nda-generator',
    label: 'NDA 생성기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!ndaDialog) ndaDialog = new NdaGeneratorDialog(services);
      ndaDialog.show();
    },
  },
  {
    // 표 빈칸 AI 채우기(2026-08-01) — 있는 양식의 **빈 셀만** 채운다. 본문 ui/table-fill.ts
    id: 'tool:table-fill',
    label: '표 빈칸 채우기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) { openTableFill(services); },
  },
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
