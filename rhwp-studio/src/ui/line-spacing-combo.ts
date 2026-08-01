/**
 * 줄 간격 칸 — **하나의 칸**에서 직접 입력 · ▾ 프리셋 · ▲▼ 조절이 다 된다.
 * (사용자 요청 2026-08-01: "프리셋, 조절, 직접 입력 한번에 되게 하자 한컴은 되던데")
 *
 * 종전에는 드롭다운과 스피너가 **따로** 있어 같은 값을 두 칸이 나눠 갖고 있었다 —
 * 어느 쪽이 진짜인지 헷갈리고, 한쪽을 고치면 다른 쪽이 거짓말을 했다.
 *
 * (text-panel-sections 에서 분리: 그 파일이 600줄 실패선을 넘었다. 이 칸은 독립적이라
 *  옮기는 데 얽힘이 없다.)
 */
import { mkEl, mkButton } from './canva-dom';

/** 자주 쓰는 값. 100% 아래는 줄이 겹치지만 표 칸·서명란처럼 눌러 담는 자리가 있다. */
const PRESETS = [10, 25, 50, 80, 100, 120, 160, 200];

export function lineSpacingCombo(initial: number, onChange: (v: number) => void): HTMLElement {
  const box = mkEl('div', 'tps-spin tps-spin--combo');
  let v = initial;

  const val = mkEl('input', 'tps-spin-num') as HTMLInputElement;
  val.type = 'text';
  val.value = String(v);
  val.title = '값을 직접 칠 수 있습니다';

  const commit = (next: number) => {
    v = Math.max(10, Math.min(500, Math.round(next)));
    val.value = String(v);
    onChange(v);
  };
  val.addEventListener('change', () => {
    const n = parseFloat(val.value);
    if (Number.isFinite(n)) commit(n); else val.value = String(v);
  });
  val.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); commit(v + 10); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); commit(v - 10); }
  });

  const menu = mkEl('div', 'tps-spin-menu');
  menu.hidden = true;
  for (const pv of PRESETS) {
    const b = mkButton('tps-spin-item', { text: `${pv}%` });
    if (pv < 100) b.title = `${pv}% — 줄이 겹칠 수 있습니다(칸에 눌러 담을 때)`;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); commit(pv); menu.hidden = true; });
    menu.appendChild(b);
  }
  const caret = mkButton('tps-spin-caret', {
    html: '<i class="ph ph-caret-down"></i>', title: '자주 쓰는 값',
  });
  caret.addEventListener('mousedown', (e) => {
    e.preventDefault();
    menu.hidden = !menu.hidden;
    if (menu.hidden) return;
    const off = (ev: MouseEvent) => {
      if (!box.contains(ev.target as Node)) {
        menu.hidden = true;
        document.removeEventListener('mousedown', off, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  });

  const arrows = mkEl('div', 'tps-spin-arrows');
  const inc = mkButton('tps-spin-arrow', { text: '▲', title: '줄 간격 늘리기' });
  const dec = mkButton('tps-spin-arrow', { text: '▼', title: '줄 간격 줄이기' });
  inc.addEventListener('mousedown', (e) => { e.preventDefault(); commit(v + 10); });
  dec.addEventListener('mousedown', (e) => { e.preventDefault(); commit(v - 10); });
  arrows.append(inc, dec);

  box.append(val, mkEl('span', 'tps-spin-unit', '%'), caret, arrows, menu);
  return box;
}
