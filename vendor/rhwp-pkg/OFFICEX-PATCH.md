# vendor/rhwp-pkg — 포크 엔진 패치판 (sc- vendor/rhwp-core 패턴의 studio 판)

- 출처: github.com/kingwabg/rhwp `main` **02af4f4dc 이후** (2026-08-09 빌드,
  `wasm-pack build --target web --release`)
- npm `@rhwp/core` 0.7.19 대비 추가분: officex 레이아웃 물리 롤업 178커밋
  (TAC 표 같은 줄 편입·기준선 문단 세로정렬·표/수식 raw_ctrl_data 저장 정합)
  + 표 TAC 토글 rel_to·오프셋 리셋(5f2a2be25).
- `scripts/sync-rhwp-pkg.mjs` 가 이 디렉터리를 npm 판보다 우선 공급한다.
  npm 판으로 되돌리려면 이 디렉터리를 지우면 된다.
- 갱신 절차: rhwp 체크아웃에서 위 명령으로 빌드 → 4파일 복사 → 이 문서의
  커밋 기준점 갱신.
