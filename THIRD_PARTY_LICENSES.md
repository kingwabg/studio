# 서드파티 고지 (THIRD PARTY LICENSES)

이 프로젝트가 포함·재배포하는 서드파티 저작물의 고지 모음.
(rhwp-studio 정보 대화상자가 이 파일을 참조한다. 새 폰트·라이브러리 반입 시 여기에 1행 추가.)

## 포함(벤더링)된 소스코드

| 구성요소 | 저작권 | 라이선스 | 위치 |
|---|---|---|---|
| rhwp / rhwp-studio (HWP·HWPX 엔진+에디터) | Copyright (c) 2025-2026 Edward Kim | MIT | `rhwp-studio/` (전문: rhwp-studio/LICENSE) · `@rhwp/core`·`@rhwp/editor` npm |
| table-king (표 엔진 이식본) | kingwabg (자체 프로젝트 이식) | MIT | `src/table-king/` |
| Rust 크레이트 (WASM 내부) | 각 저작자 | MIT/Apache-2.0 | rhwp-studio 정보 대화상자(about-dialog) 목록 참조 |

## 재배포하는 폰트

| 폰트 | 저작권 | 라이선스 | 위치 |
|---|---|---|---|
| 나눔스퀘어 / 나눔스퀘어라운드 | © NAVER Corporation | SIL OFL 1.1 | `public/fonts/` (전문: public/fonts/LICENSES/OFL-1.1.txt) |
| KoPub World 바탕/돋움 | © 한국출판인회의(KOPUS)·문화체육관광부 | KoPub 자체 라이선스 (상업·웹 이용 허용) | `public/fonts/` (고지: public/fonts/LICENSES/KoPub-NOTICE.txt) |
| 나눔고딕/명조·본고딕/명조·고운·고딕A1·IBM Plex Sans KR·도현·검은고딕·송명·나눔펜 등 12종 | 각 파운드리 (NAVER·Adobe/Google·ZESSTYPE 등) | SIL OFL 1.1 | `@fontsource/*` npm 패키지 (각 패키지 LICENSE 동봉) |
| Pretendard (UI 셸 전용) | © Kil Hyung-jin | SIL OFL 1.1 | npm 패키지 |

## 주요 개발 의존성 (배포물 비포함이나 고지)

- Vite, TypeScript, React, zustand, dnd-kit, SheetJS(xlsx), Tailwind CSS — 각 MIT/Apache-2.0.
- kordoc — 개발 검증 전용(제품 미포함).

> 폰트 파일을 추가·재배포할 때는 반드시 해당 라이선스 전문/고지를 `public/fonts/LICENSES/`에
> 함께 넣을 것 (docs/saas-gates.md G6). "저작권 Safe"는 이 파일이 완비일 때만 참이다.
