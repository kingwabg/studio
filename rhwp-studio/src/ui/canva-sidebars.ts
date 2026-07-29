/**
 * [캔버스 한컴 포크] 캔바식 좌/우 사이드바 오케스트레이터.
 * #editor-area를 가로 워크스페이스로 감싸 [좌 팔레트 · 편집영역 · 우 인스펙터/AI]로 재배치.
 * index.html·업스트림 코드는 무수정 — DOM 재구성은 전부 여기 부트스트랩에서 한다.
 */
import type { CanvaServices } from './canva-services';
import { CanvaLeftPalette } from './canva-left-palette';
import { CanvaRightInspector, type PanelTab } from './canva-right-inspector';
import { CanvaAiPanel } from './canva-ai-panel';
import { CanvaRecordPanel } from './canva-record-panel';
import { mkEl, mkButton } from './canva-dom';

let mounted = false;

// '1'=캔버스 모드(기본), '0'=문서 모드. main.ts(새 문서 여백 0 분기)와 공유 — 문자열 중복 금지.
export const CANVAS_MODE_KEY = 'rhwpCanvasMode';

/**
 * 표/셀 속성 패널을 연다 — 사이드바가 마운트된 뒤에만 동작한다.
 * 명령 계층이 UI 인스턴스를 직접 알 필요가 없도록 모듈 함수로 노출한다
 * (구 TableCellPropsDialog 진입점들이 이걸 부른다).
 */
export let openTablePanel: (which: 'text' | 'table' | 'cell', section?: string) => void = () => {};

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
  // [컨텍스트 탭 2026-07-30] 탭 4종이 있고 **보이는 집합이 선택을 따라간다**:
  // 본문 = 속성·텍스트 / 표 안 = 속성·텍스트·표·셀 / 선택 없음 = 속성.
  const ALL_TABS: PanelTab[] = ['props', 'text', 'table', 'cell'];
  const LABELS: Record<PanelTab, string> = { props: '속성', text: '텍스트', table: '표', cell: '셀' };
  const showTab = (idx: number) => {
    inspectorPane.hidden = false;
    aiPane.hidden = true;
    recordPane.hidden = true;
    inspector.setPanelTab(ALL_TABS[idx]);
  };
  const tabs = right.setTabs(ALL_TABS.map((t) => LABELS[t]), showTab);
  inspector.onTabsState = (visible, active) => {
    tabs.forEach((b, i) => {
      const tab = ALL_TABS[i];
      b.hidden = !visible.includes(tab);
      b.classList.toggle('is-active', tab === active);
    });
  };
  inspector.pokeTabs();

  // 표/셀·문단 속성 진입점(명령·우클릭·리본)이 여는 곳 — 대화상자를 대신한다.
  openTablePanel = (which, section) => {
    right.rail.classList.remove('is-collapsed');
    if (section) inspector.setSection(which, section);
    showTab(ALL_TABS.indexOf(which));
  };
  // [디자인 갱신 2026-07-30] 모델 칩은 AI 패널 **머리말 안**으로 들어갔다(패널이 직접 배치).
  // 뒤로가기는 속성 탭으로 — 패널이 이벤트로 알려 온다.
  const showTool = (pane: HTMLElement | null) => {
    inspectorPane.hidden = !!pane;
    aiPane.hidden = pane !== aiPane;
    recordPane.hidden = pane !== recordPane;
    if (!pane) inspector.setPanelTab('props');
  };
  services.eventBus.on('ai-panel-open', () => { right.rail.classList.remove('is-collapsed'); showTool(aiPane); });
  services.eventBus.on('record-panel-open', () => { right.rail.classList.remove('is-collapsed'); showTool(recordPane); });
  services.eventBus.on('ai-panel-close', () => showTool(null));
  void ai;
}

// [캔버스 한컴 포크] 메뉴바 우측 캔버스/문서 모드 토글 — 입력 해석 레이어 전환(캔바 손맛 vs 한글 커서).
function mountModeToggle(services: CanvaServices): void {
  const menuBar = document.getElementById('menu-bar');
  if (!menuBar) return;

  // [디자인 갱신 2026-07-30] 버튼 두 개 → 회색 트랙 안 흰 알약 세그먼트(아이콘 + 라벨).
  // 선택된 쪽이 흰 알약 + 그림자로 떠오른다 — 지금 어느 모드인지 한눈에 보인다.
  const wrap = mkEl('div', 'canva-mode-toggle');
  const seg = (label: string, icon: string, title: string) => {
    const b = mkButton('canva-mode-seg', { title });
    b.innerHTML = `<i class="ph-duotone ph-${icon}"></i><span>${label}</span>`;
    return b;
  };
  const bCanvas = seg('캔버스', 'selection-all', '캔버스 모드 — 개체를 자유롭게 놓습니다');
  const bDoc = seg('문서', 'article', '문서 모드 — 한글 커서로 글을 흘립니다');
  wrap.append(bCanvas, bDoc);
  // [리본 재설계 2026-07-29] 구 #menu-bar 는 이제 숨은 채 '파일' 드롭다운만 겹쳐 그린다.
  // 모드 토글은 리본 1행의 전용 자리(.rb-mode-slot)로 옮겨 겹침을 없앤다.
  const ribbonSlot = document.querySelector('.rb-mode-slot');
  (ribbonSlot ?? menuBar).appendChild(wrap);

  const apply = (on: boolean, persist: boolean) => {
    services.getInputHandler()?.setCanvasMode(on);
    bCanvas.classList.toggle('is-active', on);
    bDoc.classList.toggle('is-active', !on);
    // 선택된 쪽만 fill 아이콘 — 디자인의 ph-fill/ph-duotone 대비
    bCanvas.querySelector('i')!.className = `${on ? 'ph-fill' : 'ph-duotone'} ph-selection-all`;
    bDoc.querySelector('i')!.className = `${on ? 'ph-duotone' : 'ph-fill'} ph-article`;
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

  // [디자인 2c] 우측 패널은 **가변 폭** — 왼쪽 가장자리 손잡이 하나가 전부 한다:
  // 끌면 폭 조절, 그냥 누르면(3px 미만 이동) 접기/펼치기. 손잡이가 둘이면 어느 쪽을
  // 눌러야 하는지 매번 헷갈린다.
  if (side === 'right') {
    handle.remove();
    const grip = mkEl('div', 'canva-rail-grip');
    grip.title = '드래그해서 폭 조절 · 클릭해서 접기';
    grip.innerHTML = '<i class="canva-grip-line"></i><i class="canva-grip-dots"></i>';
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = (e as MouseEvent).clientX;
      const startW = rail.getBoundingClientRect().width;
      let moved = false;
      const move = (ev: MouseEvent) => {
        // 왼쪽 가장자리를 끌므로 왼쪽으로 갈수록 넓어진다
        const dx = startX - ev.clientX;
        if (Math.abs(dx) > 3) moved = true;
        if (!moved) return;
        rail.classList.remove('is-collapsed');
        rail.style.width = `${Math.max(220, Math.min(420, startW + dx))}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!moved) { rail.classList.toggle('is-collapsed'); return; }
        try { localStorage.setItem('rhwp:right-rail-width', String(Math.round(rail.getBoundingClientRect().width))); } catch { /* 저장 실패 무시 */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    rail.appendChild(grip);
    // 지난 폭 복원
    try {
      const saved = Number(localStorage.getItem('rhwp:right-rail-width'));
      if (saved >= 220 && saved <= 420) rail.style.width = `${saved}px`;
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
