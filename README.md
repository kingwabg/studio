# Document Studio (문서 편집기)

캔바(Canva)식 자유 배치 UI를 가진 한국어 문서 편집기.
최종 목표는 **AI가 통합된, HWPX(한글) 호환 문서 도구**다.

## 아키텍처

```
[진실]   문서 JSON 모델   ← 사용자가 조작하는 유일한 상태 (섹션·블록·표)
[파생]   화면 렌더링       ← 진실에서 매번 계산 (React)
[직렬화] HWPX 파일         ← 내보내기 코어로만 생성 (의존성 0)
```

- **진실은 한 곳**, 나머지는 파생(`useMemo`). 동기화 코드가 보이면 설계를 의심한다.
- 내보내기 코어(`src/hwpx/`)는 **의존성 0** — 자체 CRC32 + STORE ZIP + 내장 봉투.
- `kordoc`은 개발용 비계(봉투 생성·검증)일 뿐, 제품 번들에 포함되지 않는다.

## 주요 기능

- **자유 배치 문서**: A4 지면 위 제목·섹션(자동 번호 Ⅰ/1/가)·문단·목록·표
- **한컴식 표 엔진** (`src/table-king/`): 경계선 어긋남 편집, 병합/나누기,
  셀 스타일·정렬, 클립보드(내부/외부 TSV), 실행취소, `Shift+드래그` 미세 조절
- **HWPX 내보내기**: 화면 배치를 mm로 실측 → `.hwpx` 다운로드.
  용지 여백 0으로 원점을 통일해 외부 렌더러(rhwp/한글)에서도 위치가 어긋나지 않음
- **AI 문서 도우미**: 요청 → 문서 JSON 생성 (게이트웨이 검증 후 반영)

## 실행

```bash
npm install
npm run dev          # Vite 개발 서버 (127.0.0.1:5173)
npm run build        # 프로덕션 번들
```

## HWPX 검증

내보내기 코어를 바꾸면 반드시 3중 검증을 돌린다 (kordoc devDependency 사용):

```bash
npm run verify:hwpx      # validateHwpx ok + 내용 왕복(parse) + SVG 렌더
npm run gen:hwpx-base    # 봉투 스키마가 바뀔 때만 재생성
```

## 프로젝트 구조

```
src/
├─ DocumentStudio.jsx      메인 앱 (홈·템플릿·워크스페이스·AI 패널·내보내기)
├─ hwpx/
│  ├─ exportCore.js        제품 내보내기 코어 (의존성 0)
│  └─ hwpxBase.js          내장 HWPX 봉투 (자동 생성, 수정 금지)
└─ table-king/             표 엔진 (아래 출처 참고)
scripts/
├─ gen-hwpx-base.mjs       kordoc으로 봉투 생성
└─ hwpx-verify.mjs         3중 검증 하네스
```

## 출처

표 엔진(`src/table-king/`)은
[table-king-Custom](https://github.com/kingwabg/table-king-Custom)에서 이식했다.
`table/`·`hooks/`·`components/`는 업스트림 원본을 유지하고,
`TableKingBlock.jsx`만 문서 모델 통합용 래퍼(시드 + `onChange` + active 게이팅)로 감쌌다.

## 라이선스

[MIT](./LICENSE)
