/**
 * 변경 내용 추적 — studio 쪽 배선 (스펙: rhwp mydocs/eng/plans/track-changes.md)
 *
 * 세 조각:
 *  1. promoteWhileTracking — 추적 ON 동안 텍스트 명령(insertText/deleteText)을 스냅샷
 *     연산으로 승격. 이유: 추적 ON 삭제는 엔진이 지우는 대신 마크를 남기는데,
 *     DeleteTextCommand 의 undo 는 "지운 텍스트 재삽입"이라 문서가 이중이 된다.
 *     스냅샷은 마크·레코드까지 통째로 되돌린다. (추적은 검토 시간의 일이라
 *     키입력당 스냅샷 비용은 감수 — v1 한계로 스펙에 명시)
 *  2. TrackOverlay — 삽입=초록 밑줄+옅은 배경, 삭제=자홍 취소선. 조판을 건드리지 않고
 *     getSelectionRects 로 범위 사각형을 받아 위에 그린다(memo-overlay 와 같은 방식).
 *  3. 검토 명령 헬퍼 — 토글·적용/취소·모두·다음/이전 (command/commands/review-track.ts 가 사용)
 */
import type { WasmBridge } from '@/core/wasm-bridge';
import type { VirtualScroll } from '@/view/virtual-scroll';

export interface TrackChangeItem {
  id: number;
  kind: 'insert' | 'delete';
  author: string;
  date: string;
  section: number;
  para: number;
  start: number;
  end: number;
  text: string;
}

/** 추적 ON 동안 텍스트 명령을 스냅샷으로 승격 (this = InputHandler) */
export function promoteWhileTracking(this: any, desc: any): any | null {
  if (desc?.kind !== 'command') return null;
  const t = desc.command?.type;
  if (t !== 'insertText' && t !== 'deleteText') return null;
  try {
    if (!this.wasm.isTrackChangesEnabled()) return null;
  } catch {
    return null;
  }
  const command = desc.command;
  return {
    kind: 'snapshot',
    operationType: `tracked-${t}`,
    operation: (wasm: WasmBridge) => command.execute(wasm),
    meta: desc.meta,
  };
}

const LAYER_CLASS = 'track-overlay-layer';

export class TrackOverlay {
  private layer: HTMLDivElement;

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = LAYER_CLASS;
    this.layer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:7;';
  }

  private ensureAttached(): void {
    if (this.layer.parentElement) return;
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) scrollContent.appendChild(this.layer);
  }

  clear(): void {
    this.layer.innerHTML = '';
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }

  /** 변경 목록을 다시 그린다 — 본문 문단 변경만(v1 경계와 동일) */
  render(wasm: WasmBridge, zoom: number): void {
    this.ensureAttached();
    this.clear();
    let items: TrackChangeItem[] = [];
    try {
      items = JSON.parse(wasm.getTrackChanges());
    } catch {
      return;
    }
    if (items.length === 0) return;
    const scrollContent = this.container.querySelector('#scroll-content') as HTMLElement | null;
    const contentWidth = scrollContent?.clientWidth ?? 0;

    for (const it of items) {
      let rects: Array<{ pageIndex: number; x: number; y: number; width: number; height: number }> = [];
      try {
        rects = wasm.getSelectionRects(it.section, it.para, it.start, it.para, it.end);
      } catch {
        continue;
      }
      for (const r of rects) {
        if (r.width <= 0) continue;
        const pageLeft = this.virtualScroll.getPageLeftResolved(r.pageIndex, contentWidth);
        const pageTop = this.virtualScroll.getPageOffset(r.pageIndex);
        const el = document.createElement('div');
        el.className = `track-mark track-mark--${it.kind}`;
        el.dataset.tcId = String(it.id);
        el.title = `${it.kind === 'insert' ? '삽입' : '삭제'} · ${it.author}${it.date ? ` · ${it.date}` : ''}`;
        el.style.cssText =
          `position:absolute;left:${pageLeft + r.x * zoom}px;top:${pageTop + r.y * zoom}px;` +
          `width:${r.width * zoom}px;height:${r.height * zoom}px;`;
        this.layer.appendChild(el);
      }
    }
  }
}

/** 커서 기준 다음/이전 변경 찾기 (순서: 구역→문단→시작 오프셋) */
export function findAdjacentChange(
  items: TrackChangeItem[],
  pos: { sectionIndex: number; paragraphIndex: number; charOffset: number },
  dir: 1 | -1,
): TrackChangeItem | null {
  const sorted = [...items].sort(
    (a, b) => a.section - b.section || a.para - b.para || a.start - b.start,
  );
  const after = (it: TrackChangeItem) =>
    it.section > pos.sectionIndex ||
    (it.section === pos.sectionIndex &&
      (it.para > pos.paragraphIndex ||
        (it.para === pos.paragraphIndex && it.start > pos.charOffset)));
  if (dir === 1) return sorted.find(after) ?? sorted[0] ?? null;
  const before = sorted.filter((it) => !after(it) && !(it.section === pos.sectionIndex && it.para === pos.paragraphIndex && it.start === pos.charOffset));
  return before[before.length - 1] ?? sorted[sorted.length - 1] ?? null;
}

/** 커서가 어떤 변경 범위 안(또는 바로 뒤)에 있으면 그 변경 */
export function findChangeAtCursor(
  items: TrackChangeItem[],
  pos: { sectionIndex: number; paragraphIndex: number; charOffset: number },
): TrackChangeItem | null {
  return (
    items.find(
      (it) =>
        it.section === pos.sectionIndex &&
        it.para === pos.paragraphIndex &&
        it.start <= pos.charOffset &&
        pos.charOffset <= it.end,
    ) ?? null
  );
}
