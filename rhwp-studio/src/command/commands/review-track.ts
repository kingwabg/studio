/**
 * 검토 — 변경 내용 추적 명령 7종 (스펙: rhwp mydocs/eng/plans/track-changes.md)
 * 오버레이 갱신은 main.ts 부트스트랩이 document-changed 이벤트에 걸어 둔다.
 */
import type { CommandDef } from '../types';
import { findAdjacentChange, findChangeAtCursor, type TrackChangeItem } from '@/engine/track-review';

function changes(wasm: { getTrackChanges(): string }): TrackChangeItem[] {
  try {
    return JSON.parse(wasm.getTrackChanges());
  } catch {
    return [];
  }
}

/** 스냅샷으로 감싼 검토 연산 — Ctrl+Z 한 번에 되돌아간다 */
function runResolve(services: any, fn: (wasm: any) => void): void {
  const ih = services.getInputHandler();
  if (!ih) return;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'trackResolve',
    operation: (wasm: any) => {
      fn(wasm);
      return ih.getCursorPosition();
    },
  });
  services.eventBus.emit('document-changed');
}

function jumpTo(services: any, it: TrackChangeItem | null): void {
  const ih = services.getInputHandler();
  if (!ih || !it) return;
  ih.cursor.moveTo({ sectionIndex: it.section, paragraphIndex: it.para, charOffset: it.start });
  ih.updateCaret?.();
  services.eventBus.emit('cursor-rect-updated');
}

export const reviewTrackCommands: CommandDef[] = [
  {
    id: 'review:track-toggle',
    label: '변경 내용 추적',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const wasm = services.wasm as any;
      const next = !wasm.isTrackChangesEnabled();
      // 작성자 v1: 설정이 없어 '검토자' 고정 — 사용자 설정 연동은 v2
      wasm.setTrackChanges(next, '검토자', new Date().toISOString().slice(0, 10));
      services.eventBus.emit('track-changes-toggled', next);
      services.eventBus.emit('document-changed');
    },
  },
  {
    id: 'review:accept-change',
    label: '적용 후 다음으로 이동',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const list = changes(services.wasm);
      const pos = ih.getCursorPosition();
      const target = findChangeAtCursor(list, pos) ?? findAdjacentChange(list, pos, 1);
      if (!target) return;
      runResolve(services, (w) => w.acceptTrackChange(target.id));
      jumpTo(services, findAdjacentChange(changes(services.wasm), ih.getCursorPosition(), 1));
    },
  },
  {
    id: 'review:reject-change',
    label: '취소 후 다음으로 이동',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const list = changes(services.wasm);
      const pos = ih.getCursorPosition();
      const target = findChangeAtCursor(list, pos) ?? findAdjacentChange(list, pos, 1);
      if (!target) return;
      runResolve(services, (w) => w.rejectTrackChange(target.id));
      jumpTo(services, findAdjacentChange(changes(services.wasm), ih.getCursorPosition(), 1));
    },
  },
  {
    id: 'review:accept-all',
    label: '모두 적용',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      runResolve(services, (w) => w.resolveAllTrackChanges(true));
    },
  },
  {
    id: 'review:reject-all',
    label: '모두 취소',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      runResolve(services, (w) => w.resolveAllTrackChanges(false));
    },
  },
  {
    id: 'review:next-change',
    label: '다음 변경',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      jumpTo(services, findAdjacentChange(changes(services.wasm), ih.getCursorPosition(), 1));
    },
  },
  {
    id: 'review:prev-change',
    label: '이전 변경',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      jumpTo(services, findAdjacentChange(changes(services.wasm), ih.getCursorPosition(), -1));
    },
  },
];
