/**
 * [캔버스 한컴 포크] 캔바식 좌/우 사이드바 오케스트레이터.
 * #editor-area를 가로 워크스페이스로 감싸 [좌 팔레트 · 편집영역 · 우 인스펙터/AI]로 재배치.
 * index.html·업스트림 코드는 무수정 — DOM 재구성은 전부 여기 부트스트랩에서 한다.
 */
import type { CanvaServices } from './canva-services';
import { CanvaLeftPalette } from './canva-left-palette';
import { CanvaRightInspector } from './canva-right-inspector';
import { CanvaAiPanel } from './canva-ai-panel';

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

  // 우: [속성] 인스펙터 + [AI] 탭 — buildRail이 만든 body를 인스펙터 창으로 재사용(잉여 노드 방지)
  const inspectorPane = right.body;
  const aiPane = document.createElement('div');
  aiPane.className = 'canva-ai-pane-wrap';
  aiPane.style.cssText = 'flex:1;display:flex;min-height:0;';
  aiPane.hidden = true;
  right.content.append(aiPane);

  new CanvaRightInspector(inspectorPane, services);
  const ai = new CanvaAiPanel(aiPane, services);

  const tabs = right.setTabs(['속성', 'AI'], (idx) => {
    inspectorPane.hidden = idx !== 0;
    aiPane.hidden = idx !== 1;
  });
  // AI 탭에 모델 배지 부착
  tabs[1].appendChild(ai.getModelBadge());
}

// [캔버스 한컴 포크] 메뉴바 우측 캔버스/문서 모드 토글 — 입력 해석 레이어 전환(캔바 손맛 vs 한글 커서).
function mountModeToggle(services: CanvaServices): void {
  const menuBar = document.getElementById('menu-bar');
  if (!menuBar) return;

  const wrap = document.createElement('div');
  wrap.className = 'canva-mode-toggle';
  const bCanvas = document.createElement('button');
  bCanvas.type = 'button';
  bCanvas.textContent = '캔버스';
  const bDoc = document.createElement('button');
  bDoc.type = 'button';
  bDoc.textContent = '문서';
  wrap.append(bCanvas, bDoc);
  menuBar.appendChild(wrap);

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
  const rail = document.createElement('aside');
  rail.className = `canva-rail canva-rail--${side}`;

  const head = document.createElement('div');
  head.className = 'canva-rail-head';
  rail.appendChild(head);

  // content = 스크롤/플렉스 컨테이너 (좌: body 하나, 우: 인스펙터+AI 스왑)
  // ⚠ 인라인 display 금지 — 접힘 시 `.is-collapsed > * {display:none}`이 인라인을 못 이겨
  //   콘텐츠 min-content가 폭을 붙잡는다. 반드시 클래스로 지정.
  const content = document.createElement('div');
  content.className = 'canva-rail-content';
  rail.appendChild(content);

  const body = document.createElement('div');
  body.className = 'canva-rail-body';
  content.appendChild(body);

  // 접기 손잡이
  const handle = document.createElement('button');
  handle.className = 'canva-rail-handle';
  handle.type = 'button';
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

  return {
    rail, head, content, body,
    setTitle(t: string) {
      const title = document.createElement('span');
      title.className = 'canva-rail-title';
      title.textContent = t;
      head.appendChild(title);
    },
    setTabs(labels, onSelect) {
      const btns: HTMLElement[] = [];
      labels.forEach((label, idx) => {
        const b = document.createElement('button');
        b.className = 'canva-tab' + (idx === 0 ? ' is-active' : '');
        b.type = 'button';
        b.innerHTML = `<span>${label}</span>`;
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
