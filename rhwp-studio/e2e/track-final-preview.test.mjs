/**
 * [캔버스 한컴 포크] 변경 내용 보기 — 2단 A4 / 창 미리보기 실구동 검증.
 *
 * 판정식
 *  ① 리본 [변경 내용 보기] → 보기 방식 메뉴 3항목
 *  ② [2단 A4] → .tfp--dock 이 #canva-workspace 형제로 붙고, 본문 폭이 그만큼 줄어든다
 *  ③ 미리보기 캔버스가 실제로 그려진다(width>0) — 빈 상자가 아니다
 *  ④ **본문 무손상**: 미리보기 전/후 본문 텍스트와 변경 개수가 그대로 (스냅샷 복원)
 *  ⑤ [창으로] → position:fixed 로 떠 있고 본문 폭이 원래대로 돌아온다
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';

const BASE = '원래 문장입니다. ';
const ADDED = '여기가 새로 넣은 문장.';

runTest('변경 내용 보기(2단/창)', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await new Promise((r) => setTimeout(r, 700));

  // 준비 — 원문 + 추적 켜고 삽입 = 변경 1건
  const prepared = await page.evaluate(async ({ BASE, ADDED }) => {
    const w = window.__wasm;
    w.insertText(0, 0, 0, BASE);
    w.setTrackChanges(true, '검토자', '2026-08-13');
    w.insertText(0, 0, BASE.length, ADDED);
    window.__eventBus.emit('document-changed');
    await new Promise((r) => setTimeout(r, 400));
    return {
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
      changes: JSON.parse(w.getTrackChanges()).length,
      editorW: document.getElementById('editor-area').getBoundingClientRect().width,
    };
  }, { BASE, ADDED });
  console.log('  준비: 변경', prepared.changes, '건 / 본문 폭', Math.round(prepared.editorW));
  assert.ok(prepared.changes > 0, '추적된 변경이 있어야 함');

  // ① 메뉴
  const menu = await page.evaluate(() => {
    const btn = document.querySelector('[data-cmd="review:view-final"]');
    window.__dispatcher.dispatch('review:view-final', { anchorEl: btn });
    return [...document.querySelectorAll('.tfp-menu .md-item')].map((e) => e.textContent);
  });
  console.log('  ① 보기 방식 메뉴:', JSON.stringify(menu));
  assert.strictEqual(menu.length, 3, '보기 방식 3가지');

  // ②③ 2단 A4
  const dock = await page.evaluate(async () => {
    [...document.querySelectorAll('.tfp-menu .md-item')]
      .find((e) => e.textContent.includes('2단')).click();
    await new Promise((r) => setTimeout(r, 3000));
    const pane = document.querySelector('.tfp');
    const canvas = document.querySelector('.tfp-canvas');
    const w = window.__wasm;
    return {
      docked: !!pane?.classList.contains('tfp--dock'),
      parentId: pane?.parentElement?.id,
      prevSiblingId: pane?.previousElementSibling?.id,
      paneW: pane ? Math.round(pane.getBoundingClientRect().width) : 0,
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      nav: document.querySelector('.tfp-nav span')?.textContent,
      status: document.querySelector('.tfp-status')?.textContent,
      editorW: Math.round(document.getElementById('editor-area').getBoundingClientRect().width),
      text: w.getTextRange(0, 0, 0, w.getParagraphLength(0, 0)),
      changes: JSON.parse(w.getTrackChanges()).length,
    };
  });
  console.log('  ② 도킹:', dock.docked, '/ 부모', dock.parentId, '/ 앞형제', dock.prevSiblingId,
    '/ 미리보기 폭', dock.paneW, '/ 본문 폭', Math.round(prepared.editorW), '→', dock.editorW);
  console.log('  ③ 캔버스:', `${dock.canvasW}×${dock.canvasH}`, '/', dock.nav, '/', dock.status);
  assert.ok(dock.docked, '.tfp--dock 로 붙어야 함');
  assert.strictEqual(dock.prevSiblingId, 'editor-area', '본문 영역 바로 오른쪽');
  assert.ok(dock.editorW < prepared.editorW, '본문이 미리보기 폭만큼 줄어야 함');
  assert.ok(dock.canvasW > 0 && dock.canvasH > 0, '미리보기 페이지가 실제로 그려져야 함');

  // ④ 본문 무손상
  console.log('  ④ 본문:', JSON.stringify(dock.text), '/ 변경', dock.changes, '건');
  assert.strictEqual(dock.text, prepared.text, '미리보기가 본문 텍스트를 바꾸면 안 됨');
  assert.strictEqual(dock.changes, prepared.changes, '미리보기가 변경 기록을 소모하면 안 됨');

  await page.screenshot({ path: 'e2e/screenshots/track-final-preview-dock.png' });

  // ④-b 자동 갱신 — 편집하면(디바운스 후) 미리보기가 다시 뜬다. 쪽 나눔으로 쪽수가 늘어야 확인된다
  const refreshed = await page.evaluate(async () => {
    const w = window.__wasm;
    w.insertPageBreak(0, 0, w.getParagraphLength(0, 0));
    window.__eventBus.emit('document-changed');
    await new Promise((r) => setTimeout(r, 4000));
    return { nav: document.querySelector('.tfp-nav span')?.textContent };
  });
  console.log('  ④-b 자동 갱신:', refreshed.nav);
  assert.ok(/\/ 2 쪽/.test(refreshed.nav ?? ''), '편집 후 미리보기가 다시 그려져야 함');

  // ⑤ 창 모드
  const win = await page.evaluate(async () => {
    [...document.querySelectorAll('.tfp-head button')]
      .find((b) => b.textContent === '창으로').click();
    await new Promise((r) => setTimeout(r, 800));
    const pane = document.querySelector('.tfp');
    return {
      windowed: !!pane?.classList.contains('tfp--window'),
      position: pane ? getComputedStyle(pane).position : '',
      parent: pane?.parentElement?.tagName,
      editorW: Math.round(document.getElementById('editor-area').getBoundingClientRect().width),
      canvasW: document.querySelector('.tfp-canvas')?.width ?? 0,
    };
  });
  console.log('  ⑤ 창:', win.windowed, '/', win.position, '/ 부모', win.parent,
    '/ 본문 폭', win.editorW, '/ 캔버스 폭', win.canvasW);
  assert.ok(win.windowed && win.position === 'fixed', '창 모드는 떠 있어야 함');
  assert.strictEqual(win.editorW, Math.round(prepared.editorW), '창 모드면 본문 폭이 원래대로');
  assert.ok(win.canvasW > 0, '창 모드에서도 그려져야 함');

  await page.screenshot({ path: 'e2e/screenshots/track-final-preview-window.png' });

  // 닫기
  const closed = await page.evaluate(async () => {
    document.querySelector('.tfp .dialog-close').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      gone: !document.querySelector('.tfp'),
      editorW: Math.round(document.getElementById('editor-area').getBoundingClientRect().width),
    };
  });
  console.log('  ⑥ 닫기:', closed.gone, '/ 본문 폭', closed.editorW);
  assert.ok(closed.gone, '닫으면 사라져야 함');
});
