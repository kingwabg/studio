/**
 * 상태바 배포 표식 — "지금 보는 화면이 최신인가"를 눈으로 판별하기 위한 것.
 *
 * 배포는 ①Vercel 빌드 대기 ②서비스워커 캐시 두 단계로 늦는데 화면에 단서가 없어
 * "고쳤다"와 "안 보인다"가 계속 엇갈렸다(2026-07-31, 하루 세 번). 그 단서가 이것이다.
 *
 * ① 상태바에 표식이 뜬다
 * ② 호스트가 ?assetVersion= 을 주면 **그 값 그대로** 보여준다(배포 단위와 일치해야 하므로)
 */
import assert from 'node:assert';
import { runTest, createNewDocument, loadApp } from './helpers.mjs';

runTest('상태바 배포 표식', async ({ page }) => {
  await createNewDocument(page);
  await new Promise((r) => setTimeout(r, 800));
  const plain = await page.evaluate(() => document.querySelector('.stb-build')?.textContent ?? null);
  console.log('  ① 단독 실행:', JSON.stringify(plain));
  assert.ok(plain, '표식이 있어야 한다');
  assert.match(plain, /빌드|dev/, '단독 실행이면 빌드 시각을 보여준다');

  // ② 호스트가 준 배포 버전이 있으면 그대로
  await loadApp(page, '?assetVersion=test-20260731');
  await new Promise((r) => setTimeout(r, 2500));
  const hosted = await page.evaluate(() => document.querySelector('.stb-build')?.textContent ?? null);
  console.log('  ② 호스트 임베드:', JSON.stringify(hosted));
  assert.strictEqual(hosted, 'test-20260731', '호스트가 준 배포 버전을 그대로 보여야 한다');
});
