/**
 * 문단 패널 옵션의 미니 그림 — 사용자 지적 2026-08-01
 * ("왜 아이콘이 없어, 그래서 더 알아보기 힘든 거 같아, 내용 중에").
 *
 * 왜 Phosphor 를 그대로 쓰지 않는가:
 * 정렬 4종(왼쪽·가운데·오른쪽·양쪽)은 Phosphor 에 있지만 **배분·나눔은 없다** —
 * 그리고 사용자가 못 고르는 건 정확히 그 둘이다. 여기서 필요한 그림은 '아이콘'이
 * 아니라 **줄이 실제로 어떻게 놓이는지의 축소판**이라, 같은 언어(막대 4줄)로 6종을
 * 전부 그리는 편이 낫다. 첫 줄·줄 나눔도 같은 막대 문법으로 이어진다.
 *
 * 규칙: 16×12 뷰박스, 막대 높이 1.6, 줄 간격 3.2. 색은 currentColor 를 따라
 * 선택 상태(파란 글씨)에 자동으로 물든다 — 다크 테마도 별도 처리가 필요 없다.
 */

const W = 16;
const H = 12;

/** 막대 하나 — x 시작, 폭 */
function bar(y: number, x: number, w: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="1.6" rx="0.8"/>`;
}

function svg(inner: string): string {
  return `<svg class="tps-glyph" viewBox="0 0 ${W} ${H}" fill="currentColor" `
    + 'aria-hidden="true" focusable="false">' + inner + '</svg>';
}

/** 4줄짜리 문단 축소판 — rows = [시작x, 폭] 넷 */
function lines(rows: Array<[number, number]>): string {
  return svg(rows.map(([x, w], i) => bar(1 + i * 3.2, x, w)).join(''));
}

/**
 * 정렬 6종. 마지막 줄이 짧은 것이 보통의 문단이고, 그 마지막 줄을 어떻게 하느냐가
 * 양쪽/배분/나눔을 가른다 — 그림에서도 마지막 줄만 다르게 그린다.
 */
export const ALIGN_GLYPH: Record<string, string> = {
  // 왼쪽: 왼쪽만 맞고 오른쪽 끝은 **줄마다 들쭉날쭉**하다 — 이게 양쪽과의 차이다
  left: lines([[1, 14], [1, 10.5], [1, 12.5], [1, 7]]),
  // 가운데: 줄마다 길이가 다르고 각 줄이 가운데에 놓인다
  center: lines([[1, 14], [2.7, 10.5], [1.7, 12.5], [4.5, 7]]),
  // 오른쪽: 오른쪽만 맞고 왼쪽 시작이 들쭉날쭉
  right: lines([[1, 14], [4.5, 10.5], [2.5, 12.5], [8, 7]]),
  // 양쪽: 앞 세 줄은 끝이 딱 맞고 **마지막 줄만** 짧다
  justify: lines([[1, 14], [1, 14], [1, 14], [1, 7]]),
  // 배분: 마지막 줄까지 끝을 맞춘다 — 양쪽과의 차이가 정확히 이 한 줄이다
  distribute: lines([[1, 14], [1, 14], [1, 14], [1, 14]]),
  // 나눔: 낱말 사이만 벌어진 모습 — 막대가 조각조각 끊겨 있다
  split: svg(
    bar(1, 1, 4) + bar(1, 6.5, 3.5) + bar(1, 11.5, 3.5)
    + bar(4.2, 1, 5) + bar(4.2, 7.5, 7.5)
    + bar(7.4, 1, 3) + bar(7.4, 5.5, 4) + bar(7.4, 11, 4)
    + bar(10.6, 1, 5),
  ),
};

/** 첫 줄 3종 — 첫 막대의 시작 위치만 다르다(이게 곧 개념이다) */
export const INDENT_GLYPH: Record<string, string> = {
  normal: lines([[1, 14], [1, 14], [1, 14], [1, 8]]),
  indent: lines([[4, 11], [1, 14], [1, 14], [1, 8]]),
  hang: svg(
    bar(1, 1, 14) + bar(4.2, 4, 11) + bar(7.4, 4, 11) + bar(10.6, 4, 6),
  ),
};

/*
 * 줄 나눔(어절/글자/단어/하이픈)은 그림을 **일부러 넣지 않는다**.
 * 시도했다가 뺀 이유(2026-08-01 실측): 이 개념의 차이는 '오른쪽 끝이 가지런한가'인데,
 * 그걸 막대로 그리면 위 정렬 그림(왼쪽 vs 양쪽)과 똑같아져 서로를 헷갈리게 만든다.
 * 22×16 안에서는 뜻이 전달되지 않는 그림이 없느니만 못하다 — 툴팁과 설명이 맡는다.
 */

/** 문단 종류 4종은 Phosphor 로 충분하다 — 새로 그릴 이유가 없다 */
export const KIND_ICON: Record<string, string> = {
  None: 'minus',
  Outline: 'tree-structure',
  Number: 'list-numbers',
  Bullet: 'list-bullets',
};
