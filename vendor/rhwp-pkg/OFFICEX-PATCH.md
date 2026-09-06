# vendor/rhwp-pkg — 포크 엔진 패치판 (sc- vendor/rhwp-core 패턴의 studio 판)

- 출처: github.com/kingwabg/rhwp `officex/engine-fixes` **8e86ca72e** (2026-09-06 빌드,
  `wasm-pack build --target web --out-dir pkg`, release).
- 직전 벤더(02af4f4dc+, 2026-08-09) 대비 추가분: 표 격자 단일 진실화 12단계 —
  구조·델타 불변식 관문(check_invariants/check_deltas, with_table_txn), HWPX row_sizes·common 치수 로더 수리,
  TableGrid 뷰(모델 getter·렌더러 열/행 축 소비), 표시 힌트(localResize/renderWidth/renderHeight) 폐기(키는
  수용·무시), 어긋내기 코어 격자 재작성(legacy 병존), 새 API getTableGrid / getBoundaryMoveRange.
  스튜디오 짝: a5395b1(12-a 힌트 송신 제거·표시 기준 행 델타), 9378098(12-b 격자 API 소비, 구 wasm 폴백).
- `scripts/sync-rhwp-pkg.mjs` 가 이 디렉터리를 npm 판보다 우선 공급한다.
  npm 판으로 되돌리려면 이 디렉터리를 지우면 된다.
- 갱신 절차: rhwp 체크아웃에서 위 명령으로 빌드 → 4파일 복사 → 이 문서의
  커밋 기준점 갱신.
