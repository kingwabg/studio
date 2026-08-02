/**
 * 문단 타임머신 — 커서가 있는 **그 문단**의 과거 판들을 보고, 고른 판으로 그 문단만 되돌린다.
 *
 * 문서 전체 되돌리기(Ctrl+Z)와 다르다: 다른 문단은 건드리지 않는다. 기록은 브라우저 로컬
 * (media/timemachine-store.ts)이라 문서 파일에는 아무것도 안 들어간다.
 */
import { ModalDialog } from './dialog';
import { mkEl, mkButton } from './canva-dom';
import type { ParaVersion } from '@/media/timemachine-store';

/** "3분 전", "2시간 전", "어제" — 스펙의 '어제/3시간 전' 표현 */
function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  return d === 1 ? '어제' : `${d}일 전`;
}

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

class TimeMachineDialog extends ModalDialog {
  constructor(
    private versions: ParaVersion[],
    private current: string,
    private onRestore: (text: string) => void,
  ) {
    super('문단 타임머신', 560);
    this.titleIcon = 'clock-counter-clockwise';
    this.titleSubject = `이 문단 · 기록 ${versions.length}판`;
    this.confirmLabel = '닫기';
  }

  protected createBody(): HTMLElement {
    const body = mkEl('div', 'tm-body');
    body.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    const now = Date.now();

    const note = mkEl(
      'div',
      'tm-note',
      this.versions.length === 0
        ? '이 문단의 기록이 아직 없습니다. 문단을 고치고 잠시 멈추면 한 판씩 쌓입니다.'
        : '고른 판으로 이 문단만 되돌립니다 — 다른 문단은 그대로입니다. 되돌린 뒤 Ctrl+Z 로 취소할 수 있습니다.',
    );
    note.style.cssText = 'font-size:12px;color:#666;line-height:1.5';
    body.appendChild(note);

    // 지금 내용
    const cur = mkEl('div', 'tm-current');
    cur.style.cssText = 'padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#fafafa';
    const curHead = mkEl('div', '', '지금');
    curHead.style.cssText = 'font-size:11px;font-weight:600;color:#666;margin-bottom:4px';
    const curText = mkEl('div', '', this.current || '(빈 문단)');
    curText.style.cssText =
      'font-size:12px;line-height:1.5;white-space:pre-wrap;max-height:66px;overflow:auto;color:#222';
    cur.append(curHead, curText);
    body.appendChild(cur);

    // 과거 판 목록
    const list = mkEl('div', 'tm-list');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto';
    for (const v of this.versions) {
      const row = mkEl('div', 'tm-row');
      row.style.cssText =
        'display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid #ddd;border-radius:6px';

      const left = mkEl('div', '');
      left.style.cssText = 'flex:1;min-width:0';
      const when = mkEl('div', '', `${ago(v.savedAt, now)} · ${stamp(v.savedAt)}`);
      when.style.cssText = 'font-size:11px;color:#888;margin-bottom:3px';
      const text = mkEl('div', '', v.text || '(빈 문단)');
      text.style.cssText =
        'font-size:12px;line-height:1.5;white-space:pre-wrap;max-height:60px;overflow:auto;color:#222';
      left.append(when, text);

      const same = v.text === this.current;
      const btn = mkButton('dialog-btn', { text: same ? '지금과 같음' : '이 판으로' });
      btn.style.cssText = 'flex:0 0 auto;align-self:center';
      if (same) {
        (btn as HTMLButtonElement).disabled = true;
      } else {
        btn.addEventListener('click', () => {
          this.onRestore(v.text);
          this.hide();
        });
      }
      row.append(left, btn);
      list.appendChild(row);
    }
    body.appendChild(list);
    return body;
  }

  protected onConfirm(): boolean {
    return true; // '닫기'
  }
}

export function showTimeMachine(
  versions: ParaVersion[],
  current: string,
  onRestore: (text: string) => void,
): void {
  new TimeMachineDialog(versions, current, onRestore).show();
}
