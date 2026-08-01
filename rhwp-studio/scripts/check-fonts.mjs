#!/usr/bin/env node
/**
 * 글꼴 카탈로그 ↔ 실제 파일 대조.
 *
 * 왜 필요한가(2026-08-01 실측): `public/fonts` 가 디렉터리가 아니라
 * '../../web/fonts' 를 담은 15바이트 **파일**이었다 — 깨진 심볼릭 링크가 일반 파일로
 * 커밋된 것이다. 그 바람에 font-loader 가 등록한 29개 woff2 가 전부 404 였고,
 * 화면은 시스템 글꼴로 대체돼 **아무도 몰랐다**. UI 글꼴(맑은 고딕→Pretendard)만
 * 매 로드마다 404 를 냈다.
 *
 * 조용히 대체되는 결함이라 사람 눈으로는 안 잡힌다 — 그래서 게이트가 센다.
 * 파일이 없는 건 환경 문제(라이선스 폰트 미포함)일 수 있어 **경고**로 두고,
 * `public/fonts` 가 디렉터리가 아닌 것만 **실패**로 다룬다(그건 언제나 사고다).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(root, 'public', 'fonts');

let present = new Set();
try {
  const st = statSync(fontsDir); // 심볼릭 링크는 따라간다
  if (!st.isDirectory()) {
    console.error(`FAIL public/fonts 가 디렉터리가 아닙니다 (${st.size}바이트 파일) — `
      + '깨진 심볼릭 링크가 일반 파일로 커밋된 상태입니다.');
    process.exit(1);
  }
  present = new Set(readdirSync(fontsDir));
} catch {
  console.error('FAIL public/fonts 가 없습니다 — 글꼴이 하나도 서빙되지 않습니다.');
  process.exit(1);
}

const src = readFileSync(join(root, 'src', 'core', 'font-loader.ts'), 'utf8');
const refs = [...new Set([...src.matchAll(/file: '(fonts\/[^']+)'/g)].map((m) => m[1]))];
const missing = refs.filter((r) => !present.has(basename(r)));

console.log(`fonts: 참조 ${refs.length}개 · 보유 ${present.size}개 · 없음 ${missing.length}개`);
if (missing.length > 0) {
  console.warn('WARN 카탈로그가 가리키는데 없는 글꼴 (해당 이름은 OS 글꼴로 대체됨):');
  for (const m of missing) console.warn('  - ' + m);
}
