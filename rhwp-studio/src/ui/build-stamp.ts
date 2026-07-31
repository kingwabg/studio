/**
 * 상태바의 배포 표식 — "지금 내가 보는 화면이 최신인가"를 눈으로 판별한다.
 *
 * 왜 필요한가(2026-07-31): 배포는 ①Vercel 빌드 대기(1~4분) ②서비스워커 캐시 두 단계로
 * 늦는데, 화면에는 아무 단서가 없다. 그래서 "고쳤다"와 "안 보인다"가 계속 엇갈렸고
 * 하루에 세 번 헛돌았다. 번들 해시를 비교해야만 알 수 있던 것을 한 줄로 드러낸다.
 *
 * 값의 출처:
 *  - sc- 안에 embed 될 때: 호스트가 붙이는 `?assetVersion=` (배포 단위와 정확히 같다)
 *  - 단독 실행: 빌드 시각(vite define) — 개발 중엔 이쪽이 유일한 단서다
 */

declare const __BUILD_STAMP__: string;

/** 배포 표식 문자열 — 호스트가 준 배포 버전이 있으면 그것, 없으면 빌드 시각. */
export function buildStamp(): { text: string; from: 'host' | 'build' } {
  let asset: string | null = null;
  try {
    asset = new URLSearchParams(location.search).get('assetVersion');
  } catch {
    asset = null;
  }
  if (asset) return { text: asset, from: 'host' };
  return { text: typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev', from: 'build' };
}

/** 상태바 오른쪽에 표식을 붙인다. 상태바가 없으면(임베드 변형) 조용히 넘어간다. */
export function mountBuildStamp(): void {
  const bar = document.getElementById('status-bar');
  if (!bar || bar.querySelector('.stb-build')) return;
  const s = buildStamp();
  const el = document.createElement('span');
  el.className = 'stb-item stb-build';
  el.textContent = s.text;
  el.title = s.from === 'host'
    ? `배포 버전 ${s.text} — 호스트가 알려준 값입니다. 최신인지 의심되면 시크릿 창으로 여세요.`
    : `빌드 ${s.text} — 단독 실행이라 배포 버전 대신 빌드 시각을 보여줍니다.`;
  // 다른 항목과 같은 구분자를 앞에 둔다 — 없으면 '삽입'과 글자가 붙는다(실측).
  const sep = document.createElement('span');
  sep.className = 'stb-divider';
  // 메시지 영역 앞에 둔다(오른쪽 확대 컨트롤과 겹치지 않게)
  const msg = bar.querySelector('#sb-message');
  if (msg) {
    bar.insertBefore(sep, msg);
    bar.insertBefore(el, msg);
  } else {
    bar.append(sep, el);
  }
}
