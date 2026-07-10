// check-size.mjs — 코드 성장 게이트 (의존성 0).
//
// 규칙 (CLAUDE.md "코드 성장 규칙"):
//  · 파일 예산 500 유효줄 — 새 파일은 예산 초과로 태어날 수 없다
//  · 래칫: 예산 초과 기존 파일은 HEAD보다 커질 수 없다(배선 여유 +10줄), 줄이는 것만 허용
//  · 유효 줄수 = 물리 줄수 + 120자 초과분 환산(ceil(길이/120)) — "한 줄 뭉치기" 우회 봉쇄
//  · rename(-M 검출)은 원 파일의 래칫을 승계 — 개명으로 래칫 초기화 불가
//  · baseline 파일 없음 — 진실은 git(HEAD)뿐이라 병렬 세션 머지충돌이 원천 불가(H4)
//
// 사용:
//  node scripts/check-size.mjs                 워킹트리 vs HEAD (수동 점검)
//  node scripts/check-size.mjs --staged        스테이지 vs HEAD (commit-msg 훅)
//  node scripts/check-size.mjs --staged --msg-file <f>
//      커밋 메시지에 [size-override]가 있으면 통과 — 단, 이 마커는 사용자가 해당 커밋에서
//      명시적으로 지시했을 때만 쓸 수 있다(에이전트 자가 판정 금지, CLAUDE.md).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const BUDGET = 500; // 유효줄 — 신규/소형 파일 상한 (실측: 건강한 모듈 최대 455줄, 중앙값 112줄)
const ALLOWANCE = 10; // 예산 초과 파일의 커밋당 배선 여유 (import·프롭 연결 정도만)
const WIDE = 120; // 이 폭을 넘는 줄은 환산 가산 — 뭉치기 무효화

const staged = process.argv.includes("--staged");
const msgIdx = process.argv.indexOf("--msg-file");
const msgFile = msgIdx >= 0 ? process.argv[msgIdx + 1] : null;

// [size-override] — 탈출구. 판사는 사용자다(커밋 지시에 명시된 경우에만).
if (msgFile && existsSync(msgFile) && readFileSync(msgFile, "utf8").includes("[size-override]")) {
  console.log("check-size: [size-override] — 사용자 지시로 게이트 통과.");
  process.exit(0);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); // stderr 노이즈(신규 파일 fatal 등) 억제

// 머지 커밋은 스킵 (충돌 해소 커밋에서 래칫 오탐 방지)
try {
  const dir = git("rev-parse", "--git-dir").trim();
  if (existsSync(`${dir}/MERGE_HEAD`)) process.exit(0);
} catch { /* git 밖이면 게이트 무의미 */ process.exit(0); }

const isCode = (p) => /^src\/.*\.(ts|tsx|js|jsx)$/.test(p);
const isExempt = (p) =>
  /^src\/table-king\/(table|hooks|components)\//.test(p) || // 업스트림 원본만 — 우리 래퍼는 래칫 대상
  p === "src/hwpx/hwpxBase.js"; // 자동 생성물(수정 금지 파일)

// 유효 줄수 — 물리 줄 + 긴 줄 환산
const effLines = (content) =>
  content.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / WIDE)), 0);

const headLines = (path) => {
  try {
    return effLines(git("show", `HEAD:${path}`));
  } catch {
    return null; // HEAD에 없음 = 신규
  }
};

// 대상 수집: {path, oldPath(rename 승계), content}
const targets = [];
if (staged) {
  // -z NUL 파싱: R점수는 "R100\0old\0new", 그 외 "M\0path"
  const raw = git("diff", "--cached", "-M", "--name-status", "-z", "--diff-filter=ACMR");
  const f = raw.split("\0").filter(Boolean);
  for (let i = 0; i < f.length; ) {
    const status = f[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      const [oldPath, newPath] = [f[i + 1], f[i + 2]];
      targets.push({ path: newPath, oldPath });
      i += 3;
    } else {
      targets.push({ path: f[i + 1], oldPath: f[i + 1] });
      i += 2;
    }
  }
} else {
  for (const p of git("ls-files", "src").split("\n").filter(Boolean)) targets.push({ path: p, oldPath: p });
}

const readNow = (t) => {
  if (staged) {
    try {
      return git("show", `:${t.path}`); // 인덱스(스테이지) 버전
    } catch {
      return null;
    }
  }
  try {
    return readFileSync(t.path, "utf8");
  } catch {
    return null;
  }
};

const violations = [];
for (const t of targets) {
  if (!isCode(t.path)) continue;
  if (isExempt(t.path)) continue; // ⚠ 예외는 "기존 파일"에만 — 예외 디렉터리 신규 파일도 여기 안 옴
  const content = readNow(t);
  if (content == null) continue;
  const now = effLines(content);
  if (now <= BUDGET) continue;
  const before = headLines(t.oldPath);
  if (before == null) {
    violations.push(`${t.path}: 신규 파일이 예산 초과로 태어남 (${now} > ${BUDGET} 유효줄) — 모듈을 나눠 시작하세요.`);
  } else if (now > before + ALLOWANCE) {
    violations.push(
      `${t.path}: 래칫 위반 — HEAD ${before} → ${now} 유효줄 (+${now - before}, 배선 여유 +${ALLOWANCE}). ` +
        `예산(${BUDGET}) 초과 파일은 커질 수 없습니다. 먼저 분리(docs/refactoring-plan.md)하거나 새 파일로.`
    );
  }
}

if (violations.length) {
  console.error("✖ check-size 실패 — 코드 성장 규칙(CLAUDE.md) 위반:\n");
  for (const v of violations) console.error("  · " + v);
  console.error(
    "\n  통과가 정말 불가피하고 사용자가 이 커밋에서 명시 지시한 경우에만 커밋 메시지에 [size-override]."
  );
  process.exit(1);
}
console.log(`check-size: 통과 (예산 ${BUDGET} 유효줄 · 래칫 여유 +${ALLOWANCE}).`);
