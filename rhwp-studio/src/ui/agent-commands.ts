/**
 * [캔버스 한컴 포크] AI 에이전트에게 열어줄 편집기 명령 목록 — 의존성 0.
 *
 * 편집기에는 명령이 190개 있는데 에이전트 도구는 6개뿐이라, 채팅으로는 표 읽기·채우기밖에
 * 못 했다(사용자 지적 2026-08-05: claw-hwp 기능표를 두고 "이거 전부 되냐"). 기능을 새로 만드는
 * 대신 **이미 있는 명령을 열어준다** — dispatcher 가 canExecute 까지 검사하므로 안전 판정은
 * 그쪽에 맡기고, 여기서는 **무엇을 열지**만 정한다.
 *
 * 여는 기준 3가지:
 *  ① 되돌릴 수 있는 편집일 것 — 스냅샷/undo 로 복구되는 것만.
 *  ② 대화상자를 띄우지 않을 것 — 모달이 뜨면 에이전트 루프가 사람 입력을 기다리다 멈춘다.
 *  ③ 파일·앱 상태를 건드리지 않을 것 — 저장·열기·인쇄·설정은 사람이 누른다.
 */

/** 열어줄 명령 접두사. 이 안에서도 아래 DENY 에 걸리면 막힌다. */
const ALLOW_PREFIX = ['format:', 'table:', 'insert:', 'page:', 'edit:'];

/**
 * 막는 명령 — 이유별로 묶었다.
 * ⚠ 새 명령이 생기면 기본은 **열림**이다. 위험한 걸 추가하면 여기에 같이 넣을 것.
 */
const DENY = new Set([
  // 대화상자를 띄운다 — 루프가 멈춘다
  'format:char-shape', 'format:para-shape', 'format:style-dialog', 'format:bullet-shape',
  'format:para-num-shape', 'format:object-properties', 'format:apply-style',
  'table:cell-props', 'table:formula', 'insert:picture-props', 'insert:equation-edit',
  'insert:symbols', 'insert:emoji', 'insert:image', 'insert:my-photos', 'insert:field',
  'insert:snippet', 'insert:toc', 'insert:bookmark', 'page:setup', 'page:section-settings',
  'page:col-settings', 'page:masterpage', 'page:new-page-num', 'page:apply-hf-template',
  'page:page-border', 'insert:equation', 'insert:shape', 'insert:textbox',
  // 되돌리기 어렵거나 범위가 큰 삭제
  'table:delete', 'insert:picture-delete', 'page:headerfooter-delete',
  'edit:select-all', 'edit:delete',
  // 클립보드·모양복사 — 에이전트가 사용자 클립보드를 건드리면 안 된다
  'edit:cut', 'edit:copy', 'edit:paste', 'edit:format-copy',
  'table:transpose-copy', 'table:transpose-paste',
  // 찾기/바꾸기 — 모달이고 문서 전체를 훑는다
  'edit:find', 'edit:find-replace', 'edit:find-again',
]);

export interface AgentCommand { id: string; label: string; }

/** 에이전트에게 노출할 명령만 추린다. */
export function allowedCommands(all: AgentCommand[]): AgentCommand[] {
  return all.filter((c) =>
    ALLOW_PREFIX.some((p) => c.id.startsWith(p)) && !DENY.has(c.id));
}

/** 모델에게 줄 목록 문자열 — 키워드로 좁힐 수 있다(전부 주면 프롬프트가 터진다). */
export function describeCommands(all: AgentCommand[], keyword = '', limit = 40): string {
  const k = keyword.trim().toLowerCase();
  const hit = allowedCommands(all).filter((c) =>
    !k || c.id.toLowerCase().includes(k) || c.label.toLowerCase().includes(k));
  if (!hit.length) return `ERROR: "${keyword}" 에 맞는 명령 없음`;
  const shown = hit.slice(0, limit);
  const more = hit.length > shown.length ? `\n… 외 ${hit.length - shown.length}개 (키워드로 좁히세요)` : '';
  return shown.map((c) => `${c.id}\t${c.label}`).join('\n') + more;
}

/** 이 명령을 에이전트가 부를 수 있나. */
export function isAllowed(all: AgentCommand[], id: string): boolean {
  return allowedCommands(all).some((c) => c.id === id);
}
