/**
 * 표/셀 속성 — 패널 내장판 (디자인 2c 갱신: "표 조작 전체를 오른쪽으로")
 *
 * 왜 이렇게: 표/셀 속성 대화상자(table-cell-props-dialog.ts, ~1,800줄)는 탭 빌더 6종이
 * **모달 셸과 무관하게** DOM 을 만들고 저장은 onConfirm 한 곳에 모여 있다. 그래서 로직을
 * 다시 쓰지 않고 그 폼을 그대로 패널에 심는다 — 재작성은 기능 유실 위험만 크다.
 *
 * 모달과 다른 점은 **확인 버튼이 없다**는 것뿐이라, 입력이 바뀌면 디바운스 후 자동 저장한다.
 */
import { TableCellPropsDialog } from './table-cell-props-dialog';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { EventBus } from '@/core/event-bus';

/** 대화상자의 보호 멤버를 패널에서 쓰기 위한 최소 노출 */
class InlineForm extends TableCellPropsDialog {
  /** 모달을 띄우지 않고 폼 DOM 만 만든다 (+ 문서 값으로 채운다) */
  buildInline(): HTMLElement {
    const body = this.createBody();
    // show() 가 하던 '속성 조회 + 폼 채우기'를 대신 수행한다
    this.loadAndPopulate();
    return body;
  }

  /** 현재 폼 상태를 문서에 반영한다(모달의 '확인'과 같은 경로) */
  applyNow(): void {
    this.onConfirm();
  }
}

export class TablePropsInline {
  private form: InlineForm | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 패널에 폼을 심는다.
   * @param host 그려 넣을 자리
   * @param tab 'table' 이면 표 전체, 'cell' 이면 선택 셀 기준
   */
  mount(
    host: HTMLElement,
    wasm: WasmBridge,
    eventBus: EventBus,
    tableCtx: { sec: number; ppi: number; ci: number },
    cellIdx: number,
    tab: 'table' | 'cell',
  ): void {
    this.dispose();
    host.innerHTML = '';
    try {
      this.form = new InlineForm(wasm, eventBus, tableCtx, cellIdx, tab);
      const body = this.form.buildInline();
      body.classList.add('tcp-inline');
      host.appendChild(body);
      // 확인 버튼이 없으므로 변경 즉시 반영 — 연타를 묶어 한 번만 저장한다.
      const schedule = () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.applySafely(); }, 260);
      };
      body.addEventListener('change', schedule);
      body.addEventListener('input', schedule);
      // 버튼(방향·정렬 토글 등)은 change 를 안 쏘므로 클릭도 잡는다
      body.addEventListener('click', (e) => {
        if ((e.target as HTMLElement)?.closest('button')) schedule();
      });
    } catch (err) {
      console.warn('[table-props-inline] 폼 구성 실패:', err);
      host.textContent = '표 속성을 불러오지 못했습니다.';
    }
  }

  private applySafely(): void {
    try {
      this.form?.applyNow();
    } catch (err) {
      console.warn('[table-props-inline] 적용 실패:', err);
    }
  }

  dispose(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.form = null;
  }
}
