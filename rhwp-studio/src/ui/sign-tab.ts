/**
 * 서명·도장 대화상자의 탭 하나가 지켜야 할 약속.
 *
 * 세 탭(직접·글씨체·도장)이 하는 일은 전부 **투명한 캔버스 하나를 채우는 것**이라,
 * 껍데기는 그 캔버스만 알면 내려받기·문서 삽입을 똑같이 처리할 수 있다.
 * 탭이 늘어도 껍데기는 안 바뀐다.
 */
export interface SignTab {
  /** 탭 본문 */
  el: HTMLElement;
  /** 결과물 — 배경 없이 그려야 투명 PNG 가 된다 */
  canvas: HTMLCanvasElement;
  label: string;
  /** 탭 이름 아래 한 줄 — 이 탭이 무엇을 하는지 */
  sub: string;
  /** 대화상자 맨 아래 안내 한 줄 */
  foot: string;
  /** 되돌리기 버튼 문구(탭마다 하는 일이 달라 이름도 다르다) */
  resetLabel: string;
  /** 비어 있으면 내려받기·삽입 버튼을 잠근다 */
  isEmpty(): boolean;
  clear(): void;
  /** 탭이 보이게 된 직후 — 캔버스 크기 재기·포커스처럼 **붙은 뒤에만** 되는 일 */
  onShow?(): void;
}
