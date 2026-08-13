/**
 * [캔버스 한컴 포크] 변경 내용 보기 — **변경 적용본**을 원문 옆에 나란히 띄운다.
 *
 * 왜: 기존 [본 최종]은 같은 화면을 갈아치우고(스냅샷 적용 → 복원) 편집을 잠갔다.
 * 전/후를 동시에 못 보고, 보는 동안 일도 못 한다.
 *
 * 왜 한 장만 그리나: 왼쪽(원문 + 변경 표시)은 이미 본문 캔버스에 떠 있다. 두 번 그릴 이유가
 * 없어 **오른쪽 한 장만** 별도 WasmBridge 로 그린다(비교 창처럼 문서 2벌을 띄우지 않는다).
 *
 * 본문 무손상: 스냅샷 → 모두 적용 → `exportHwpx()` 로 바이트만 뜨고 → 즉시 스냅샷 복원.
 * 본문 문서는 손댄 적이 없으므로 미리보기 중에도 편집이 열려 있다.
 */
import { WasmBridge } from '@/core/wasm-bridge';

export type TrackPreviewMode = 'dock' | 'window';

/** 미리보기가 본문 쪽에서 받아야 하는 것들 — UI 가 엔진을 직접 알지 않게 좁힌 구멍 */
export interface TrackPreviewHost {
  /** 지금 시점의 "모두 적용" 바이트. 실패하면 null */
  snapshotApplied(): Uint8Array | null;
  /** 이벤트 구독(해지 함수를 돌려준다) */
  on(event: string, handler: (...args: unknown[]) => void): () => void;
}

const FILE_NAME = '변경 적용본.hwpx';
/** 타이핑이 멎고 이만큼 지나면 갱신 — 문서를 통째로 다시 파싱하므로 짧게 잡지 않는다 */
const REFRESH_DELAY_MS = 1000;

class TrackFinalPreview {
  private wrap: HTMLDivElement | null = null;
  private canvas!: HTMLCanvasElement;
  private bodyEl!: HTMLDivElement;
  private navLabel!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private modeBtn!: HTMLButtonElement;
  private wasm: WasmBridge | null = null;
  private host: TrackPreviewHost | null = null;
  private unsubs: Array<() => void> = [];
  private mode: TrackPreviewMode = 'dock';
  private page = 0;
  private pageCount = 0;
  private token = 0;
  private refreshTimer: number | null = null;
  private refreshing = false;

  isOpen(): boolean {
    return !!this.wrap;
  }

  /** 이미 같은 모드로 열려 있으면 닫는다(리본 버튼 = 토글) */
  async open(mode: TrackPreviewMode, host: TrackPreviewHost): Promise<void> {
    if (this.wrap && this.mode === mode) {
      this.close();
      return;
    }
    this.host = host;
    this.mode = mode;
    if (!this.wrap) this.build();
    this.mount();
    this.subscribe();
    await this.reload();
  }

  close(): void {
    this.token += 1;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.wrap?.remove();
    this.wrap = null;
    this.host = null;
    try {
      this.wasm?.releaseDocument();
    } catch {
      /* noop */
    }
    this.wasm = null;
    this.pageCount = 0;
  }

  // ── DOM ────────────────────────────────────────────────
  private build(): void {
    const wrap = document.createElement('div');
    wrap.className = 'tfp';

    const head = document.createElement('div');
    head.className = 'tfp-head';
    const title = document.createElement('span');
    title.className = 'tfp-title';
    title.textContent = '변경 적용본';
    this.modeBtn = document.createElement('button');
    this.modeBtn.className = 'dialog-btn tfp-mini';
    this.modeBtn.addEventListener('click', () => {
      const next: TrackPreviewMode = this.mode === 'dock' ? 'window' : 'dock';
      this.mode = next;
      this.mount();
      this.draw();
    });
    const close = document.createElement('button');
    close.className = 'dialog-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    head.append(title, this.modeBtn, close);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'tfp-body';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tfp-canvas';
    this.bodyEl.append(this.canvas);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'tfp-status';

    const nav = document.createElement('div');
    nav.className = 'tfp-nav';
    const prev = document.createElement('button');
    prev.className = 'dialog-btn tfp-mini';
    prev.textContent = '◀';
    prev.addEventListener('click', () => this.setPage(this.page - 1));
    this.navLabel = document.createElement('span');
    const next = document.createElement('button');
    next.className = 'dialog-btn tfp-mini';
    next.textContent = '▶';
    next.addEventListener('click', () => this.setPage(this.page + 1));
    nav.append(prev, this.navLabel, next);

    wrap.append(head, this.bodyEl, this.statusEl, nav);
    this.wrap = wrap;
  }

  /** 2단 = 편집 영역 오른쪽 형제, 창 = body 위에 띄움 */
  private mount(): void {
    if (!this.wrap) return;
    const editorArea = document.getElementById('editor-area');
    if (this.mode === 'dock' && editorArea?.parentElement) {
      editorArea.after(this.wrap);
    } else {
      this.mode = 'window';
      document.body.append(this.wrap);
    }
    this.wrap.classList.toggle('tfp--dock', this.mode === 'dock');
    this.wrap.classList.toggle('tfp--window', this.mode === 'window');
    this.modeBtn.textContent = this.mode === 'dock' ? '창으로' : '2단으로';
  }

  private subscribe(): void {
    const host = this.host;
    if (!host || this.unsubs.length > 0) return;
    // 본문에서 보는 쪽으로 따라간다 — 좌우가 다른 쪽을 보고 있으면 비교가 안 된다
    this.unsubs.push(host.on('current-page-changed', (page) => this.setPage(page as number)));
    this.unsubs.push(host.on('document-changed', () => this.scheduleRefresh()));
  }

  // ── 내용 ───────────────────────────────────────────────
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.reload();
    }, REFRESH_DELAY_MS);
  }

  private async reload(): Promise<void> {
    const host = this.host;
    if (!host || !this.wrap || this.refreshing) return;
    this.refreshing = true;
    const token = ++this.token;
    try {
      const bytes = host.snapshotApplied();
      if (!bytes) {
        this.statusEl.textContent = '변경 적용본을 만들지 못했습니다.';
        return;
      }
      if (!this.wasm) {
        this.wasm = new WasmBridge();
        await this.wasm.initialize();
      }
      if (token !== this.token || !this.wrap) return;
      const info = this.wasm.loadDocument(bytes, FILE_NAME);
      try {
        this.wasm.refreshLayout();
      } catch {
        /* 레이아웃 갱신 실패는 렌더에서 다시 드러난다 */
      }
      this.pageCount = Math.max(1, info.pageCount);
      this.page = Math.min(this.page, this.pageCount - 1);
      this.statusEl.textContent = '모든 변경을 적용한 모습 — 본문은 그대로입니다.';
      this.draw();
    } catch (e) {
      this.statusEl.textContent = `미리보기 실패: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.refreshing = false;
    }
  }

  private setPage(page: number): void {
    if (!this.wrap || this.pageCount === 0) return;
    const next = Math.max(0, Math.min(this.pageCount - 1, page));
    if (next === this.page) return;
    this.page = next;
    this.draw();
  }

  private draw(): void {
    const wasm = this.wasm;
    if (!wasm || !this.wrap) return;
    try {
      const info = wasm.getPageInfo(this.page);
      const maxW = Math.max(200, this.bodyEl.clientWidth - 24);
      const scale = Math.max(0.15, Math.min(1.5, maxW / Math.max(1, info.width)));
      this.canvas.width = Math.max(1, Math.floor(info.width * scale));
      this.canvas.height = Math.max(1, Math.floor(info.height * scale));
      wasm.renderPageToCanvasFiltered(this.page, this.canvas, scale, 'all');
      this.navLabel.textContent = `${this.page + 1} / ${this.pageCount} 쪽`;
    } catch (e) {
      this.statusEl.textContent = `페이지 렌더 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

export const trackFinalPreview = new TrackFinalPreview();

/** 보기 방식 고르기 — 리본 [변경 내용 보기] 버튼 밑에 붙는 작은 메뉴 */
export function showTrackViewMenu(
  anchor: HTMLElement | undefined,
  actions: { inline: () => void; dock: () => void; window: () => void },
): void {
  document.querySelector('.tfp-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'context-menu tfp-menu';
  const rows: Array<[string, () => void]> = [
    ['한 화면에서 보기', actions.inline],
    ['2단 A4 (오른쪽에 나란히)', actions.dock],
    ['창으로 띄우기', actions.window],
  ];
  for (const [label, run] of rows) {
    const row = document.createElement('div');
    row.className = 'md-item';
    row.textContent = label;
    row.addEventListener('click', () => {
      menu.remove();
      run();
    });
    menu.append(row);
  }
  document.body.append(menu);

  const r = anchor?.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const x = Math.max(0, Math.min(window.innerWidth - box.width - 2, r?.left ?? 8));
  const y = Math.max(0, Math.min(window.innerHeight - box.height - 2, r?.bottom ?? 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const off = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  requestAnimationFrame(() => document.addEventListener('mousedown', off, true));
}
