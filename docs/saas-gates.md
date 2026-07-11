# 공개 배포 게이트 (saas-gates) — 이 체크리스트 전부 ✅ 전에는 배포 금지

product-spec P2("사업화 게이트")의 실행 체크리스트. 흩어져 있던 배포 전 필수 항목을 한 곳에.
게이트를 통과 처리할 때는 증거(커밋/설정 스크린샷/실측)를 함께 기록한다.

## 보안 (G1~G4)

- [ ] **G1. SheetJS 교체** — `xlsx@0.18.5`(npm, 미수정 CVE 2건: CVE-2023-30533·CVE-2024-22363)를
  공식 배포(cdn.sheetjs.com) 0.20.x로. P3-13(rhwp 병합 이식)이 먼저 오면 그때 함께, 아니면
  배포 전 단독 교체. (tech-choices 심사 결과 참조)
- [ ] **G2. 외부 콘텐츠 살균** — 타인 hwpx 미리보기·외부 HTML 렌더 경로에 DOMPurify
  (tech-choices 트리거 대기 2건이 이 게이트로 승격됨)
- [ ] **G3. AI 프록시 서버리스 이관** — dev 프록시 폐기, Vercel Functions + 로그인 검증 +
  사용량 제한. **AI 데이터 처리 고지 동반**(전송 대상 MiniMax=국외·전송 내용·보존 여부를
  처리방침과 AI 패널 첫 사용 안내에 명시 — 개인정보보호법 국외 이전 고지)
- [ ] **G4. 비밀값 최종 스캔** — 전체 커밋 이력 시크릿 스캔 1회(현재까지는 무유출 확인
  2026-07-12) + GitHub Push Protection 활성 상태 확인

## 법률 (G5~G6)

- [ ] **G5. 법정 문서 3종** — 개인정보처리방침(회원 오픈과 동시 필수) · 이용약관 ·
  통신판매업 신고(마켓 판매 개시 전)
- [ ] **G6. 라이선스 고지 완비** — THIRD_PARTY_LICENSES.md 최신 + rhwp-studio/LICENSE(업스트림
  고지) + public/fonts/LICENSES/ 전문 동봉(⚠ KoPub 전문 원문 확보 TODO) + 빌드 산출물에
  고지 파일 포함 확인. "저작권 Safe"는 이 게이트가 완비일 때만 셀링포인트로 말할 수 있다.

## 품질·운영 (G7~G9)

- [ ] **G7. 성능·호환** — ①지원 브라우저 선언(Chrome/Edge/Whale 최근 2개 메이저 + WebAssembly
  필수, 미지원 감지 시 안내 배너) ②초기 번들(gzip) 상한 수치 확정(배포 직전 vite build 실측으로
  결정 — WASM 5.7MB는 지연 로드 유지+로딩 인디케이터) ③관공서급 저사양 프로필 1회 실측
- [ ] **G8. CI 그린** — .github/workflows/ci.yml (verify:hwpx + rhwp tsc/test) 통과 상태
- [ ] **G9. 릴리스 기본기** — 클라이언트 에러 수집 도구(후보 비교는 tech-choices 절차로) ·
  배포 시 git tag vX.Y.Z · 앱 화면 버전 표기

## 사용자 검증 (G10)

- [ ] **G10. 도그푸딩 + 파일럿 1명** — P0 도그푸딩 게이트 기록 누적(실제 한컴 한글에서 열어본
  실문서들) + 결제 착수 전 외부 실무자 1명이 실업무 문서 1건 완주

## GitHub 계정 설정 (1회, 사용자 직접 — AI는 계정 설정 불가)

- [ ] Settings → Code security → **Push protection** 켜기 (비밀키 push 서버 차단)
- [ ] Settings → Rules → Rulesets → main에 **Block force pushes + Restrict deletions**
- [ ] 계정 **2FA 복구 코드** 오프라인 보관
- [ ] (선택) 두 번째 원격 백업 — GitLab 무료 repo에 `git push --mirror` 주 1회
