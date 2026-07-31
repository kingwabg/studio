/**
 * 검사 결과 패널 — 지적이 있을 때만 편집 영역 오른쪽 아래에 뜨는 알약.
 * 스펙: studio `docs/plans/format-linter.md` (2차)
 *
 * 왜 우측 속성 패널 안이 아닌가: 지적은 **어느 탭을 보고 있든** 알아야 하는 정보다.
 * 글자 탭에 넣으면 표를 만지는 동안 안 보이고, 탭마다 복제하면 진실이 넷이 된다.
 * 접힌 상태는 "검사 N건" 한 줄이라 자리를 거의 안 먹는다.
 */
import type { LintItem } from './items';

const MAX_ROWS = 12;

export class LintPanel {
  private root: HTMLDivElement;
  private open = false;

  constructor(
    private container: HTMLElement,
    private cb: {
      onApplyAll(): void;
      onPick(it: LintItem): void;
      onToggleFormat(on: boolean): void;
      isFormatOn(): boolean;
    },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'lint-panel';
    this.root.hidden = true;
  }

  dispose(): void { this.root.remove(); }

  render(items: LintItem[]): void {
    if (!this.root.parentElement) this.container.appendChild(this.root);
    this.root.textContent = '';
    // 지적이 없어도 서식 검사가 켜져 있으면 끄는 길은 남겨 둔다(켜 놓고 못 끄면 곤란하다).
    if (items.length === 0 && !this.cb.isFormatOn()) { this.root.hidden = true; return; }
    this.root.hidden = false;

    const head = document.createElement('button');
    head.className = 'lint-panel-head';
    const spell = items.filter((i) => i.kind === 'spell').length;
    const fmt = items.length - spell;
    head.innerHTML =
      `<span class="lint-panel-dot"></span><span>검사 ${items.length}건</span>` +
      `<span class="lint-panel-sub">맞춤법 ${spell}${this.cb.isFormatOn() ? ` · 서식 ${fmt}` : ''}</span>` +
      `<i class="ph ph-caret-${this.open ? 'down' : 'up'}"></i>`;
    head.addEventListener('click', () => { this.open = !this.open; this.render(items); });
    this.root.appendChild(head);

    if (!this.open) return;

    const list = document.createElement('div');
    list.className = 'lint-panel-list';
    for (const it of items.slice(0, MAX_ROWS)) {
      const row = document.createElement('button');
      row.className = `lint-panel-row lint-panel-row--${it.kind}`;
      row.innerHTML =
        `<span class="lint-panel-msg">${esc(it.msg)}</span>` +
        (it.detail ? `<span class="lint-panel-detail">${esc(it.detail)}</span>` : '');
      row.addEventListener('click', () => this.cb.onPick(it));
      list.appendChild(row);
    }
    if (items.length > MAX_ROWS) {
      const more = document.createElement('div');
      more.className = 'lint-panel-more';
      more.textContent = `그 밖에 ${items.length - MAX_ROWS}건`;
      list.appendChild(more);
    }
    this.root.appendChild(list);

    const foot = document.createElement('div');
    foot.className = 'lint-panel-foot';
    // 서식 규정 검사는 기본 꺼짐 — 실제 문서에서 수백 건이 뜬다(근거는 lint/items.ts).
    const tog = document.createElement('label');
    tog.className = 'lint-panel-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.cb.isFormatOn();
    box.addEventListener('change', () => this.cb.onToggleFormat(box.checked));
    tog.append(box, document.createTextNode('서식 규정도 검사'));
    foot.appendChild(tog);
    const fixable = items.filter((i) => i.fix).length;
    const all = document.createElement('button');
    all.className = 'lint-card-btn is-primary';
    all.textContent = `전부 적용 (${fixable})`;
    all.disabled = fixable === 0;
    all.addEventListener('click', () => this.cb.onApplyAll());
    foot.appendChild(all);
    this.root.appendChild(foot);
  }
}

/** 문서에서 온 문자열은 그대로 innerHTML 에 넣지 않는다 */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
