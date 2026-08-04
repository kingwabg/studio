/**
 * AI 문서 작성 — 쪽 검토 (2026-08-05).
 *
 * 주문서 원칙 4 「페이지는 추정 금지」의 우리식 이행: 주문서 §6 은 글자폭 평균으로
 * 높이를 **추정**하는 엔진을 만들라 했지만, 우리는 진짜 rhwp 조판이 있으므로
 * 실체화된 문서에서 **실제 쪽 번호를 읽는다**. 추정 공식은 하나도 없다.
 *
 * 고아 제목(주문서 §6.1-4): 제목이 쪽 끝에 홀로 남고 내용은 다음 쪽에 있는 상태.
 * 판정도 실측 — 제목 문단의 쪽과 첫 내용 문단의 쪽이 다르면 고아다.
 */
import type { WriterDocument } from './document-model';
import { headingLabel } from './document-model';
import type { RealizeMap } from './realize';

interface WasmLike {
  pageCount: number;
  getCursorRect(sec: number, para: number, charOffset: number): { pageIndex: number };
}

export interface ReviewResult {
  /** 모델(LLM)에게 돌아가는 보고 문자열 */
  rendered: string;
  warningCount: number;
}

export function reviewPages(
  wasm: WasmLike, doc: WriterDocument, map: RealizeMap,
): ReviewResult {
  const pageOf = (para: number): number => {
    try { return wasm.getCursorRect(0, para, 0).pageIndex + 1; } catch { return -1; }
  };

  const lines: string[] = [`총 ${wasm.pageCount}쪽 (실제 조판 결과)`];
  const warnings: string[] = [];

  doc.sections.forEach((s, si) => {
    const at = map.sections[si];
    if (!at) return;
    const hp = pageOf(at.headingPara);
    const bp = pageOf(at.firstBlockPara);
    const ep = pageOf(at.lastPara);
    lines.push(`[${si}] ${headingLabel(s)} — ${hp === ep ? `${hp}쪽` : `${hp}~${ep}쪽`}`);
    // 고아 제목: 제목과 첫 내용이 다른 쪽 — 제목만 쪽 끝에 남았다는 뜻이다.
    if (hp > 0 && bp > 0 && hp !== bp && at.headingPara !== at.firstBlockPara) {
      warnings.push(
        `⚠ 고아 제목: "${headingLabel(s)}" 제목이 ${hp}쪽 끝에 홀로 있고 내용은 ${bp}쪽에 있습니다. ` +
        `이 섹션에 new_page 를 켜거나(delete 후 re-add), 앞 섹션 분량을 조절하세요.`,
      );
    }
  });

  if (warnings.length > 0) lines.push('', ...warnings);
  else lines.push('', '고아 제목 없음 — 쪽 배치 양호.');

  return { rendered: lines.join('\n'), warningCount: warnings.length };
}
