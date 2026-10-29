/**
 * 다른 문서에서 쪽 가져오기 (P2, 사용자 승인 2026-10-29)
 *
 * 흐름:
 *   ① 파일(.hwp/.hwpx) 선택 → **숨은 iframe 편집기**에 로드 (현재 문서는 건드리지 않는다)
 *   ② 문단→쪽 매핑을 실측(`getCursorRect`)으로 만들어 쪽 목록을 보여 준다
 *   ③ 고른 쪽의 문단 범위만 `exportSelectionHtml` 로 뽑아
 *   ④ 현재 문서 커서 위치에 `pasteHtml` 로 삽입
 *
 * 왜 iframe 인가: 엔진 인스턴스는 문서 1개만 들 수 있어, 원본을 현재 문서에 덮어쓰지 않으려면
 * 두 번째 인스턴스가 필요하다. iframe 은 같은 출처라 wasm·DOM 에 그대로 접근할 수 있고,
 * 작업이 끝나면 통째로 버려 메모리도 회수된다.
 *
 * ⚠ 1차 보장 범위 = 본문·기본 표·이미지. 각주/필드/머리말은 손실될 수 있어 호출부가 고지한다.
 */
import { showToast } from './toast';

type IframeDoc = {
  frame: HTMLIFrameElement;
  wasm: any;
  pageCount: number;
  paraPage: number[]; // paraIndex → pageIndex
  docTotal: number;
  dispose: () => void;
};

type CanvaServicesLike = {
  getInputHandler: () => any;
  wasm: any;
};

const MAX_PAGES = 200;

/** 숨은 iframe 에 원본 문서를 로드하고, 문단→쪽 매핑까지 만든다. */
async function loadIntoHiddenFrame(bytes: Uint8Array, name: string): Promise<IframeDoc> {
  const frame = document.createElement('iframe');
  frame.src = `${location.pathname}?importWorker=1`;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);

  const ready = await new Promise<any>((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const w = frame.contentWindow as any;
      if (w?.__wasm) { resolve(w.__wasm); return; }
      if (Date.now() - started > 30000) { reject(new Error('보조 편집기 초기화 시간 초과')); return; }
      setTimeout(tick, 150);
    };
    tick();
  });

  ready.loadDocument(bytes, name);
  const pageCount = ready.pageCount as number;
  const docTotal = ready.getParagraphCount?.(0) ?? 0;

  // 문단→쪽: 각 문단 시작 위치의 커서 사각형이 어느 쪽인지로 판정한다(엔진에 직접 매핑이 없다).
  const paraPage: number[] = [];
  for (let p = 0; p < docTotal; p++) {
    let page = 0;
    try {
      const rect = JSON.parse(ready.getCursorRect(0, p, 0));
      page = rect?.pageIndex ?? rect?.pageIdx ?? 0;
    } catch { page = 0; }
    paraPage.push(page);
  }

  return {
    frame, wasm: ready, pageCount, paraPage, docTotal,
    dispose: () => { try { frame.remove(); } catch { /* ignore */ } },
  };
}

/** 쪽 선택 모달 — 체크박스 목록(가져올 쪽). 취소 시 null. */
function pickPages(doc: IframeDoc, fileName: string): Promise<number[] | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:22000;background:#0005;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(520px,92vw);max-height:80vh;display:flex;flex-direction:column;background:var(--ui-surface,#fff);border-radius:10px;box-shadow:0 18px 50px #0004;overflow:hidden;font:13px/1.5 system-ui,sans-serif;';

    const head = document.createElement('div');
    head.style.cssText = 'padding:12px 14px;border-bottom:1px solid var(--ui-border,#e5e7eb);font-weight:700;';
    head.textContent = `다른 문서에서 쪽 가져오기 — ${fileName} (${doc.pageCount}쪽)`;
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:8px 14px;color:var(--ui-text-muted,#6b7280);font-size:12px;';
    hint.textContent = '가져올 쪽을 고르세요. 1차에서는 본문·표·이미지를 보장하고 각주/머리말은 제외될 수 있습니다.';

    const list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:6px 10px;';
    const boxes: HTMLInputElement[] = [];
    for (let p = 0; p < Math.min(doc.pageCount, MAX_PAGES); p++) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = String(p);
      const span = document.createElement('span'); span.textContent = `${p + 1} 쪽`;
      row.append(cb, span);
      list.appendChild(row);
      boxes.push(cb);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--ui-border,#e5e7eb);';
    const cancel = document.createElement('button'); cancel.textContent = '취소';
    const ok = document.createElement('button'); ok.textContent = '가져오기';
    ok.style.cssText = 'background:var(--ui-link,#256ef4);color:#fff;border-radius:6px;padding:6px 14px;border:0;cursor:pointer;';
    cancel.style.cssText = 'border-radius:6px;padding:6px 14px;border:1px solid var(--ui-border,#e5e7eb);background:transparent;cursor:pointer;';
    foot.append(cancel, ok);

    box.append(head, hint, list, foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = (value: number[] | null): void => { overlay.remove(); resolve(value); };
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(null); });
    ok.addEventListener('click', () => {
      const picked = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      if (!picked.length) { showToast({ message: '가져올 쪽을 하나 이상 선택하세요.' }); return; }
      finish(picked);
    });
  });
}

/** 쪽 목록 → 문단 범위(시작/끝). 쪽에 문단이 없으면 null. */
function pageRangeToParagraphs(doc: IframeDoc, pages: number[]): { startPara: number; endPara: number } | null {
  const wanted = new Set(pages);
  let startPara = -1, endPara = -1;
  doc.paraPage.forEach((page, para) => {
    if (!wanted.has(page)) return;
    if (startPara < 0) startPara = para;
    endPara = para;
  });
  return startPara < 0 ? null : { startPara, endPara };
}

/**
 * 다른 문서에서 쪽을 가져와 현재 커서 위치에 삽입한다.
 * @returns 삽입한 쪽 수(0이면 실패/취소)
 */
export async function importPagesFromFile(services: CanvaServicesLike): Promise<number> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.hwp,.hwpx';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
  if (!file) return 0;

  showToast({ message: `${file.name} 불러오는 중…` });
  let doc: IframeDoc | null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    doc = await loadIntoHiddenFrame(bytes, file.name);

    const picked = await pickPages(doc, file.name);
    if (!picked) return 0;

    const range = pageRangeToParagraphs(doc, picked);
    if (!range) { showToast({ message: '선택한 쪽에서 가져올 본문을 찾지 못했습니다.' }); return 0; }

    const html = doc.wasm.exportSelectionHtml(0, range.startPara, 0, range.endPara, 0x7fffffff);
    if (!html || !html.trim()) { showToast({ message: '가져올 내용이 비어 있습니다.' }); return 0; }

    const ih = services.getInputHandler();
    const pos = ih?.cursor?.getPosition?.() ?? { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
    try {
      services.wasm.pasteHtml(pos.sectionIndex ?? 0, pos.paragraphIndex ?? 0, pos.charOffset ?? 0, html);
    } catch (err) {
      // 표 안에서 실패하면 셀 붙여넣기 경로로 재시도
      const parent = pos.parentParaIndex;
      if (parent === undefined) throw err;
      services.wasm.pasteHtmlInCell(
        pos.sectionIndex ?? 0, parent, pos.controlIndex ?? 0, pos.cellIndex ?? 0,
        pos.cellParaIndex ?? 0, pos.charOffset ?? 0, html,
      );
    }
    ih?.eventBus?.emit?.('document-changed');
    showToast({ message: `${picked.length}쪽을 가져왔습니다.` });
    return picked.length;
  } catch (err) {
    console.error('[page-import] 실패', err);
    showToast({ message: `가져오기 실패: ${(err as Error)?.message ?? '알 수 없는 오류'}` });
    return 0;
  } finally {
    doc?.dispose();
  }
}
