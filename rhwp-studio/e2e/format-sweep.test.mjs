/**
 * 서식 전수 스윕 — 한컴 서식 메뉴 패리티 판정식 ①(적용-판독 층)
 * (스펙: rhwp mydocs/eng/plans/hancom-format-parity.md, 2026-07-30 한컴 대화상자 채록 기준)
 *
 * 글자 모양·문단 모양의 각 속성을 명령/API로 적용하고 엔진 판독값으로 단언한다.
 * "명령은 있는데 안 먹는" 갭을 기계적으로 잡는 층 — 시각(조판) 정합은 별도 오라클.
 */
import assert from 'node:assert';
import { runTest, createNewDocument, clickEditArea, typeText } from './helpers.mjs';

runTest('서식 전수 — 글자·문단 속성 적용-판독', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await createNewDocument(page);
  await clickEditArea(page);
  await typeText(page, '서식 스윕 대상 문장입니다.');
  await new Promise((r) => setTimeout(r, 500));

  // ── 글자 모양: 토글 9종 + 수치 4종 ──
  const charRes = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const out = {};
    // 단어 선택
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 1 });
    ih.cursor.selectWordAtCursor();

    const toggles = ['bold', 'italic', 'underline', 'strikethrough', 'emboss', 'engrave', 'superscript', 'subscript'];
    for (const t of toggles) {
      ih.toggleFormat(t);
      await new Promise((r) => setTimeout(r, 120));
      const cur = ih.getCharPropertiesAtCursor();
      out[t] = t === 'superscript' || t === 'subscript' ? !!cur[t]
        : t === 'emboss' || t === 'engrave' ? !!cur[t] : !!cur[t];
      ih.toggleFormat(t); // 원복
      await new Promise((r) => setTimeout(r, 80));
    }
    // 외곽선 (outlineType)
    ih.toggleFormat('outline');
    await new Promise((r) => setTimeout(r, 120));
    out.outline = (ih.getCharPropertiesAtCursor().outlineType ?? 0) !== 0;
    ih.toggleFormat('outline');

    // 수치: 크기·장평·자간·글자색
    ih.applyCharFormat({ fontSize: 1600 });
    await new Promise((r) => setTimeout(r, 120));
    out.fontSize = ih.getCharPropertiesAtCursor().fontSize;
    ih.applyCharFormat({ ratios: Array(7).fill(120) });
    await new Promise((r) => setTimeout(r, 120));
    out.ratio = ih.getCharPropertiesAtCursor().ratios?.[0];
    ih.applyCharFormat({ spacings: Array(7).fill(25) });
    await new Promise((r) => setTimeout(r, 120));
    out.spacing = ih.getCharPropertiesAtCursor().spacings?.[0];
    ih.applyCharFormat({ textColor: '#E03131' });
    await new Promise((r) => setTimeout(r, 120));
    out.color = (ih.getCharPropertiesAtCursor().textColor ?? '').toLowerCase();
    return out;
  });
  console.log('  글자:', JSON.stringify(charRes));
  for (const k of ['bold', 'italic', 'underline', 'strikethrough', 'emboss', 'engrave', 'superscript', 'subscript', 'outline']) {
    assert.ok(charRes[k], `글자 토글 적용-판독: ${k}`);
  }
  assert.strictEqual(charRes.fontSize, 1600, '기준 크기 16pt');
  assert.strictEqual(charRes.ratio, 120, '장평 120%');
  assert.strictEqual(charRes.spacing, 25, '자간 25%');
  assert.strictEqual(charRes.color, '#e03131', '글자 색');

  // ── 글자 모양 확장 탭: 밑줄·취소선·음영·그림자·상대크기·글자위치·강조점·커닝 ──
  const extRes = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const probe = async (mods) => {
      ih.applyCharFormat(mods);
      await new Promise((r) => setTimeout(r, 120));
      return ih.getCharPropertiesAtCursor();
    };
    const out = {};
    let c = await probe({ underlineType: 'Bottom', underlineShape: 2, underlineColor: '#0000FF' });
    out.underline = { type: c.underlineType, shape: c.underlineShape, color: c.underlineColor };
    c = await probe({ strikeShape: 1, strikeColor: '#FF0000' });
    out.strike = { shape: c.strikeShape, color: c.strikeColor };
    c = await probe({ shadeColor: '#FFFF00' });
    out.shade = c.shadeColor;
    c = await probe({ shadowType: 1, shadowColor: '#888888', shadowOffsetX: 10, shadowOffsetY: 10 });
    out.shadow = { type: c.shadowType, color: c.shadowColor, x: c.shadowOffsetX };
    c = await probe({ relativeSizes: Array(7).fill(80) });
    out.relSize = c.relativeSizes?.[0];
    c = await probe({ charOffsets: Array(7).fill(20) });
    out.charOffset = c.charOffsets?.[0];
    c = await probe({ emphasisDot: 1 });
    out.emphasis = c.emphasisDot;
    c = await probe({ kerning: true });
    out.kerning = c.kerning;
    return out;
  });
  console.log('  글자확장:', JSON.stringify(extRes));
  assert.deepStrictEqual(extRes.underline, { type: 'Bottom', shape: 2, color: '#0000ff' }, '밑줄 위치·모양·색');
  assert.deepStrictEqual(extRes.strike, { shape: 1, color: '#ff0000' }, '취소선 모양·색');
  assert.strictEqual(extRes.shade, '#ffff00', '음영 색');
  assert.deepStrictEqual(extRes.shadow, { type: 1, color: '#888888', x: 10 }, '그림자 종류·색·오프셋');
  assert.strictEqual(extRes.relSize, 80, '상대 크기 80%');
  assert.strictEqual(extRes.charOffset, 20, '글자 위치 20%');
  assert.strictEqual(extRes.emphasis, 1, '강조점');
  assert.strictEqual(extRes.kerning, true, '커닝');

  // ── 문단 모양: 정렬 6종 + 여백·첫줄·간격 ──
  const paraRes = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const out = { align: {} };
    ih.cursor.clearSelection();
    ih.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 });

    for (const a of ['left', 'center', 'right', 'justify', 'distribute', 'split']) {
      ih.applyParaAlign(a);
      await new Promise((r) => setTimeout(r, 120));
      out.align[a] = ih.getParaProperties().alignment;
    }
    // 여백 (왼쪽/오른쪽) — HWPUNIT
    ih.applyParaFormat({ marginLeft: 2000, marginRight: 1000 });
    await new Promise((r) => setTimeout(r, 120));
    let p = ih.getParaProperties();
    out.marginLeft = p.marginLeft; out.marginRight = p.marginRight;
    // 첫 줄 들여쓰기 (양수) / 내어쓰기 (음수) — 한컴 문단 모양 「첫 줄」 라디오와 동일 의미
    ih.applyParaFormat({ indent: 1500 });
    await new Promise((r) => setTimeout(r, 120));
    out.indent = ih.getParaProperties().indent;
    ih.applyParaFormat({ indent: -1500 });
    await new Promise((r) => setTimeout(r, 120));
    out.hanging = ih.getParaProperties().indent;
    // 줄 간격 % / 문단 위·아래
    ih.applyParaFormat({ lineSpacing: 200, lineSpacingType: 'Percent' });
    await new Promise((r) => setTimeout(r, 120));
    p = ih.getParaProperties();
    out.lineSpacing = p.lineSpacing; out.lineSpacingType = p.lineSpacingType;
    ih.applyParaFormat({ spacingBefore: 500, spacingAfter: 300 });
    await new Promise((r) => setTimeout(r, 120));
    p = ih.getParaProperties();
    out.before = p.spacingBefore; out.after = p.spacingAfter;
    return out;
  });
  console.log('  문단:', JSON.stringify(paraRes));
  assert.deepStrictEqual(paraRes.align, {
    left: 'left', center: 'center', right: 'right',
    justify: 'justify', distribute: 'distribute', split: 'split',
  }, '정렬 6종 적용-판독');
  assert.strictEqual(paraRes.marginLeft, 2000, '왼쪽 여백');
  assert.strictEqual(paraRes.marginRight, 1000, '오른쪽 여백');
  assert.strictEqual(paraRes.indent, 1500, '첫 줄 들여쓰기(+)');
  assert.strictEqual(paraRes.hanging, -1500, '첫 줄 내어쓰기(-)');
  assert.strictEqual(paraRes.lineSpacing, 200, '줄 간격 200%');
  assert.strictEqual(paraRes.before, 500, '문단 위 간격');
  assert.strictEqual(paraRes.after, 300, '문단 아래 간격');

  // ── 문단 모양 「테두리/배경」 탭 + 탭 정의 + 줄나눔 기준 (한컴 문단 모양 미덮은 영역) ──
  const paraExtRes = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    const probe = async (mods) => {
      ih.applyParaFormat(mods);
      await new Promise((r) => setTimeout(r, 150));
      return ih.getParaProperties();
    };
    const out = {};
    let p = await probe({
      borderLeft: { type: 1, width: 2, color: '#0000FF' },
      borderTop: { type: 1, width: 2, color: '#0000FF' },
      borderSpacing: [100, 200, 100, 200],
      borderConnect: true,
    });
    out.borderLeft = p.borderLeft; out.borderSpacing = p.borderSpacing; out.borderConnect = p.borderConnect;
    p = await probe({ fillType: 'solid', fillColor: '#FFFF99' });
    out.fill = { type: p.fillType, color: p.fillColor };
    // 줄 나눔 기준은 숫자 코드 규약 (types.ts: 한글 0=어절/1=글자, 영문 0=단어/1=하이픈/2=글자)
    p = await probe({ koreanBreakUnit: 1, englishBreakUnit: 2 });
    out.breakUnit = { ko: p.koreanBreakUnit, en: p.englishBreakUnit };
    // 탭 정의 규약(types.ts): { position: HWPUNIT, type: 숫자(0=왼쪽,1=오른쪽,2=가운데,3=소수점), fill }
    p = await probe({ tabStops: [{ position: 2000, type: 2, fill: 0 }] });
    out.tabStops = (p.tabStops ?? []).map((t) => ({ position: t.position, type: t.type }));
    p = await probe({ keepWithNext: true, keepLines: true, widowOrphan: true, pageBreakBefore: true });
    out.flags = { next: p.keepWithNext, lines: p.keepLines, widow: p.widowOrphan, pb: p.pageBreakBefore };
    p = await probe({ fontLineHeight: true, autoSpaceKrEn: true, autoSpaceKrNum: true });
    out.auto = { fontLine: p.fontLineHeight, krEn: p.autoSpaceKrEn, krNum: p.autoSpaceKrNum };
    // 세로 정렬 — autoSpacing 과 같은 비트로 오해석돼 항상 0으로 지워지던 결함 회귀
    // (2026-07-30 수리: 판독이 attr2=autoSpacing / attr1 bit20-21=verticalAlign 로 분리)
    p = await probe({ verticalAlign: 1, autoSpaceKrEn: true });
    out.vAlign = { v: p.verticalAlign, krEn: p.autoSpaceKrEn };
    return out;
  });
  console.log('  문단확장:', JSON.stringify(paraExtRes));
  assert.ok(paraExtRes.borderLeft && paraExtRes.borderLeft.width > 0, '문단 테두리(왼쪽) 적용');
  assert.deepStrictEqual(paraExtRes.borderSpacing, [100, 200, 100, 200], '테두리 간격 4방향');
  assert.strictEqual(paraExtRes.borderConnect, true, '문단 테두리 연결');
  assert.strictEqual((paraExtRes.fill.color ?? '').toLowerCase(), '#ffff99', '문단 배경 면 색');
  assert.deepStrictEqual(paraExtRes.breakUnit, { ko: 1, en: 2 }, '줄 나눔 기준(한글=글자, 영문=글자)');
  assert.deepStrictEqual(paraExtRes.tabStops, [{ position: 2000, type: 2 }], '사용자 탭 정의(가운데 탭)');
  assert.deepStrictEqual(paraExtRes.flags,
    { next: true, lines: true, widow: true, pb: true }, '문단 보호·다음문단과 함께·외톨이·쪽 나눔');
  assert.deepStrictEqual(paraExtRes.auto,
    { fontLine: true, krEn: true, krNum: true }, '글꼴 줄높이·한영/한숫자 자동 간격');
  assert.deepStrictEqual(paraExtRes.vAlign, { v: 1, krEn: true },
    '세로 정렬과 자동 간격이 서로를 지우지 않는다(비트 오해석 회귀)');

  // ── 수준 증감: 번호 문단에서 paraLevel 이동 (서식 > 한 수준 증가/감소) ──
  const levelRes = await page.evaluate(async () => {
    const ih = window.__inputHandler;
    ih.commandDispatcher?.dispatch?.('format:toggle-numbering');
    window.__inputHandler.dispatcher?.dispatch?.('format:toggle-numbering');
    await new Promise((r) => setTimeout(r, 300));
    const before = ih.getParaProperties();
    ih.changeOutlineLevel(1);
    await new Promise((r) => setTimeout(r, 300));
    const after = ih.getParaProperties();
    ih.changeOutlineLevel(-1);
    await new Promise((r) => setTimeout(r, 300));
    const restored = ih.getParaProperties();
    return {
      head: before.headType,
      beforeLevel: before.paraLevel ?? 0,
      afterLevel: after.paraLevel ?? 0,
      restoredLevel: restored.paraLevel ?? 0,
    };
  });
  console.log('  수준:', JSON.stringify(levelRes));
  assert.notStrictEqual(levelRes.head, 'None', '문단 번호 적용됨');
  assert.strictEqual(levelRes.afterLevel, levelRes.beforeLevel + 1, '한 수준 감소(레벨+1)');
  assert.strictEqual(levelRes.restoredLevel, levelRes.beforeLevel, '한 수준 증가로 복귀');

  assert.deepStrictEqual(errors, [], `페이지 오류: ${JSON.stringify(errors)}`);
});
