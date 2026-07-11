# 기술 선택 대장 (tech-choices) — "왜 이 라이브러리를 쓰/안 쓰는가"의 정본

새 기능 구현 전 이 대장을 대조한다. **이미 결정된 영역은 재론 금지** — 단 "재검토 트리거"가
충족되면 다시 올린다. 새 결정(채택/자체구현)은 반드시 여기 기록(+playbooks/CHANGELOG.md).
라이선스 기준: MIT/Apache 계열만 (저작권 Safe 전략과 동결 — GPL류·상용은 사용자 승인 필수).

## 확정 결정 (불변식 또는 사용자 확정 — 재검토 트리거 명시)

| 영역 | 결정 | 왜 | 재검토 트리거 |
|---|---|---|---|
| HWPX 내보내기 코어 | **의존성 0 자체구현** (자체 CRC32+STORE ZIP+내장 봉투) | 제품 핵심 자산·공급망 리스크 0·7중 검증 완료 | 없음 (불변식) |
| 조판·렌더·파싱 | **rhwp(@rhwp/core, MIT) 위임 — 재발명 금지** | 6만 줄 검증된 엔진 | 없음 (불변식) |
| kordoc | **개발용 비계만 — 제품 포함 금지** | 검증 도구로만 | 없음 |
| 텍스트 편집(캔버스) | **자체 contentEditable(runs 모델) 유지** — Lexical 실험 후 폐기(2026-07-10 사용자 확정) | HWPX 정합 자산 7종(전각보정·hp:run 직렬화 등)이 라이브러리와 구조 충돌(H2) | flow 장문 고도화 또는 협업(Yjs) 착수 시 — 후보 ProseMirror/TipTap만, **Slate 배제**(한글 IME) |
| rhwp-studio 포크 | **vanilla TS 유지, 프레임워크 주입 금지** | 업스트림 diff 유지 원칙 | 업스트림이 방향 전환 시 |
| 표 엔진(/studio) | table-king 이식본 유지 | 한컴식 경계 편집 자산 | rhwp 트랙이 대체 시 이관 판단 |
| 상태(React) | zustand | 경량·검증됨 | 없음 |
| DnD | dnd-kit | 접근성·검증됨 | 없음 |
| 엑셀/CSV | SheetJS(xlsx) | 사실상 표준. ⚠ CSV는 UTF-8→EUC-KR 폴백 직접 디코딩 후 투입 | 라이선스 정책 변화 시 |
| AI 클라이언트 | **SDK 없이 fetch 직접** (OpenAI 호환 /api/ai 프록시) | 프록시가 키 주입·형식 단순·번들 0 | 스트리밍/툴콜 필요 시 SDK 재평가 |
| 자산 저장 | IndexedDB 얇은 자체 래퍼 | Supabase/NAS 교체 대비 인터페이스 유지 목적 | 저장 백엔드(P2 #9) 착수 시 |
| 테스트 러너 | node --test (rhwp), 자체 하네스(hwpx) | 의존성 최소 | 없음 |

## 심사 결과 (2026-07-12 자체 구현 전수 점검 — 4영역 30건, 멀티에이전트 감사)

### 🔴 즉시 조치 (adopt-lib) — 1건
| 기능 | 판정 | 근거 |
|---|---|---|
| 엑셀/CSV 파싱 `xlsx@0.18.5`(npm) | **보류(사용자 결정 2026-07-12)** — rhwp 데이터 병합 이식(P3-13) 착수 시 공식 배포 0.20.x로 함께 교체 | 미수정 CVE 2건이나 현재 이 화면(/studio 데이터 탭) 사용자는 개발자 본인뿐. 이식 때 어차피 코드를 만지므로 그때 교체가 효율적. ⚠ 공개 배포 전엔 반드시 교체(saas-gates G1) |

### 🟡 트리거 대기 (consider-lib) — 시점이 오면 도입
| 기능 | 후보 | 도입 트리거 |
|---|---|---|
| rhwp 미리보기 SVG 주입(무살균 innerHTML) | DOMPurify (Apache-2.0, ~7KB) | 템플릿 마켓/공유로 **타인 hwpx**를 미리보기하는 시점 (XSS 표면) |
| AI HTTP 클라이언트(fetch 41줄) | openai SDK 또는 Vercel ai (Apache-2.0) | 스트리밍 UX / Vercel 서버리스 이관 / tool-call 필요 시 |
| AI JSON 스키마 검증(수동 30줄) | zod (MIT) | AI 배치 스키마가 3+ 요소·중첩으로 커져 수동 검증 50줄 초과 시 |
| 클립보드 외 외부 HTML 렌더 | DOMPurify 전단 | 외부 HTML을 화면에 직접 렌더하는 기능이 생길 때 |

### 🟢 자체 구현 유지 (keep-custom) — 근거 확립 (재론 금지, 요지만)
- **ZIP/CRC32·XML 조립·header 정규식 패치**(exportCore): 의존성 0 불변식 + 바이트 수준
  캘리브레이션된 템플릿 — 범용 빌더가 검증 매핑을 흔드는 위험 > 이득
- **스냅·마퀴·undo 히스토리**(/studio): 후보(react-moveable·selecto·zundo)는 DOM px 기반이라
  mm JSON 진실과 이중 진실(H4 위반), 도메인 규칙은 어차피 커스텀 필요
- **리치텍스트**: 사용자 확정(트리거: flow 장문/협업 → PM/TipTap만)
- **EUC-KR 폴백·토큰 치환**: 네이티브 TextDecoder 내장 / mustache는 "미지 토큰 보존" 의도와 충돌
- **rhwp 포크 전반**(캔버스 모드·스냅·다이얼로그): vanilla 원칙 + 이 도메인에 맞는 라이브러리 부재
- **인프라**(검증 하네스·성장 게이트·sync 스크립트·node --test·puppeteer e2e): 자작이 요구사항의
  최소 구현이거나 이미 라이브러리 위임 중. idb/idb-keyval은 ISC 라이선스로 게이트 탈락,
  Dexie는 스토어 2+·마이그레이션 생길 때만
- **폰트 로딩**: 이미 @fontsource 12종 사용 중 — fontfaceobserver는 유지보수 중단으로 배제

### 감사 부수 발견 (라이브러리 아님 — 코드 결함/부채, 처리 대기)
1. `exportCore.js esc()`가 XML 1.0 불법 제어문자(U+0000~0008 등)를 안 거름 — 붙여넣기 텍스트로
   파일 깨질 수 있음 → 제어문자 스트립 1줄 추가 (verify:hwpx 재실행 필수)
2. `export/measure.ts charWidthMm`이 호출마다 canvas 생성(240자 문단 = 캔버스 240개) →
   모듈 레벨 ctx 캐시로 (rhwpLoader lastFont 패턴)
3. rhwp 포크 `mkBtn/mkLabel`류 DOM 헬퍼가 3파일째 중복(중복 2회 룰 초과) → canva-dom.ts 추출
4. rhwp-studio `pixelmatch·pngjs`가 dependencies에 분류(e2e 전용) → devDependencies로 이동

## 라이브러리 채택 절차 (미결 영역에서 — 이 절이 절차·기준의 정본, 타 문서는 포인터만)

1. 이 대장에서 영역 확인 — 확정 결정이면 준수, 트리거 미충족 재론 금지.
2. 후보 1~3개 비교표: 기능 적합성 / 유지보수(최근 릴리스·이슈 응답) / 라이선스 / 번들·성능 영향.
3. 사용자에게 선택지 제시(자체구현 옵션 포함) → 결정을 이 대장에 1행 추가 + CHANGELOG.
4. 도입 시 얇은 래퍼로 감싸 교체 가능하게 (자산 저장 래퍼 선례).
