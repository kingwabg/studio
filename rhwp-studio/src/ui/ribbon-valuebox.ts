/**
 * 리본 값 상자 — 「값 + 프리셋(⌄) + 스피너(▲▼)」 한 덩어리.
 *
 * 눈 먼 ± 버튼(누르면 얼마가 됐는지 모른다) 대신 **지금 값이 보이는** 컨트롤이다.
 * 크기·줄 간격·들여쓰기·내어쓰기가 같은 모양을 쓴다(사용자 지시 2026-08-03).
 * 마크업/클래스는 기존 크기 스피너(.sb-size-group)를 그대로 따라 CSS 신규 없이 붙는다.
 */

export interface ValueBoxOpts {
  /**
   * 상자 앞에 붙는 아이콘 단추 — 누르면 **한 번에 적용**(들여쓰기 한 단계 등).
   * 값 상자는 그 옆에서 정밀 조정을 맡는다: "눌러서 바로 적용 + 값도 바로 수정"
   * (사용자 요청 2026-08-03). cmd 를 주면 data-cmd 가 붙어 활성 표시도 같이 받는다.
   */
  leadIcon?: { svg: string; title: string; cmd?: string; onClick?: () => void };
  /** 표시 단위 — 'pt' | '%' 등 */
  unit: string;
  /** ⌄ 를 눌렀을 때 뜨는 프리셋 값들 */
  presets: number[];
  /** ▲▼ 한 번의 증감폭 */
  step: number;
  min: number;
  max: number;
  /** 소수 자리 (크기 12.0 처럼) */
  decimals?: number;
  width?: number;
  title?: string;
  /** 값이 확정될 때 — 타이핑 후 Enter/blur, 프리셋 선택, 스피너 */
  onCommit: (value: number) => void;
}

export interface ValueBox {
  el: HTMLElement;
  /** 커서 자리 값이 바뀌면 호출 — 사용자가 타이핑 중이면 건드리지 않는다 */
  setValue: (v: number | undefined) => void;
}

export function createValueBox(opts: ValueBoxOpts): ValueBox {
  const dec = opts.decimals ?? 0;
  const fmt = (v: number): string => v.toFixed(dec);

  const group = document.createElement('span');
  group.className = 'sb-size-group rb-valuebox';
  if (opts.width) group.style.width = `${opts.width}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sb-size';
  if (opts.title) input.title = opts.title;

  const unit = document.createElement('span');
  unit.className = 'sb-size-unit';
  unit.textContent = opts.unit;

  // 프리셋 ⌄
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'sb-arrow rb-vb-caret';
  caret.textContent = '⌄';
  caret.title = '자주 쓰는 값';

  const arrows = document.createElement('span');
  arrows.className = 'sb-size-arrows';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'sb-arrow';
  up.textContent = '▲';
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'sb-arrow';
  down.textContent = '▼';
  arrows.append(up, down);

  // 아이콘 단추(선택) — 값 칸 앞. 편집 포커스를 뺏지 않게 mousedown 으로 잡는다.
  let lead: HTMLButtonElement | null = null;
  if (opts.leadIcon) {
    lead = document.createElement('button');
    lead.type = 'button';
    lead.className = 'rb-vb-lead';
    lead.title = opts.leadIcon.title;
    lead.innerHTML = opts.leadIcon.svg;
    if (opts.leadIcon.cmd) lead.dataset.cmd = opts.leadIcon.cmd;
    const fire = opts.leadIcon.onClick;
    lead.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire?.();
    });
    group.appendChild(lead);
  }

  group.append(input, unit, caret, arrows);

  let current: number | undefined;
  let typing = false;

  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const commit = (v: number): void => {
    const c = clamp(v);
    current = c;
    input.value = fmt(c);
    opts.onCommit(c);
  };

  input.addEventListener('focus', () => { typing = true; });
  input.addEventListener('blur', () => {
    typing = false;
    const n = parseFloat(input.value);
    if (Number.isFinite(n)) commit(n);
    else if (current !== undefined) input.value = fmt(current);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (current !== undefined) input.value = fmt(current);
      input.blur();
    }
  });

  // 스피너 — mousedown 으로 잡아 편집 포커스를 뺏지 않는다(리본 다른 버튼과 같은 관례)
  const bump = (dir: number) => (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    commit((current ?? opts.presets[0] ?? opts.min) + dir * opts.step);
  };
  up.addEventListener('mousedown', bump(1));
  down.addEventListener('mousedown', bump(-1));

  // 프리셋 목록
  let menu: HTMLElement | null = null;
  const closeMenu = (): void => { menu?.remove(); menu = null; };
  const toggleMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    const m = document.createElement('div');
    m.className = 'rb-over-panel rb-vb-menu';
    const r = group.getBoundingClientRect();
    m.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;z-index:60;min-width:${r.width}px`;
    for (const p of opts.presets) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rb-over-row';
      row.textContent = `${fmt(p)}${opts.unit}`;
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        commit(p);
        closeMenu();
      });
      m.appendChild(row);
    }
    document.body.appendChild(m);
    menu = m;
    const off = (ev: MouseEvent): void => {
      if (menu && !menu.contains(ev.target as Node)) { closeMenu(); document.removeEventListener('mousedown', off, true); }
    };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  };
  caret.addEventListener('mousedown', toggleMenu);
  // 아이콘에 할 일이 없으면(크기·줄 간격) 아이콘도 프리셋을 연다 — 죽은 단추를 두지 않는다.
  if (lead && !opts.leadIcon?.onClick) lead.addEventListener('mousedown', toggleMenu);

  return {
    el: group,
    setValue: (v) => {
      if (typing) return; // 타이핑 중엔 밀어내지 않는다
      current = v;
      input.value = v === undefined ? '' : fmt(v);
    },
  };
}
