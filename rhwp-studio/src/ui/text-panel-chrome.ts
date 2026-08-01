/**
 * 문단 패널의 겉틀 — 섹션 줄 + 설명 토글 [?].
 * (canva-right-inspector 에서 분리 2026-08-01: 파일 크기 래칫을 넘었고, 이 둘은
 *  패널 본문 로직과 수명이 다르다 — 문단 패널 UX 결정이 바뀔 때만 손댄다.)
 *
 * 사용자 결정(2026-08-01): 설명은 기본 꺼짐 + 토글, 자주 쓰는 것은 한 화면.
 * 실측 근거: 설명을 다 펼치면 「문단 종류」가 859px 이라 738px 화면을 넘어 스크롤이 났다.
 *
 * ⚠ 「자세히」 접기는 **뺐다**(2026-08-01 2차 지적). 탭 4개는 늘 보이고, 설명 토글은
 *   따로 한 줄을 먹지 않게 **탭 줄 오른쪽 끝**에 붙는다 — 겉틀이 두 줄이던 것이 한 줄이 된다.
 */
import { mkEl, mkButton } from './canva-dom';
import { helpOn, setHelpOn } from './text-panel-sections';

/** 설명 켜기/끄기 — 꺼도 title 툴팁은 살아 있어 마우스를 올리면 읽을 수 있다 */
function helpBar(onToggle: () => void): HTMLElement {
  const bar = mkEl('div', 'canva-help-bar');
  const b = mkButton('canva-help-btn', {
    title: helpOn() ? '설명 끄기' : '설명 켜기 — 각 항목이 무엇을 하는지 보여줍니다',
  });
  b.innerHTML = '<i class="ph-duotone ph-question"></i><span>설명</span>';
  b.classList.toggle('is-on', helpOn());
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    setHelpOn(!helpOn());
    onToggle();
  });
  bar.appendChild(b);
  return bar;
}


/** 「문단」 탭 한 판을 조립한다 — 설명 토글 · 섹션 줄 · 본문 · 「자세히」 */
export function buildTextTab(pane: HTMLElement, o: {
  strip: HTMLElement;
  mount: (host: HTMLElement) => boolean;
  redraw: () => void;
}): void {
  // 탭 줄 한 줄에 섹션 4개 + [설명] — 겉틀이 두 줄을 먹지 않게 한 줄로 합친다
  const row = mkEl('div', 'canva-sec-row');
  o.strip.appendChild(helpBar(o.redraw));
  row.appendChild(o.strip);
  pane.appendChild(row);
  const host = mkEl('div', 'canva-props-host');
  pane.appendChild(host);
  if (!o.mount(host)) {
    host.appendChild(mkEl('div', 'canva-hint', '문단에 커서를 두면 문단 설정이 열립니다.'));
  }
}
