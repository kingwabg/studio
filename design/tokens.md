# 디자인 정본 (single source) — 여기서 시작해서 코드로 퍼뜨린다

**규칙**: 디자인 값(색·크기·radius)을 바꾸려면 **이 파일을 먼저 고치고**, 아래 "사용처"의
파일들에 반영한다. 코드에서 직접 색을 지어내지 말 것 — 이 표에 없는 색이 필요하면 먼저
여기에 추가(+CHANGELOG). 시각 카드 미러: claude.ai/design "Document Studio 디자인 시스템".

## 1. KRDS 팔레트 (2026-07-11 사용자 확정 — 정부 블루)

| 토큰 | 값 | 용도 |
|---|---|---|
| primary-50 | `#256EF4` | 주 액센트(행위·링크·포커스) |
| primary-60 | `#0B50D0` | hover/pressed, 밝은 배경 위 액센트 텍스트 |
| primary-20 | `#B1CEFB` | 연한 강조 보더 |
| primary-5 | `#ECF2FE` | 액센트 틴트 배경 |
| gray-90 | `#1E2124` | 본문 잉크(값·입력) |
| gray-70 | `#464C53` | 보조 텍스트·필드 라벨 |
| gray-50 | `#6D7882` | 섹션 제목·힌트 |
| gray-30 | `#B1B8BE` | 트랙·비활성 |
| gray-20 | `#CDD1D5` | 필드 보더 |
| gray-10 | `#E6E8EA` | 헤어라인 |
| gray-5 | `#F4F5F6` | 세그먼트 배경 |
| danger | `#DE3412` | 위험·삭제 (⚠ #dc3545 부트스트랩 빨강 금지) |
| warning | `#FFB114` | 경고 |
| success | `#228738` | 성공 |
| info | `#0B78CB` | 정보 |
| point | `#D63D4A` | 포인트 |

## 2. 사용처 (같은 값이 사는 곳 — 바꿀 때 전부 반영)

| 표면 | 파일 | 변수 체계 |
|---|---|---|
| `/studio` 에디터 셸 | `src/tailwind.css` 끝부분 `.studio-editor-shell` | `--accent` 등 |
| `/studio` 인스펙터 | `src/tailwind.css` 끝부분 `.studio-right-panel` | `--ins-*` |
| rhwp-studio (캔버스 한컴) | `rhwp-studio/src/styles/krds-theme.css` | `--ui-*` (base.css 값을 덮음) |
| 캔바 사이드바 | `rhwp-studio/src/styles/canva-sidebars.css` | `--ui-*` 소비 (직접 hex 금지) |

## 3. 크기·radius (표면별 번역 — KRDS 정격은 민원사이트용이라 에디터 밀도로 번역)

| 항목 | /studio 인스펙터 | rhwp 캔바 사이드바 |
|---|---|---|
| 필드 높이 | 36px (크기입력 34) | 30~34px |
| radius | 필드 9 · 탭 내부 6 | 6~8 (카드 8·버튼 6) |
| 섹션 제목 | 11px/700 tracking .08em | 10.5px/700 uppercase |
| 값·입력 | 12.5px/600 | 12.5px/600 |
| 패널 폭 | 276px | 좌 176 · 우 264px |
| 포커스 | 보더 primary-50 + 3px halo rgba(37,110,244,.15) | 동일 |

공통 금지: 그라데이션·과한 그림자(플랫+보더), 이모지 아이콘(인라인 SVG 1.4px 스트로크만),
Tailwind 유틸리티명과 겹치는 클래스명.

## 4. 알려진 표류 (발견 시 여기 기록, 고치면 지움)

- 2026-07-12 발견: `rhwp-studio/src/ui/canva-right-inspector.ts`의 글자색 스와치 배열에
  `#dc3545`(부트스트랩 빨강) — KRDS 계열(`#DE3412`)로 교정 필요 (다음 UI 작업 때, 실측 검증 포함).
- `rhwp-studio/src/styles/base.css`의 `--ui-danger-strong: #dc3545`는 krds-theme.css가 덮으므로
  실렌더는 KRDS — 단 임포트 순서 의존이니 base를 직접 참조하지 말 것.
- 2026-07-12 발견: `canva-ai-review-ui.ts`의 diff "추가" 강조에 초록 `#e6f4ea`/`#1a7f37` 인라인
  — KRDS 팔레트에 성공/추가 초록 토큰이 없어 신규 도입. **정본에 초록 계열 추가 필요**(문서
  검토 diff·향후 성공 상태용). 추가 후 이 인라인을 CSS 변수로 교체. (UI 에이전트가 카탈로그
  미러 미동기화로 보고한 항목.)
