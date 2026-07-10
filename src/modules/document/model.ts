// model.ts — 새 자유배치 캔버스의 문서 모델 (진실).
//
// 기존 흐름 에디터(sections→blocks, 브라우저가 배치)와 달리, 이 모델은 Canva식
// 절대 배치다: 모든 블록이 mm 좌표(x/y/w/h)를 직접 가진다. A4(210×297mm) 지면 위에
// 자유롭게 놓인다. 좌표 단위를 mm로 두면 기존 exportCore(mm→HWPUNIT)와 그대로 만난다.
//
// Phase 1은 순수 프론트엔드 — DB/직렬화는 Phase 2에서 이 타입을 그대로 저장한다.

export type BlockType = "text" | "table" | "image";

// table-king 스냅샷 (src/table-king의 표 모델 — 병합·행별 너비·셀별 높이·셀 스타일)
export interface TableKingData {
  cells: { text: string; style: Record<string, unknown> }[][];
  widths: number[][]; // px, 행별
  cellHeights: number[][]; // px, 셀별
  merges: { r: number; c: number; rs: number; cs: number }[];
}

export type TextAlign = "left" | "center" | "right";
export type ParaListType = "bullet" | "num"; // 문단 목록 — 글머리(•) / 번호(1.)

// 인라인 리치 텍스트 — 한 텍스트 블록 안의 "런"(같은 서식이 연속되는 글자 구간).
// 런이 없으면(runs 미지정) 블록 전체가 균일 서식(기존 동작 100% 보존). 런이 있으면
// 그게 진실이고, block.text는 런 텍스트를 이어붙인 평문 미러다(토큰 칩·사이저·미리보기·
// 병합이 계속 block.text를 읽으므로 항상 동기 유지). 런이 지정하지 않은 속성은 블록
// 기본값을 상속한다(예: run.color 없으면 block.color). 줄바꿈은 run.text 안의 "\n".
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean; // 밑줄 — bold와 같은 3-상태(undefined=블록 상속)
  strike?: boolean; // 취소선
  color?: string; // hex
  bg?: string; // 형광펜(글자 배경) hex — 내보내기: charPr shadeColor. 블록 상속 없음(런 전용)
  fontSize?: number; // pt — 없으면 블록 크기 상속
  font?: string; // 폰트 레지스트리 key — 없으면 블록 글꼴 상속
}

// 런의 서식이 동일한가 (텍스트는 무시) — normalizeRuns가 인접 런 병합 판정에 쓴다.
// ⚠ bold/italic은 3-상태다: undefined=블록 상속, true=강제 굵게, false=강제 보통.
// 블록이 굵을 때 일부만 보통으로(false) 만드는 게 의미 있으므로 false≠undefined로 구분한다
// (둘을 같게 보면 병합돼 서식이 블록 전체로 번진다).
export function runStyleEq(a: TextRun, b: TextRun): boolean {
  return (
    (a.bold ?? null) === (b.bold ?? null) &&
    (a.italic ?? null) === (b.italic ?? null) &&
    (a.underline ?? null) === (b.underline ?? null) &&
    (a.strike ?? null) === (b.strike ?? null) &&
    (a.color ?? null) === (b.color ?? null) &&
    (a.bg ?? null) === (b.bg ?? null) &&
    (a.fontSize ?? null) === (b.fontSize ?? null) &&
    (a.font ?? null) === (b.font ?? null)
  );
}

// 빈 런 제거 + 인접 동일서식 런 병합 (편집 후 항상 정규형 유지). 전부 비면 [{text:""}].
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (r.text === "") continue;
    const last = out[out.length - 1];
    if (last && runStyleEq(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out.length ? out : [{ text: "" }];
}

// 블록의 런 목록 (없으면 블록 전체를 하나의 무서식 런으로 — 블록 기본값 상속)
export function blockRuns(block: Block): TextRun[] {
  return block.runs?.length ? block.runs : [{ text: block.text ?? "" }];
}

export const runsToText = (runs: TextRun[]): string => runs.map((r) => r.text).join("");

// 블록에 실제 내용이 없는가 (안내문 표시 판정용) — 공백뿐이면 비었다고 본다
export const blockIsEmpty = (block: Block): boolean => !(block.text ?? "").trim();

// 지금 안내문(placeholder)을 보여줘야 하는가 — 토글 켜짐 + 안내문 있음 + 본문 비었음
export const showingHint = (block: Block): boolean =>
  !!block.hintOn && !!block.hint && blockIsEmpty(block);

// 오프셋(평문 문자 위치)에 런 경계가 생기도록 분할 — 걸친 런을 두 조각으로 쪼갠다
function splitRunsAt(runs: TextRun[], offset: number): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const len = r.text.length;
    if (offset > pos && offset < pos + len) {
      const cut = offset - pos;
      out.push({ ...r, text: r.text.slice(0, cut) });
      out.push({ ...r, text: r.text.slice(cut) });
    } else {
      out.push({ ...r });
    }
    pos += len;
  }
  return out;
}

// [start,end) 구간의 런에만 서식 패치 적용 (값이 undefined면 그 속성 제거 = 블록 상속으로).
// 경계에서 런을 쪼갠 뒤 완전히 구간 안에 든 런만 패치하고 정규화한다.
export function applyRunStyle(
  runs: TextRun[],
  start: number,
  end: number,
  patch: Partial<Omit<TextRun, "text">>
): TextRun[] {
  if (start >= end) return runs;
  const split = splitRunsAt(splitRunsAt(runs, start), end);
  let pos = 0;
  const next = split.map((r) => {
    const rEnd = pos + r.text.length;
    const within = pos >= start && rEnd <= end;
    pos = rEnd;
    if (!within) return r;
    const merged = { ...r } as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined || v === null) delete merged[k];
      else merged[k] = v;
    }
    return merged as unknown as TextRun;
  });
  return normalizeRuns(next);
}

// [start,end) 구간을 지우고 그 자리에 insert 런들을 끼워 넣는다 (서식 붙여넣기·잘라내기).
// 경계에서 런을 쪼갠 뒤 앞/뒤를 보존하고 정규화 — applyRunStyle과 같은 분할 규칙.
export function spliceRuns(runs: TextRun[], start: number, end: number, insert: TextRun[]): TextRun[] {
  const split = splitRunsAt(splitRunsAt(runs, start), end);
  const before: TextRun[] = [];
  const after: TextRun[] = [];
  let pos = 0;
  for (const r of split) {
    const rEnd = pos + r.text.length;
    if (rEnd <= start) before.push(r);
    else if (pos >= end) after.push(r);
    // start~end 사이 런은 삭제(교체 대상)
    pos = rEnd;
  }
  return normalizeRuns([...before, ...insert, ...after]);
}

// [start,end) 구간에 실제로 걸린 런들 (선택 서식바의 활성 상태 판정용)
export function rangeRuns(runs: TextRun[], start: number, end: number): TextRun[] {
  const split = splitRunsAt(splitRunsAt(runs, start), end);
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of split) {
    const rEnd = pos + r.text.length;
    if (pos >= start && rEnd <= end && r.text.length) out.push(r);
    pos = rEnd;
  }
  return out;
}

export interface Block {
  id: string;
  type: BlockType;
  // 트리(부모-자식) — 문서의 논리 구조. 부모를 끌면 자손이 함께 움직이고(자석 그룹),
  // 내보내기 때 트리 상하관계가 개요 번호(Ⅰ/1/가)로 펴진다. 없으면 루트 블록.
  parentId?: string;
  // 아코디언 접기 — true면 이 블록의 자손을 캔버스·레이어에서 숨긴다.
  // 보기 전용 상태: 내보내기(hwpx)·펴기(flatten)는 무시하고 전부 포함한다.
  collapsed?: boolean;
  // 공간 그룹(캔바식) — 같은 groupId끼리 하나로 이동·잠금. parentId(논리 트리)와 직교:
  // 개요 번호·펴기에 관여하지 않는다(관계없는 박스도 묶을 수 있음).
  groupId?: string;
  // 잠금 — true면 이동·리사이즈 차단(실수 방지). 선택은 됨.
  locked?: boolean;
  // 텍스트 폭 수동 지정 — 없으면 내용에 맞춰 auto-width(박스가 글자를 감쌈).
  // 사용자가 핸들로 폭을 조절하면 true가 되어 폭 고정 + 줄바꿈(캔바식 Auto→Fixed).
  manualW?: boolean;
  x: number; // mm, 지면 좌상단 기준
  y: number; // mm
  w: number; // mm
  h: number; // mm
  text?: string; // text 블록 — runs가 있으면 그 평문 미러(항상 동기)
  // 인라인 리치 텍스트 런 — 있으면 진실(블록 균일서식 대신 구간별 서식). 없으면 균일.
  runs?: TextRun[];
  // 안내문(폼 placeholder) — 블록이 비어있고 hintOn이면 지면에 회색으로 표시,
  // 실제 글자를 입력하면 사라진다. 내보내기(HWPX)엔 절대 안 나감(별도 필드라 본문과 무관).
  hint?: string; // 안내문 텍스트 (토글 꺼도 보존 — 다시 켜면 재사용)
  hintOn?: boolean; // 안내문 켜기/끄기 토글
  // 본문(흐름) 플래그 — true면 hwpx로 나갈 때 절대배치 개체가 아니라 "진짜 문단"으로
  // 내보낸다: 한글에서 커서가 흐르고, 이어 쓰면 밀리고, 길면 페이지를 넘는다.
  flow?: boolean;
  rows?: string[][]; // table 블록 구형 포맷 (data 없을 때 폴백 — 저장된 옛 문서 호환)
  data?: TableKingData; // table 블록 — table-king 엔진 스냅샷 (진실)
  src?: string; // image 블록 (Phase 2 Storage)
  // 텍스트 스타일 (text 블록) — 없으면 기본값. 내보내기(exportHwpx)도 이 값을 쓴다.
  font?: string; // 폰트 레지스트리 key (fonts.ts) — 없으면 문서 기본(나눔고딕)
  fontSize?: number; // pt
  bold?: boolean;
  italic?: boolean;
  underline?: boolean; // 밑줄 (블록 전체 기본 — 구간별은 runs)
  strike?: boolean; // 취소선
  align?: TextAlign;
  color?: string; // hex
  // 줄간격(%) — 화면 line-height = 값/100, 내보내기 paraPr lineSpacing에 그대로.
  // 없으면 기본 138(leading-snug 1.375와 정합 — 검증된 기존 값 유지)
  lineSpacing?: number;
  // 문단별 정렬 — text의 \n 경계가 문단. index i = i번째 문단, null/누락 = block.align 상속.
  // 편집 DOM(문단 div의 textAlign)에서 파생돼 flush 때 저장된다.
  paraAligns?: (TextAlign | null)[];
  // 문단별 목록 — "bullet"(글머리 •)/"num"(번호 1.)/null. 번호는 연속 num 문단끼리 이어
  // 세고 끊기면 1부터. 내보내기: paraPr heading NUMBER/BULLET(+bullets 정의 주입).
  paraLists?: (ParaListType | null)[];
  // ── 모양(shape) — 요소 상자의 겉모습 ──
  fill?: string; // 배경색 hex (없으면 투명). 내보내기: 셀 채우기 색으로.
  radius?: number; // 모서리 반경 px — 화면 전용(HWPX엔 둥근 모서리 개념 없음)
  borderColor?: string; // 테두리 색
  borderWidth?: number; // 테두리 두께 px (0/없으면 테두리 없음) — 화면 전용
  // ── 여백(padding) — 상자 안쪽 여백(mm). 텍스트는 이 값만큼 글이 접히는 폭이 준다.
  //    화면 CSS 패딩 = 내보내기 cellMargin과 같은 값이어야 줄바꿈이 정합한다. ──
  padX?: number; // 좌우 안쪽 여백(mm) — 없으면 DEFAULT_TEXT_PAD.x
  padY?: number; // 상하 안쪽 여백(mm) — 없으면 DEFAULT_TEXT_PAD.y
}

export const TEXT_DEFAULTS = {
  fontSize: 10.5,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: "left" as TextAlign,
  color: "#000000",
};

// 텍스트 상자 기본 안쪽 여백(mm) — 화면의 px-2 py-1(8px/4px)과 같은 값.
// SCALE=3.7795px/mm → 8/SCALE≈2.12, 4/SCALE≈1.06. 이 값이 화면·내보내기 공통 기준이라
// 캔버스 줄바꿈 = 한글 줄바꿈 정합이 유지된다(검증된 240자 실측 기준).
export const DEFAULT_TEXT_PAD = { x: 8 / 3.7795275591, y: 4 / 3.7795275591 };
export const padOf = (b: Block) => ({
  x: b.padX ?? DEFAULT_TEXT_PAD.x,
  y: b.padY ?? DEFAULT_TEXT_PAD.y,
});

export interface CanvasDoc {
  id: string;
  title: string;
  page: { w: number; h: number }; // mm — 기본 A4
  blocks: Block[];
}

export const A4: CanvasDoc["page"] = { w: 210, h: 297 };

// 블록 타입별 기본 크기(mm)와 시드 콘텐츠
const BLOCK_DEFAULTS: Record<BlockType, Partial<Block>> = {
  text: { w: 80, h: 12, text: "텍스트를 입력하세요", fill: "#ffffff", borderColor: "#98A4BD" },
  table: {
    w: 120,
    h: 24,
    rows: [
      ["항목", "내용", "비고"],
      ["", "", ""],
    ],
  },
  image: { w: 60, h: 45 },
};

// id 생성 — 전역 고유(UUID). 영속화에 필수: 세션 카운터는 새로고침 후 재사용돼
// 문서/블록 id가 충돌한다(기존 것을 덮어씀). crypto.randomUUID는 브라우저·Node18+ 지원.
const uid = (prefix: string): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  // 폴백(구형 환경): 시간+난수 조합
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

export function createBlock(type: BlockType, x: number, y: number): Block {
  const d = BLOCK_DEFAULTS[type];
  return {
    id: uid("blk"),
    type,
    x: Math.round(x),
    y: Math.round(y),
    w: d.w ?? 60,
    h: d.h ?? 20,
    text: d.text,
    rows: d.rows,
    fill: d.fill,
    borderColor: d.borderColor,
  };
}

export function createDoc(title = "제목 없는 문서"): CanvasDoc {
  return { id: uid("doc"), title, page: { ...A4 }, blocks: [] };
}

// ── 트리 헬퍼 (parentId 기반) ──

// id의 모든 자손 id 집합 (자석 그룹 이동·서브트리 삭제/복제용)
export function descendantIds(blocks: Block[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const b of blocks) {
      if (b.parentId === pid && !out.has(b.id)) {
        out.add(b.id);
        walk(b.id);
      }
    }
  };
  walk(id);
  return out;
}

// candidate가 id 자신이거나 자손인가 — setParent 순환 방지용
export function isSelfOrDescendant(blocks: Block[], id: string, candidate: string): boolean {
  return id === candidate || descendantIds(blocks, id).has(candidate);
}

// ── 공간 그룹 헬퍼 (groupId 기반) ──

// 같은 공간 그룹에 속한 블록 id들 (자기 포함). groupId 없으면 [id]만.
export function groupMemberIds(blocks: Block[], id: string): string[] {
  const b = blocks.find((x) => x.id === id);
  if (!b?.groupId) return [id];
  return blocks.filter((x) => x.groupId === b.groupId).map((x) => x.id);
}

// "함께 이동하는 집합" — 선택 ∪ 트리 자손(자석) ∪ 그룹 멤버, 고정점까지 확장.
// moveBlock·nudgeMany·드래그 팔로우가 전부 이 하나를 쓴다(이동 규칙 단일화).
export function moveSetIds(blocks: Block[], ids: string[]): Set<string> {
  const out = new Set<string>(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...out]) {
      for (const d of descendantIds(blocks, id)) if (!out.has(d)) { out.add(d); grew = true; }
      for (const g of groupMemberIds(blocks, id)) if (!out.has(g)) { out.add(g); grew = true; }
    }
  }
  return out;
}

// 접힌(collapsed) 조상을 가진 블록 id 집합 — 캔버스·레이어 패널이 숨길 대상.
// 내보내기·flatten은 이 집합을 쓰지 않는다 (접기는 조망용, 문서 내용은 그대로).
export function collapsedHiddenIds(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks)
    if (b.collapsed) for (const id of descendantIds(blocks, b.id)) out.add(id);
  return out;
}
