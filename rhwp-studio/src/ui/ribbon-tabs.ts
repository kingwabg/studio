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
  | { kind: 'slot'; slot: string; width: number; label?: string; icon?: string }
  | { kind: 'expander'; label: string; cmd?: string }
  /**
   * 값 상자 — 「값 + 프리셋(⌄) + 스피너(▲▼)」. 눈 먼 ± 대신 지금 값이 보인다.
   * `key` 로 리본이 어떤 서식인지 알아 커서 값을 밀어 넣는다(ribbon-header.setParaState 등).
   */
  | {
      kind: 'value';
      key: 'font-size' | 'line-spacing' | 'indent' | 'outdent';
      label: string;
      icon: string;
      unit: string;
      presets: number[];
      step: number;
      min: number;
      max: number;
      decimals?: number;
      width: number;
      cmd: string;
      hint?: string;
      /**
       * 앞 아이콘을 눌렀을 때 실행할 명령 — "누르면 한 번에 적용, 값은 옆에서 수정".
       * 없으면 아이콘이 프리셋 목록을 연다.
       */
      iconCmd?: string;
    }
  | { kind: 'over'; icon: string; label: string; key?: string; cmd?: string };

const P = (icon: string, label: string, cmd?: string, hint?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd, hint });
const PP = (icon: string, label: string, cmd?: string): RibbonItem =>
  ({ kind: 'btn', icon, label, cmd, primary: true });
const gap = (): RibbonItem => ({ kind: 'gap' });
const combo = (label: string, width: number, cmd?: string): RibbonItem =>
  ({ kind: 'combo', label, width, cmd });
const slot = (name: string, width: number, label?: string, icon?: string): RibbonItem =>
  ({ kind: 'slot', slot: name, width, label, icon });
const O = (icon: string, label: string, key?: string, cmd?: string): RibbonItem =>
  ({ kind: 'over', icon, label, key, cmd });
/** 값 상자 — 크기·줄 간격·들여쓰기·내어쓰기가 같은 모양을 쓴다(사용자 지시 2026-08-03) */
const V = (
  key: 'font-size' | 'line-spacing' | 'indent' | 'outdent',
  label: string, icon: string, unit: string, cmd: string,
  o: { presets: number[]; step: number; min: number; max: number; decimals?: number; width?: number; hint?: string; iconCmd?: string },
): RibbonItem => ({
  kind: 'value', key, label, icon, unit, cmd,
  presets: o.presets, step: o.step, min: o.min, max: o.max,
  decimals: o.decimals, width: o.width ?? 92, hint: o.hint, iconCmd: o.iconCmd,
});

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
      slot('style-name', 100, '스타일', 'cards-three'),
      slot('font-name', 100, '글꼴', 'text-aa'),
      V('font-size', '크기', 'text-t', 'pt', 'format:font-size-set', {
        presets: [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48],
        step: 1, min: 1, max: 300, decimals: 1, width: 100,
        hint: '글자 크기 — 값을 고치거나 ⌄ 에서 고릅니다',
      }),
      gap(),
      P('text-b', '굵게', 'format:bold'),
      P('text-italic', '기울임', 'format:italic'),
      P('text-underline', '밑줄', 'format:underline'),
      P('text-strikethrough', '취소선', 'format:strikethrough'),
      // 글자 색·형광펜은 구 서식바(Toolbar)가 소유한 동작하는 피커를 입양한다
      // (글꼴 콤보와 같은 adopt 패턴 — 이벤트·상태 동기가 그대로 산다. 배선은 main.ts).
      // 색 피커는 Toolbar 의 살아 있는 컨트롤을 입양한다 — 나머지 타일처럼 이름을 붙인다
      slot('text-color', 44, '글자 색', 'palette'),
      slot('highlight', 46, '형광펜', 'highlighter'),
      gap(),
      // 정렬 4종은 한컴·워드와 같은 순서(왼쪽·가운데·오른쪽·양쪽)로 나란히 둔다 —
      // '오른쪽 정렬'만 「⋯」에 숨어 있어 정렬을 고르는 손이 두 곳으로 갈렸다(2026-07-30).
      P('text-align-left', '왼쪽 정렬', 'format:align-left'),
      P('text-align-center', '가운데 정렬', 'format:align-center'),
      P('text-align-right', '오른쪽 정렬', 'format:align-right'),
      P('text-align-justify', '양쪽 정렬', 'format:align-justify'),
      // 종전엔 아이콘 버튼이었는데 값 없이 디스패치돼 **아무 동작도 안 했다**(2026-08-03 발견).
      // 값 상자로 바꿔 실제로 쓰이게 한다.
      V('line-spacing', '줄 간격', 'arrows-vertical', '%', 'format:line-spacing', {
        presets: [100, 115, 130, 145, 160, 180, 200, 250, 300],
        step: 5, min: 50, max: 500, width: 100,
        hint: '줄 간격(%) — 값을 고치거나 ⌄ 에서 고릅니다',
      }),
      // ⚠ 목록·들여쓰기·자간/장평·대화상자 3형제는 **「서식」 탭으로 옮겼다**(사용자 지시
      //   2026-08-03: "홈에 기능이 많아 용도별로 나누자" → A안). 홈은 손이 가장 자주 가는
      //   글자 꾸미기 + 정렬까지만 둔다. 서식 탭 위치는 한/글 순서를 따른다(입력 다음).
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
      P('images', '내 사진', 'insert:my-photos'),
      PP('shapes', '도형', 'insert:shape'),
      P('text-t', '글상자', 'insert:textbox'),
      gap(),
      P('math-operations', '수식', 'insert:equation'),
      P('asterisk', '문자표', 'insert:symbols'),
      P('smiley', '이모지', 'insert:emoji'),
      P('brackets-curly', '필드 입력', 'insert:field'),
      P('cursor-click', '명령 단추', 'insert:form-button'),
      P('check-square', '선택 상자', 'insert:form-checkbox'),
      P('caret-circle-down', '콤보 상자', 'insert:form-combobox'),
      P('radio-button', '라디오 단추', 'insert:form-radio'),
      P('textbox', '입력 상자', 'insert:form-edit'),
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
    id: 'format',
    label: '서식',
    // [홈 분가 2026-08-03] 사용자 지시 "홈에 기능이 많아 용도별로 나누자" → A안.
    // 자리는 한/글 리본 순서를 따른다([편집][보기][입력][**서식**][쪽][검토][도구]) —
    // 한/글 쓰던 손이 찾아가는 자리에 둔다. 홈엔 손이 가장 자주 가는 것만 남겼다.
    items: [
      // 목록·수준 — 개요/번호 문서의 뼈대
      P('list-numbers', '문단 번호', 'format:toggle-numbering'),
      P('list-bullets', '글머리표', 'format:toggle-bullet'),
      P('text-indent', '한 수준 증가', 'format:level-increase'),
      P('text-outdent', '한 수준 감소', 'format:level-decrease'),
      gap(),
      // 일반 문단 들여쓰기/내어쓰기 — '한 수준' 은 개요/번호용이라 일반 문단엔 안 먹는다.
      // 아이콘을 누르면 한 단계 바로 적용되고, 값은 옆에서 바로 고친다.
      V('indent', '들여쓰기', 'arrow-line-right', 'pt', 'format:indent-set', {
        presets: [0, 10, 20, 30, 40], step: 5, min: 0, max: 400, width: 100,
        iconCmd: 'format:indent-increase',
        hint: '아이콘을 누르면 한 단계 들여씁니다 — 값을 직접 고치거나 ⌄ 에서 골라도 됩니다',
      }),
      V('outdent', '내어쓰기', 'arrow-line-left', 'pt', 'format:outdent-set', {
        presets: [0, 10, 20, 30], step: 5, min: 0, max: 400, width: 100,
        iconCmd: 'format:indent-decrease',
        hint: '아이콘을 누르면 한 단계 내어씁니다 — 값을 직접 고치거나 ⌄ 에서 골라도 됩니다',
      }),
      gap(),
      // 글자 간격(자간·장평).
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
      // 대화상자 3형제 — 앞머리 콤보는 고르기, 여기는 만들기·고치기.
      P('cards-three', '스타일 설정', 'format:style-dialog',
        '스타일을 만들고 고칩니다 — 목록에서 고르는 건 홈 앞머리 칸입니다 (F6)'),
      P('text-aa', '글자 모양', 'format:char-shape'),
      P('paragraph', '문단 모양', 'format:para-shape'),
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
      P('arrows-in-line-vertical', '한 쪽 줄이기', 'format:auto-fit-page',
        '마지막 몇 줄이 다음 쪽으로 넘칠 때 줄 간격(부족하면 자간까지)을 조금 줄여 페이지 수를 1 줄입니다'),
      P('arrows-in', '전체 쪽 줄이기', 'format:auto-fit-max',
        '가독성 하한(줄 간격 130% · 자간 -12%)까지 줄여 문서 전체를 줄일 수 있는 만큼 줄입니다'),
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
      // 고스트 코멘트 — 문서를 안 건드리는 검토 메모(인쇄·PDF 에 안 나온다)
      P('ghost', '고스트 코멘트', 'review:ghost-add',
        '커서 자리에 메모를 답니다. 문서에는 저장되지 않고 인쇄·PDF 에도 나오지 않습니다'),
      P('eye-closed', '고스트 보기', 'review:ghost-toggle', '고스트 코멘트 표시를 켜고 끕니다'),
      O('eraser', '고스트 비우기', '', 'review:ghost-clear'),
      gap(),
      P('clock-counter-clockwise', '문단 타임머신', 'review:time-machine',
        '커서가 있는 문단의 과거 모습을 보고 그 문단만 되돌립니다 (문서 전체가 아니라)'),
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
  // 홈은 「서식」 탭 분가(2026-08-03) 뒤 16개로 줄어 접을 게 없다 — 취소선도 되살렸다.
  home: [],
  // 장평은 자간과 헷갈린다는 지적(2026-08-01)이 있어 서식 탭에서도 기본 접힘.
  // 필요한 사람은 「⋯ 편집」에서 켠다.
  format: ['장평 줄이기', '장평 늘리기'],
  edit: ['모양 붙여넣기', '찾아가기'],
  insert: ['필드 입력', '미주', '이모지'],
  layout: ['격자 설정', '새 번호로 시작', '구역 나누기', '쪽 테두리/배경', '바탕쪽'],
  tools: ['스크립트', '사전', '번역', '상용구', 'NDA 생성기', '동의율 시뮬레이터', '서식 규정 검사'],
  review: ['조판 부호', '문단 부호', '본 최종'],
};

const HIDDEN_KEY = 'rhwpRibbonHidden';

/**
 * 탭별 숨김 라벨 — 저장된 게 있으면 그것을 쓰되, **저장본에 없는 탭은 기본값으로 채운다**.
 *
 * ⚠ 종전엔 저장본이 있으면 통째로 그것만 썼다. 그래서 탭이 새로 생기면(2026-08-03 「서식」)
 *   이미 써 온 사용자에게는 그 탭의 기본 접힘이 영영 반영되지 않는다 — 탭 키가 저장본에
 *   없어서다. 탭 단위로 채워 넣는다(사용자가 직접 끈 탭은 그대로 존중).
 */
export function loadHidden(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, string[]>;
      return { ...DEFAULT_OFF, ...saved };
    }
  } catch { /* 시크릿 모드 등 */ }
  return { ...DEFAULT_OFF };
}
export function saveHidden(v: Record<string, string[]>): void {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)); } catch { /* 무시 */ }
}

// ─── 사용자 배치(2026-08-03) ──────────────────────────────────────────
// 「⋯ 편집」이 켜고 끄기만 되던 것을 **자유 배치**로 넓힌다(사용자 요청):
// 전체 탭의 아이콘을 다 보여주고 끌어다 홈에 원하는 것만 남긴다.
//
// 저장 모델: 탭마다 "이 탭에 이 순서로 이것들을 놓는다"는 라벨 목록.
// 없는 탭은 기본 배치(RIBBON_TABS) 그대로 — 손대지 않은 탭은 앞으로 기본이 바뀌면 따라간다.
// (켜고 끄기(hidden)와 달리 **다른 탭 것도 가져올 수 있다**는 게 핵심 차이다.)

const CUSTOM_KEY = 'rhwpRibbonCustom';

export type RibbonLayout = Record<string, string[]>;

export function loadLayout(): RibbonLayout {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) return JSON.parse(raw) as RibbonLayout;
  } catch { /* 시크릿 모드 등 */ }
  return {};
}

export function saveLayout(v: RibbonLayout): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(v)); } catch { /* 무시 */ }
}

/** 라벨을 가진 모든 항목 — 어느 탭에서 왔는지와 함께. 배치 고르개의 재료다. */
export interface CatalogEntry {
  label: string;
  icon: string;
  fromTab: string;
  item: RibbonItem;
}

export function buildCatalog(): CatalogEntry[] {
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const tab of RIBBON_TABS) {
    for (const item of tab.items) {
      const label =
        item.kind === 'btn' || item.kind === 'over' || item.kind === 'value' ? item.label
        : item.kind === 'slot' ? item.label
        : undefined;
      if (!label || seen.has(label)) continue; // 같은 라벨은 한 번만(되돌리기는 홈·편집 양쪽에 있다)
      seen.add(label);
      const icon =
        item.kind === 'btn' || item.kind === 'over' || item.kind === 'value' ? item.icon
        : item.kind === 'slot' ? (item.icon ?? 'square')
        : 'square';
      out.push({ label, icon, fromTab: tab.label, item });
    }
  }
  return out;
}

/** 라벨 → 항목 정의 (배치 목록을 실제 리본 항목으로 되돌릴 때) */
export function catalogMap(): Map<string, RibbonItem> {
  const m = new Map<string, RibbonItem>();
  for (const e of buildCatalog()) m.set(e.label, e.item);
  return m;
}

/**
 * 이 탭에 실제로 놓을 항목들.
 * 사용자 배치가 있으면 그것(구분선은 원래 자리 대신 무리 사이에 자동으로 하나씩),
 * 없으면 기본 배치에서 접힌 것만 뺀다.
 */
export function resolveTabItems(
  tab: { id: string; items: RibbonItem[] },
  layout: RibbonLayout,
  hidden: Record<string, string[]>,
): RibbonItem[] {
  const custom = layout[tab.id];
  if (!custom) {
    const off = new Set(hidden[tab.id] ?? []);
    return tab.items.filter((i) => {
      if (i.kind === 'btn') return !off.has(i.label);
      if (i.kind === 'slot' && i.label) return !off.has(i.label);
      if (i.kind === 'value') return !off.has(i.label);
      return true;
    });
  }
  const map = catalogMap();
  const items: RibbonItem[] = [];
  for (const label of custom) {
    const it = map.get(label);
    if (it) items.push(it);
  }
  return items;
}

