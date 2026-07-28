import { enableDialogDrag } from './dialog-drag';

/**
 * 모달 다이얼로그 베이스 클래스 (WebGian dialog_wrap 패턴)
 *
 * DOM은 show() 호출 시 생성된다 (ES2022 class field 초기화 순서 이슈 방지).
 */
export abstract class ModalDialog {
  afterClose?: () => void;

  protected overlay!: HTMLDivElement;
  protected dialog!: HTMLDivElement;
  private title: string;
  private width: number;
  private closeOnOverlayClick: boolean;
  private built = false;
  private captureHandler: ((e: KeyboardEvent) => void) | null = null;

  /** 타이틀바 아이콘 (Phosphor 이름, 예: 'table') — 하위 클래스가 설정 */
  protected titleIcon: string | null = null;
  /** 선택 대상 표기 (예: '표 블록 · 3×3 · B2') */
  protected titleSubject: string | null = null;

  constructor(title: string, width: number, closeOnOverlayClick = false) {
    this.title = title;
    this.width = width;
    this.closeOnOverlayClick = closeOnOverlayClick;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-wrap';
    this.dialog.style.width = `${this.width}px`;

    // 타이틀 바
    // [모달 셸 재설계 2026-07-29] 파란 타이틀바 → 흰 타이틀바 + 아이콘 타일 + 선택 대상.
    const titleBar = document.createElement('div');
    titleBar.className = 'dialog-title';
    if (this.titleIcon) {
      const tile = document.createElement('i');
      tile.className = `ph-duotone ph-${this.titleIcon}`;
      titleBar.appendChild(tile);
    }
    const titleText = document.createElement('span');
    titleText.textContent = this.title;
    titleBar.appendChild(titleText);
    if (this.titleSubject) {
      const sub = document.createElement('span');
      sub.className = 'dialog-subject';
      sub.textContent = this.titleSubject;
      titleBar.appendChild(sub);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialog-close';
    closeBtn.innerHTML = '<i class="ph ph-x"></i>';
    closeBtn.addEventListener('click', () => this.hide());
    titleBar.appendChild(closeBtn);

    this.dialog.appendChild(titleBar);

    // 본문
    const body = this.createBody();
    body.classList.add('dialog-body');
    this.dialog.appendChild(body);

    // 하단 버튼
    const footer = document.createElement('div');
    footer.className = 'dialog-footer';

    // 키보드 힌트 — 사용자가 버튼 순서를 학습하지 않아도 되게(디자인 3a)
    const hint = document.createElement('span');
    hint.className = 'dialog-keyhint';
    hint.textContent = 'Enter 확인 · Esc 취소';
    footer.appendChild(hint);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dialog-btn dialog-btn-primary';
    confirmBtn.textContent = '확인';
    confirmBtn.addEventListener('click', () => {
      const shouldClose = this.onConfirm();
      if (shouldClose !== false) this.hide();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn';
    cancelBtn.textContent = '취소';
    cancelBtn.addEventListener('click', () => this.hide());

    footer.appendChild(confirmBtn);
    footer.appendChild(cancelBtn);
    this.dialog.appendChild(footer);

    this.overlay.appendChild(this.dialog);

    // 모달은 기본적으로 명시적 버튼/Escape로만 닫는다.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && this.closeOnOverlayClick) this.hide();
    });

    enableDialogDrag(this.dialog, titleBar);
  }

  show(): void {
    this.build();
    document.body.appendChild(this.overlay);

    // document capture 단계에서 키 이벤트를 가로채 편집 영역 도달 차단
    // input/textarea 내부의 일반 타이핑은 허용한다.
    this.captureHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement;

      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        this.hide();
        return;
      }
      if (e.key === 'Enter' && !isEditable) {
        e.stopPropagation();
        e.preventDefault();
        const btn = this.dialog.querySelector('.dialog-btn-primary') as HTMLButtonElement | null;
        btn?.click();
        return;
      }
      // 편집 가능한 요소 내부 → 키 입력 허용, 외부 전파만 차단
      e.stopPropagation();
      if (!isEditable) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this.captureHandler, true);

    // 확인 버튼에 포커스 → 시각적 피드백 + 접근성
    const btn = this.dialog.querySelector('.dialog-btn-primary') as HTMLButtonElement | null;
    btn?.focus();
  }

  hide(): void {
    if (this.captureHandler) {
      document.removeEventListener('keydown', this.captureHandler, true);
      this.captureHandler = null;
    }
    this.overlay?.remove();
    this.afterClose?.();
  }

  /** 서브클래스에서 본문 DOM을 생성 */
  protected abstract createBody(): HTMLElement;

  /** 서브클래스에서 확인 버튼 동작 구현. false 반환 시 대화상자 유지 */
  protected abstract onConfirm(): void | boolean;
}
