# vendor/rhwp-pkg — 포크 엔진 패치판 (sc- vendor/rhwp-core 패턴의 studio 판)

- 출처: github.com/kingwabg/rhwp `officex/engine-fixes` **9cee3f492** (2026-09-06 빌드,
  `wasm-pack build --target web --out-dir pkg`, release).
- 직전 벤더(02af4f4dc+, 2026-08-09) 대비 추가분: 표 격자 단일 진실화 12단계 —
  구조·델타 불변식 관문(check_invariants/check_deltas, with_table_txn), HWPX row_sizes·common 치수 로더 수리,
  TableGrid 뷰(모델 getter·렌더러 열/행 축 소비), 표시 힌트(localResize/renderWidth/renderHeight) 폐기(키는
  수용·무시), 어긋내기 코어 격자 재작성(legacy 병존), 새 API getTableGrid / getBoundaryMoveRange.
  스튜디오 짝: a5395b1(12-a 힌트 송신 제거·표시 기준 행 델타), 9378098(12-b 격자 API 소비, 구 wasm 폴백).
- cd10fe1dd 추가분: 행 삽입(insert_row)이 기준 행의 칸 모양(col_span)을 복사 — 어긋낸 표 마지막 셀 Tab 행 추가가
  실오라기 칸 포함 4칸이 되던 결함 수리.
- 1c24b2d3d 추가분: 병합 산술 — 병합 칸은 실효 기하(격자 열 폭 합·실효 행 높이 합) 상속, 병합 뒤 죽은 격자선 접기
  (어긋낸 칸+이웃 병합·표 전체 병합이 D1/D2 관문에 거부되던 결함), 행 삭제는 실효 높이 차감.
- 9cee3f492 추가분: 가로 RowBreak 연속 쪽 "짧은 행 흘림"(260px) 폐기 — 쪽 밖으로 밀려 보이지 않던 행 수리(교육과정 385→414쪽),
  hp:label 왕복 보존, 고아 주석 정리, cargo fmt.
- `scripts/sync-rhwp-pkg.mjs` 가 이 디렉터리를 npm 판보다 우선 공급한다.
  npm 판으로 되돌리려면 이 디렉터리를 지우면 된다.
- 갱신 절차: rhwp 체크아웃에서 위 명령으로 빌드 → 4파일 복사 → 이 문서의
  커밋 기준점 갱신.
