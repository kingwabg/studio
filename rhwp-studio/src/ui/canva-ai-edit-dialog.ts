/**
 * [캔버스 한컴 포크] "AI에게 수정하기" 대화상자 — 글상자 우클릭 메뉴에서 진입.
 * 흐름: 현재 내용 표시 → "이 영역을 어떻게 수정할까요?" 지시 입력 → M3 수정안 →
 * 수정 전/후 비교 → [적용](한 번의 snapshot = Ctrl+Z 취소 가능) / [다시 요청] / [취소].
 * inline-ai의 "골라서 수정하고 한눈에 비교"를 캔버스 개체 단위로 옮긴 것.
 */
import { callMiniMax, aiErrorHint } from './canva-ai-client';

const EDIT_PROMPT =
  '당신은 한국어 문서 편집 도우미입니다. 사용자가 준 "현재 내용"을 요청에 따라 수정해, ' +
  '수정된 전체 텍스트만 출력하세요. 설명·인사·마크업 없이 결과 텍스트만. 줄바꿈은 유지하거나 요청에 맞게 조정합니다.';

interface ShapeRef { sec: number; ppi: number; ci: number; }

/** 글상자 전체 텍스트 읽기 (문단들 → \n 결합) */
function readShapeText(wasm: any, ref: ShapeRef): string {
  const n = wasm.getCellParagraphCount(ref.sec, ref.ppi, ref.ci, 0);
  const lines: string[] = [];
  for (let cpi = 0; cpi < n; cpi++) {
    const len = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, cpi);
    lines.push(len > 0 ? wasm.getTextInCell(ref.sec, ref.ppi, ref.ci, 0, cpi, 0, len) : '');
  }
  return lines.join('\n');
}

/** 글상자 내용을 새 텍스트로 통째 교체 (스냅샷 안에서 호출) */
function replaceShapeText(wasm: any, ref: ShapeRef, next: string): void {
  // 뒤 문단부터 비우고 앞 문단에 합쳐 1문단으로 정리
  const n = wasm.getCellParagraphCount(ref.sec, ref.ppi, ref.ci, 0);
  for (let cpi = n - 1; cpi >= 1; cpi--) {
    const len = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, cpi);
    if (len > 0) wasm.deleteTextInCell(ref.sec, ref.ppi, ref.ci, 0, cpi, 0, len);
    wasm.mergeParagraphInCell(ref.sec, ref.ppi, ref.ci, 0, cpi);
  }
  const len0 = wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, 0);
  if (len0 > 0) wasm.deleteTextInCell(ref.sec, ref.ppi, ref.ci, 0, 0, 0, len0);
  // 새 텍스트 삽입 (줄마다 insert → 분할)
  const lines = next.split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]) wasm.insertTextInCell(ref.sec, ref.ppi, ref.ci, 0, k, 0, lines[k]);
    if (k < lines.length - 1) wasm.splitParagraphInCell(ref.sec, ref.ppi, ref.ci, 0, k, lines[k].length);
  }
}

export function showAiEditDialog(ih: any, ref: ShapeRef): void {
  const wasm = ih.wasm;
  let original = '';
  try { original = readShapeText(wasm, ref); } catch { /* 빈 글상자 */ }
  let revised: string | null = null;
  let busy = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'dialog-wrap';
  dialog.style.width = '460px';

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    ih.textarea?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  const titleBar = document.createElement('div');
  titleBar.className = 'dialog-title';
  titleBar.textContent = 'AI에게 수정하기';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'dialog-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  titleBar.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.style.cssText = 'padding:14px 16px;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow-y:auto;';

  const mkLabel = (t: string) => {
    const l = document.createElement('div');
    l.style.cssText = 'font-size:11px;font-weight:700;color:var(--ui-text-hint);';
    l.textContent = t;
    return l;
  };
  const mkBox = (t: string) => {
    const b = document.createElement('div');
    b.style.cssText = 'border:1px solid var(--ui-border);border-radius:6px;padding:8px 10px;font-size:12.5px;'
      + 'line-height:1.55;white-space:pre-wrap;word-break:break-word;background:var(--ui-bg-light);color:var(--ui-text);max-height:140px;overflow-y:auto;';
    b.textContent = t;
    return b;
  };

  body.appendChild(mkLabel('현재 내용'));
  body.appendChild(mkBox(original || '(비어 있음)'));

  const ask = mkLabel('이 영역을 어떻게 수정할까요?');
  body.appendChild(ask);
  const input = document.createElement('textarea');
  input.rows = 3;
  input.placeholder = '예) 더 격식 있는 안내문으로 바꿔줘 / 두 문장으로 줄여줘';
  input.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--ui-border);'
    + 'border-radius:6px;padding:8px 10px;font-size:12.5px;font-family:inherit;color:var(--ui-text);background:var(--ui-surface);';
  body.appendChild(input);

  // 수정안 영역 (요청 후 채워짐)
  const revisedLabel = mkLabel('수정 후');
  const revisedBox = mkBox('');
  revisedBox.style.borderColor = 'var(--ui-link)';
  revisedLabel.hidden = true;
  revisedBox.hidden = true;
  body.appendChild(revisedLabel);
  body.appendChild(revisedBox);

  const status = document.createElement('div');
  status.style.cssText = 'font-size:11.5px;color:var(--ui-text-hint);white-space:pre-wrap;';
  body.appendChild(status);

  const footer = document.createElement('div');
  footer.className = 'dialog-footer';
  const mkBtn = (label: string, primary: boolean) => {
    const b = document.createElement('button');
    b.className = primary ? 'dialog-btn dialog-btn-primary' : 'dialog-btn';
    b.textContent = label;
    return b;
  };
  const requestBtn = mkBtn('수정 요청', true);
  const applyBtn = mkBtn('적용', true);
  const cancelBtn = mkBtn('취소', false);
  applyBtn.style.display = 'none';
  cancelBtn.addEventListener('click', close);

  const doRequest = async () => {
    const instruction = input.value.trim();
    if (!instruction || busy) return;
    busy = true;
    requestBtn.disabled = true;
    status.textContent = 'AI가 수정안을 작성 중…';
    try {
      const out = await callMiniMax(EDIT_PROMPT, `현재 내용:\n${original}\n\n수정 요청: ${instruction}`);
      revised = out;
      revisedLabel.hidden = false;
      revisedBox.hidden = false;
      revisedBox.textContent = out;
      status.textContent = '';
      applyBtn.style.display = '';
      requestBtn.textContent = '다시 요청';
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      status.textContent = `요청 실패: ${detail}${aiErrorHint(detail)}`;
    } finally {
      busy = false;
      requestBtn.disabled = false;
    }
  };
  requestBtn.addEventListener('click', () => void doRequest());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doRequest(); }
    e.stopPropagation(); // 편집기 단축키로 새지 않게
  });

  applyBtn.addEventListener('click', () => {
    if (revised === null) return;
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'aiEditShape',
      operation: () => {
        replaceShapeText(wasm, ref, revised as string);
        return ih.cursor.getPosition();
      },
    });
    ih.eventBus.emit('document-changed');
    close();
  });

  footer.append(requestBtn, applyBtn, cancelBtn);
  dialog.append(titleBar, body, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  input.focus();
}
