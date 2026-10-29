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
  'format:para-num-shape', 'format:object-properties',
  'table:cell-props', 'table:formula', 'insert:picture-props', 'insert:equation-edit',
  'insert:symbols', 'insert:emoji', 'insert:image', 'insert:my-photos', 'insert:field',
  'insert:snippet', 'insert:toc', 'insert:bookmark', 'page:setup', 'page:section-settings',
  'page:col-settings', 'page:masterpage', 'page:new-page-num', 'page:apply-hf-template',
  'page:page-border', 'insert:equation', 'insert:shape', 'insert:textbox',
  // [캔버스 한컴 포크] 열기만 성공하는 대화상자를 편집 성공으로 보고하지 않는다.
  'table:create', 'table:border-each', 'table:border-one', 'table:insert-row-col',
  'table:delete-row-col', 'table:cell-split', 'table:block-formula',
  'insert:chart', 'insert:endnote-shape', 'edit:compare-documents',
  'edit:document-history', 'edit:goto',
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

// 실제 등록된 스텁만 구분한다. 현재 비활성인 정상 명령은 미구현으로 오인하지 않는다.
const UNSUPPORTED = new Set(['insert:para-band', 'insert:comment', 'insert:hyperlink']);

/** [캔버스 한컴 포크] UI 명령과 별개로 대상을 지정하여 읽고 적용할 편집 도구의 기능. */
const EDITOR_OPERATIONS: Record<string, string> = {
  'page:setup': 'set_page: 용지 크기·방향·여백',
  'format:char-shape': 'format_text: 글자 범위의 글꼴·크기·장평·자간·색',
  'format:para-shape': 'format_paragraph: 문단 정렬·줄 간격·문단 여백',
  'format:style-dialog': 'define_style / inspect_document: 스타일 조회·정의·수정',
  'format:apply-style': 'apply_style: 문단 또는 셀 문단에 스타일 적용',
  'table:create': 'create_table: 행·열·열 너비·행 높이를 지정한 표 생성',
  'table:cell-props': 'set_table / format_cells: 표 배치·셀 여백·정렬',
  'table:border-each': 'format_cells: 셀별 테두리·배경',
  'table:cell-merge': 'merge_cells: 행·열 범위 셀 병합',
};

const COMMAND_PARAMS: Record<string, string> = {
  'format:apply-style': 'params={styleId:정수}',
  'format:font-size-set': 'params={value:pt}',
  'format:indent-set': 'params={value:pt}',
  'format:outdent-set': 'params={value:pt}',
  'format:line-spacing': 'params={value:퍼센트}',
  'format:toggle-bullet': 'params={bulletChar:문자}(선택)',
  'format:apply-bullet': 'params={bulletChar:문자}',
};

/** 전체 기능을 발견하되, 자동 실행 가능 여부·UI 경유·미구현을 숨기지 않는다. */
export function describeCapabilities(all: AgentCommand[], keyword = '', limit = 60): string {
  const k = keyword.trim().toLowerCase();
  const hit = all.filter((c) => !k || `${c.id} ${c.label}`.toLowerCase().includes(k));
  if (!hit.length) return `ERROR: "${keyword}" 에 맞는 기능 없음`;
  const count = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 60;
  const lines = hit.slice(0, count).map((c) => {
    const route = UNSUPPORTED.has(c.id) ? 'unsupported: 편집기 미구현'
      : EDITOR_OPERATIONS[c.id] ? `editor_tool: ${EDITOR_OPERATIONS[c.id]} — 도구 스키마의 대상·속성 지정`
      : isAllowed(all, c.id) ? 'command: 현재 커서·선택 대상, isEnabled 확인 필요'
      : 'ui_required: UI 조작 경로; 자동 run_command 미지원';
    const params = COMMAND_PARAMS[c.id];
    return `${c.id}\t${c.label}\t${route}${params ? `; ${params}` : ''}`;
  });
  if (hit.length > count) lines.push(`… 외 ${hit.length - count}개 (키워드로 좁히세요)`);
  lines.push('기능 목록은 실행·검증 완료를 뜻하지 않습니다. 적용 후 문서 속성을 다시 읽으세요.');
  return lines.join('\n');
}

/** 에이전트에게 노출할 명령만 추린다. */
export function allowedCommands(all: AgentCommand[]): AgentCommand[] {
  return all.filter((c) =>
    ALLOW_PREFIX.some((p) => c.id.startsWith(p)) && !DENY.has(c.id) && !UNSUPPORTED.has(c.id));
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
