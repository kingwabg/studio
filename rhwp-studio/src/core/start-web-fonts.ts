/**
 * 웹폰트를 **기다리지 않고** 내려받는다 — 사용자 신고 2026-08-01
 * ("강력 새로 고침이 로딩 오래 걸리는 이유, 화면도 이상하게 나오고").
 *
 * 실측(2026-08-01): CRITICAL 로 잡힌 함초롬 3종이 CDN 에서 **34MB**
 * (HANBatangB 13.3 + HANBatang 11.3 + HCRDotum 9.5)이고, 이걸 await 하고 있어
 * 첫 화면이 뜨기까지 **5,055ms** 걸렸다. 그 5초 동안 화면은 뼈대만 보인다.
 * 기다리지 않게 바꾸니 **441ms**(자원 44.8MB → 10.6MB).
 *
 * ⚠ 왜 안 기다려도 되나: 조판 **폭은 엔진의 내장 메트릭**이 정한다(웹폰트 실측이
 *   아니다). 글꼴이 늦게 와도 자리는 안 흔들리고 글자 모양만 나중에 바뀐다 —
 *   CSS `font-display: swap` 과 같은 원리다. 다 오면 한 번 다시 그린다.
 */
import { loadWebFonts, type WebFontLoadOptions } from './font-loader';

export function startWebFonts(
  docFonts: string[] | undefined,
  options: WebFontLoadOptions | undefined,
  repaint: () => void,
  msg?: HTMLElement,
): void {
  if (msg) msg.textContent = '글꼴 내려받는 중...';
  void loadWebFonts(docFonts ?? [], (loaded, total) => {
    if (msg && total > 0) msg.textContent = `글꼴 내려받는 중... (${loaded}/${total})`;
  }, options)
    .then(() => {
      if (msg) msg.textContent = '';
      try { repaint(); } catch { /* 아직 문서가 없으면 할 일 없음 */ }
    })
    .catch((e) => console.warn('[fonts] 웹폰트 로드 실패(계속 진행):', e));
}
