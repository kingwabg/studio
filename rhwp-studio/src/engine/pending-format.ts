/**
 * 대기 서식 — 선택 없이 고른 글자 서식을 '다음에 칠 글자'에 걸어 둔다.
 *
 * 왜 있나: 빈 문단에서 굵게·크기를 눌러도 아무 일이 없었다(사용자 신고 2026-07-30).
 * 선택이 없으면 applyToggleFormat 은 조기 반환하고 format-char 도 무시했기 때문.
 * 워드·한컴은 다음 입력에 걸어 둔다 — 그 동작과 수명(커서를 옮기면 무효)을 따른다.
 *
 * 왜 별도 모듈: input-handler.ts 는 파일 크기 래칫의 상한(4,797줄)에 걸려 있다.
 * 새 기능은 새 모듈로 — 게이트가 잡아 준 대로.
 *
 * 호출자는 input-handler.ts 의 얇은 위임 메서드들(`this` = InputHandler).
 */
import type { CharProperties, DocumentPosition } from '@/core/types';

/** 커서 자리를 문자열 하나로 — 대기 서식의 유효 범위 판정용 */
function posKey(this: any): string {
  const p = this.cursor.getPosition();
  return [p.sectionIndex, p.paragraphIndex, p.parentParaIndex ?? -1, p.controlIndex ?? -1,
    p.cellIndex ?? -1, p.cellParaIndex ?? -1, p.charOffset].join(':');
}

/** 대기 서식을 얹는다(누적) + 툴바·패널이 즉시 눌린 상태로 보이게 알린다 */
export function setPendingCharFormat(this: any, props: Partial<CharProperties>): void {
  this.pendingChar = { ...(this.pendingChar ?? {}), ...props };
  this.pendingAt = posKey.call(this);
  this.eventBus.emit('cursor-format-changed', getPendingOrCurrentChar.call(this));
}

/** 현재 커서에서 유효한 대기 서식 (자리를 옮겼으면 버린다) */
export function getPendingCharFormat(this: any): Partial<CharProperties> | null {
  if (!this.pendingChar) return null;
  if (this.pendingAt !== posKey.call(this)) {
    this.pendingChar = null;
    this.pendingAt = null;
    return null;
  }
  return this.pendingChar;
}

/** 표시용 — 문서 서식 위에 대기 서식을 얹은 값 */
export function getPendingOrCurrentChar(this: any): CharProperties {
  const base = this.getCharPropertiesAtCursor();
  const pend = getPendingCharFormat.call(this);
  return pend ? { ...base, ...pend } : base;
}

/** 선택이 없을 때의 토글 — outline 만 숫자(outlineType), 나머지는 불리언 */
export function togglePending(this: any, prop: string): void {
  const cur = getPendingOrCurrentChar.call(this) as Record<string, unknown>;
  const next = prop === 'outline'
    ? { outlineType: ((cur.outlineType as number) ?? 0) ? 0 : 1 }
    : { [prop]: !cur[prop] };
  setPendingCharFormat.call(this, next as Partial<CharProperties>);
}

/**
 * 방금 삽입한 글자에 대기 서식을 입힌다(삽입 위치 + 길이 범위에만).
 * IME 조합 중에는 조합 텍스트를 지웠다 다시 넣으므로 매 조합마다 다시 호출된다.
 */
export function applyPendingToInserted(this: any, pos: DocumentPosition, length: number): void {
  const pend = this.pendingChar;
  if (!pend || length <= 0) return;
  try {
    this.applyCharPropsToRange(
      { ...pos, charOffset: pos.charOffset },
      { ...pos, charOffset: pos.charOffset + length },
      pend,
    );
  } catch (err) {
    console.warn('[pending-format] 대기 서식 적용 실패:', err);
  }
  // 커서는 삽입 끝으로 가므로 대기 자리도 함께 옮긴다 — 이어 치면 계속 적용된다
  this.pendingAt = [pos.sectionIndex, pos.paragraphIndex, pos.parentParaIndex ?? -1,
    pos.controlIndex ?? -1, pos.cellIndex ?? -1, pos.cellParaIndex ?? -1,
    pos.charOffset + length].join(':');
}
