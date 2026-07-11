/**
 * [캔버스 한컴 포크] 캔바 사이드바 공용 서비스 핸들.
 * 패널들이 rhwp 엔진에 닿는 유일한 통로 — main.ts 부트스트랩에서 실제 인스턴스를 주입한다.
 * 새 엔진 로직은 만들지 않는다: 기존 커맨드 dispatch + eventBus 미러가 원칙.
 */
import type { WasmBridge } from '@/core/wasm-bridge';
import type { EventBus } from '@/core/event-bus';
import type { CommandDispatcher } from '@/command/dispatcher';
import type { InputHandler } from '@/engine/input-handler';

export interface CanvaServices {
  wasm: WasmBridge;
  eventBus: EventBus;
  dispatcher: CommandDispatcher;
  getInputHandler: () => InputHandler | null;
}
