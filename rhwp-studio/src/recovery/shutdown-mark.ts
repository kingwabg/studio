/**
 * 정상 종료 / 사고 종료 가르기 — 복구본을 **사고 때만** 묻기 위한 표식.
 *
 * 문제(사용자 지적 2026-08-03): 새로고침할 때마다 「문서 복구」 창이 떴다. 우리 앱이
 * 정상 종료와 비정상 종료를 구분하지 못해, 초안이 남아 있으면 무조건 물었기 때문이다.
 * 「나중에」는 아무것도 안 지우므로 다음 부팅에서 또 뜬다 — 영구 반복.
 *
 * 한/글 방식: 복구 문서는 **비정상 종료 뒤에만** 뜬다. 정상적으로 닫으면 복구본을 스스로
 * 지운다. 그래서 평소엔 안 보이고 진짜 사고 때만 나타난다.
 *
 * 브라우저에서 그걸 가르는 표준 수법:
 *   부팅 때 'running' 을 적고, 나갈 때(pagehide) 'clean' 으로 바꾼다.
 *   다음 부팅에서 'running' 이 남아 있으면 = 나갈 때를 못 거쳤다 = **사고**.
 * pagehide 는 새로고침·탭 닫기·창 닫기에서 다 불리고, 크래시·강제종료에서는 안 불린다.
 */

const KEY = 'rhwpStudio.shutdown';

export type LastExit = 'clean' | 'crash' | 'first';

/**
 * 부팅 때 한 번 부른다. **직전 종료가 어땠는지**를 돌려주고, 이번 세션을 'running' 으로 건다.
 * (돌려준 뒤 바로 표식을 갈아 끼우므로 두 번 부르면 두 번째는 'crash' 로 보인다 — 한 번만.)
 */
export function beginSession(): LastExit {
  let last: LastExit = 'first';
  try {
    const prev = localStorage.getItem(KEY);
    if (prev === 'clean') last = 'clean';
    else if (prev === 'running') last = 'crash';
    localStorage.setItem(KEY, 'running');
  } catch {
    // localStorage 를 못 쓰는 환경(사생활 모드 등) — 사고로 단정하지 않는다.
    // 복구를 못 묻는 것보다 매번 묻는 게 더 나쁘다(이 수리의 취지).
    return 'first';
  }

  // 나갈 때 표식을 'clean' 으로. pagehide 가 정본이고, 안 불리는 브라우저 대비로
  // beforeunload 도 같이 건다(둘 다 불려도 결과는 같다).
  const mark = (): void => {
    try { localStorage.setItem(KEY, 'clean'); } catch { /* 못 적으면 다음에 사고로 보일 뿐 */ }
  };
  window.addEventListener('pagehide', mark);
  window.addEventListener('beforeunload', mark);
  return last;
}
