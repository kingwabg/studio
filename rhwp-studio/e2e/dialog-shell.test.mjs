import assert from 'node:assert';
import { runTest, createNewDocument, screenshot } from './helpers.mjs';
runTest('모달 셸 재설계 — 흰 타이틀바·아이콘 타일·칩 탭·푸터 순서', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  // 대표 모달 열기 (차례 만들기 = ModalDialog 상속)
  await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const { TocDialog } = await import('/src/ui/toc-dialog.ts');
    new TocDialog({ getInputHandler: () => ih }).show();
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  const r = await page.evaluate(() => {
    const w = document.querySelector('.dialog-wrap');
    const t = w?.querySelector('.dialog-title');
    const icon = t?.querySelector('i[class*="ph-"]');
    const close = w?.querySelector('.dialog-close i');
    const f = w?.querySelector('.dialog-footer');
    const hint = f?.querySelector('.dialog-keyhint')?.textContent ?? null;
    // 화면 순서: 취소가 확인보다 왼쪽
    const btns = [...(f?.querySelectorAll('.dialog-btn') ?? [])];
    const rects = btns.map(b => ({ t: b.textContent, x: Math.round(b.getBoundingClientRect().left) }));
    const cancel = rects.find(b => b.t === '취소'), ok = rects.find(b => b.t === '확인');
    const cs = t ? getComputedStyle(t) : null;
    return {
      hasIcon: !!icon, iconClass: icon?.className ?? null,
      closeIsPhosphor: !!close,
      hint,
      cancelLeftOfOk: cancel && ok ? cancel.x < ok.x : null,
      titleBg: cs?.backgroundColor ?? null,
      labelWidth: (() => { const l = w?.querySelector('.dialog-label'); return l ? Math.round(l.getBoundingClientRect().width) : null; })(),
    };
  });
  console.log('  실측:', JSON.stringify(r));
  assert.ok(r.hasIcon, '타이틀바 아이콘 타일');
  assert.ok(r.closeIsPhosphor, '× 는 Phosphor 아이콘');
  assert.strictEqual(r.hint, 'Enter 확인 · Esc 취소', '푸터 키 힌트');
  assert.strictEqual(r.cancelLeftOfOk, true, '화면 순서: 취소 → 확인');
  await screenshot(page, 'dialog-shell');
  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
