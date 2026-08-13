/**
 * 검토 — 변경 내용 추적 명령 7종 (스펙: rhwp mydocs/eng/plans/track-changes.md)
 * 오버레이 갱신은 main.ts 부트스트랩이 document-changed 이벤트에 걸어 둔다.
 */
import type { CommandDef } from '../types';
import { findAdjacentChange, findChangeAtCursor, type TrackChangeItem } from '@/engine/track-review';
import { showToast } from '@/ui/toast';
import { showTrackViewMenu, trackFinalPreview, type TrackPreviewMode } from '@/ui/track-final-preview';

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

/** 본 최종 미리보기 상태 — 스냅샷 id 를 들고 있다(모듈 전역: 뷰는 하나뿐) */
let finalPreview: { snapshotId: number } | null = null;

function hasChanges(wasm: any): boolean {
  if (changes(wasm).length > 0) return true;
  showToast({ message: '표시할 변경 내용이 없습니다.', durationMs: 2500 });
  return false;
}

/**
 * 한컴의 [변경 내용 보기 → 본 최종]: 모든 변경을 적용한 모습을 **읽기 전용**으로 본다.
 * 구현 = 스냅샷 저장 → 모두 적용 → (다시 누르면) 스냅샷 복원.
 * 편집을 막는 이유: 적용된 문서를 고치면 복원 시 그 편집이 사라진다.
 */
function toggleInlineFinal(services: any): void {
  const ih = services.getInputHandler() as any;
  if (!ih) return;
  const wasm = services.wasm as any;
  if (finalPreview) {
    wasm.restoreSnapshot(finalPreview.snapshotId);
    finalPreview = null;
    ih.active = true;
    services.eventBus.emit('track-view-final', false);
    services.eventBus.emit('document-changed');
    showToast({ message: '예정 및 변경 내용 보기로 돌아왔습니다.', durationMs: 2500 });
    return;
  }
  if (!hasChanges(wasm)) return;
  const snapshotId = wasm.saveSnapshot();
  wasm.resolveAllTrackChanges(true);
  finalPreview = { snapshotId };
  ih.active = false; // 읽기 전용 — 편집하면 복원 시 소실되므로 잠근다
  services.eventBus.emit('track-view-final', true);
  services.eventBus.emit('document-changed');
  showToast({
    message: '본 최종 미리보기 — 모든 변경을 적용한 모습입니다.\n편집은 잠겨 있습니다. 다시 누르면 검토 화면으로 돌아갑니다.',
    durationMs: 5000,
  });
}

/**
 * [캔버스 한컴 포크] 나란히 보기 — 변경 적용본을 **오른쪽 한 장**으로 띄운다.
 * 본문은 스냅샷 복원으로 원상 유지하므로 편집 잠금이 필요 없다.
 */
function openSidePreview(services: any, mode: TrackPreviewMode): void {
  const wasm = services.wasm as any;
  if (!trackFinalPreview.isOpen() && !hasChanges(wasm)) return;
  void trackFinalPreview.open(mode, {
    snapshotApplied(): Uint8Array | null {
      const id = wasm.saveSnapshot();
      try {
        wasm.resolveAllTrackChanges(true);
        return wasm.exportHwpx();
      } catch {
        return null;
      } finally {
        wasm.restoreSnapshot(id);
      }
    },
    on: (event, handler) => services.eventBus.on(event, handler),
  });
}

export const reviewTrackCommands: CommandDef[] = [
  {
    id: 'review:view-final',
    label: '변경 내용 보기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services, params) {
      showTrackViewMenu(params?.anchorEl as HTMLElement | undefined, {
        inline: () => toggleInlineFinal(services),
        dock: () => openSidePreview(services, 'dock'),
        window: () => openSidePreview(services, 'window'),
      });
    },
  },
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
