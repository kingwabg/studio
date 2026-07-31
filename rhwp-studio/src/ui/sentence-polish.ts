/**
 * 「문장 다듬기」 — 지금 문단을 AI 로 3가지로 고쳐 보여주고, 고른 것으로 바꾼다.
 * (사용자 요청 2026-07-31: 카카오톡처럼 문장을 고쳐 주는 기능)
 *
 * 규칙·사전으로는 원리상 못 하는 일이다. 사용자 예문
 * "우울하다 박으로 나ㅆ다.타. … 날파리 들어 틀어와서" 에서 규칙 0건, 사전 0건이었다 —
 * `박으로`도 `틀어와서`도 **사전에 있는 맞는 말**이고 틀린 건 문맥이기 때문이다.
 *
 * ⚠ 이 파일은 **문서 텍스트가 밖으로 나가는 유일한 경로**다. 세 겹으로 막는다:
 *   ① 사용자가 버튼을 눌렀을 때만 — 자동 호출 없음
 *   ② 아동 관찰기록 계열에서는 호출부가 버튼 자체를 감춘다(canEditorPolish)
 *   ③ 보내기 전 사람 이름을 가리고, 돌아온 문장에 되꽂는다(maskNames/unmaskNames)
 */

/** 호스트(sc-)가 붙여 주는 문서 종류 — 아동 기록이면 아예 안 보여준다. */
export type DocKind = 'general' | 'child-record';

/**
 * 이 문서에서 「문장 다듬기」를 허용하나.
 * ⚠ 기본값이 **허용**이 아니다 — 종류를 모르면(호스트가 안 알려주면) 일반 문서로 본다.
 *   아동 기록을 일반으로 오인하는 게 더 위험하므로, 호스트가 명시적으로 알려주게 한다.
 */
export function canPolish(kind: DocKind): boolean {
  return kind !== 'child-record';
}

/** 문서 종류 — URL 파라미터로 호스트가 알려준다(`?docKind=child-record`). */
export function currentDocKind(): DocKind {
  try {
    return new URLSearchParams(location.search).get('docKind') === 'child-record'
      ? 'child-record'
      : 'general';
  } catch {
    return 'general';
  }
}

/** 가린 이름을 되돌리기 위한 표 */
export interface NameMask {
  masked: string;
  table: Map<string, string>;
}

/**
 * 사람 이름을 가린다 — 성+이름 두세 글자 한글 뒤에 호칭·조사가 붙는 형태만 잡는다.
 * 완벽한 익명화가 아니다(그건 불가능하다). **보내는 양을 줄이는 최소한의 방어**이고,
 * 진짜 방어선은 ②(아동 기록에서는 아예 안 보냄)다 — 이 한계를 알고 쓸 것.
 */
export function maskNames(text: string, known: readonly string[] = []): NameMask {
  const table = new Map<string, string>();
  let n = 0;
  let masked = text;
  const put = (name: string): string => {
    for (const [k, v] of table) if (v === name) return k;
    const key = `〔사람${++n}〕`;
    table.set(key, name);
    return key;
  };
  // ① 호스트가 알려준 실제 이름(아동·직원)이 있으면 그것부터
  for (const name of known) {
    if (name.length < 2) continue;
    masked = masked.split(name).join(put(name));
  }
  // ② 호칭이 붙은 한글 이름 — 김민수 선생님 / 박지영 님
  masked = masked.replace(/([가-힣]{2,4})\s?(선생님|님|씨|아동|학생)/g,
    (_m, name: string, title: string) => `${put(name)} ${title}`);
  return { masked, table };
}

/** 가린 이름을 되돌린다. */
export function unmaskNames(text: string, mask: NameMask): string {
  let out = text;
  for (const [key, name] of mask.table) out = out.split(key).join(name);
  return out;
}

const SYSTEM =
  '당신은 한국어 문장을 다듬는 편집자입니다. 주어진 문단을 뜻은 그대로 두고 ' +
  '맞춤법·띄어쓰기·문법·어색한 표현을 고쳐 **서로 다른 3가지**로 제시하세요.\n' +
  '출력은 JSON 하나만: {"versions":["...","...","..."]}\n' +
  '규칙: ①원문에 없는 내용을 지어내지 마세요 ②〔사람1〕 같은 표시는 그대로 두세요 ' +
  '③3가지는 문체가 서로 달라야 합니다(간결/자연스럽게/격식) ④설명·코드펜스 없이 JSON만.';

/**
 * 문단을 3가지로 다듬어 받는다. 실패하면 빈 배열 — 호출부가 안내만 띄운다.
 * 호출 경로는 `/api/ai/v1/chat/completions`(호스트 프록시가 키를 붙인다).
 */
export async function polishParagraph(
  text: string,
  known: readonly string[] = [],
): Promise<{ versions: string[]; error?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { versions: [] };
  const mask = maskNames(trimmed, known);
  try {
    const res = await fetch('/api/ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: mask.masked },
        ],
        temperature: 0.7,
        max_tokens: 1024,
        // ⚠ 추론(thinking) 모델은 생각에만 수천~수만 토큰을 쓴다(Nemotron 은 기본
        //   reasoning_budget 16384). 문장 다듬기는 그럴 일이 아니고, 생각이 길어지면
        //   답이 잘려 JSON 이 깨진다. 끄는 옵션을 함께 보낸다 — 모르는 모델은 무시한다.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      error?: string | { message?: string };
    };
    if (!res.ok) {
      const e = typeof json.error === 'string' ? json.error : json.error?.message;
      return { versions: [], error: e ?? `요청 실패 (${res.status})` };
    }
    const msg = json.choices?.[0]?.message;
    // 추론 모델은 생각을 reasoning_content 에 따로 담는다 — 답이 비면 거기서라도 찾는다.
    // (enable_thinking 을 못 끄는 모델 대비. 생각 안에도 우리가 시킨 JSON 이 들어 있다.)
    const raw = msg?.content?.trim() ? msg.content : (msg?.reasoning_content ?? '');
    // 모델이 코드펜스를 붙이는 일이 잦다 — 첫 { 부터 마지막 } 까지만 본다.
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e <= s) return { versions: [], error: '응답을 이해하지 못했습니다' };
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { versions?: unknown };
    const versions = Array.isArray(parsed.versions)
      ? parsed.versions.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    return { versions: versions.slice(0, 3).map((v) => unmaskNames(v, mask)) };
  } catch (err) {
    return { versions: [], error: String(err) };
  }
}
