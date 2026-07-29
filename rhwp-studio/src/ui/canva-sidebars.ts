/**
 * [캔버스 한컴 포크] 캔바식 좌/우 사이드바 오케스트레이터.
 * #editor-area를 가로 워크스페이스로 감싸 [좌 팔레트 · 편집영역 · 우 인스펙터/AI]로 재배치.
 * index.html·업스트림 코드는 무수정 — DOM 재구성은 전부 여기 부트스트랩에서 한다.
 */
import type { CanvaServices } from './canva-services';
import { CanvaLeftPalette } from './canva-left-palette';
import { CanvaRightInspector } from './canva-right-inspector';
import { CanvaAiPanel } from './canva-ai-panel';
import { CanvaRecordPanel } from './canva-record-panel';
import { mkEl, mkButton } from './canva-dom';

let mounted = false;

// '1'=캔버스 모드(기본), '0'=문서 모드. main.ts(새 문서 여백 0 분기)와 공유 — 문자열 중복 금지.
export const CANVAS_MODE_KEY = 'rhwpCanvasMode';

export function mountCanvaSidebars(services: CanvaServices): void {
  if (mounted) return;
  const root = document.getElementById('studio-root');
  const editorArea = document.getElementById('editor-area');
  if (!root || !editorArea) return;
  mounted = true;

  mountModeToggle(services);

  // 워크스페이스 행: editorArea 자리에 삽입하고 editorArea를 그 안으로 이동
  const ws = document.createElement('div');
  ws.id = 'canva-workspace';
  root.insertBefore(ws, editorArea);

  const left = buildRail('left');
  const right = buildRail('right');
  ws.append(left.rail, editorArea, right.rail);

  // 좌: 삽입 팔레트
  left.setTitle('삽입');
  new CanvaLeftPalette(left.body, services);

  // 우: [속성] 인스펙터 + [AI] + [녹음] 탭 — buildRail이 만든 body를 인스펙터 창으로 재사용(잉여 노드 방지)
  const inspectorPane = right.body;
  // ⚠ 레이아웃은 CSS 클래스로 — 인라인 display:flex는 [hidden] 규칙을 이겨 탭이 안 숨는다.
  const aiPane = mkEl('div', 'canva-ai-pane-wrap');
  aiPane.hidden = true;
  right.content.append(aiPane);
  const recordPane = mkEl('div', 'canva-record-pane-wrap');
  recordPane.hidden = true;
  right.content.append(recordPane);

  const inspector = new CanvaRightInspector(inspectorPane, services);
  const ai = new CanvaAiPanel(aiPane, services);
  new CanvaRecordPanel(recordPane, services);

  // [디자인 2c 갱신] 탭 = 속성 · 표 · 셀 (AI·녹음은 명세에서 빠짐 → 속성 탭 하단으로 접근)
  const tabs = right.setTabs(['속성', '표', '셀'], (idx) => {
    inspectorPane.hidden = false;
    aiPane.hidden = true;
    recordPane.hidden = true;
    inspector.setPanelTab(idx === 0 ? 'props' : idx === 1 ? 'table' : 'cell');
  });
  // [디자인 2c] 모델 이름 칩은 **AI 패널 안**으로 — 속성 탭에서는 쓰이지 않는 정보라
  // 탭 스트립에 상시 노출할 이유가 없다.
  const badge = ai.getModelBadge();
  badge.classList.add('canva-ai-model--inpane');
  aiPane.prepend(badge);
  void tabs;
}

// [캔버스 한컴 포크] 메뉴바 우측 캔버스/문서 모드 토글 — 입력 해석 레이어 전환(캔바 손맛 vs 한글 커서).
function mountModeToggle(services: CanvaServices): void {
  const menuBar = document.getElementById('menu-bar');
  if (!menuBar) return;

  const wrap = mkEl('div', 'canva-mode-toggle');
  const bCanvas = mkButton('', { text: '캔버스' });
  const bDoc = mkButton('', { text: '문서' });
  wrap.append(bCanvas, bDoc);
  // [리본 재설계 2026-07-29] 구 #menu-bar 는 이제 숨은 채 '파일' 드롭다운만 겹쳐 그린다.
  // 모드 토글은 리본 1행의 전용 자리(.rb-mode-slot)로 옮겨 겹침을 없앤다.
  const ribbonSlot = document.querySelector('.rb-mode-slot');
  (ribbonSlot ?? menuBar).appendChild(wrap);

  const apply = (on: boolean, persist: boolean) => {
    services.getInputHandler()?.setCanvasMode(on);
    bCanvas.classList.toggle('is-active', on);
    bDoc.classList.toggle('is-active', !on);
    if (persist) { try { localStorage.setItem(CANVAS_MODE_KEY, on ? '1' : '0'); } catch { /* ignore */ } }
  };
  bCanvas.addEventListener('click', () => apply(true, true));
  bDoc.addEventListener('click', () => apply(false, true));

  let initial = true;
  try { initial = localStorage.getItem(CANVAS_MODE_KEY) !== '0'; } catch { /* ignore */ }
  apply(initial, false);
}

interface RailParts {
  rail: HTMLElement;
  head: HTMLElement;
  content: HTMLElement;
  body: HTMLElement;
  setTitle: (t: string) => void;
  setTabs: (labels: string[], onSelect: (idx: number) => void) => HTMLElement[];
}

function buildRail(side: 'left' | 'right'): RailParts {
  const rail = mkEl('aside', `canva-rail canva-rail--${side}`);

  const head = mkEl('div', 'canva-rail-head');
  rail.appendChild(head);

  // content = 스크롤/플렉스 컨테이너 (좌: body 하나, 우: 인스펙터+AI 스왑)
  // ⚠ 인라인 display 금지 — 접힘 시 `.is-collapsed > * {display:none}`이 인라인을 못 이겨
  //   콘텐츠 min-content가 폭을 붙잡는다. 반드시 클래스로 지정.
  const content = mkEl('div', 'canva-rail-content');
  rail.appendChild(content);

  const body = mkEl('div', 'canva-rail-body');
  content.appendChild(body);

  // 접기 손잡이
  const handle = mkButton('canva-rail-handle');
  const setChevron = () => {
    const collapsed = rail.classList.contains('is-collapsed');
    // 좌 레일: 열림=◀(접기)·닫힘=▶(펼치기), 우 레일 반대
    const open = side === 'left' ? '‹' : '›';
    const close = side === 'left' ? '›' : '‹';
    handle.textContent = collapsed ? close : open;
  };
  handle.addEventListener('click', () => { rail.classList.toggle('is-collapsed'); setChevron(); });
  rail.appendChild(handle);
  setChevron();

  // [디자인 2c 갱신 2026-07-29] 우측 패널은 **가변 폭** — 왼쪽 가장자리를 끌어 조절한다.
  if (side === 'right') {
    const grip = mkEl('div', 'canva-rail-grip');
    grip.title = '드래그해서 패널 폭 조절';
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = (e as MouseEvent).clientX;
      const startW = rail.getBoundingClientRect().width;
      const move = (ev: MouseEvent) => {
        // 왼쪽 가장자리를 끌므로 왼쪽으로 갈수록 넓어진다
        const w = Math.max(240, Math.min(560, startW + (startX - ev.clientX)));
        rail.style.width = `${w}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        try { localStorage.setItem('rhwp:right-rail-width', String(Math.round(rail.getBoundingClientRect().width))); } catch { /* 저장 실패 무시 */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    rail.appendChild(grip);
    // 지난 폭 복원
    try {
      const saved = Number(localStorage.getItem('rhwp:right-rail-width'));
      if (saved >= 240 && saved <= 560) rail.style.width = `${saved}px`;
    } catch { /* 무시 */ }
  }

  return {
    rail, head, content, body,
    setTitle(t: string) {
      head.appendChild(mkEl('span', 'canva-rail-title', t));
    },
    setTabs(labels, onSelect) {
      const btns: HTMLElement[] = [];
      labels.forEach((label, idx) => {
        const b = mkButton('canva-tab' + (idx === 0 ? ' is-active' : ''), { html: `<span>${label}</span>` });
        b.addEventListener('click', () => {
          btns.forEach((x) => x.classList.toggle('is-active', x === b));
          onSelect(idx);
        });
        head.appendChild(b);
        btns.push(b);
      });
      return btns;
    },
  };
}
