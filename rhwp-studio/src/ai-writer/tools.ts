/**
 * AI 문서 작성 — 16개 도구 (2026-08-05, 「Hwpx 한글 도우미」 주문서 §4 이식).
 *
 * 프로토콜은 기존 문서 작업 에이전트(canva-ai-agent)와 같다: 모델이 턴마다
 * {"tool":…} JSON 하나를 내고, 결과 문자열을 받아 다음 행동을 정한다.
 * 도구는 **모델(WriterDocument)만** 만진다 — 지면 실체화는 realize.ts 의 일이고,
 * review_pages 때만 실제 조판이 돈다(주문서 원칙 4: 페이지는 추정 금지).
 */
import {
  type WriterDocument, type Section, type Block,
  assignSectionNumbers, validateBlock, listTables, headingLabel, LIMITS,
} from './document-model';
import { getTemplate, templateNames } from './templates';

export const WRITER_PROMPT =
  '당신은 한국 행정기관·공공기관의 문서 작성 실무자입니다. 보고서·계획서·공문·회의록을 ' +
  '**실제 담당자가 결재 올리는 수준**으로 작성합니다. 아래 도구를 JSON 한 개로 호출해 문서를 조립하세요.\n' +
  '작성 순서: get_template → add_title → add_section 반복 → review_pages → 필요시 수정 → done.\n' +
  '\n[문체 — 가장 중요]\n' +
  '① 보고서·계획서·회의록은 **개조식**으로 쓴다. 문장을 명사형으로 끝낸다: ~함, ~임, ~추진, ~예정, ~필요.\n' +
  '   나쁨: "본 보고서는 운영 현황을 보고하고자 한다." → 좋음: "2026년 하반기 센터 운영 현황과 성과를 보고함"\n' +
  '② 한 문장은 2줄 이내. 길면 쪼개서 list 로 내린다. 서술형 문단(para)은 섹션당 1~2개면 충분하다.\n' +
  '③ 공문만 서술식 경어체(~하고자 합니다, ~하여 주시기 바랍니다)를 쓴다.\n' +
  '④ 구체적으로 쓴다: 기간·대상·수치·근거를 명시하고, 모르는 값은 [○○명] [○○천원] 처럼 단위까지 붙여 남긴다.\n' +
  '⑤ 붙임·근거 표기 관행을 지킨다: "붙임  1. ○○ 1부.  끝." / 근거는 "○○법 제○조" 형식.\n' +
  '\n[구성]\n' +
  '⑥ 항목 나열은 반드시 list 블록 — 마커(□·○·-)는 서버가 섹션 깊이에 맞춰 자동으로 붙이니 items 에 쓰지 마라.\n' +
  '⑦ 예산·일정·현황·비교는 반드시 table. 첫 행이 머리행이다. 합계 행이 필요하면 마지막에 넣는다.\n' +
  '⑧ 세부 주제는 level 2(1.)·level 3(가.) 하위 섹션으로 쪼갠다 — 한 섹션에 다 붓지 마라.\n' +
  '⑨ 번호(Ⅰ·1·가)는 서버가 자동으로 붙인다 — heading 에 번호를 쓰지 마라.\n' +
  '\n도구 목록:\n' +
  '· {"tool":"get_template","doc_type":"보고서"} — 유형별 표준 목차·처방. 항상 이것부터.\n' +
  '· {"tool":"add_title","text":"제목"}\n' +
  '· {"tool":"add_section","heading":"개요","level":1,"new_page":false,"blocks":[…]}\n' +
  '  blocks: {"type":"para","text":…} | {"type":"list","items":[…],"ordered":false} | {"type":"table","rows":[[…],…]}\n' +
  '· {"tool":"read_document"} — 현재 목차(주소). 수정 전 필수.\n' +
  '· {"tool":"review_pages"} — 실제 조판의 쪽 배치. 고아 제목 경고가 오면 고친다.\n' +
  '· {"tool":"edit_paragraph","section_index":0,"paragraph_index":0,"text":…} · {"tool":"delete_paragraph",…}\n' +
  '· {"tool":"delete_section","section_index":0}\n' +
  '· {"tool":"edit_cell","table_index":0,"row":0,"col":0,"text":…} · {"tool":"delete_table","table_index":0}\n' +
  '· {"tool":"add_table_row","table_index":0,"cells":[…],"at":null} · {"tool":"delete_table_row","table_index":0,"row":1}\n' +
  '· {"tool":"add_table_col","table_index":0,"at":null} · {"tool":"delete_table_col","table_index":0,"col":1}\n' +
  '· {"tool":"merge_cells","table_index":0,"top":0,"left":0,"bottom":0,"right":1}\n' +
  '· {"tool":"set_line_spacing","percent":160}\n' +
  '· {"tool":"done","report":"한국어 2~3문장"} — 마지막에 반드시.\n' +
  '규칙: 반드시 JSON 하나만 출력(설명 금지). ERROR 를 받으면 같은 호출을 반복하지 말고 고쳐 부른다. ' +
  'done 전에 review_pages 를 한 번은 돌린다.';

/** 도구 실행 결과 — 모델에게 돌아가는 문자열 + 지면 갱신 필요 여부 */
export interface ToolOutcome {
  result: string;
  /** 모델이 바뀌어 실체화가 낡았다 — review_pages/done 때 다시 그려야 한다 */
  dirty: boolean;
  finished: boolean;
  report?: string;
  /** review_pages 요청 — 호출부(패널)가 realize+review 를 돌려 결과를 넣어 준다 */
  wantsReview?: boolean;
}

const idx = (v: unknown): number => (Number.isInteger(Number(v)) ? Number(v) : -1);

/**
 * 도구 하나를 모델에 적용한다. 순수 함수에 가깝다(문서 모델만 변형) —
 * 그래서 모델(LLM) 없이도 node/브라우저에서 그대로 시험할 수 있다.
 */
export function runWriterTool(
  doc: WriterDocument, name: string, args: Record<string, unknown>,
): ToolOutcome {
  const ok = (result: string, dirty = true): ToolOutcome => ({ result, dirty, finished: false });
  const err = (msg: string): ToolOutcome => ({ result: msg, dirty: false, finished: false });

  const pickSection = (): Section | string => {
    const i = idx(args.section_index);
    if (i < 0 || i >= doc.sections.length) return `ERROR: section_index ${i} 없음 (0~${doc.sections.length - 1})`;
    return doc.sections[i];
  };
  const pickTable = () => {
    const tables = listTables(doc);
    const i = idx(args.table_index);
    if (i < 0 || i >= tables.length) return `ERROR: table_index ${i} 없음 (0~${tables.length - 1})`;
    return tables[i].table;
  };

  switch (name) {
    case 'get_template': {
      const t = getTemplate(String(args.doc_type ?? ''));
      return ok(t.rendered, false);
    }

    case 'add_title': {
      const text = String(args.text ?? '').trim();
      if (!text || text.length > LIMITS.title) return err(`ERROR: 제목은 1~${LIMITS.title}자`);
      doc.title = text;
      return ok(`제목 설정: ${text}`);
    }

    case 'add_section': {
      const heading = String(args.heading ?? '').trim();
      if (!heading || heading.length > LIMITS.heading) return err(`ERROR: heading 은 1~${LIMITS.heading}자`);
      if (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9가-하]+[.)]/.test(heading)) {
        return err('ERROR: heading 에 번호를 쓰지 마세요 — 번호는 자동으로 붙습니다');
      }
      const level = idx(args.level);
      if (level < 1 || level > 3) return err('ERROR: level 은 1|2|3');
      const rawBlocks = Array.isArray(args.blocks) ? args.blocks : [];
      if (rawBlocks.length === 0 || rawBlocks.length > LIMITS.blocksPerSection) {
        return err(`ERROR: blocks 는 1~${LIMITS.blocksPerSection}개`);
      }
      const blocks: Block[] = [];
      for (const raw of rawBlocks) {
        const b = validateBlock(raw);
        if (typeof b === 'string') return err(b);
        blocks.push(b);
      }
      doc.sections.push({
        heading, level: level as 1 | 2 | 3, blocks,
        pageBreakBefore: args.new_page === true, number: '',
      });
      assignSectionNumbers(doc);
      const added = doc.sections[doc.sections.length - 1];
      return ok(`섹션 추가: ${headingLabel(added)} (블록 ${blocks.length}개, section_index ${doc.sections.length - 1})`);
    }

    case 'read_document': {
      if (doc.sections.length === 0) return ok('문서가 비어 있습니다. add_title → add_section 으로 시작하세요.', false);
      const tables = listTables(doc);
      const lines = [`제목: ${doc.title || '(없음)'}`, `줄간격: ${doc.lineSpacing}%`];
      doc.sections.forEach((s, si) => {
        const parts = s.blocks.map((b) =>
          b.type === 'para' ? `문단(${b.text.length}자)`
          : b.type === 'list' ? `목록(${b.items.length}항목)`
          : `표${tables.findIndex((t) => t.table === b)}(${b.rows.length}×${b.rows[0].length})`);
        lines.push(`[${si}]${'  '.repeat(s.level - 1)} ${headingLabel(s)}${s.pageBreakBefore ? ' ⏎쪽나눔' : ''} — ${parts.join(', ')}`);
      });
      return ok(lines.join('\n'), false);
    }

    case 'review_pages':
      // 실체화·조판은 도구 밖(패널)의 일 — 여기서는 요청만 표시한다.
      return { result: '', dirty: false, finished: false, wantsReview: true };

    case 'edit_paragraph': {
      const s = pickSection();
      if (typeof s === 'string') return err(s);
      const paras = s.blocks.filter((b) => b.type === 'para');
      const pi = idx(args.paragraph_index);
      if (pi < 0 || pi >= paras.length) return err(`ERROR: paragraph_index ${pi} 없음 (섹션 내 문단 ${paras.length}개)`);
      const text = String(args.text ?? '').trim();
      if (!text || text.length > LIMITS.paraText) return err(`ERROR: text 는 1~${LIMITS.paraText}자`);
      (paras[pi] as { text: string }).text = text;
      return ok(`수정: [${idx(args.section_index)}] ${pi}번째 문단`);
    }

    case 'delete_paragraph': {
      const s = pickSection();
      if (typeof s === 'string') return err(s);
      const pi = idx(args.paragraph_index);
      const paras = s.blocks.filter((b) => b.type === 'para');
      if (pi < 0 || pi >= paras.length) return err(`ERROR: paragraph_index ${pi} 없음`);
      s.blocks.splice(s.blocks.indexOf(paras[pi]), 1);
      return ok('문단 삭제 완료');
    }

    case 'delete_section': {
      const i = idx(args.section_index);
      if (i < 0 || i >= doc.sections.length) return err(`ERROR: section_index ${i} 없음`);
      const [gone] = doc.sections.splice(i, 1);
      assignSectionNumbers(doc);
      return ok(`섹션 삭제: ${gone.heading} — 이후 번호가 다시 매겨졌습니다. read_document 로 확인하세요.`);
    }

    case 'edit_cell': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      const r = idx(args.row); const c = idx(args.col);
      if (r < 0 || r >= t.rows.length || c < 0 || c >= t.rows[0].length) {
        return err(`ERROR: (${r},${c}) 없음 — 표는 ${t.rows.length}×${t.rows[0].length}`);
      }
      t.rows[r][c] = String(args.text ?? '');
      return ok(`셀 (${r},${c}) 수정`);
    }

    case 'add_table_row': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      if (t.rows.length >= LIMITS.tableRows) return err(`ERROR: 표 ${LIMITS.tableRows}행 한도`);
      const cols = t.rows[0].length;
      const cells = Array.isArray(args.cells) ? args.cells.map(String) : [];
      if (cells.length !== cols) return err(`ERROR: cells 는 ${cols}개여야 합니다 (받음 ${cells.length})`);
      const at = args.at == null ? t.rows.length : idx(args.at);
      if (at < 0 || at > t.rows.length) return err(`ERROR: at ${at} 범위 밖`);
      t.rows.splice(at, 0, cells);
      return ok(`행 추가 → ${t.rows.length}×${cols}`);
    }

    case 'delete_table_row': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      const r = idx(args.row);
      if (r < 0 || r >= t.rows.length) return err(`ERROR: row ${r} 없음`);
      if (t.rows.length === 1) return err('ERROR: 마지막 행은 지울 수 없습니다 — delete_table 을 쓰세요');
      t.rows.splice(r, 1);
      t.merges = [];
      return ok(`행 삭제 → ${t.rows.length}행 (병합 지시는 초기화됨)`);
    }

    case 'add_table_col': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      const cols = t.rows[0].length;
      if (cols >= LIMITS.tableCols) return err(`ERROR: 표 ${LIMITS.tableCols}열 한도`);
      const at = args.at == null ? cols : idx(args.at);
      if (at < 0 || at > cols) return err(`ERROR: at ${at} 범위 밖`);
      for (const row of t.rows) row.splice(at, 0, '');
      return ok(`열 추가 → ${t.rows.length}×${cols + 1}`);
    }

    case 'delete_table_col': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      const c = idx(args.col);
      const cols = t.rows[0].length;
      if (c < 0 || c >= cols) return err(`ERROR: col ${c} 없음`);
      if (cols === 1) return err('ERROR: 마지막 열은 지울 수 없습니다 — delete_table 을 쓰세요');
      for (const row of t.rows) row.splice(c, 1);
      t.merges = [];
      return ok(`열 삭제 → ${cols - 1}열 (병합 지시는 초기화됨)`);
    }

    case 'delete_table': {
      const tables = listTables(doc);
      const i = idx(args.table_index);
      if (i < 0 || i >= tables.length) return err(`ERROR: table_index ${i} 없음`);
      const { table, section } = tables[i];
      section.blocks.splice(section.blocks.indexOf(table), 1);
      return ok('표 삭제 완료');
    }

    case 'merge_cells': {
      const t = pickTable();
      if (typeof t === 'string') return err(t);
      const [top, left, bottom, right] = [idx(args.top), idx(args.left), idx(args.bottom), idx(args.right)];
      const R = t.rows.length; const C = t.rows[0].length;
      if (top < 0 || left < 0 || bottom >= R || right >= C || top > bottom || left > right) {
        return err(`ERROR: 병합 범위가 표(${R}×${C})를 벗어나거나 뒤집혔습니다`);
      }
      if (top === bottom && left === right) return err('ERROR: 한 칸은 병합할 수 없습니다');
      t.merges.push({ top, left, bottom, right });
      return ok(`병합 예약: (${top},${left})~(${bottom},${right}) — 실체화 때 적용됩니다`);
    }

    case 'set_line_spacing': {
      const p = idx(args.percent);
      if (p < 100 || p > 250) return err('ERROR: percent 는 100~250');
      doc.lineSpacing = p;
      return ok(`줄간격 ${p}%`);
    }

    case 'done': {
      const report = String(args.report ?? '').trim() || '문서 작성을 마쳤습니다.';
      return { result: report, dirty: false, finished: true, report };
    }

    default:
      return err(`ERROR: 알 수 없는 도구 "${name}". 목록: ${templateNames().length > 0 ? '' : ''}get_template, add_title, add_section, read_document, review_pages, edit_paragraph, edit_cell, delete_paragraph, delete_section, delete_table, add_table_row, delete_table_row, add_table_col, delete_table_col, merge_cells, set_line_spacing, done`);
  }
}
