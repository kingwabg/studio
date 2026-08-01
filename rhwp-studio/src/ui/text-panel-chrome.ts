/**
 * 문단 패널의 겉틀 두 조각 — 설명 토글 [?] 과 「자세히」 접기.
 * (canva-right-inspector 에서 분리 2026-08-01: 파일 크기 래칫을 넘었고, 이 둘은
 *  패널 본문 로직과 수명이 다르다 — 문단 패널 UX 결정이 바뀔 때만 손댄다.)
 *
 * 사용자 결정(2026-08-01): 설명은 기본 꺼짐 + 토글, 자주 쓰는 것은 한 화면.
 * 실측 근거: 설명을 다 펼치면 「문단 종류」가 859px 이라 738px 화면을 넘어 스크롤이 났다.
 */
import { mkEl, mkButton } from './canva-dom';
import { helpOn, setHelpOn, ADVANCED_SECTIONS } from './text-panel-sections';

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

/** 「자세히」가 펼쳐져 있나 — 화면 상태일 뿐이라 인스펙터가 들고 있을 이유가 없다 */
let advOpen = false;

/** 「자세히」 — 문단 종류·줄 나눔·탭을 접었다 편다 */
function advToggle(open: boolean, onToggle: () => void): HTMLElement {
  const b = mkButton('canva-adv-toggle');
  b.innerHTML = `<span>자세히</span><i class="ph ph-caret-${open ? 'up' : 'down'}"></i>`;
  b.classList.toggle('is-open', open);
  b.title = open ? '접기' : '문단 종류 · 줄 나눔 · 탭 · 보호 옵션';
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onToggle();
  });
  return b;
}

/**
 * 「자세히」 여닫기. 접을 때 고급 섹션을 보고 있었다면 「자주」로 되돌린다 —
 * 안 그러면 버튼만 사라지고 내용이 남아 "왜 못 접지?" 가 된다.
 * @returns 다음 열림 상태
 */
export function toggleAdvanced(cur: { text: string }): void {
  advOpen = !advOpen;
  if (!advOpen && ADVANCED_SECTIONS.includes(cur.text)) cur.text = '자주';
}

/** 섹션 줄에 실제로 보일 것 — 고급 섹션은 「자세히」를 펴야 나온다 */
export function visibleSections(
  all: Array<[string, string]>, kind: string,
): Array<[string, string]> {
  if (kind !== 'text' || advOpen) return all;
  return all.filter(([label]) => !ADVANCED_SECTIONS.includes(label));
}

/** 「문단」 탭 한 판을 조립한다 — 설명 토글 · 섹션 줄 · 본문 · 「자세히」 */
export function buildTextTab(pane: HTMLElement, o: {
  strip: HTMLElement;
  mount: (host: HTMLElement) => boolean;
  onAdv: () => void;
  redraw: () => void;
}): void {
  pane.appendChild(helpBar(o.redraw));
  // 고를 게 하나뿐이면 섹션 줄은 자리만 먹는다 — 「자세히」를 접은 상태가 그렇다
  if (o.strip.children.length > 1) pane.appendChild(o.strip);
  const host = mkEl('div', 'canva-props-host');
  pane.appendChild(host);
  if (!o.mount(host)) {
    host.appendChild(mkEl('div', 'canva-hint', '문단에 커서를 두면 문단 설정이 열립니다.'));
  }
  pane.appendChild(advToggle(advOpen, o.onAdv));
}
