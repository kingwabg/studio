// presets.ts — 문서 콘텐츠 색 프리셋의 유일 정본 (UI 크롬 색이 아니라 "문서에 들어가는 값").
// 2026-07 중복 감사: 같은 팔레트가 4벌 재선언돼 파랑이 #2B5CE6/#256EF4로 표류했던 것을 수렴.
// 잉크 계열 첫 값은 화면 기본색(TEXT_DEFAULTS.color=#000000)과 일치시킨다.
// 파랑은 KRDS 정부 블루(#256EF4) — studio-krds-direction. ⚠ 재선언 금지, 여기서만 수정.

// 본문 글자색 (툴바 ColorPopover · 인스펙터 InspectorColor · 인라인 서식바 공용)
export const TEXT_COLOR_PRESETS = ["#000000", "#5B6577", "#256EF4", "#D64550", "#3B9B6B", "#C77A28"];
