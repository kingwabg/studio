/**
 * 캔버스 글꼴 치환 — HWP 문서가 지정한 글꼴 이름을 **실제로 있는** 글꼴 사슬로 바꾼다.
 *
 * CanvasRenderingContext2D.prototype.font 을 통째로 갈아끼우는 방식이라,
 * 문서 캔버스뿐 아니라 **앱 안의 모든 캔버스**에 걸린다는 점이 중요하다.
 * (wasm-bridge.ts 에 있던 것을 2026-08-01 에 옮겼다 — 글꼴 문제는 글꼴 파일에 둔다.)
 */
import { fontFamilyChainForDisplay } from './font-substitution';

/**
 * 치환을 **면제**받는 글꼴 이름.
 *
 * 왜 필요한가(2026-08-01 실측): 위에 쓴 대로 이 치환은 모든 캔버스에 걸린다. 그래서 UI 가
 * 제 손으로 FontFace 를 실어 쓰는 글꼴(서명 만들기의 붓글씨·펜글씨)까지 '모르는 이름'으로
 * 취급돼 시스템 글꼴 사슬로 바뀌었고, 붓글씨와 펜글씨가 **똑같이** 그려졌다.
 * 조용히 대체될 뿐이라 화면만 봐서는 원인을 알 수 없다.
 *
 * 치환의 본래 목적은 문서가 가리키는 없는 글꼴을 메워 주는 것이다 —
 * 앱이 직접 싣고 있다고 선언한 글꼴은 그 대상이 아니다.
 */
const SELF_LOADED_FAMILIES = new Set<string>();

/** UI 가 FontFace 로 직접 실은 글꼴을 치환 대상에서 뺀다. */
export function keepCanvasFontFamily(family: string): void {
  SELF_LOADED_FAMILIES.add(family);
}

/**
 * CSS font 문자열에서 font-family를 추출하여 폰트 치환을 적용한다.
 *
 * 입력: 'bold 14.5px "안상수2006가는", sans-serif'
 * 출력: 'bold 14.5px "돋움", sans-serif'
 */
export function substituteCssFontFamily(cssFont: string): string {
  const pxIdx = cssFont.indexOf('px ');
  if (pxIdx < 0) return cssFont;

  const prefix = cssFont.substring(0, pxIdx + 3);
  const familyPart = cssFont.substring(pxIdx + 3);

  const match = familyPart.match(/^"([^"]+)"/);
  if (!match) return cssFont;

  const fontName = match[1];
  if (SELF_LOADED_FAMILIES.has(fontName)) return cssFont;
  return prefix + fontFamilyChainForDisplay(fontName, 0, 0);
}

let installed = false;

/**
 * 프로토타입 교체가 실제로 걸렸는가.
 * 걸렸다면 `ctx.font = ...` 만으로 치환되므로 호출부가 직접 치환할 필요가 없다.
 */
export function isCanvasFontSubstitutionInstalled(): boolean {
  return installed;
}

export function installCanvasFontSubstitution(): void {
  if (installed) return;
  if (typeof CanvasRenderingContext2D === 'undefined') return;

  const proto = CanvasRenderingContext2D.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!descriptor?.get || !descriptor.set || descriptor.configurable === false) return;

  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get!.call(this);
    },
    set(value: string) {
      descriptor.set!.call(this, substituteCssFontFamily(String(value)));
    },
  });
  installed = true;
}
