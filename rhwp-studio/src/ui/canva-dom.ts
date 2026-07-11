/**
 * [캔버스 한컴 포크] 캔바 UI 공용 DOM 헬퍼 — 중복 2회 룰 추출(2026-07-12)
 * 실제로 2회 이상 등장하는 생성 패턴만 담는다 (사변적 API 금지):
 *  - mkEl:             createElement + className + textContent
 *                      (팔레트·인스펙터·AI 패널·사이드바의 pane/label/hint/row 류)
 *  - mkButton:         type="button" 버튼 + 클래스/텍스트/아이콘HTML/title
 *                      (팔레트 카드·인스펙터 아이콘 버튼·AI 액션·사이드바 탭/토글)
 *  - mkDialogBtn:      다이얼로그 푸터 버튼 .dialog-btn(-primary)
 *                      (AI 수정 대화상자 mkBtn · 셀 지우기 대화상자 mk 통합)
 *  - buildDialogShell: .modal-overlay > .dialog-wrap > .dialog-title(+.dialog-close ×)
 *                      + .dialog-body + .dialog-footer 뼈대 (두 대화상자 공통)
 * ⚠ 동작 불변 원칙: 클래스명·DOM 구조·이벤트 등록 방식을 기존 사용처와 동일하게 유지.
 */

/** 요소 생성 + 클래스/텍스트. className이 빈 값이면 class 속성을 만들지 않는다(원본 DOM 유지). */
export function mkEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export interface MkButtonOpts {
  text?: string;
  /** 인라인 SVG 등 마크업 라벨 — text와 동시 지정 금지(마지막 지정이 덮음) */
  html?: string;
  title?: string;
}

/** type="button" 버튼 생성. className '' 허용(모드 토글·스테퍼처럼 클래스 없는 버튼). */
export function mkButton(className: string, opts: MkButtonOpts = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  if (opts.title !== undefined) b.title = opts.title;
  if (opts.text !== undefined) b.textContent = opts.text;
  if (opts.html !== undefined) b.innerHTML = opts.html;
  return b;
}

/**
 * 다이얼로그 푸터 버튼 (.dialog-btn / .dialog-btn-primary).
 * 기존 두 대화상자 모두 type 미지정(브라우저 기본)이었으므로 type을 건드리지 않는다 — 동작 불변.
 */
export function mkDialogBtn(label: string, primary: boolean, onClick?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = primary ? 'dialog-btn dialog-btn-primary' : 'dialog-btn';
  b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export interface DialogShell {
  overlay: HTMLDivElement;
  dialog: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  closeBtn: HTMLButtonElement;
}

/**
 * 대화상자 뼈대 조립: .modal-overlay > .dialog-wrap(width) >
 * [.dialog-title(제목+.dialog-close ×) · .dialog-body · .dialog-footer].
 * body 내용/스타일·푸터 버튼은 호출자가 채우고, document.body 부착도 호출자 책임
 * (키보드 핸들러 등록 순서 등 기존 흐름을 그대로 두기 위함).
 */
export function buildDialogShell(title: string, width: string, onClose: () => void): DialogShell {
  const overlay = mkEl('div', 'modal-overlay');
  const dialog = mkEl('div', 'dialog-wrap');
  dialog.style.width = width;

  const titleBar = mkEl('div', 'dialog-title', title);
  // 닫기 버튼: 기존 구현과 동일하게 type 미지정 — mkButton을 쓰지 않는 이유
  const closeBtn = mkEl('button', 'dialog-close', '×');
  closeBtn.addEventListener('click', onClose);
  titleBar.appendChild(closeBtn);

  const body = mkEl('div', 'dialog-body');
  const footer = mkEl('div', 'dialog-footer');

  dialog.append(titleBar, body, footer);
  overlay.appendChild(dialog);
  return { overlay, dialog, body, footer, closeBtn };
}
