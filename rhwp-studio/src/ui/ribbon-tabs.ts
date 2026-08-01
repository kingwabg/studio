/**
 * 리본 탭 데이터 — 어떤 탭에 어떤 명령이 어떤 순서로 놓이나.
 * (ribbon-header.ts 에서 분리 2026-08-01: 렌더러와 목록을 한 파일에 두니 600줄
 *  실패선을 넘었다. 목록은 자주 바뀌고 렌더러는 거의 안 바뀐다 — 수명이 다르다.)
 *
 * 디자인 정본 = "rhwp 헤더·리본 재설계" 2a.
 */

export type RibbonItem =
  | { kind: 'btn'; icon: string; label: string; cmd?: string; primary?: boolean; hint?: string }
  | { kind: 'gap' }
  | { kind: 'combo'; label: string; width: number; cmd?: string }
  /** 기존 Toolbar 가 소유한 실제 컨트롤(#font-name 등)을 이 자리로 옮겨 담는다 */
  | { kind: 'slot'; slot: string; width: number; label?: string }
  | { kind: 'expander'; label: string; cmd?: string }
  | { kind: 'over'; icon: string; label: string; key?: string; cmd?: string };

const P = (icon: string, label: string, cmd?: string, hint?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd, hint });
const PP = (icon: string, label: string, cmd?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd, primary: true });
const gap = (): RibbonItem => ({ kind: 'gap' });
const combo = (label: string, width: number, cmd?: string): RibbonItem =>
  ({ kind: 'combo', label, width, cmd });
const slot = (name: string, width: number, label?: string): RibbonItem =>
  ({ kind: 'slot', slot: name, width, label });
const O = (icon: string, label: string, key?: string, cmd?: string): RibbonItem =>
  ({ kind: 'over', icon, label, key, cmd });

export const RIBBON_TABS: Array<{ id: string; label: string; items: RibbonItem[] }> = [
  {
    id: 'home',
    label: '홈',
    // 홈 = 편집 + 서식 필수를 한 줄에 (탭 전환 없이 "쓰기 → 꾸미기")
    items: [
      // 되돌리기·잘라내기 묶음은 '편집' 탭으로 옮겼다(2026-07-30) — 홈은 서식에 전념한다.
      // 글꼴·크기는 Toolbar 가 소유한 실제 컨트롤을 옮겨 온다(상태 동기·이벤트 유지)
      // 한컴 순서(사용자 요청 2026-08-01): 되돌리기·다시 실행 │ 스타일 · 글꼴 · 크기 │ …
      // 되돌리기 둘은 '편집' 탭에도 있지만 여기서도 첫 자리를 준다 — 손이 가장 많이
      // 가는 두 명령이라 탭을 옮겨 다니게 하지 않는다(한컴·워드가 같은 이유로 그렇다).
      PP('arrow-counter-clockwise', '되돌리기', 'edit:undo'),
      PP('arrow-clockwise', '다시 실행', 'edit:redo'),
      gap(),
      slot('style-name', 116, '스타일'),
      slot('font-name', 132, '글꼴'),
      slot('font-size', 74, '크기'),
      gap(),
      P('text-b', '굵게', 'format:bold'),
      P('text-italic', '기울임', 'format:italic'),
      P('text-underline', '밑줄', 'format:underline'),
      P('text-strikethrough', '취소선', 'format:strikethrough'),
      // 글자 색·형광펜은 구 서식바(Toolbar)가 소유한 동작하는 피커를 입양한다
      // (글꼴 콤보와 같은 adopt 패턴 — 이벤트·상태 동기가 그대로 산다. 배선은 main.ts).
      // 색 피커는 Toolbar 의 살아 있는 컨트롤을 입양한다 — 나머지 타일처럼 이름을 붙인다
      slot('text-color', 44, '글자 색'),
      slot('highlight', 46, '형광펜'),
      gap(),
      // 정렬 4종은 한컴·워드와 같은 순서(왼쪽·가운데·오른쪽·양쪽)로 나란히 둔다 —
      // '오른쪽 정렬'만 「⋯」에 숨어 있어 정렬을 고르는 손이 두 곳으로 갈렸다(2026-07-30).
      P('text-align-left', '왼쪽 정렬', 'format:align-left'),
      P('text-align-center', '가운데 정렬', 'format:align-center'),
      P('text-align-right', '오른쪽 정렬', 'format:align-right'),
      P('text-align-justify', '양쪽 정렬', 'format:align-justify'),
      P('arrows-vertical', '줄 간격', 'format:line-spacing'),
      gap(),
      P('list-numbers', '문단 번호', 'format:toggle-numbering'),
      P('list-bullets', '글머리표', 'format:toggle-bullet'),
      P('text-indent', '한 수준 증가', 'format:level-increase'),
      P('text-outdent', '한 수준 감소', 'format:level-decrease'),
      gap(),
      // 글자 간격(자간·장평) — 문단 수준(들여쓰기)과 같은 '간격' 무리라 옆에 둔다.
      // 명령은 이미 있었다(format:char-spacing-*/char-ratio-*, 단축키 Shift+Alt+N/W/J/K).
      // ⚠ 자간과 장평은 "비슷해 보인다"는 지적을 받았다(2026-08-01). 둘 다 한 줄에
      //   들어가는 글자 수를 바꿔서 그렇게 느껴지는데, 바꾸는 대상이 다르다 —
      //   자간은 글자 **사이**, 장평은 글자 **자체의 폭**이다. 툴팁으로 못 박는다.
      P('arrows-in-line-horizontal', '자간 줄이기', 'format:char-spacing-decrease',
        '글자와 글자 사이를 좁힙니다 — 글자 모양은 그대로입니다 (Shift+Alt+N)'),
      P('arrows-out-line-horizontal', '자간 늘리기', 'format:char-spacing-increase',
        '글자와 글자 사이를 벌립니다 — 글자 모양은 그대로입니다 (Shift+Alt+W)'),
      P('arrows-in-simple', '장평 줄이기', 'format:char-ratio-decrease',
        '글자 자체를 홀쭉하게 만듭니다 — 사이 간격이 아니라 글자 폭입니다 (Shift+Alt+J)'),
      P('arrows-out-simple', '장평 늘리기', 'format:char-ratio-increase',
        '글자 자체를 넓적하게 만듭니다 — 사이 간격이 아니라 글자 폭입니다 (Shift+Alt+K)'),
      gap(),
      // 「⋯」에 있던 두 대화상자를 꺼내 놓는다. 옛 '자세히' 확장 버튼은 글자 모양과
      // 같은 명령이라 중복 — 버튼으로 대체하고 홈의 오버플로는 비운다(⋯ 자동 소멸).
      P('text-aa', '글자 모양', 'format:char-shape'),
      P('paragraph', '문단 모양', 'format:para-shape'),
    ],
  },
  {
    id: 'edit',
    label: '편집',
    // 되돌리기·오려두기 묶음의 집. 찾기 계열도 여기로 모아 홈·검토와 겹치지 않게 한다
    // (헤더 재설계의 '같은 명령이 세 곳에 중복되지 않는다' 규칙).
    items: [
      PP('arrow-counter-clockwise', '되돌리기', 'edit:undo'),
      PP('arrow-clockwise', '다시 실행', 'edit:redo'),
      gap(),
      P('scissors', '오려 두기', 'edit:cut'),
      P('copy', '복사', 'edit:copy'),
      P('clipboard-text', '붙이기', 'edit:paste'),
      gap(),
      P('paint-brush', '모양 복사', 'edit:format-copy'),
      P('paint-bucket', '모양 붙여넣기', 'edit:format-paste'),
      gap(),
      P('selection-all', '모두 선택', 'edit:select-all'),
      P('eraser', '지우기', 'edit:delete'),
      gap(),
      P('magnifying-glass', '찾기', 'edit:find'),
      P('text-t', '찾아 바꾸기', 'edit:find-replace'),
      P('crosshair', '찾아가기', 'edit:goto'),
      O('arrow-counter-clockwise', '다시 찾기', 'Ctrl+L', 'edit:find-again'),
    ],
  },
  {
    id: 'insert',
    label: '삽입',
    items: [
      PP('table', '표', 'table:create'),
      PP('image', '그림', 'insert:image'),
      PP('shapes', '도형', 'insert:shape'),
      P('text-t', '글상자', 'insert:textbox'),
      gap(),
      P('math-operations', '수식', 'insert:equation'),
      P('asterisk', '문자표', 'insert:symbols'),
      P('smiley', '이모지', 'insert:emoji'),
      P('brackets-curly', '필드 입력', 'insert:field'),
      gap(),
      P('link-simple', '하이퍼링크', 'insert:hyperlink'),
      P('bookmark-simple', '책갈피', 'insert:bookmark'),
      gap(),
      P('note', '각주', 'insert:footnote'),
      P('notebook', '미주', 'insert:endnote'),
      gap(),
      P('sliders-horizontal', '개체 속성', 'insert:picture-props'),
      O('subtitles', '캡션 넣기', 'Ctrl+N,C', 'insert:caption-toggle'),
      O('arrow-clockwise', '오른쪽 90° 회전', '', 'insert:rotate-cw'),
      O('flip-horizontal', '좌우 대칭', '', 'insert:flip-horz'),
      O('flip-vertical', '상하 대칭', '', 'insert:flip-vert'),
      O('trash', '개체 지우기', 'Delete', 'insert:picture-delete'),
    ],
  },
  {
    id: 'layout',
    label: '레이아웃',
    items: [
      PP('article', '편집 용지', 'file:page-setup'),
      P('selection', '쪽 테두리/배경', 'page:page-border'),
      gap(),
      PP('arrow-line-up', '머리말', 'page:header-create'),
      PP('arrow-line-down', '꼬리말', 'page:footer-create'),
      P('hash', '쪽 번호', 'page:insert-field-pagenum'),
      P('number-square-one', '새 번호로 시작', 'page:new-page-num'),
      gap(),
      P('rows', '쪽 나누기', 'page:break'),
      P('columns', '단 나누기', 'page:column-break'),
      P('columns-plus-right', '단 설정', 'page:col-settings'),
      gap(),
      P('grid-four', '격자 보기', 'view:toggle-grid'),
      P('grid-nine', '격자 설정', 'view:grid-settings'),
      gap(),
      P('rectangle-dashed', '구역 설정', 'page:section-settings'),
      P('arrows-out-line-horizontal', '구역 나누기', 'page:section-break'),
      P('stack-simple', '바탕쪽', 'page:masterpage'),
      P('printer', '인쇄', 'file:print'),
      O('eye-slash', '현재 쪽만 감추기', '', 'page:hide-current'),
      O('crop', '잘림 보기', '', 'view:toggle-clip'),
    ],
  },
  {
    id: 'tools',
    label: '도구',
    // 디자인의 tools 탭 그대로. AI·녹음은 `side:` 로 우측 패널을 여는 항목이라 명령으로 배선.
    // ⚠ 아직 구현이 없는 도구(사전·번역·스크립트·문서 공유·함께 편집)도 **자리를 남긴다** —
    //   누르면 '준비 중' 안내가 뜬다(tool.ts). 뺄지 말지는 제품 결정이다.
    items: [
      PP('sparkle', 'AI 도우미', 'tool:ai-panel'),
      PP('microphone', '음성 녹음', 'tool:record-panel'),
      gap(),
      P('text-aa', '맞춤법 검사', 'edit:spellcheck'),
      gap(),
      P('table', '표 빈칸 채우기', 'tool:table-fill'),
      gap(),
      P('stamp', '도장 만들기', 'tool:seal-maker'),
      P('list-checks', '전자서명 체크리스트', 'tool:esign-checklist'),
      P('chart-bar', '동의율 시뮬레이터', 'tool:consent-sim'),
      P('file-lock', 'NDA 생성기', 'tool:nda-generator'),
      P('ruler', '서식 규정 검사', 'edit:format-lint'),
      P('books', '사전', 'tool:dictionary'),
      P('translate', '번역', 'tool:translate'),
      gap(),
      P('list-numbers', '차례 만들기', 'insert:toc'),
      P('text-align-left', '상용구', 'insert:snippet'),
      gap(),
      P('command', '명령 팔레트', 'tool:command-palette'),
      P('puzzle-piece', '스크립트', 'tool:script'),
      P('gear-six', '환경 설정', 'tool:options'),
      O('cloud-arrow-up', '문서 공유', '', 'tool:share'),
      O('users-three', '함께 편집', '', 'tool:coedit'),
    ],
  },
  {
    id: 'review',
    label: '검토',
    items: [
      PP('git-diff', '문서 비교', 'edit:compare-documents'),
      PP('clock-counter-clockwise', '이력 관리', 'edit:document-history'),
      gap(),
      // 변경 내용 추적 (track-changes.md) — 토글·적용/취소·이동
      PP('pencil-line', '변경 추적', 'review:track-toggle'),
      P('check', '적용 후 다음', 'review:accept-change'),
      P('x', '취소 후 다음', 'review:reject-change'),
      P('caret-left', '이전 변경', 'review:prev-change'),
      P('caret-right', '다음 변경', 'review:next-change'),
      P('eye', '본 최종', 'review:view-final'),
      O('checks', '모두 적용', '', 'review:accept-all'),
      O('trash', '모두 취소', '', 'review:reject-all'),
      gap(),
      P('brackets-angle', '조판 부호', 'view:ctrl-mark'),
      P('arrow-elbow-down-left', '문단 부호', 'view:para-mark'),
      gap(),
      P('magnifying-glass-plus', '확대', 'view:zoom-in'),
      P('magnifying-glass-minus', '축소', 'view:zoom-out'),
      gap(),
      O('info', '제품 정보', '', 'file:about'),
    ],
  },
];

/** 아이콘 굵기 — 디자인 2b (기본값 듀오톤) */

/**
 * 탭마다 기본으로 「⋯ 편집」에 접어 두는 명령(디자인 2a).
 * 이름을 붙이면 버튼이 커져 한 줄에 다 안 들어간다 — 자주 쓰는 것만 리본에 남기고
 * 나머지는 접는다. 사용자가 켜면 그 선택이 이긴다(아래 hidden 저장).
 */
export const DEFAULT_OFF: Record<string, string[]> = {
  // 한 수준 증가·감소는 사용자 요청으로 기본 노출(2026-08-01). 자간·장평 4종 중
  // 자주 쓰는 '자간'만 남기고 '장평'은 접는다 — 홈 한 줄에 다 들어가지 않는다.
  home: ['취소선', '장평 줄이기', '장평 늘리기'],
  edit: ['모양 붙여넣기', '찾아가기'],
  insert: ['필드 입력', '미주', '이모지'],
  layout: ['격자 설정', '새 번호로 시작', '구역 나누기', '쪽 테두리/배경', '바탕쪽'],
  tools: ['스크립트', '사전', '번역', '상용구', 'NDA 생성기', '동의율 시뮬레이터', '서식 규정 검사'],
  review: ['조판 부호', '문단 부호', '본 최종'],
};

const HIDDEN_KEY = 'rhwpRibbonHidden';

/** 탭별 숨김 라벨 — 저장된 게 있으면 그것, 없으면 DEFAULT_OFF. */
export function loadHidden(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
  } catch { /* 시크릿 모드 등 */ }
  return { ...DEFAULT_OFF };
}
export function saveHidden(v: Record<string, string[]>): void {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)); } catch { /* 무시 */ }
}

