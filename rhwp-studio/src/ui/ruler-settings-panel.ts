/**
 * 환경 설정의 「줄자」 탭 — 줄자 모양을 넷 중에서 고른다.
 * (디자인 "rhwp 줄자 재설계" 2026-08-03 · 사용자 지시: 지금 것 포함 4개 선택지)
 *
 * 카드마다 작은 그림을 그려 **눈으로 고르게** 한다 — 이름만으론 "여백 지도"가 뭔지 모른다.
 * 그림은 실제 줄자와 같은 색·같은 문법(본문 띠·커서 자홍)이라 고른 뒤 놀라지 않는다.
 */
import { userSettings, type RulerStyle } from '@/core/user-settings';
import { RULER_INK } from '@/view/ruler-styles';
import type { EventBus } from '@/core/event-bus';

interface Choice {
  id: RulerStyle;
  name: string;
  desc: string;
  /** 미리보기 그림 — 60×34 캔버스에 그린다 */
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** 미리보기 공통: 종이·본문 띠 위치 */
const BODY_L = 14;
const BODY_R = 48;

const CHOICES: Choice[] = [
  {
    id: 'classic',
    name: '기본 (지금)',
    desc: '한글과 같은 회색 눈금자 — mm 눈금과 들여쓰기 삼각 표식.',
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(BODY_L, 0, BODY_R - BODY_L, h);
      ctx.strokeStyle = '#555555'; ctx.lineWidth = 1;
      for (let x = 4; x < w; x += 5) {
        const big = (x - 4) % 20 === 0;
        ctx.beginPath(); ctx.moveTo(x + 0.5, h); ctx.lineTo(x + 0.5, h - (big ? 9 : 4)); ctx.stroke();
      }
      ctx.fillStyle = '#4080c0';
      ctx.beginPath(); ctx.moveTo(BODY_L - 4, 2); ctx.lineTo(BODY_L + 4, 2); ctx.lineTo(BODY_L, 9);
      ctx.closePath(); ctx.fill();
    },
  },
  {
    id: 'map',
    name: '여백 지도',
    desc: '눈금을 세는 대신 영역을 본다. 본문 폭은 청록 띠, 여백은 빈 종이. 숫자는 커서 자리에만.',
    paint: (ctx, w, h) => {
      ctx.fillStyle = RULER_INK.paper; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = RULER_INK.body;
      ctx.fillRect(BODY_L, h / 2 - 4, BODY_R - BODY_L, 8);
      ctx.fillRect(BODY_L, 0, 1, h); ctx.fillRect(BODY_R, 0, 1, h);
      ctx.fillStyle = RULER_INK.cursor;
      ctx.beginPath(); ctx.moveTo(24, 3); ctx.lineTo(32, 3); ctx.lineTo(28, 11);
      ctx.closePath(); ctx.fill();
    },
  },
  {
    id: 'cross',
    name: '십자 조준',
    desc: '인쇄 돔보에서 가져왔다. 두 줄자에서 뻗은 선이 커서에서 만난다 — 지금 몇 칸인지 눈으로 따라간다.',
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = RULER_INK.paper; ctx.fillRect(BODY_L, 0, BODY_R - BODY_L, h);
      ctx.lineWidth = 1;
      for (let x = 4; x < w; x += 5) {
        const big = (x - 4) % 20 === 0;
        ctx.strokeStyle = big ? RULER_INK.tick : RULER_INK.tickFaint;
        ctx.beginPath(); ctx.moveTo(x + 0.5, h); ctx.lineTo(x + 0.5, h - (big ? 11 : 5)); ctx.stroke();
      }
      ctx.strokeStyle = RULER_INK.cursor;
      ctx.beginPath(); ctx.moveTo(30.5, 0); ctx.lineTo(30.5, h); ctx.stroke();
      ctx.beginPath(); ctx.arc(30.5, h / 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(30.5, h / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = RULER_INK.cursor; ctx.fill();
    },
  },
  {
    id: 'quiet',
    name: '부를 때만',
    desc: '평소엔 실 한 줄. 줄자에 손이 가까이 가면 눈금이 피어나고 여백 손잡이가 나온다 — 글 쓸 때 화면이 조용하다.',
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = RULER_INK.line; ctx.fillRect(0, h - 6, w, 1);
      ctx.fillStyle = RULER_INK.tickFaint; ctx.fillRect(BODY_L, h - 6, BODY_R - BODY_L, 1);
      // 오른쪽 절반은 "깨어난" 모습
      ctx.save();
      ctx.beginPath(); ctx.rect(w / 2, 0, w / 2, h); ctx.clip();
      ctx.strokeStyle = '#bcd9e2'; ctx.lineWidth = 1;
      for (let x = 4; x < w; x += 5) {
        ctx.beginPath(); ctx.moveTo(x + 0.5, h); ctx.lineTo(x + 0.5, h - ((x - 4) % 20 === 0 ? h : 8)); ctx.stroke();
      }
      ctx.fillStyle = RULER_INK.body; ctx.fillRect(BODY_L, h - 5, BODY_R - BODY_L, 2);
      ctx.beginPath(); ctx.moveTo(BODY_R - 4, 0); ctx.lineTo(BODY_R + 4, 0); ctx.lineTo(BODY_R, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },
  },
];

/** 환경 설정 안에 들어갈 줄자 패널 */
export function createRulerPanel(eventBus?: EventBus): HTMLElement {
  const panel = document.createElement('div');

  const section = document.createElement('div');
  section.className = 'dialog-section';
  const title = document.createElement('div');
  title.className = 'dialog-section-title';
  title.textContent = '줄자 모양';
  section.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'dialog-hint';
  hint.style.cssText = 'font-size:12px;color:var(--color-text-dim,#666);line-height:1.5;margin-bottom:10px';
  hint.textContent = '줄자가 알려 줄 것은 셋입니다 — 글이 어디서 시작하고, 어디서 끝나고, 커서가 어느 칸인가. 아래 셋은 그걸 먼저 보여 주고 눈금을 뒤로 물립니다.';
  section.appendChild(hint);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const current = userSettings.getRulerStyle();

  for (const c of CHOICES) {
    const row = document.createElement('label');
    row.className = 'ruler-choice';
    row.style.cssText = [
      'display:flex;gap:10px;align-items:flex-start',
      'padding:9px 10px;border:1px solid var(--color-border,#ddd);border-radius:6px',
      'cursor:pointer',
    ].join(';');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'ruler-style';
    radio.value = c.id;
    radio.checked = c.id === current;
    radio.style.marginTop = '2px';

    const cv = document.createElement('canvas');
    const W = 60, H = 34, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = `width:${W}px;height:${H}px;flex:0 0 auto;border:1px solid var(--color-border,#ddd);border-radius:3px`;
    const cx = cv.getContext('2d');
    if (cx) { cx.setTransform(dpr, 0, 0, dpr, 0, 0); c.paint(cx, W, H); }

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    const name = document.createElement('div');
    name.textContent = c.name;
    name.style.cssText = 'font-size:13px;font-weight:600';
    const desc = document.createElement('div');
    desc.textContent = c.desc;
    desc.style.cssText = 'font-size:11.5px;line-height:1.45;color:var(--color-text-dim,#666)';
    textWrap.append(name, desc);

    const paint = (): void => {
      row.style.borderColor = radio.checked ? 'var(--color-primary,#00647f)' : 'var(--color-border,#ddd)';
      row.style.background = radio.checked ? 'var(--color-accent-bg,#e4f1f6)' : 'transparent';
    };
    paint();

    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      userSettings.setRulerStyle(c.id);
      list.querySelectorAll<HTMLElement>('.ruler-choice').forEach((el) => {
        const r = el.querySelector<HTMLInputElement>('input[type=radio]');
        el.style.borderColor = r?.checked ? 'var(--color-primary,#00647f)' : 'var(--color-border,#ddd)';
        el.style.background = r?.checked ? 'var(--color-accent-bg,#e4f1f6)' : 'transparent';
      });
      // 고르는 즉시 화면 줄자가 바뀐다 — 대화상자를 닫아야 보이면 고를 수가 없다.
      eventBus?.emit('ruler-style-changed', c.id);
    });

    row.append(radio, cv, textWrap);
    list.appendChild(row);
  }

  section.appendChild(list);
  panel.appendChild(section);
  return panel;
}
