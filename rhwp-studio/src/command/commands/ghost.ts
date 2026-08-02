/**
 * 고스트 코멘트 — 문서를 **전혀 건드리지 않는** 검토 메모 3종.
 *
 * 빨간 글씨로 적어두고 인쇄 전에 일일이 지우던 왕복을 없앤다: 메모는 캔버스 위
 * 오버레이(engine/ghost-overlay.ts)라 문서 바이트에 안 들어가고, 인쇄/PDF 는 wasm SVG 를
 * 새 창에 조립하므로(command/commands/file.ts) 구조상 저절로 빠진다.
 *
 * 문서를 안 바꾸니 히스토리(Ctrl+Z)에도 안 얹는다 — 되돌릴 문서 변경이 없다.
 */
import type { CommandDef } from '../types';
import { showToast } from '@/ui/toast';
import { showTimeMachine } from '@/ui/timemachine-modal';

export const ghostCommands: CommandDef[] = [
  {
    id: 'review:ghost-add',
    label: '고스트 코멘트',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      const text = window.prompt('고스트 코멘트 — 문서에는 저장되지 않고 인쇄·PDF 에도 안 나옵니다.');
      if (text === null) return; // 취소
      if (!ih.addGhostComment(text)) {
        showToast({ message: '내용이 비어 있어 달지 않았습니다.', durationMs: 2500 });
        return;
      }
      showToast({ message: '고스트 코멘트를 달았습니다 (인쇄·PDF 제외).', durationMs: 3000 });
    },
  },
  {
    id: 'review:ghost-toggle',
    label: '고스트 보기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      const on = ih.toggleGhostComments();
      showToast({ message: on ? '고스트 코멘트를 표시합니다.' : '고스트 코멘트를 감췄습니다.', durationMs: 2500 });
    },
  },
  {
    id: 'review:ghost-clear',
    label: '고스트 비우기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      void ih.clearGhostComments().then((n: number) => {
        showToast({
          message: n > 0 ? `고스트 코멘트 ${n}개를 지웠습니다.` : '지울 고스트 코멘트가 없습니다.',
          durationMs: 2500,
        });
      });
    },
  },
  // 문단 타임머신 — 문서 전체가 아니라 **커서가 있는 문단**만 과거로 되돌린다
  {
    id: 'review:time-machine',
    label: '문단 타임머신',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      const pos = ih.getCursorPosition?.() ?? ih.cursor?.getPosition?.();
      if (!pos) return;
      let current = '';
      try {
        current = services.wasm.getTextRange(pos.sectionIndex, pos.paragraphIndex, 0, 4000) ?? '';
      } catch { /* 못 읽으면 빈 문단으로 본다 */ }
      void ih.listParagraphVersions().then((versions: any[]) => {
        showTimeMachine(versions as any, current, (text: string) => {
          if (ih.restoreParagraphVersion(text)) {
            services.eventBus.emit('document-changed');
            showToast({ message: '이 문단을 고른 판으로 되돌렸습니다.', durationMs: 3000 });
          }
        });
      });
    },
  },
];
