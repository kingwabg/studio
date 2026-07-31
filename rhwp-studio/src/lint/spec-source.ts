/**
 * 서식 규격 공급원 — 「우리 센터 서식」을 호스트(sc-)에서 받아온다.
 * 스펙: studio `docs/plans/format-linter.md` (3차)
 *
 * 편집기는 sc- 안에 같은 오리진 iframe 으로 들어가므로 `/api/format-specs` 를 그대로
 * 부른다. 단독 실행(개발 5173 · 데모)에서는 그 경로가 없으므로 **내장 기본값 한 벌**로
 * 조용히 떨어진다 — 규격을 못 받았다고 검사가 멈추면 안 된다.
 *
 * ⚠ 규칙 끔(`*On: false`)은 값을 지우는 게 아니라 **그 규칙을 검사에서 뺀다**.
 * 안 쓰는 규칙이 켜져 있으면 실제 문서에서 지적이 수백 건 쏟아진다(실측 2026-07-31).
 */
import { DEFAULT_SPEC, type FormatSpec } from './format-rules';

/** 호스트에서 오는 규격 한 벌(이름·기본 여부 + 규칙 값/on-off). */
export interface NamedSpec {
  id: string;
  name: string;
  isDefault: boolean;
  spec: FormatSpec;
}

const BUILTIN: NamedSpec = {
  id: 'builtin',
  name: '기본 서식 규격',
  isDefault: true,
  spec: DEFAULT_SPEC,
};

/** 호스트 응답 = 이름표 + FormatSpec 그대로(양쪽 타입을 같은 모양으로 맞춰 뒀다). */
type HostSpec = FormatSpec & { id: string; name: string; isDefault: boolean };

function toSpec(h: HostSpec): FormatSpec {
  return {
    fontName: h.fontName, fontNameOn: h.fontNameOn,
    bodyPt: h.bodyPt, bodyPtOn: h.bodyPtOn,
    boldBodyMinChars: h.boldBodyMinChars, boldBodyOn: h.boldBodyOn,
    headerBoldOn: h.headerBoldOn,
    tableMaxPt: h.tableMaxPt, tableMaxPtOn: h.tableMaxPtOn,
  };
}

/**
 * 호스트에서 규격 목록을 받아온다. 실패하면 내장 기본값 한 벌.
 * 규격은 자주 바뀌지 않으므로 한 번 받아 캐시한다(reload 로 다시 받는다).
 */
let cache: NamedSpec[] | null = null;

export async function loadSpecs(): Promise<NamedSpec[]> {
  if (cache) return cache;
  try {
    const res = await fetch('/api/format-specs', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { specs?: HostSpec[] };
    const list = (json.specs ?? []).map((h) => ({
      id: h.id, name: h.name, isDefault: h.isDefault, spec: toSpec(h),
    }));
    cache = list.length > 0 ? list : [BUILTIN];
  } catch {
    // 단독 실행이거나 호스트가 아직 규격을 안 준다 — 검사는 계속 돈다.
    cache = [BUILTIN];
  }
  return cache;
}

/** 다음 loadSpecs 가 다시 받아오게 한다(관리자 화면에서 고친 뒤). */
export function invalidateSpecs(): void {
  cache = null;
}

/** 처음 고를 규격 — 기본으로 표시된 것, 없으면 첫 번째. */
export function pickDefault(list: NamedSpec[]): NamedSpec {
  return list.find((s) => s.isDefault) ?? list[0] ?? BUILTIN;
}
