/**
 * 스타일 정보 카드 — 「문단 모양 / 글자 모양 / 번호·글머리표」 세 줄 요약.
 *
 * 스타일 대화상자(ui/style-dialog.ts)와 오른쪽 패널(스타일 탭)이 **같은 함수**를 쓴다.
 * 두 곳이 제 나름대로 문구를 만들면 같은 스타일이 다르게 읽힌다 — 오늘 이모지·정렬에서
 * 같은 실수를 이미 했다(한쪽만 고쳐 다른 쪽이 어긋남).
 */
import type { CharProperties, ParaProperties } from '@/core/types';

export const ALIGN_LABELS: Record<string, string> = {
  justify: '양쪽', left: '왼쪽', right: '오른쪽', center: '가운데',
  distribute: '배분', split: '나눔',
};

export const HEAD_LABELS: Record<string, string> = {
  None: '없음', Outline: '개요', Number: '번호', Bullet: '글머리표',
};

export const pxToPt = (v: number): string => ((v * 72) / 96).toFixed(1);

/** 문단 모양 요약 — 줄 배열(호출자가 <br> 로 잇든 DOM 으로 쌓든 정한다) */
export function paraInfoLines(pp: ParaProperties, nextStyleName: string): string[] {
  const align = ALIGN_LABELS[pp.alignment ?? 'justify'] ?? pp.alignment ?? '';
  const lsType = pp.lineSpacingType ?? 'Percent';
  const ls = pp.lineSpacing ?? 160;
  const ml = pp.marginLeft != null ? pxToPt(pp.marginLeft) : '0.0';
  const mr = pp.marginRight != null ? pxToPt(pp.marginRight) : '0.0';
  const indent = pp.indent != null ? pxToPt(pp.indent) : '0.0';
  const indentPt = parseFloat(indent);
  const firstLine = indentPt > 0
    ? `들여쓰기 ${indent} pt`
    : indentPt < 0 ? `내어쓰기 ${Math.abs(indentPt).toFixed(1)} pt` : '보통';
  const lsStr = lsType === 'Percent' ? `${ls} %` : `${pxToPt(ls)} pt`;
  return [
    `왼쪽 여백: ${ml} pt   첫 줄: ${firstLine}`,
    `오른쪽 여백: ${mr} pt   정렬 방식: ${align}`,
    `줄 간격: ${lsStr}`,
    `다음 스타일: ${nextStyleName}`,
  ];
}

/** 글자 모양 요약 */
export function charInfoLines(cp: CharProperties): string[] {
  const font = cp.fontFamily ?? 'sans-serif';
  const size = cp.fontSize != null ? (cp.fontSize / 100).toFixed(0) : '10';
  const ratio = cp.ratios?.[0] ?? 100;
  const spacing = cp.spacings?.[0] ?? 0;
  return [
    `글꼴: ${font}`,
    `크기: ${size} pt`,
    `장평: ${ratio}%  자간: ${spacing}%`,
  ];
}

/** 번호·글머리표 요약 */
export function headInfoLine(pp: ParaProperties): string {
  const headType = pp?.headType ?? 'None';
  return `종류: ${HEAD_LABELS[headType] ?? headType}`;
}
