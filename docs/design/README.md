# Handoff: 업무24 `/studio` 리디자인

## Overview
한국어 HWPX(한글) 호환 문서 편집기 **업무24**의 `/studio` 리디자인 시안.
"밋밋하고 촌스럽다"는 오너 피드백에 대응해 **깊이·위계·마이크로 디테일**을 더한 4개 화면:
홈 대시보드, 에디터 셸(라이트), 에디터 셸(다크·AI 패널), 한글 미리보기 모달.

## About the Design Files
이 번들의 파일은 **HTML로 만든 디자인 레퍼런스**다 — 의도한 룩앤필과 동작을 보여주는 프로토타입이며, 그대로 복사해 쓸 프로덕션 코드가 아니다.
할 일은 이 디자인을 **대상 코드베이스의 기존 환경**(React + Vite, Tailwind utilities-only + Radix Themes, dnd-kit, zustand)에서 기존 패턴대로 **재구현**하는 것이다.
함께 넣은 `design-brief-원본.md`가 코드베이스 구조·절대 제약을 설명한다. **반드시 먼저 읽을 것.**

## Fidelity
**High-fidelity (hifi).** 색·타이포·간격·상태가 최종 의도값이다. 기존 라이브러리(Tailwind 브랜드 유틸 + Radix props)로 픽셀 수준 재현을 목표로 한다.

## 절대 제약 (브리프 원본 §4 요약 — 어기면 회귀)
1. 기존 앱(`/`) 무손상 — `src/DocumentStudio.jsx`, `src/table-king/**` 금지
2. Tailwind는 utilities-only (preflight 금지)
3. Radix Themes는 `.radix-themes` 스코프로 `/studio`에만
4. **지면(`.canvas-dots`) 폰트 = 맑은 고딕 고정** (조판 정합) — UI 셸은 Pretendard
5. A4 지면 210×297mm, mm 좌표계 불변
6. 아이콘 = 인라인 SVG(1.4~1.6px 스트로크), 이모지 금지
7. 한국어 UI

## Screens / Views

### 1. 홈 대시보드 — `/studio` (`routes/StudioHome.tsx`) · 시안 1a
- **목적**: 새 문서 시작 + 템플릿 발견 + 최근 문서 복귀. 첫인상은 따뜻하게(구독/마켓 목표), 나머지는 절제.
- **레이아웃**: 상단 네비 60px → 콘텐츠 패딩 36px 48px, 세로 3섹션(gap 36px).
- **상단 네비**: 로고(28px 블루 #2B5CE6 라운드 사각 + "24") + "업무24"(16px/800), 탭(홈=active: bg #EDF2FE, color #2B5CE6 / 나머지 #5B6577, hover bg #F6F7FA), 중앙 검색바(420×36px, bg #F6F7FA, border #E4E8EF, radius 10px, ⌘K 뱃지), 우측 업그레이드 버튼(bg #EDF2FE, border #C4D4F9, color #2B5CE6) + 아바타 32px.
- **히어로**: bg #FBF8F2, border #F0E9DC(따뜻한 톤), radius 16px, padding 32px 36px. 제목 24px/800 "오늘은 어떤 문서를 만들까요?". 시작 카드 6개(128×96px, 내부에 52×70px 미니 문서 썸네일, 첫 줄만 카테고리 색: 빈문서 #98A2B3 / 공문서 #2B5CE6 / 사업계획서 #E58B3A / 보고서 #4CAF7D / 회의록 #9A6FD4 / 품의서 #D46F8C). hover: translateY(-2px) + 2단 그림자 + border #C4D4F9.
- **인기 템플릿**: 4열 그리드(gap 16px). 카드: 썸네일 영역 150px(카테고리 틴트 bg: #EDF2FE/#FBF3E7/#EAF6EF/#F3EEFB)에 하단 정렬 미니 A4(120×126px), 메타 행(이름 13.5px/700 + 설명 12px #98A2B3 + 태그 pill). hover: translateY(-2px)+그림자.
- **최근 문서**: 5열 그리드(gap 14px). 카드: 썸네일 118px(bg #F6F7FA, 미니 A4 78×100px) + 이름/시간.

### 2. 에디터 셸 (라이트) — `/studio/editor/:id` · 시안 1b
- **구조**: 상단 액션 바 52px + 서식 툴바 44px + [좌: 아이콘 레일 66px + 콘텐츠 패널 250px | 중앙 캔버스 | 우측 속성 패널 284px].
- **상단 액션 바** (`EditorToolbar.tsx`): bg #fff, border-bottom #E4E8EF, 미세 그림자. 좌: ‹내 문서, 구분선, 로고 22px, 문서 제목(14.5px/700, hover 시 편집 어포던스: border #E4E8EF + bg #F6F7FA), "저장됨"(체크 #4CAF7D + 12px #98A2B3). 우: 공문서로 펴기(ghost) / 한글 미리보기(outline) / **HWPX 내보내기**(primary: bg #2B5CE6, hover #1F49C4, shadow 0 1px 2px rgba(43,92,230,.35)).
- **서식 툴바**: 폰트 셀렉트(맑은 고딕) → 크기 스테퍼(−/10pt/＋) → 가(굵게=active: bg #EDF2FE color #2B5CE6)/가(기울임)/가(밑줄)/가(취소선) → 글자색 스와치 6개(17px 원형: #1A2233 #5B6577 #2B5CE6 #D64550 #3B9B6B #C77A28) → 정렬 세그먼트 4개(좌=active) → 줄 간격(160% 드롭다운) → 목록(불릿/1./가.) → **표 도구 그룹**: 테두리(active, 팝오버 열림)/셀 배경/셀 합치기/행·열 추가 → 우측 ⋯ 더보기.
- **표 테두리 팝오버**: 276px, radius 13px, 2단 그림자. ① 프리셋 12개(4열 그리드, 각각 18px 미니 다이어그램 + 10px 라벨): 모두(기본 선택)/바깥/안쪽/없음/위/아래/왼쪽/오른쪽/위아래/좌우/가로선/세로선 — 활성 변은 #1A2233, 비활성 변은 #DFE4EC로 표시. ② 선 종류(실선=active/파선/점선/이중선). ③ 굵기 스테퍼(0.4mm). ④ "선택한 셀에만 적용" 토글.
- **좌측 (캔바식 2단)** (`LeftPanel.tsx`):
  - 아이콘 레일 66px: 블록(active: bg #EDF2FE, 아이콘+라벨 #2B5CE6)/템플릿/데이터/업로드/AI. 아이템 56px 폭, 아이콘 17px + 라벨 10.5px.
  - 콘텐츠 패널 250px: 검색바(36px) → "자주 사용함" pill 칩 3개(본문 텍스트/3×2 표/결재선) → "카테고리 둘러보기" 3열 그리드 9타일(46px 틴트 타일 + 11px 라벨: 텍스트/본문/표/이미지/결재선/서명/날짜/쪽 번호/붙임 — 틴트: #EDF2FE/#FBF3E7/#EAF6EF/#F3EEFB/#FDEEF0 순환, hover: translateY(-1px)+틴트색 그림자) → **구조 트리**(8행, 행 30px, 들여쓰기 18px+연결선, 표 행=선택: bg #EDF2FE border #C4D4F9, 그룹 소속 행: bg rgba(43,92,230,.06)) → 점선 드롭존 "여기로 끌면 최상위로".
- **중앙 캔버스** (`CanvasStage.tsx`): bg #EDF0F5 + 도트 그리드(radial-gradient #D5DAE3 1px / 24px 간격). 가로/세로 눈금자 26px(반투명 흰 배경 + blur, 눈금 #CBD2DE, 숫자 9px #98A2B3, mm 단위). A4 지면 594px 폭, 3단 그림자(0 1px 2px / 0 10px 28px / 0 32px 64px -24px). 좌하단 페이지 표시 pill("1/1 페이지 · A4 210×297mm"), 우하단 줌 컨트롤(−/100%/＋).
- **캔버스 위 선택 UI** (`CanvasBlock.tsx` — 로직 불변, 시각만):
  - **개별 선택(표)**: outline 1.5px #2B5CE6(inset -5px) + 코너 핸들 4개(8px 흰 사각 + 파란 테두리) + **플로팅 액션 바**(선택 위 중앙, top -52px: 회전/잠금/복제/삭제(hover 시 red #D64550 틴트)/⋯, bg #fff radius 11px 2단 그림자) + **라벨 칩**(좌상단: ● 표 · 3×3 | ✓ 모두 변경) + **열 그립**(상단 경계, 16×5px 파란 pill, cursor col-resize) + **행 그립**(좌측 경계, 5×16px) + **행/열 추가 ＋ 버튼**(우측 중앙·하단 중앙, 22px 원형 흰 버튼).
  - **간격 표시**: 선택 블록 위/아래 이웃 블록까지 수직 측정선(1px #2B5CE6 + 끝단 캡) + mm 값 칩(9.5px 흰 글자, bg #2B5CE6, radius 4px). 예: 위 8mm, 아래 10mm.
  - **그룹 선택(트리에서 부모 선택 시)**: 하위 포함 전체를 감싸는 점선 테두리(1.5px dashed #7C9AF0, radius 7px, bg rgba(43,92,230,.02)) + 우상단 칩 "그룹 · Ⅱ. 세부 계획 (하위 2)".
  - **스냅 가이드**: 1px dashed #E5484D 세로선 + "여백 22mm" 라벨.
- **우측 속성 패널** (`RightPanel.tsx`): 상단 속성/AI 세그먼트 탭 → 선택 요소 헤더(아이콘 타일 24px + "표 블록 · 3×3" + 위치 설명) → 섹션들(라벨 11px/700 #98A2B3, 행 26px, 구분선 #EDF0F5):
  - **모양**: 배경(없음, 체커 스와치) / 모서리(0px)·넘침(보임) / 불투명도(1.00)·Z-순서(auto) / 추가 칩: 그림자·텍스트 그림자·변형·필터(점선 pill)
  - **크기**: 너비·높이(auto + 고정/맞춤/채움 세그먼트) / 자르기 토글 / 추가: 최소·최대
  - **위치**: 인라인/절대 세그먼트
  - **콘텐츠 레이아웃**: 블록 셀렉트
  - **여백**: 안쪽 여백 프리셋 3개(좁게/보통=active/넓게) + 상·하·좌·우 4칸 입력(상2 하2 좌3 우3, mm) / 바깥 여백 동일(없음=active, 0 0 0 0) / 테두리 추가(점선 pill)
  - **고급 / 내보내기 설정**(접힌 행) → **디버그**(모노스페이스 JSON 박스)

### 3. 에디터 셸 (다크) · 시안 1c
- 크롬만 다크, **지면은 흰색 유지**(조판 정합). 토큰: 캔버스 #0C0F14(도트 #1C212B), 표면 #171B23/#12151C, 헤어라인 rgba(255,255,255,.07~.10), 잉크 #E7EAF0/#9AA3B2/#6B7484, 액센트 #5B84F0(hover #6F94F4, 액센트 위 글자는 #0C0F14), 액센트 틴트 rgba(91,132,240,.14~.16), 밝은 액센트 텍스트 #8FADF6.
- 우측 패널 = **AI 탭**: 사용자 말풍선(우측 정렬, bg #5B84F0, radius 14/14/4/14) / AI 응답(bg rgba(255,255,255,.05), 내부에 맑은 고딕 결과 미리보기 박스 + "지면에 적용"(primary)·"다시 쓰기"(ghost) 버튼) / 하단 제안 칩(더 공손하게·개조식으로·표로 정리) + 입력바(42px + 전송 버튼 28px).

### 4. 한글 미리보기 모달 (`HanPreviewModal.tsx`) · 시안 1d
- 배경: 에디터 blur(3px) + 딤 rgba(16,22,35,.46).
- 모달 880×800px, radius 18px, 대형 2단 그림자. 헤더 58px: 눈 아이콘 타일 + 제목/부제("한글(HWP) 화면과 동일한 조판으로 렌더링됩니다") + **"줄바꿈 정합 일치" 상태 pill**(#4CAF7D, bg #EDF8F1) + 닫기.
- 본문: bg #F0F2F6에 페이지 프레임(460×650px, 맑은 고딕). 푸터 60px: 페이지 네비(‹ 1/1 ›) + "맑은 고딕 · A4 210×297mm" + 닫기/HWPX 내보내기(primary).

## Interactions & Behavior
- 카드 hover: `translateY(-2px)` + 2단 그림자, transition all .15s ease (기존 `.click-card` 패턴 확장)
- 팔레트 타일 hover: `translateY(-1px)` + 카테고리색 그림자 `0 4px 10px -4px <tint 30%>`
- 버튼 hover: primary #2B5CE6→#1F49C4 / ghost→bg #F6F7FA / outline→border #CBD2DE
- 세그먼트 active: 흰 배경 + `inset 0 0 0 1px #C4D4F9` + 글자 #2B5CE6/700
- 트리: 행 hover bg #F6F7FA, 선택 bg #EDF2FE, 부모 선택 시 하위 행 틴트 + 캔버스에 그룹 점선 테두리
- 표 선택: 플로팅 액션 바 + 그립 + 간격 측정선 표시(위 인터랙션은 dnd-kit/zustand 기존 로직 유지, 표현만 교체)
- 스와치 hover: scale(1.15)

## State Management
기존 zustand 스토어 유지. 시각적으로 필요한 상태: 선택 블록 id / 그룹(부모) 선택 여부 / 표 셀 선택 / 팝오버 열림(테두리) / 좌측 레일 활성 탭 / 우측 탭(속성·AI) / 다크 모드 플래그(Radix `appearance` 전환).

## Design Tokens
**라이트** (기존 `src/tailwind.css` 토큰 그대로 + 추가):
ink #1A2233 · inksoft #5B6577 · inkfaint #98A2B3 · accent #2B5CE6 · accenthover #1F49C4 · accentsoft #EDF2FE · accentline #C4D4F9 · line #E4E8EF · linestrong #CBD2DE · paper #F6F7FA · canvas #EDF0F5
추가 카테고리 틴트: 주황 #C77A28/#FBF3E7 · 초록 #3B9B6B/#EAF6EF · 보라 #8A5FC8/#F3EEFB · 빨강 #D64550/#FDEEF0 · 홈 히어로 #FBF8F2/#F0E9DC · 성공 #4CAF7D · 스냅 가이드 #E5484D · 그룹 점선 #7C9AF0 · 비활성 테두리 다이어그램 #DFE4EC
**다크**: 위 §3 참조.
**그림자**: 카드 hover `0 2px 4px rgba(16,24,40,.06), 0 12px 24px -8px rgba(16,24,40,.14)` / 지면 `0 1px 2px rgba(16,24,40,.08), 0 10px 28px rgba(16,24,40,.10), 0 32px 64px -24px rgba(26,34,51,.20)` / 팝오버 `0 4px 10px rgba(16,24,40,.08), 0 20px 44px -12px rgba(16,24,40,.24)`
**radius**: 카드 12~16px · 컨트롤 7~10px · 팝오버 13px · 모달 18px · pill 20px
**타이포**: UI = Pretendard Variable(제목 24/17/14.5, 본문 13/12.5, 캡션 11~12, 섹션 라벨 11px/700/tracking .08em) / 지면 = 맑은 고딕(불변)

## Assets
외부 에셋 없음. 모든 아이콘은 인라인 SVG(1.2~1.6px 스트로크) — 시안 HTML에서 그대로 추출 가능. 폰트: Pretendard Variable(CDN 또는 로컬), 맑은 고딕(시스템).

## Screenshots
`screenshots/` 폴더에 4개 화면 캡처 포함 (1a 홈 / 1b 에디터 라이트 / 1c 에디터 다크 / 1d 한글 미리보기 모달). 정확한 수치는 HTML 원본에서 읽을 것 — 스크린샷은 축소 렌더링이다.

## Files
- `업무24 Studio 리디자인.dc.html` — 시안 4종(1a 홈 / 1b 에디터 라이트 / 1c 에디터 다크 / 1d 한글 미리보기 모달). 브라우저로 열면 렌더링됨. 모든 스타일이 인라인이라 값을 그대로 읽으면 된다.
- `design-brief-원본.md` — 코드베이스 구조, 파일 경로, 절대 제약, 작업 규칙(화면 단위 PR로 쪼갤 것). **구현 전 필독.**
