// [캔버스 한컴 포크] CSS 좌표가 아니라 iframe을 포함한 화면의 물리 픽셀에 맞춘다.
export function snapPageOffset(offset: number, origin: number, dpr: number): number {
  return Math.round((origin + offset) * dpr) / dpr - origin;
}

export function pageScreenOrigin(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  let x = rect.left, y = rect.top;
  let view = element.ownerDocument.defaultView;
  try {
    while (view?.frameElement) {
      const frame = view.frameElement as HTMLElement;
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left + frame.clientLeft;
      y += frameRect.top + frame.clientTop;
      view = frame.ownerDocument.defaultView;
    }
  } catch {
    // 다른 출처 iframe은 외부 좌표를 읽을 수 없으므로 내부 격자까지만 보정한다.
  }
  return { x, y };
}
