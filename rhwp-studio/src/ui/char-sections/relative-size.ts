/**
 * 「글자」 탭 · 상대 크기 · 글자 위치 — 워드엔 없고 한/글에만 있는 두 서식.
 *
 * 왜 패널로 꺼내는가: 지금은 「글자 모양」 대화상자 기본 탭 오른쪽 구석에 있어서,
 *  "영문만 살짝 키운다" / "이 글자만 기준선 위로 민다" 같은 잦은 미세조정에도 대화상자를 열고 닫아야 한다.
 *
 * 값은 엔진 CharProperties 의 배열 두 개를 그대로 쓴다(새 매핑을 만들지 않는다):
 *  - relativeSizes: 언어별 상대 크기 %  (기본 100)
 *  - charOffsets:   언어별 글자 위치 %  (기본 0, 양수면 위로)
 *
 * ⚠ 배열은 **7칸 고정, 인덱스 = 언어**다 (core/user-settings.ts 의 LANG / LANG_LABELS):
 *   0 한글 · 1 영문 · 2 한자 · 3 일어 · 4 외국어 · 5 기호 · 6 사용자.
 *   char-shape-dialog.ts(updateLangFields/saveLangFields)에서 확인했다.
 *
 * v1 은 **전체 언어 일괄 적용** — 자간·장평(ratios/spacings)이 이미 `Array(7).fill(값)` 관례를 쓰고,
 * 언어별로 나눠 쓰는 사람은 대화상자로 간다. 언어별 UI 가 필요해지면 여기서
 * LANG_LABELS 로 탭을 얹고 fill 대신 해당 인덱스만 갈아끼우면 된다(엔진 쪽은 이미 그렇게 받는다).
 */
import { mkEl, mkButton } from '../canva-dom';
import type { CharProperties } from '@/core/types';
import type { CharSectionDeps } from './types';

/** 배열 길이 = 언어 수. LANG_LABELS 와 같은 7. */
const LANG_COUNT = 7;

/** 대화상자(char-shape-dialog.ts)의 입력 범위와 맞춘다 — 같은 서식이 두 자리에서 다른 한계를 가지면 안 된다 */
const RANGE = {
  relativeSize: { min: 10, max: 250, def: 100 },
  charOffset: { min: -100, max: 100, def: 0 },
} as const;

interface RowSpec {
  label: string;
  hint: string;
  min: number;
  max: number;
  def: number;
  /** 지금 값 — 일괄 적용이라 대표로 0번(한글) 칸을 읽는다(자간·장평 패널과 같은 방식) */
  read: (p: CharProperties | null) => number;
  /** 7칸을 한꺼번에 채운 patch */
  patch: (v: number) => Partial<CharProperties>;
}

const ROWS: readonly RowSpec[] = [
  {
    label: '상대 크기(%)',
    hint: '글꼴 크기는 그대로 두고 이 글자만 비율로 키우거나 줄입니다.',
    ...RANGE.relativeSize,
    read: (p) => p?.relativeSizes?.[0] ?? RANGE.relativeSize.def,
    patch: (v) => ({ relativeSizes: Array(LANG_COUNT).fill(v) as number[] }),
  },
  {
    label: '글자 위치(%)',
    hint: '기준선 위아래로 밀어 올리거나 내립니다 — 위첨자와는 다릅니다(크기가 줄지 않습니다).',
    ...RANGE.charOffset,
    read: (p) => p?.charOffsets?.[0] ?? RANGE.charOffset.def,
    patch: (v) => ({ charOffsets: Array(LANG_COUNT).fill(v) as number[] }),
  },
];

export function buildRelativeSizeSection(host: HTMLElement, deps: CharSectionDeps): void {
  const sec = deps.section('상대 크기 · 글자 위치');

  for (const spec of ROWS) {
    let cur = clamp(spec.read(deps.charProps), spec.min, spec.max);

    const row = mkEl('div', 'canva-line-row');
    row.appendChild(mkEl('span', 'canva-line-label', spec.label));

    // 기본값 되돌리기 — 값이 이미 기본이면 눌러도 티가 안 나므로 흐리게 둔다
    const reset = mkButton('canva-section-link', { text: '기본값', title: `${spec.label} 기본값(${spec.def})으로` });

    const box = mkEl('div', 'canva-stepper canva-stepper--wide');
    const input = mkEl('input');
    input.type = 'number';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.value = String(cur);

    /** 화면 표시 + 엔진 적용을 한 곳에서 — 스텝/직접입력/되돌리기 세 경로가 갈라지면 값이 어긋난다 */
    const commit = (next: number): void => {
      const v = clamp(next, spec.min, spec.max);
      if (v === cur) { input.value = String(v); return; } // 범위 밖 입력을 되돌리는 표시 갱신은 필요
      cur = v;
      input.value = String(v);
      reset.style.opacity = v === spec.def ? '0.4' : '';
      deps.applyChar(spec.patch(v));
    };

    // ⚠ click 이 아니라 mousedown+preventDefault — 패널 클릭에 본문 선택이 풀리면
    //    서식이 선택 범위가 아니라 엉뚱한 대기 서식으로 걸린다(패널의 다른 버튼들과 같은 규약).
    const step = (d: number) => (e: Event): void => { e.preventDefault(); commit(cur + d); };
    const dec = mkButton('', { text: '−', title: `${spec.label} 줄이기` });
    const inc = mkButton('', { text: '+', title: `${spec.label} 늘리기` });
    dec.addEventListener('mousedown', step(-1));
    inc.addEventListener('mousedown', step(1));
    reset.addEventListener('mousedown', (e) => { e.preventDefault(); commit(spec.def); });

    // 직접 입력은 change 로만 받는다 — 타이핑 한 글자마다 적용하면 undo 가 자릿수만큼 쌓인다
    input.addEventListener('change', () => commit(parseInt(input.value, 10) || spec.def));

    box.append(dec, input, inc);
    row.append(reset, box);
    sec.appendChild(row);
    sec.appendChild(mkEl('div', 'canva-hint', spec.hint));

    reset.style.opacity = cur === spec.def ? '0.4' : '';
  }

  sec.appendChild(mkEl('div', 'canva-hint',
    '※ 한/글은 이 두 값을 언어(한글·영문·한자…)별로 따로 갖습니다. 여기서는 모든 언어에 같이 적용됩니다 — '
    + '언어별로 다르게 주려면 「글자 모양」 대화상자를 쓰세요.'));

  host.appendChild(sec);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
