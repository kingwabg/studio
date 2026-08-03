/**
 * 오른쪽 패널 「글자」 탭에 얹는 섹션들의 공용 계약.
 *
 * 각 기능은 이 폴더 안에 **파일 하나**로 산다. 서로 다른 파일만 건드리게 해서 여럿이
 * 동시에 작업해도 덮어쓰지 않는다(배선은 canva-right-inspector.ts 가 한 곳에서 한다).
 *
 * 원칙(패널 전체 규칙과 같다):
 *  - 새 엔진 로직 없음. 글자 서식 적용은 **`emit('format-char', patch)` 한 경로**만 쓴다
 *    (그래야 선택/대기서식 처리와 Ctrl+Z 가 기존과 똑같이 동작한다).
 *  - 리본에 이미 있는 것(굵게·기울임·밑줄 켜기·글자색·형광펜·자간·장평)은 다시 넣지 않는다.
 *    패널은 "고른 것을 자세히 손보는 자리"다.
 */
import type { CharProperties } from '@/core/types';
import type { CanvaServices } from '../canva-services';

export interface CharSectionDeps {
  services: CanvaServices;
  /**
   * 섹션 껍데기를 만든다(제목 + 옵션 링크). 패널의 다른 섹션과 같은 모양이 나온다.
   * 호출자가 반환된 요소에 내용을 채워 넣고, host 에는 이미 붙어 있다.
   */
  section: (label: string, link?: { text: string; onClick: () => void }) => HTMLElement;
  /**
   * 섹션을 **그릴 때**의 글자 속성 — 없으면 null.
   * ⚠ 이건 스냅숏이다. 섹션은 탭을 열 때 한 번만 그려지고 커서가 움직여도 다시 안 그려지므로,
   *   **누를 때 판단하는 값(토글 on/off 같은 것)은 반드시 `getCharProps()` 로 다시 읽어라.**
   *   (2026-08-03 실결함: 강조점이 낡은 값으로 토글돼 두 번째 문단부터는 "해제"만 보냈다.)
   */
  charProps: CharProperties | null;
  /** 지금 이 순간의 글자 속성 — 커서를 옮긴 뒤에도 맞는 값 */
  getCharProps: () => CharProperties | null;
  /** 커서 서식이 바뀔 때마다 부른다(섹션의 켜짐 표시 갱신용). 패널을 다시 그리면 자동 해제된다. */
  onCharChange: (fn: (p: CharProperties) => void) => void;
  /**
   * 글자 서식 적용 — 내부에서 `eventBus.emit('format-char', patch)` 를 부른다.
   * 선택이 있으면 그 범위에, 없으면 대기 서식(다음 입력)에 걸린다.
   */
  applyChar: (patch: Partial<CharProperties>) => void;
  /** 패널을 다시 그린다(값 표시를 갱신해야 할 때) */
  redraw: () => void;
}

/** 각 섹션 파일이 내보내는 함수 모양 */
export type CharSectionBuilder = (host: HTMLElement, deps: CharSectionDeps) => void;
