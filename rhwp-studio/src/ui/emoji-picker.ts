/**
 * 이모지 넣기 — `emoji-picker-element`(Apache-2.0) 웹 컴포넌트를 띄우고,
 * 고른 이모지를 커서 자리에 넣는다(문자표와 **같은 삽입 경로** = 되돌리기 1회).
 *
 * ⚠ 데이터는 CDN 이 아니라 `public/emoji/ko.json` 에서 읽는다.
 *   기본값은 jsDelivr 를 치는데, 센터 망에서 외부 요청이 막히면 피커가 빈 채로 뜨고
 *   PWA 오프라인도 깨진다. 한국어 주석(활짝 웃는 얼굴)·태그(미소·웃음·행복)가 들어 있어야
 *   "웃음"으로 검색이 된다 — 영어 데이터로는 한국어 검색이 안 된다.
 *
 * ⚠ 이모지는 조판에서 **전각(1em)** 으로 잡힌다(엔진 fallback_char_width). 연속 이모지가
 *   겹치고 뒤 글자가 사라지던 결함은 2026-07-31 수리 — 잠금은 rhwp
 *   tests/officex_emoji_caret.rs. 여기서 여러 개를 연달아 넣어도 안전하다.
 */
import 'emoji-picker-element';
import { InsertTextCommand } from '@/engine/command';
import type { CommandServices } from '@/command/types';

/** 벤더링한 한국어 데이터(빌드 시 public/ 그대로 복사됨) */
const DATA_SOURCE = 'emoji/ko.json';

interface EmojiClickDetail {
  unicode?: string;
  emoji?: { unicode?: string };
}

export class EmojiPicker {
  private wrap: HTMLDivElement | null = null;
  private onDocDown: ((e: MouseEvent) => void) | null = null;

  constructor(private services: CommandServices) {}

  isOpen(): boolean {
    return this.wrap !== null;
  }

  toggle(anchor?: HTMLElement | null): void {
    if (this.wrap) this.hide();
    else this.show(anchor);
  }

  show(anchor?: HTMLElement | null): void {
    if (this.wrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'emoji-pop';

    const picker = document.createElement('emoji-picker');
    picker.setAttribute('locale', 'ko');
    // 상대 경로 — /rhwp-studio/ 하위 배포에서도 맞다(절대경로는 404, 2026-07-29 실사고와 같은 함정).
    picker.setAttribute('data-source', new URL(DATA_SOURCE, document.baseURI).href);
    picker.addEventListener('emoji-click', (e) => {
      // 라이브러리가 자체 EmojiClickEvent 타입을 내보내지만 필요한 건 detail 뿐이다.
      const d = (e as unknown as { detail?: EmojiClickDetail }).detail;
      const ch = d?.unicode ?? d?.emoji?.unicode;
      if (ch) this.insert(ch);
    });
    wrap.appendChild(picker);

    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.place(anchor);

    // 바깥을 누르면 닫는다. 피커 안쪽 클릭은 통과시킨다.
    this.onDocDown = (e: MouseEvent) => {
      if (!this.wrap) return;
      if (this.wrap.contains(e.target as Node)) return;
      if (anchor && anchor.contains(e.target as Node)) return;
      this.hide();
    };
    document.addEventListener('mousedown', this.onDocDown, true);
  }

  hide(): void {
    if (this.onDocDown) document.removeEventListener('mousedown', this.onDocDown, true);
    this.onDocDown = null;
    this.wrap?.remove();
    this.wrap = null;
  }

  /** 고른 이모지를 커서 자리에 — 문자표와 같은 명령이라 되돌리기가 그대로 따라온다. */
  private insert(ch: string): void {
    const ih = this.services.getInputHandler();
    if (!ih) return;
    const pos = ih.getCursorPosition();
    ih.executeOperation({ kind: 'command', command: new InsertTextCommand(pos, ch) });
    this.services.eventBus.emit('document-changed');
    // 계속 고를 수 있게 피커는 열어 두되, 후속 타이핑을 위해 포커스는 편집기로 돌린다.
    ih.focus();
  }

  /** 누른 버튼 아래에 붙인다 — 화면 밖으로 나가면 안쪽으로 당긴다. */
  private place(anchor?: HTMLElement | null): void {
    if (!this.wrap) return;
    const W = 340;
    const H = 420;
    const r = anchor?.getBoundingClientRect();
    const left = r
      ? Math.min(Math.max(8, r.left), window.innerWidth - W - 8)
      : Math.round((window.innerWidth - W) / 2);
    const top = r
      ? Math.min(r.bottom + 6, window.innerHeight - H - 8)
      : Math.round((window.innerHeight - H) / 2);
    this.wrap.style.cssText = `position:fixed;left:${left}px;top:${Math.max(8, top)}px;z-index:2000;`;
  }
}
