/**
 * [캔버스 한컴 포크] AI 커맨드 — 개체 우클릭 "AI에게 수정하기".
 * 선택된 글상자(shape)의 텍스트를 대화형으로 수정한다 (canva-ai-edit-dialog).
 */
import type { CommandDef } from '../types';
import { showAiEditDialog } from '@/ui/canva-ai-edit-dialog';

export const aiCommands: CommandDef[] = [
  {
    id: 'ai:edit-shape',
    label: 'AI에게 수정하기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      // ① 글상자 개체 선택 상태 → 그 개체, ② 글상자 텍스트 편집 중 → 커서의 글상자
      let target: { sec: number; ppi: number; ci: number } | null = null;
      const pref = ih.cursor?.getSelectedPictureRef?.();
      if (pref && pref.type === 'shape' && !pref.cellPath) {
        target = { sec: pref.sec, ppi: pref.ppi, ci: pref.ci };
      } else if (ih.cursor?.isInTextBox?.()) {
        const pos = ih.cursor.getPosition();
        if (pos.parentParaIndex !== undefined && pos.controlIndex !== undefined
            && (pos.cellPath?.length ?? 0) <= 1) {
          target = { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex };
        }
      }
      if (target) showAiEditDialog(ih, target);
    },
  },
];
