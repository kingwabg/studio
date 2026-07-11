완료 게이트 실행. docs/playbooks/verify.md 의 매트릭스대로:

1. 이번 변경이 닿은 영역의 필수 검증을 **실제로 실행**한다
   (rhwp 소스면 `cd rhwp-studio && npx tsc --noEmit && npm test`, src/hwpx면 `npm run verify:hwpx`,
   UI 동작이면 docs/playbooks/browser-drive.md 레시피로 실구동 실측).
2. 결과를 완료 게이트 양식으로 보고한다:
   - 변경 파일 / 실행한 검증(명령+원문 수치) / 이전→이후 실측 / 미검증(+사용자 확인 방법)
3. UI·동작 변경이면 이전/이후 비교를 보여준다(위젯 가능 환경이면 위젯, CLI면 표).
4. 하나라도 실패면 "완료"라 말하지 않는다 — 실패 원문과 다음 조치를 보고.
5. 새로 확정한 함정이 있으면 docs/playbooks/traps.md 에 3줄(증상→원인→해법) 추가했는지 확인.

$ARGUMENTS 가 있으면 그 범위에 한정해 게이트를 돌린다.
