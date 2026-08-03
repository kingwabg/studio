/**
 * 리본 배치 고르개 — 「⋯ 편집」이 여는 모달.
 * (사용자 요청 2026-08-03: "전체 아이콘이 탭별로 다 보여서 드래그 식으로, 홈에 원하는 것만")
 *
 * 종전 「⋯ 편집」은 **그 탭 항목을 켜고 끄기만** 했다 — 다른 탭 아이콘을 홈으로 가져올 수 없었다.
 * 여기서는 전체 탭의 아이콘을 다 보여주고, 끌어다 놓아 탭 구성을 직접 짠다.
 *
 * 저장은 ribbon-tabs.ts 의 layout(탭 → 라벨 순서 목록). 손대지 않은 탭은 기본 배치를 그대로
 * 따르므로, 나중에 기본이 바뀌면 그 탭은 따라간다(전부 복사해 두면 그게 안 된다).
 */
import { ModalDialog } from './dialog';
import { mkEl, mkButton } from './canva-dom';
import {
  RIBBON_TABS, buildCatalog, loadLayout, saveLayout, resolveTabItems, loadHidden,
  type CatalogEntry, type RibbonLayout, type RibbonItem,
} from './ribbon-tabs';

/** 항목의 라벨(없으면 null) — 배치는 라벨로 다룬다 */
function labelOf(item: RibbonItem): string | null {
  if (item.kind === 'btn' || item.kind === 'over' || item.kind === 'value') return item.label;
  if (item.kind === 'slot') return item.label ?? null;
  return null;
}

class RibbonCustomizeDialog extends ModalDialog {
  private layout: RibbonLayout = loadLayout();
  private tabId: string;
  private listEl!: HTMLElement;
  private paletteEl!: HTMLElement;

  constructor(startTab: string, private onApply: () => void) {
    super('리본 배치', 860);
    this.titleIcon = 'squares-four';
    this.tabId = startTab;
    this.confirmLabel = '적용';
  }

  /** 지금 편집 중인 탭의 라벨 목록 — 배치가 없으면 기본에서 뽑아 시작한다 */
  private currentLabels(): string[] {
    if (this.layout[this.tabId]) return this.layout[this.tabId];
    const tab = RIBBON_TABS.find((t) => t.id === this.tabId);
    if (!tab) return [];
    const hidden = loadHidden();
    return resolveTabItems(tab, {}, hidden)
      .map(labelOf)
      .filter((l): l is string => !!l);
  }

  private setLabels(next: string[]): void {
    this.layout[this.tabId] = next;
    this.paint();
  }

  protected createBody(): HTMLElement {
    const body = mkEl('div', 'rc-body');
    body.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    // 어느 탭을 짤지
    const tabRow = mkEl('div', 'rc-tabrow');
    tabRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    tabRow.appendChild(mkEl('span', '', '탭:'));
    for (const t of RIBBON_TABS) {
      const b = mkButton('rc-tabbtn', { text: t.label });
      b.style.cssText = 'padding:3px 10px;border-radius:5px;border:1px solid var(--color-border,#ddd);background:var(--color-bg,#fff);cursor:pointer;font-size:12px';
      if (t.id === this.tabId) {
        b.style.borderColor = 'var(--color-primary,#00647f)';
        b.style.background = 'var(--color-accent-bg,#e4f1f6)';
        b.style.fontWeight = '600';
      }
      b.addEventListener('click', () => { this.tabId = t.id; this.paint(); });
      tabRow.appendChild(b);
    }
    const reset = mkButton('rc-reset', { text: '이 탭 기본값으로' });
    reset.style.cssText = 'margin-left:auto;padding:3px 10px;border-radius:5px;border:1px solid var(--color-border,#ddd);background:var(--color-bg,#fff);cursor:pointer;font-size:12px';
    reset.addEventListener('click', () => { delete this.layout[this.tabId]; this.paint(); });
    tabRow.appendChild(reset);
    body.appendChild(tabRow);

    const cols = mkEl('div', 'rc-cols');
    cols.style.cssText = 'display:flex;gap:12px;align-items:stretch;min-height:340px';

    // 왼쪽: 전체 아이콘(탭별)
    const left = mkEl('div', 'rc-col');
    left.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;min-width:0';
    left.appendChild(mkEl('div', 'rc-coltitle', '전체 아이콘 — 끌어서 오른쪽에 놓으세요'));
    this.paletteEl = mkEl('div', 'rc-palette');
    this.paletteEl.style.cssText = 'flex:1;overflow:auto;border:1px solid var(--color-border,#ddd);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:10px';
    left.appendChild(this.paletteEl);
    cols.appendChild(left);

    // 오른쪽: 이 탭 구성
    const right = mkEl('div', 'rc-col');
    right.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;min-width:0';
    right.appendChild(mkEl('div', 'rc-coltitle', '이 탭에 놓인 것 — 끌어서 순서를 바꾸고, × 로 뺍니다'));
    this.listEl = mkEl('div', 'rc-list');
    this.listEl.style.cssText = 'flex:1;overflow:auto;border:1px solid var(--color-border,#ddd);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:4px';
    right.appendChild(this.listEl);
    cols.appendChild(right);

    body.appendChild(cols);

    const hint = mkEl('div', 'rc-hint',
      '같은 아이콘을 여러 탭에 둘 수 있습니다. 손대지 않은 탭은 기본 배치를 그대로 씁니다.');
    hint.style.cssText = 'font-size:11.5px;color:var(--color-text-dim,#666)';
    body.appendChild(hint);

    for (const el of [...body.querySelectorAll<HTMLElement>('.rc-coltitle')]) {
      el.style.cssText = 'font-size:11.5px;color:var(--color-text-dim,#666)';
    }

    this.paint();
    return body;
  }

  /** 왼쪽 팔레트 + 오른쪽 목록을 다시 그린다 */
  private paint(): void {
    // 탭 단추 강조 갱신은 간단히 다시 열지 않고 클래스만 — 여기선 목록 둘만 다시 그린다.
    const labels = this.currentLabels();
    const placed = new Set(labels);

    // ── 팔레트(탭별 묶음) ──
    this.paletteEl.replaceChildren();
    const byTab = new Map<string, CatalogEntry[]>();
    for (const e of buildCatalog()) {
      const arr = byTab.get(e.fromTab) ?? [];
      arr.push(e);
      byTab.set(e.fromTab, arr);
    }
    for (const [tabLabel, entries] of byTab) {
      const group = mkEl('div', 'rc-group');
      const h = mkEl('div', 'rc-grouphead', tabLabel);
      h.style.cssText = 'font-size:11px;font-weight:600;color:var(--color-primary,#00647f);margin-bottom:4px';
      group.appendChild(h);
      const wrap = mkEl('div', 'rc-chips');
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
      for (const e of entries) {
        const chip = mkButton('rc-chip', { title: `${e.label} (${e.fromTab})` });
        chip.innerHTML = `<i class="ph-duotone ph-${e.icon}"></i><span>${e.label}</span>`;
        chip.draggable = true;
        chip.style.cssText = [
          'display:inline-flex;align-items:center;gap:4px',
          'padding:3px 7px;border-radius:5px;font-size:11.5px;cursor:grab',
          `border:1px solid ${placed.has(e.label) ? 'var(--color-primary,#00647f)' : 'var(--color-border,#ddd)'}`,
          `background:${placed.has(e.label) ? 'var(--color-accent-bg,#e4f1f6)' : 'var(--color-bg,#fff)'}`,
        ].join(';');
        chip.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/plain', e.label);
          ev.dataTransfer!.effectAllowed = 'copy';
        });
        // 끌기 말고 눌러서도 넣을 수 있게(끌기가 어려운 환경 대비)
        chip.addEventListener('dblclick', () => {
          if (!placed.has(e.label)) this.setLabels([...labels, e.label]);
        });
        wrap.appendChild(chip);
      }
      group.appendChild(wrap);
      this.paletteEl.appendChild(group);
    }

    // ── 이 탭 구성 ──
    this.listEl.replaceChildren();
    const map = new Map(buildCatalog().map((e) => [e.label, e]));
    labels.forEach((label, idx) => {
      const e = map.get(label);
      const row = mkEl('div', 'rc-row');
      row.draggable = true;
      row.style.cssText = [
        'display:flex;align-items:center;gap:8px',
        'padding:5px 8px;border:1px solid var(--color-border,#ddd);border-radius:5px',
        'background:var(--color-bg,#fff);cursor:grab;font-size:12px',
      ].join(';');
      row.innerHTML = `<i class="ph-duotone ph-${e?.icon ?? 'square'}"></i><span style="flex:1">${label}</span>`;
      const del = mkButton('rc-del', { text: '×', title: '이 탭에서 빼기' });
      del.style.cssText = 'border:0;background:transparent;cursor:pointer;font-size:15px;color:var(--color-text-dim,#888)';
      del.addEventListener('click', () => this.setLabels(labels.filter((_, i) => i !== idx)));
      row.appendChild(del);

      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', label);
        ev.dataTransfer?.setData('application/x-from-index', String(idx));
        ev.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.style.borderColor = 'var(--color-primary,#00647f)'; });
      row.addEventListener('dragleave', () => { row.style.borderColor = 'var(--color-border,#ddd)'; });
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        row.style.borderColor = 'var(--color-border,#ddd)';
        const dropped = ev.dataTransfer?.getData('text/plain');
        if (!dropped) return;
        const fromRaw = ev.dataTransfer?.getData('application/x-from-index');
        const next = [...labels];
        if (fromRaw) {
          // 순서 바꾸기
          const from = Number(fromRaw);
          if (!Number.isFinite(from)) return;
          next.splice(from, 1);
          next.splice(from < idx ? idx - 1 : idx, 0, dropped);
        } else {
          // 팔레트에서 새로 넣기(이미 있으면 그 자리로 옮긴다)
          const exist = next.indexOf(dropped);
          if (exist >= 0) next.splice(exist, 1);
          next.splice(idx, 0, dropped);
        }
        this.setLabels(next);
      });
      this.listEl.appendChild(row);
    });

    // 목록 빈 자리(맨 끝)에 떨구면 뒤에 붙인다
    this.listEl.addEventListener('dragover', (ev) => ev.preventDefault());
    this.listEl.ondrop = (ev): void => {
      ev.preventDefault();
      const dropped = ev.dataTransfer?.getData('text/plain');
      if (!dropped) return;
      const next = labels.filter((l) => l !== dropped);
      next.push(dropped);
      this.setLabels(next);
    };

    if (labels.length === 0) {
      this.listEl.appendChild(mkEl('div', 'rc-hint', '비어 있습니다 — 왼쪽에서 끌어다 놓으세요.'));
    }
  }

  protected onConfirm(): boolean {
    saveLayout(this.layout);
    this.onApply();
    return true;
  }
}

export function showRibbonCustomize(startTab: string, onApply: () => void): void {
  new RibbonCustomizeDialog(startTab, onApply).show();
}
