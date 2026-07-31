/**
 * 사전 기반 맞춤법 — hunspell + 한국어 사전(spellcheck-ko).
 * 스펙: studio `docs/plans/format-linter.md` (4차)
 *
 * 왜 필요한가: 규칙 90여 개는 **아는 오타만** 잡는다. "모드게"처럼 목록에 없는 말은
 * 그냥 지나간다(2026-07-31 사용자 실측). 사전은 "그런 말이 없다"를 알 수 있다.
 *
 * ⚠ 전량 로컬이다. 문서 텍스트를 외부로 보내지 않는다는 원칙(ui/spell-dialog.ts 헤더)은
 *   여기서도 유지된다 — 사전 파일만 받아오고 검사는 브라우저 안에서 한다.
 *
 * 라이선스: 엔진 hunspell-wasm(LGPL-2.0 / GPL-2.0 / MPL-1.1 택일 — MPL 로 쓴다:
 * 파일 단위 카피레프트라 우리 코드에 번지지 않는다) + 사전 hunspell-dict-ko(GPL-3).
 * ⚠ hunspell-asm(MIT)을 먼저 시도했으나 6년 묵은 emscripten glue 가 최신 번들러에서
 *   'runtimeModule is not a function' 으로 죽는다(2026-07-31 실측) — 그래서 이쪽이다.
 * 사전은 **별개 저작물**로 원본 라이선스 그대로 `public/dict/` 에 둔다 — 프로젝트가
 * LICENSE.md 에 "executable program and a hunspell dictionary are considered as
 * separate works" 라고 명시했다. 파일을 고치거나 우리 코드에 섞지 말 것.
 *
 * 크기: ko.aff 11MB + ko.dic 2.7MB. 그대로 두면 저장소가 무거워져 **gzip 으로 벤더링**하고
 * 브라우저에서 DecompressionStream 으로 푼다(합계 0.85MB).
 */

/**
 * 벤더링 경로 — 상대 경로여야 /rhwp-studio/ 하위 배포에서도 맞다.
 *
 * ⚠ 확장자가 `.bin` 인 이유: `.gz` 로 두면 서버가 `Content-Encoding: gzip` 을 붙여
 *   **브라우저가 먼저 풀어버린다**. 그러면 우리 DecompressionStream 이 이미 풀린 바이트를
 *   또 풀려다 스트림이 깨진다("Failed to fetch", 2026-07-31 실측). 확장자를 감춰
 *   서버가 손대지 않게 하고, 압축 해제는 우리가 명시적으로 한다.
 */
const AFF = 'dict/ko.aff.bin';
const DIC = 'dict/ko.dic.bin';
/** 받아온 원본을 담아 두는 캐시 — 두 번째부터는 네트워크를 안 탄다(오프라인 포함) */
const CACHE = 'rhwp-dict-v1';

interface HunspellLike {
  testSpelling(word: string): boolean;
  getSpellingSuggestions(word: string): string[];
  addWord(word: string): void;
}

let ready: Promise<HunspellLike | null> | null = null;
let inst: HunspellLike | null = null;

/** 사전이 이미 준비됐나 — UI 가 "준비 중"을 보여줄지 판단한다 */
export function isDictReady(): boolean {
  return inst !== null;
}

/** gzip 으로 벤더링한 파일을 받아 푼다. Cache Storage 에 원본(gz)을 남긴다. */
async function fetchGz(path: string): Promise<Uint8Array> {
  const url = new URL(path, document.baseURI).href;
  let res: Response | undefined;
  try {
    const cache = await caches.open(CACHE);
    res = await cache.match(url);
    if (!res) {
      const fresh = await fetch(url);
      if (!fresh.ok) throw new Error(`${path} ${fresh.status}`);
      await cache.put(url, fresh.clone());
      res = fresh;
    }
  } catch {
    // Cache Storage 를 못 쓰는 환경(시크릿 창 일부 등)에서도 검사는 되어야 한다
    res = await fetch(url);
    if (!res.ok) throw new Error(`${path} ${res.status}`);
  }
  const ds = new DecompressionStream('gzip');
  const buf = await new Response(res.body!.pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * 사전을 준비한다(중복 호출 안전 — 한 번만 받는다).
 * 실패하면 null 을 돌려주고 조용히 규칙 검사만 계속한다 — 사전을 못 받았다고
 * 편집기가 멈추면 안 된다.
 */
export function ensureDictionary(): Promise<HunspellLike | null> {
  if (!ready) {
    ready = (async () => {
      try {
        const [{ createHunspellFromStrings }, aff, dic] = await Promise.all([
          import('hunspell-wasm'), fetchGz(AFF), fetchGz(DIC),
        ]);
        const dec = new TextDecoder('utf-8');
        inst = (await createHunspellFromStrings(
          dec.decode(aff), dec.decode(dic),
        )) as unknown as HunspellLike;
        return inst;
      } catch (err) {
        console.warn('[dict] 사전 준비 실패 — 규칙 검사만 계속합니다:', err);
        return null;
      }
    })();
  }
  return ready;
}

/**
 * 편집기가 뜬 뒤 **한가할 때** 미리 받아 둔다(사용자 제안 2026-07-31).
 * 로그인 시점이 아니라 여기인 이유: 로그인하는 사람 중 문서를 여는 비율이 절반도 안 돼서,
 * 편집기를 안 여는 사용자에게는 순수 낭비다. 편집기가 떴으면 쓸 사람이 확실하고,
 * 첫 글자를 치기까지 보통 몇 초가 있어 체감 대기가 0 이다.
 *
 * ⚠ 아끼는 회선(saveData·2G/3G)에서는 자동으로 받지 않는다 — 현장에 테더링이 있다.
 */
export function prefetchDictionary(): void {
  const c = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (c?.saveData || (c?.effectiveType && /^(slow-)?2g$|^3g$/.test(c.effectiveType))) return;
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
  }).requestIdleCallback;
  const run = () => { void ensureDictionary(); };
  if (idle) idle(run, { timeout: 8000 });
  else window.setTimeout(run, 3000);
}

/** 사전에 있는 말인가. 사전이 아직 없으면 **모르는 것으로 치지 않는다**(true). */
export function isKnownWord(word: string): boolean {
  if (!inst || !word) return true;
  try {
    return inst.testSpelling(word);
  } catch {
    return true;
  }
}

/** 고칠 후보 — 없으면 빈 배열. */
export function suggestWord(word: string): string[] {
  if (!inst || !word) return [];
  try {
    return inst.getSpellingSuggestions(word).slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * 사용자 사전에 말을 더한다 — 아동·직원·프로그램 이름처럼 사전에 없지만 맞는 말.
 * 이걸 안 하면 일지가 온통 밑줄이 된다(고유명사 오탐).
 */
export function addKnownWords(words: readonly string[]): void {
  if (!inst) return;
  for (const w of words) {
    if (!w) continue;
    try { inst.addWord(w); } catch { /* 한 단어 실패가 전체를 막지 않는다 */ }
  }
}
