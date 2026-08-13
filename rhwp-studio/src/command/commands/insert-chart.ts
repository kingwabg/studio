/** [차트 2026-08-13] 차트 삽입·편집 명령.
 *
 * 차트는 새 개체 타입을 만들지 않고 **OLE 개체**로 들어간다 — 선택·핸들·이동·크기조절·
 * 글자처럼취급·되돌리기·z-order·캡션이 이미 통과하는 경로다. 차트인지 여부는 타입이
 * 아니라 `getChartSpec` 성공 여부로 가린다.
 */

import type { CommandDef, CommandServices, EditorContext } from '../types';
import { ChartDataDialog } from '../../ui/chart-data-dialog';
import {
  defaultChartSpec,
  getChartSpec,
  insertChart,
  setChartSpec,
  type ChartSpec,
} from '../../core/wasm-bridge-chart';

/** InputHandler 의 내부 연산 접근면 — 명령 계층에 공개 타입이 없어 최소 형태만 선언 */
interface EngineOps {
  executeOperation(op: {
    kind: 'snapshot';
    operationType: string;
    operation: (wasm: unknown) => unknown;
  }): void;
  cursor?: { getSelectedPictureRef?: () => { sec: number; ppi: number; ci: number } | null };
}

let dialog: ChartDataDialog | null = null;

export const chartCommands: CommandDef[] = [
  {
    id: 'insert:chart',
    label: '차트',
    canExecute: (ctx: EditorContext) => ctx.hasDocument,
    execute(services: CommandServices) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getPosition();
      dialog = new ChartDataDialog(defaultChartSpec(), 'insert');
      dialog.onApply = (spec: ChartSpec) => {
        try {
          // 스냅샷 연산으로 감싸면 ⌘Z 가 공짜로 따라온다(그림 삽입과 같은 경로)
          (ih as unknown as EngineOps).executeOperation({
            kind: 'snapshot',
            operationType: 'insertChart',
            operation: (wasm: unknown) => {
              insertChart(wasm, pos.sectionIndex, pos.paragraphIndex, spec);
              return ih.getPosition();
            },
          });
          services.eventBus.emit('document-changed');
        } catch (err) {
          console.warn('[insert:chart] 차트 삽입 실패:', err);
        }
      };
      dialog.show();
    },
  },
  {
    id: 'chart:edit-data',
    label: '차트 데이터 편집',
    canExecute: (ctx: EditorContext) => ctx.hasDocument,
    execute(services: CommandServices) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const sel = (ih as unknown as EngineOps).cursor?.getSelectedPictureRef?.();
      if (!sel) return;
      const cur = getChartSpec(services.wasm, sel.sec, sel.ppi, sel.ci);
      if (!cur) return; // 차트가 아닌 개체 — 조용히 무시(호출자가 타입을 안 가린다)
      dialog = new ChartDataDialog(cur, 'edit');
      dialog.onApply = (spec: ChartSpec) => {
        try {
          (ih as unknown as EngineOps).executeOperation({
            kind: 'snapshot',
            operationType: 'setChartSpec',
            operation: (wasm: unknown) => {
              setChartSpec(wasm, sel.sec, sel.ppi, sel.ci, spec);
              return ih.getPosition();
            },
          });
          services.eventBus.emit('document-changed');
        } catch (err) {
          console.warn('[chart:edit-data] 차트 편집 실패:', err);
        }
      };
      dialog.show();
    },
  },
];
