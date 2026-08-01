/**
 * 「직접」 탭 — 마우스·손가락으로 쓰듯 그리는 서명.
 * (사용자 요청 2026-08-01: "직접 손으로 쓰듯 하는 필기체")
 *
 * 왜 signature_pad(27KB, MIT)인가:
 * 손글씨로 보이는 핵심은 **속도에 따라 선 굵기가 변하는 것**이다. 그건 점을 선으로 잇는
 * 일이 아니라 3차 베지에 + 속도 평활(velocity filter) + 굵기 보간이라, 직접 짜면 200줄이
 * 넘고 손 떨림에서 오는 튐을 잡느라 계속 손대게 된다. 이 라이브러리가 정확히 그것만 한다.
 *
 * 투명 배경: backgroundColor 를 주지 않으면 캔버스가 비어 있는 채로 시작해
 * 그대로 투명 PNG 가 된다 — 별도 처리가 필요 없다.
 */
import SignaturePad from 'signature_pad';
import type { SignTab } from './sign-tab';

/** 캔버스 표시 크기(CSS px) — 실제 픽셀은 devicePixelRatio 배 */
const PAD_H = 260;

export function createDrawTab(onChange: () => void): SignTab {
  const el = document.createElement('div');
  el.className = 'sgn-panel sgn-draw';

  const stage = document.createElement('div');
  stage.className = 'sgn-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'sgn-canvas';
  const hint = document.createElement('div');
  hint.className = 'sgn-placeholder';
  hint.textContent = '마우스나 손가락으로 서명해 주세요';
  stage.append(canvas, hint);
  el.appendChild(stage);

  let pad: SignaturePad | null = null;

  const syncHint = () => { hint.hidden = !(pad?.isEmpty() ?? true); };

  /**
   * ⚠ 캔버스 크기는 **화면에 붙은 뒤에만** 잴 수 있다(대화상자는 show() 때 body 에 붙는다).
   *   붙기 전에 재면 0 이 나오고 그은 선이 전부 좌표 밖으로 나간다.
   *   그리고 크기를 바꾸면 캔버스 내용이 지워지므로 이미 그린 서명은 다시 찍어 준다.
   */
  const resize = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = stage.clientWidth || 560;
    const next = [Math.round(w * ratio), Math.round(PAD_H * ratio)];
    if (canvas.width === next[0] && canvas.height === next[1]) return;
    const keep = pad && !pad.isEmpty() ? pad.toData() : null;
    canvas.width = next[0];
    canvas.height = next[1];
    canvas.getContext('2d')!.scale(ratio, ratio);
    if (!pad) {
      pad = new SignaturePad(canvas, {
        // 천천히 = 굵게, 빠르게 = 가늘게. 기본값(0.5~2.5)은 문서에 넣으면 너무 얇다.
        minWidth: 1.2,
        maxWidth: 4.2,
        velocityFilterWeight: 0.7,
        penColor: '#1a1a1a',
      });
      pad.addEventListener('endStroke', () => { syncHint(); onChange(); });
      pad.addEventListener('beginStroke', () => { hint.hidden = true; });
    } else {
      pad.clear();
      if (keep) pad.fromData(keep);
    }
    syncHint();
  };

  return {
    el,
    canvas,
    label: '직접',
    sub: '손으로 쓰듯 그립니다',
    foot: '펜을 천천히 움직이면 선이 굵어지고, 빠르게 움직이면 가늘어집니다.',
    resetLabel: '다시 그리기',
    isEmpty: () => pad?.isEmpty() ?? true,
    clear: () => { pad?.clear(); syncHint(); onChange(); },
    onShow: () => { resize(); syncHint(); },
  };
}
