/**
 * [캔버스 한컴 포크] 우측 캔바식 속성 인스펙터.
 * 선택 컨텍스트(본문·표 셀·표 개체·그림)를 배너로 보여주고, 글자 서식을 편집한다.
 * 원칙: 새 엔진 로직 없음 — 적용은 기존 커맨드 dispatch / format-char emit,
 *       상태 반영은 Toolbar와 같은 cursor-format-changed·cursor-para-changed 미러.
 */
import type { CanvaServices } from './canva-services';
import type { CharProperties, ParaProperties } from '@/core/types';
import { TableBorderSection } from './table-border-section';
import { TablePanelSections } from './table-panel-sections';
import { TextPanelSections, TEXT_SECTIONS } from './text-panel-sections';
import { buildTextTab } from './text-panel-chrome';
import { mkEl, mkButton } from './canva-dom';
import { FormatSpecimen } from './format-specimen';
import { currentTextRuns, describeBodySelection, detectMixedFormat, scanFormatRuns, selectRun } from './selection-summary';
import { buildFixParts, type LintItemLike } from './fix-preview';
import { proofreadParagraph } from './para-proofread';
import { openWordPop } from './word-pop';
import { canPolish, currentDocKind } from './sentence-polish';
import { applyPolishResult } from './change-review';
import { openPolishPop } from './polish-pop';
import { openTablePanel } from './canva-sidebars';
import { insertFormatted } from './ai-doc-insert';
import { TemplatePickerModal } from './template-picker-modal';
import { openTemplateEditBar, closeTemplateEditBar } from './template-edit-bar';
import { extractDocBody, saveTemplate, deleteTemplate, createTemplateId } from '@/media/template-store';
import { showToast } from './toast';
import { buildStylePanel } from './style-panel';
// 글자 탭 확장 섹션 — 각 기능이 파일 하나씩(ui/char-sections/)
import type { CharSectionDeps } from './char-sections/types';
import { buildSameFormatSection } from './char-sections/same-format';
import { buildFormObjectPanel } from './form-object-panel';
import { buildEmphasisSection } from './char-sections/emphasis-dot';
import { buildLineDecorSection } from './char-sections/line-decor';
import { buildCharShadeSection } from './char-sections/char-shade';
import { buildRelativeSizeSection } from './char-sections/relative-size';

type Ctx = 'none' | 'body' | 'cell' | 'table' | 'picture' | 'form';
export type PanelTab = 'props' | 'text' | 'table' | 'cell' | 'style';

/** 각 탭의 섹션 목차 (디자인 2c 갱신 2026-07-30 — 텍스트 탭 신설) */
const SECTIONS: Record<'text' | 'table' | 'cell', Array<[string, string]>> = {
  text: TEXT_SECTIONS,
  table: [['위치', 'crosshair-simple'], ['크기', 'arrows-out-cardinal'], ['여백', 'square-half'],
          ['쪽 넘김', 'files'], ['테두리·배경', 'square'], ['캡션', 'subtitles']],
  cell: [['크기', 'arrows-out-cardinal'], ['여백', 'square-half'], ['정렬', 'align-center-vertical'],
         ['속성', 'sliders-horizontal'], ['테두리·배경', 'square'], ['필드', 'textbox']],
};
const ALIGN_ICONS: Record<string, string> = {
  left: '<path d="M3 5h18M3 10h12M3 15h18M3 20h12"/>',
  center: '<path d="M3 5h18M6 10h12M3 15h18M6 20h12"/>',
  right: '<path d="M3 5h18M9 10h12M3 15h18M9 20h12"/>',
  justify: '<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/>',
};
// [캔버스 한컴 포크] 다중 선택 개체 정렬 아이콘 (개체를 기준선에 붙이는 형상)
const OBJ_ALIGN: { cmd: string; title: string; icon: string }[] = [
  { cmd: 'object:align-left', title: '왼쪽 정렬', icon: '<path d="M4 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="7" y="14" width="6" height="4"/>' },
  { cmd: 'object:align-hcenter', title: '가로 가운데', icon: '<path d="M12 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="9" y="14" width="6" height="4"/>' },
  { cmd: 'object:align-right', title: '오른쪽 정렬', icon: '<path d="M20 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="11" y="14" width="6" height="4"/>' },
  { cmd: 'object:align-top', title: '위쪽 정렬', icon: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="7" width="4" height="6"/>' },
  { cmd: 'object:align-vcenter', title: '세로 가운데', icon: '<path d="M3 12h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="9" width="4" height="6"/>' },
  { cmd: 'object:align-bottom', title: '아래쪽 정렬', icon: '<path d="M3 20h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="11" width="4" height="6"/>' },
  { cmd: 'object:distribute-h', title: '가로 간격 분배', icon: '<rect x="3" y="7" width="3" height="10"/><rect x="10.5" y="7" width="3" height="10"/><rect x="18" y="7" width="3" height="10"/>' },
  { cmd: 'object:distribute-v', title: '세로 간격 분배', icon: '<rect x="7" y="3" width="10" height="3"/><rect x="7" y="10.5" width="10" height="3"/><rect x="7" y="18" width="10" height="3"/>' },
];
const COLORS = ['#000000', '#dc3545', '#f59e0b', '#16a34a', '#256ef4', '#7c3aed', '#6b7280', '#ffffff'];

/** 텍스트 스타일 프리셋 — pt 는 HWP 단위(pt×100), level 은 개요 번호 수준(없으면 번호 해제 안 함) */
interface TextStyle {
  id: string;
  label: string;
  hint: string;
  pt: number;
  bold: boolean;
  /** undefined = 번호 상태를 건드리지 않음, -1 = 번호 해제, 0~6 = 그 수준의 개요 번호 */
  level?: number;
}
const TEXT_STYLES: TextStyle[] = [
  { id: 'h1', label: '제목 추가', hint: '제목 1 — 20pt 굵게', pt: 20, bold: true },
  { id: 'h2', label: '부제목 추가', hint: '제목 2 — 15pt 굵게', pt: 15, bold: true },
  // 2열로 바뀌며 카드가 좁아졌다 — 「약간의 본문 텍스트 추가」는 잘려서 뜻이 사라졌다
  { id: 'body', label: '본문', hint: '본문 — 10pt', pt: 10, bold: false },
  { id: 'num1', label: '1. 번호 제목', hint: '개요 번호 1수준 — 13pt 굵게', pt: 13, bold: true, level: 0 },
  { id: 'num2', label: '가. 번호', hint: '개요 번호 2수준 — 10pt', pt: 10, bold: false, level: 1 },
];

function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export class CanvaRightInspector {
  private ctx: Ctx = 'none';
  private panelTab: PanelTab = 'props';
  private painted = false;
  /** [캔버스 한컴 포크] 그림 컨텍스트 내 다중 선택 여부 — 단일↔다중 전환 시 정렬 섹션 재렌더 */
  private lastMulti = false;
  /** 표/셀 컨텍스트에서 지금 보고 있는 셀 — 이게 바뀌면 패널을 다시 그린다 */
  private lastCellKey = '';

  private banner!: HTMLElement;
  /** lint 오버레이가 밀어 주는 검사 결과 — 「수정본」 줄의 재료 */
  private lintItems: LintItemLike[] = [];
  /**
   * 마지막으로 사전 검사를 돌린 문단(구역:문단:본문).
   * ⚠ 커서만 움직여도 cursor-format-changed 가 온다. 그때마다 사전을 돌리면
   *   어절마다 hunspell 조회 + 복합명사 분해라 클릭할 때마다 패널이 멎는다
   *   (사용자 신고 2026-08-01). 문단 내용이 그대로면 결과도 그대로다 — 다시 안 돈다.
   */
  private lastProofKey = '';
  /** 「지금 서식」 견본(디자인 3a) — 본문은 format-specimen.ts */
  private specimen = new FormatSpecimen();
  private fmtPane!: HTMLElement;
  private emptyEl!: HTMLElement;
  private extrasHost!: HTMLElement;
  private tabPane!: HTMLElement;
  /** 테두리·배경 섹션만 2c 전용 UI */
  private borderSection = new TableBorderSection();
  /** 나머지 섹션의 2c UI */
  private panelSections = new TablePanelSections();
  /** 텍스트(문단 모양) 탭 */
  private textSections = new TextPanelSections();
  /** 표·셀 탭에서 지금 보고 있는 섹션 */
  private curSection: Record<'text' | 'table' | 'cell', string> = { text: '자주', table: '위치', cell: '크기' };
  private biu: Record<'bold' | 'italic' | 'underline' | 'strike', HTMLButtonElement> = {} as any;
  private fontNameBtn!: HTMLButtonElement;
  private lineSpacingBtn!: HTMLButtonElement;
  private aligns: Record<string, HTMLButtonElement> = {};
  private sizeInput!: HTMLInputElement;
  private swatches: HTMLButtonElement[] = [];

  constructor(private root: HTMLElement, private services: CanvaServices) {
    this.render();
    this.wire();
    this.refreshContext();
  }

  private render(): void {
    const pane = mkEl('div', 'canva-pane');

    this.banner = mkEl('div', 'canva-context-banner');
    pane.appendChild(this.banner);

    // 빈 상태 (문서 없음)
    this.emptyEl = mkEl('div', 'canva-ins-empty', '문서를 열면 선택한 개체의 속성이 여기 표시됩니다.');
    this.emptyEl.hidden = true;
    pane.appendChild(this.emptyEl);

    // 글자 서식
    this.fmtPane = mkEl('div', 'canva-pane');

    // [지금 서식 견본 2026-07-30 디자인 3a] 상태 이름만 적힌 배너 대신 현재 서식이
    // 그대로 적용된 예문을 맨 위에 둔다 — 아래 컨트롤을 만지면 즉시 따라온다.
    this.specimen.mount(this.fmtPane);

    // [텍스트 스타일 프리셋 2026-07-30] 캔바식 '제목 추가' 카드 — 누르면 현재 문단
    // 전체에 크기·굵기(·번호)를 한 번에 입힌다. 카드 자체가 그 스타일로 그려져
    // 결과를 미리 보여준다.
    const styleSec = this.section('텍스트 스타일');
    const styles = mkEl('div', 'canva-styles');
    for (const t of TEXT_STYLES) {
      const b = mkButton(`canva-style-card canva-style--${t.id}`, { title: t.hint });
      b.textContent = t.label;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.applyTextStyle(t); });
      styles.appendChild(b);
    }
    styleSec.appendChild(styles);

    // [2026-08-03 사용자 지시] 글자 탭의 「스타일 설정…」 제거 — 같은 진입점이 스타일 탭
    // 하단과 홈 리본에 이미 있어 세 겹이었다. 여기 프리셋 카드는 "빠른 적용"만 맡는다.

    this.fmtPane.appendChild(styleSec);

    // [문단 템플릿 2026-08-02] 캔바식 '시작 골격' — 누르면 모달 그리드가 열리고, 고른 카드가
    // 커서 자리에 제목+번호목록 등 서식된 문단을 통째로 넣는다. 삽입은 기존
    // insertFormatted(ai-doc-insert) 재사용: 분류·좌표 변환·단일 undo 가 이미 처리돼 있다.
    const tplSec = this.section('문단 템플릿');
    const tplBtn = mkButton('canva-full-btn', {
      html: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/>') + '<span>문단 템플릿…</span>',
    });
    tplBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const modal = new TemplatePickerModal({
        onPick: (t) => this.applyTemplate(t.body),
        // 수정: 새 문서에 body 를 채우고 「템플릿 편집 모드」 바를 띄운다 — 이름·저장
        //   (같은 id 덮어쓰기)·삭제·닫기를 문서 위에서 바로. 저장이 딴 데로 새던 문제 해결.
        onEdit: (t) => {
          // 새 문서 준비가 끝난 뒤 내용을 채우고 편집 바를 띄운다(경합 방지 — create-new
          //   는 async·저장가드 포함). 가드를 취소하면 onReady 가 안 불려 아무 일도 없다.
          this.services.eventBus.emit('create-new-document', {
            onReady: () => {
              this.applyTemplate(t.body);
              openTemplateEditBar({
                label: t.label,
                onSave: (name) => {
                  const body = extractDocBody(this.services.wasm);
                  if (!body.trim()) { showToast({ message: '저장할 본문이 없습니다.', durationMs: 2200 }); return; }
                  void saveTemplate({ id: t.id, label: name || t.label, body, addedAt: Date.now() });
                  showToast({ message: `템플릿 '${name || t.label}' 저장됨`, durationMs: 2200 });
                },
                onDelete: () => {
                  void deleteTemplate(t.id);
                  closeTemplateEditBar();
                  showToast({ message: '템플릿을 삭제했습니다.', durationMs: 2200 });
                },
              });
            },
          });
        },
        onSaveCurrent: async (name) => {
          const body = extractDocBody(this.services.wasm);
          if (!body.trim()) {
            showToast({ message: '저장할 본문이 없습니다.', durationMs: 2200 });
            return;
          }
          await saveTemplate({ id: createTemplateId(), label: name || '내 템플릿', body, addedAt: Date.now() });
          showToast({ message: '현재 문서를 템플릿으로 저장했습니다.', durationMs: 2200 });
          modal.refresh();
        },
        onDelete: (id) => deleteTemplate(id),
      });
      modal.show();
    });
    tplSec.appendChild(tplBtn);
    this.fmtPane.appendChild(tplSec);

    // ⚠ 「글자」(B·I·U·취소선·글꼴·크기)·「글자색」·「형광펜」 섹션은 **뺐다**
    //   (사용자 요청 2026-08-01 "없어도 될 거 같아"). 리본 홈 탭에 같은 것이 전부 있다.
    // ⚠ 「글자 모양 자세히」·「문단 모양 자세히」 버튼도 **뺐다**(사용자 요청 2026-08-01)
    //   — 스타일 설정으로 대체. 남는 것: 지금 서식 견본 · 텍스트 스타일(+스타일 설정) · 도구.
    //   상태 반영(reflectChar)은 이 요소들이 없어도 되게 옵셔널로 두었다.

    // [글자 탭 확장 2026-08-03] 리본에 **없는** 글자 서식들을 여기 모은다 — 패널은
    // "고른 것을 자세히 손보는 자리"다(리본과 겹치면 오늘 「스타일 설정」처럼 지우게 된다).
    // 각 기능은 ui/char-sections/ 안에 파일 하나씩 산다. 적용은 전부 아래 applyChar 한 경로.
    {
      // 이 묶음을 다시 그리면 옛 섹션의 구독은 버린다(안 버리면 죽은 DOM 을 계속 칠한다).
      this.charSectionWatchers = [];
      const charDeps: CharSectionDeps = {
        services: this.services,
        section: (label, link) => {
          const sec = this.section(label, link);
          this.fmtPane.appendChild(sec);
          return sec;
        },
        charProps: this.lastCharProps ?? null,
        getCharProps: () => this.lastCharProps ?? null,
        onCharChange: (fn) => { this.charSectionWatchers.push(fn); },
        applyChar: (patch) => this.services.eventBus.emit('format-char', patch),
        redraw: () => this.applyContext(),
      };
      buildSameFormatSection(this.fmtPane, charDeps);
      buildEmphasisSection(this.fmtPane, charDeps);
      buildLineDecorSection(this.fmtPane, charDeps);
      buildCharShadeSection(this.fmtPane, charDeps);
      buildRelativeSizeSection(this.fmtPane, charDeps);
    }

    // [디자인 2c] AI·녹음은 탭에서 빠졌다 → 속성 탭 하단이 그 진입점이다.
    // (탭만 없애고 진입점을 안 만들어 AI 패널이 열리지 않던 상태를 여기서 메운다.)
    const toolSec = this.section('도구');
    const toolRow = mkEl('div', 'canva-chip-row');
    for (const [label, icon, ev] of [
      ['AI 도우미', 'sparkle', 'ai-panel-open'],
      ['녹음·받아쓰기', 'microphone', 'record-panel-open'],
    ] as const) {
      const b = mkButton('canva-chip', { title: label });
      b.innerHTML = `<i class="ph-duotone ph-${icon}"></i><span>${label}</span>`;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.services.eventBus.emit(ev); });
      toolRow.appendChild(b);
    }
    toolSec.appendChild(toolRow);
    this.fmtPane.appendChild(toolSec);

    // 컨텍스트 추가(표/그림) 영역
    this.extrasHost = mkEl('div', 'canva-pane');
    this.fmtPane.appendChild(this.extrasHost);

    // [디자인 2c 갱신] 표·셀 탭 전용 영역 — fmtPane 을 숨겨도 살아 있어야 하므로 형제로 둔다
    this.tabPane = mkEl('div', 'canva-pane');
    this.tabPane.hidden = true;
    pane.appendChild(this.tabPane);

    pane.appendChild(this.fmtPane);
    this.root.appendChild(pane);
  }

  /** 섹션 머리 — 디자인 2c 는 부차 동작을 제목 오른쪽 작은 링크로 둔다(전체폭 버튼 아님) */
  private section(label: string, link?: { text: string; onClick: () => void }): HTMLElement {
    const sec = mkEl('div', 'canva-ins-section');
    const head = mkEl('div', 'canva-section-head');
    head.appendChild(mkEl('span', 'canva-section-label', label));
    if (link) {
      const a = mkButton('canva-section-link', { text: link.text });
      a.addEventListener('mousedown', (e) => { e.preventDefault(); link.onClick(); });
      head.appendChild(a);
    }
    sec.appendChild(head);
    return sec;
  }

  private wire(): void {
    // ⚠ 조작 칩(canva-chip)은 dataset.cmd 만 심는다 — 디스패치는 여기 위임 한 곳.
    // (칩마다 리스너를 달다 빠뜨려 '눌러도 무동작' 이던 실결함의 재발 방지. 2026-07-30 실측:
    // 줄 지우기·셀 합치기·블록 계산 칩 전부가 리스너 없이 그려지고 있었다.)
    this.root.addEventListener('mousedown', (e) => {
      const chip = (e.target as HTMLElement)?.closest('.canva-chip[data-cmd]') as HTMLElement | null;
      if (!chip) return;
      e.preventDefault();
      if (chip.dataset.cmd) this.services.dispatcher.dispatch(chip.dataset.cmd, { anchorEl: chip });
    });
    const bus = this.services.eventBus;
    bus.on('lint:items', (items) => {
      this.lintItems = items as LintItemLike[];
      const ihc = (this.services.getInputHandler() as any)?.cursor;
      if (ihc) this.paintCorrections(ihc);
    });
    bus.on('cursor-format-changed', (p) => this.reflectChar(p as CharProperties));
    bus.on('cursor-para-changed', (p) => this.reflectPara(p as ParaProperties));
    bus.on('cursor-cell-changed', () => this.refreshContext());
    bus.on('cursor-rect-updated', () => this.refreshContext());
    bus.on('table-object-selection-changed', () => this.refreshContext());
    bus.on('picture-object-selection-changed', () => this.refreshContext());
    bus.on('form-object-selection-changed', () => this.refreshContext());
    bus.on('document-changed', () => this.refreshContext());
    // 새 문서 생성/로드 완료는 command-state-changed로 온다 (initializeDocument)
    bus.on('command-state-changed', () => this.refreshContext());
  }

  /** 마지막으로 받은 커서 글자 속성 — char-sections 가 "지금 값"을 보여줄 때 쓴다 */
  private lastCharProps: CharProperties | null = null;

  /** char-sections 가 걸어 둔 "커서 서식 바뀜" 구독 — 패널을 다시 그릴 때 통째로 버린다 */
  private charSectionWatchers: Array<(p: CharProperties) => void> = [];

  private reflectChar(p: CharProperties): void {
    this.lastCharProps = p;
    for (const fn of this.charSectionWatchers) {
      try { fn(p); } catch { /* 표시용 — 한 섹션이 죽어도 나머지는 칠한다 */ }
    }
    this.specimen.reflectChar(p);
    const ih = this.services.getInputHandler() as any;
    const ihc = ih?.cursor;
    if (ihc) {
      this.specimen.setMixed(detectMixedFormat(ihc, this.services.wasm as never));
      const { runs, truncated } = scanFormatRuns(ihc, this.services.wasm as never);
      this.specimen.setRuns(runs, truncated);
      this.specimen.onPickRun = (r) => selectRun(ih, ihc, r);
      // 견본을 예문이 아니라 지금 문단의 실제 글자로 채운다(사용자 제안 2026-07-31).
      const live = currentTextRuns(ihc, this.services.wasm as never);
      this.specimen.setContent(live.runs, live.truncated);
      // 「수정본」 — 지금 문단을 맞춤법대로 고치면 어떻게 되는지(사용자 요청 2026-07-31)
      this.paintCorrections(ihc);
      // 「확인할 낱말」 — 사전이 모르는 말을 **이 문단에서만**(사용자 결정 2026-07-31)
      this.paintWordChecks(ihc);
      // [문장 다듬기] — 아동 기록에서는 버튼 자체를 만들지 않는다
      this.paintPolish(ihc);
    }
    this.biu.bold?.classList.toggle('is-active', !!p.bold);
    this.biu.italic?.classList.toggle('is-active', !!p.italic);
    this.biu.underline?.classList.toggle('is-active', !!p.underline);
    this.biu.strike?.classList.toggle('is-active', !!p.strikethrough);
    if (p.fontSize !== undefined && this.sizeInput) this.sizeInput.value = String(p.fontSize / 100);
    const fam = (p as any).fontFamily ?? (p as any).fontFamilies?.[0];
    if (fam && this.fontNameBtn) {
      const sp = this.fontNameBtn.querySelector('span');
      if (sp) sp.textContent = String(fam);
    }
    if (p.textColor) {
      const hex = p.textColor.toLowerCase();
      this.swatches.forEach((s) => s.classList.toggle('is-active', (s.style.background || '').length > 0 && rgbToHex(s.style.background) === hex));
    }
  }

  /**
   * 커서 문단의 맞춤법 고침을 「수정본」 줄로 그린다.
   * 검사 결과는 lint 오버레이가 밀어 준다(bus 'lint:items') — 인스펙터가 검사기를
   * 직접 알지 않게 해서, 규칙이 늘어도 이 파일은 그대로다.
   */
  private paintCorrections(ihc: any): void {
    const pos = ihc.getPosition?.();
    if (!pos || pos.parentParaIndex !== undefined) { this.specimen.setCorrections([]); return; }
    this.specimen.setCorrections(
      buildFixParts(this.services.wasm as never, this.lintItems, pos.sectionIndex, pos.paragraphIndex));
    this.specimen.onFixAll = () => this.services.eventBus.emit('lint:fix-paragraph', pos);
  }

  /**
   * 커서 문단만 사전으로 확인해 낱말 칩을 그린다.
   * 문서 전체가 아닌 이유: 복합명사 때문에 공문 한 장에 78건이 떴다(실측).
   */
  private paintWordChecks(ihc: any): void {
    const pos = ihc.getPosition?.();
    if (!pos || pos.parentParaIndex !== undefined) {
      this.specimen.setWordChecks([]);
      this.lastProofKey = '';
      return;
    }
    const w = this.services.wasm as never;
    // 같은 문단·같은 내용이면 다시 돌지 않는다(커서 이동만으로 재검사 금지).
    const ww = this.services.wasm as any;
    let text = '';
    try {
      text = ww.getTextRange(pos.sectionIndex, pos.paragraphIndex, 0,
        ww.getParagraphLength(pos.sectionIndex, pos.paragraphIndex));
    } catch { /* 못 읽으면 아래에서 검사한다 */ }
    const key = `${pos.sectionIndex}:${pos.paragraphIndex}:${text}`;
    if (key === this.lastProofKey) return;
    this.lastProofKey = key;
    const found = proofreadParagraph(w, pos.sectionIndex, pos.paragraphIndex);
    this.specimen.setWordChecks(found.map((f) => f.word));
    this.specimen.onWordPick = (word, anchor) => {
      const hit = found.find((f) => f.word === word);
      if (!hit) return;
      openWordPop(word, anchor, (to) => {
        const ih = this.services.getInputHandler() as any;
        ih?.executeOperation({
          kind: 'snapshot',
          operationType: 'wordFix',
          operation: (wasm: any) => {
            wasm.replaceText(pos.sectionIndex, pos.paragraphIndex, hit.at, hit.len, to);
            return null;
          },
        });
        this.services.eventBus.emit('document-changed');
      });
    };
  }

  /**
   * [문장 다듬기] 배선. 문장이 외부로 나가는 유일한 경로라 두 겹으로 막는다:
   * 아동 기록이면 버튼을 안 만들고, 만들어도 **누를 때만** 호출한다.
   */
  private paintPolish(ihc: any): void {
    const pos = ihc.getPosition?.();
    const ok = pos && pos.parentParaIndex === undefined && canPolish(currentDocKind());
    this.specimen.setPolishAvailable(!!ok);
    if (!ok) return;
    this.specimen.onPolish = (anchor) => {
      const w = this.services.wasm as any;
      let text = '';
      try {
        text = w.getTextRange(pos.sectionIndex, pos.paragraphIndex, 0,
          w.getParagraphLength(pos.sectionIndex, pos.paragraphIndex));
      } catch { return; }
      void openPolishPop(text, anchor, (to) => {
        // [변경 검토] 이전(빨강)·새 글(초록)을 문서에서 비교 후 [진행]으로 확정 —
        // 검토 불가 조건의 즉시 교체 폴백까지 change-review 가 맡는다.
        applyPolishResult(this.services as never, pos, text, to,
          () => this.specimen.onPolish?.(anchor));
      });
    };
  }

  private reflectPara(p: ParaProperties): void {
    this.specimen.reflectPara(p);
    const a = p.alignment;
    for (const key of Object.keys(this.aligns)) this.aligns[key].classList.toggle('is-active', a === key);
    const ls = (p as any).lineSpacing;
    if (ls !== undefined && this.lineSpacingBtn) {
      const sp = this.lineSpacingBtn.querySelector('span');
      if (sp) sp.textContent = `${ls}%`;
    }
  }

  private refreshContext(): void {
    const ih = this.services.getInputHandler() as any;
    const hasDoc = this.services.wasm.pageCount > 0;
    let ctx: Ctx;
    if (!ih || !hasDoc) ctx = 'none';
    else if (ih.formObjectSelection) ctx = 'form';
    else if (ih.isInPictureObjectSelection?.()) ctx = 'picture';
    else if (ih.isInTableObjectSelection?.()) ctx = 'table';
    else if (ih.isInTable?.()) ctx = 'cell';
    else ctx = 'body';
    // [캔버스 한컴 포크] 그림 컨텍스트 안에서도 다중 선택 전환이면 다시 그린다(정렬 섹션 노출)
    const multi = ctx === 'picture' && !!ih.isMultiPictureSelection?.();
    // 양식 선택은 어느 개체냐가 곧 내용 — 개체가 바뀌면(또는 속성 갱신 신호면) 항상 다시 그린다
    if (ctx === 'form') {
      this.painted = true;
      this.ctx = ctx;
      this.lastMulti = multi;
      this.panelTab = 'props';
      this.applyContext();
      this.syncTabs();
      return;
    }
    // 셀에서 셀로 옮겨도 ctx 는 'cell' 그대로다 — 그러면 패널이 처음 물었던 셀 번호를
    // 계속 쓰게 되어, 셀 보호·제목 셀이 **엉뚱한 칸**에 걸린다(사용자 신고 2026-08-04).
    const cellKey = (ctx === 'cell' || ctx === 'table') ? cellIdentity(ih) : '';
    const cellMoved = cellKey !== this.lastCellKey;
    if (ctx === this.ctx && this.painted && multi === this.lastMulti && !cellMoved) {
      // 같은 컨텍스트·같은 셀 안의 커서 이동 — 위치 설명(쪽·문단·셀 주소)만 따라간다
      this.paintBanner();
      return;
    }
    this.painted = true;
    this.ctx = ctx;
    this.lastMulti = multi;
    this.lastCellKey = cellKey;
    // [컨텍스트 탭] 선택이 곧 탭이다 — 셀 클릭=셀, 표 개체=표, 그 외=서식 패널.
    // ctx 가 바뀔 때만 건드리므로, 표 안에서 사용자가 손으로 고른 탭은 유지된다.
    this.panelTab = ctx === 'table' ? 'table' : ctx === 'cell' ? 'cell' : 'props';
    this.applyContext();
    this.syncTabs();
  }

  /**
   * 사이드바 탭 스트립 갱신 — **보이는 탭 집합이 선택을 따라간다**(사용자 결정 2026-07-30):
   * 본문/그림 = [속성, 텍스트] · 표 안 = [속성, 텍스트, 표, 셀] · 선택 없음 = [속성].
   */
  onTabsState: ((tabs: PanelTab[], active: PanelTab) => void) | null = null;

  /** 사이드바가 콜백을 늦게 다는 부팅 순서 보정 — 현재 상태를 즉시 알린다 */
  pokeTabs(): void {
    this.syncTabs();
  }

  private visibleTabs(): PanelTab[] {
    if (this.ctx === 'none') return ['props'];
    if (this.ctx === 'cell' || this.ctx === 'table') return ['props', 'text', 'table', 'cell', 'style'];
    return ['props', 'text', 'style'];
  }

  private syncTabs(): void {
    const tabs = this.visibleTabs();
    if (!tabs.includes(this.panelTab)) this.panelTab = 'props';
    this.onTabsState?.(tabs, this.panelTab);
  }

  /**
   * 현재 문단 전체에 스타일 프리셋을 입힌다 — 부분 선택을 요구하지 않는 게 핵심.
   * (캔바·워드의 스타일 적용과 같은 기대: 커서만 두고 누르면 문단이 바뀐다.)
   * 글자(크기·굵게)는 문단 범위 char 서식으로, 번호는 para 서식으로 — 모두 커맨드
   * 경로라 Ctrl+Z 한 번에 되돌아간다.
   */
  private applyTextStyle(t: { pt: number; bold: boolean; level?: number }): void {
    const ih = this.services.getInputHandler() as any;
    if (!ih) return;
    try {
      const pos = ih.cursor.getPosition();
      // v1 은 본문 문단만 — 셀 안은 컨텍스트 탭에서 이 화면이 아예 안 보인다
      if (pos.parentParaIndex !== undefined) return;
      const len = this.services.wasm.getParagraphLength(pos.sectionIndex, pos.paragraphIndex);
      const start = { ...pos, charOffset: 0 };
      const end = { ...pos, charOffset: len };
      ih.applyCharPropsToRange(start, end, { fontSize: t.pt * 100, bold: t.bold });
      if (t.level !== undefined) {
        const nid = this.services.wasm.ensureDefaultNumbering();
        ih.applyParaPropsToRange(start, end,
          { headType: 'Number', numberingId: nid, paraLevel: t.level } as any);
      }
    } catch (err) {
      console.warn('[inspector] 텍스트 스타일 적용 실패:', err);
    }
  }

  /**
   * 문서 템플릿 삽입 — 커서 자리에 서식된 문단 골격을 한 스냅샷으로 넣는다.
   * 본문 삽입은 기존 ai-doc-insert 의 insertFormatted 를 그대로 쓴다(분류·좌표 변환·
   * 단일 undo 가 이미 처리돼 있다). v1 은 본문만 — 셀 안·빈 문서면 넣지 않는다.
   */
  private applyTemplate(body: string): void {
    const ih = this.services.getInputHandler() as any;
    if (!ih || this.services.wasm.pageCount === 0) return;
    try {
      const start = ih.cursor.getPosition();
      if (start.parentParaIndex !== undefined) return;
      insertFormatted(ih, body);
      // insertFormatted 는 wasm 만 조작하고 cursor 객체는 갱신하지 않아 삽입 후 커서가
      //   stale 해진다("NaN번째 문단"). 삽입 시작점(=삽입된 제목의 앞)으로 커서를 놓아
      //   유효화한다 — 사용자가 곧바로 제목부터 편집할 수 있다.
      ih.cursor.moveTo({
        sectionIndex: start.sectionIndex ?? 0,
        paragraphIndex: start.paragraphIndex ?? 0,
        charOffset: start.charOffset ?? 0,
      });
      ih.updateCaret?.();
      this.services.eventBus.emit('document-changed');
    } catch (err) {
      console.warn('[inspector] 템플릿 삽입 실패:', err);
    }
  }

  /**
   * 스타일 탭 — 문서에 저장된 이름 있는 스타일 목록을 카드로 그린다. 카드를 누르면
   * 커서 문단에 그 스타일을 입힌다(기존 applyStyle 재사용 — 스냅샷 undo·재렌더 포함).
   * 하단 「스타일 설정…」은 기존 StyleDialog(만들기·편집)를 연다.
   */
  /**
   * 스타일 탭 — 대화상자와 같은 구조(목록 + 정보 카드 3장)를 패널에서, 그리고 ✎ 로
   * **여기서 바로 고친다**(사용자 지시 2026-08-03). 본체는 ui/style-panel.ts.
   */
  private buildStyleTab(host: HTMLElement): void {
    const sec = this.section('스타일');
    host.appendChild(sec);
    buildStylePanel(sec, {
      wasm: this.services.wasm,
      eventBus: this.services.eventBus,
      applyStyle: (id) => {
        const ih = this.services.getInputHandler() as any;
        ih?.applyStyle(id);
        ih?.focus?.();
      },
      dispatch: (cmd) => this.services.dispatcher.dispatch(cmd),
      // 편집 중 바는 「본문 편집」 헤더 오른쪽에 붙는다(사용자 지시 2026-08-03)
      headerSlot: this.banner,
    });
  }

  /** 아이콘 칩 여러 개를 한 줄(줄바꿈 허용)로 — 디자인 2c 의 표 조작 섹션 */
  private chipRow(items: Array<[label: string, cmd: string, icon: string]>): HTMLElement {
    const row = mkEl('div', 'canva-chip-row');
    for (const [label, cmd, icon] of items) {
      const b = mkButton('canva-chip', { title: label });
      b.innerHTML = `<i class="ph-duotone ph-${icon}"></i><span>${label}</span>`;
      b.dataset.cmd = cmd;
      row.appendChild(b);
    }
    return row;
  }

  /** 선택 대상의 위치 설명 — 디자인 2c 의 "표 블록 · 3×3 · B2" 자리 */
  private describeSelection(c: Ctx): string {
    const ih = this.services.getInputHandler() as any;
    if (!ih) return '';
    try {
      if (c === 'body') {
        // 선택을 반영한다 — 문단 범위 + 글자 수(본문은 ui/selection-summary.ts)
        return ih.cursor ? describeBodySelection(ih.cursor, this.services.wasm as never) : '';
      }
      if (c === 'cell' || c === 'table') {
        const ref = ih.cursor?.getCellTableContext?.();
        if (!ref) return '';
        const dim = this.services.wasm.getTableDimensions?.(ref.sec, ref.ppi, ref.ci);
        const size = dim?.rowCount && dim?.colCount ? `${dim.rowCount}×${dim.colCount}` : '';
        const pos = ih.cursor?.getPosition?.();
        // A1 표기 — 셀 인덱스에서 행/열 역산
        let cell = '';
        if (c === 'cell' && pos?.cellIndex !== undefined && dim?.colCount) {
          const r = Math.floor(pos.cellIndex / dim.colCount);
          const col = pos.cellIndex % dim.colCount;
          cell = ` · ${String.fromCharCode(65 + col)}${r + 1}`;
        }
        return `표 블록${size ? ` · ${size}` : ''}${cell}`;
      }
      if (c === 'picture') {
        return ih.isMultiPictureSelection?.() ? '개체 2개 이상 선택' : '';
      }
    } catch { /* 조회 실패 시 설명 없음 */ }
    return '';
  }

  /**
   * 그림 빠른 설정 — 배치 방식과 크기(mm).
   *
   * ⚠ 배치 방식이 첫 칸인 이유: 「글자처럼 배치」가 켜져 있으면 **드래그로 못 옮긴다**
   *   (input-handler-picture.ts:601). 도장을 넣고 "왜 이동이 안 되지"로 막힌 신고가
   *   실제로 있었다 — 그 벽을 여기서 바로 넘게 한다.
   *
   * 값 읽기는 이 파일의 다른 곳과 같은 방식(getInputHandler() as any)이다.
   */
  private pictureQuickControls(): HTMLElement {
    const wrap = mkEl('div', 'canva-pic-quick');
    const ih = this.services.getInputHandler() as any;
    const ref = ih?.cursor?.getSelectedPictureRef?.();
    let props: any = null;
    try { props = ref ? ih.getObjectProperties?.(ref) : null; } catch { props = null; }

    // ① 배치 방식
    const row = mkEl('div', 'canva-pic-row');
    const label = mkEl('span', 'canva-pic-label');
    label.textContent = '배치';
    const seg = mkEl('div', 'canva-pic-seg');
    const inline = !!props?.treatAsChar;
    ([['글자처럼', true], ['자유 이동', false]] as Array<[string, boolean]>).forEach(([txt, want]) => {
      const b = mkButton('canva-pic-seg-btn', { title: want ? '본문에 글자처럼 실린다(이동 불가)' : '원하는 자리로 끌어 옮길 수 있다' });
      b.textContent = txt;
      b.classList.toggle('is-on', inline === want);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (inline === want) return;
        this.services.dispatcher.dispatch('object:toggle-inline');
        // ⚠ refreshContext 는 **맥락이 바뀌었을 때만** 다시 그린다. 여기서는 'picture' 그대로라
        //   조기 반환해서 버튼이 옛 상태로 남았다(2026-08-04 실측). 본문을 다시 짓는 쪽을 부른다.
        setTimeout(() => this.applyContext(), 60);
      });
      seg.appendChild(b);
    });
    row.append(label, seg);
    wrap.appendChild(row);

    // ② 크기(mm) — HWPUNIT 1mm = 7200/25.4
    const MM = 7200 / 25.4;
    if (props && typeof props.width === 'number' && typeof props.height === 'number') {
      const sizeRow = mkEl('div', 'canva-pic-row');
      const sl = mkEl('span', 'canva-pic-label');
      sl.textContent = '크기';
      const mk = (key: 'width' | 'height', unitText: string) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.className = 'canva-pic-num';
        i.min = '1';
        i.value = String(Math.round(props[key] / MM));
        i.title = unitText;
        i.addEventListener('change', () => {
          const mm = Math.max(1, Number(i.value) || 1);
          if (!ref) return;
          try { ih.setObjectProperties?.(ref, { [key]: Math.round(mm * MM) }); } catch { /* 무시 */ }
          setTimeout(() => this.applyContext(), 60);
        });
        return i;
      };
      const unit = mkEl('span', 'canva-pic-unit');
      unit.textContent = 'mm';
      sizeRow.append(sl, mk('width', '가로(mm)'), mk('height', '세로(mm)'), unit);
      wrap.appendChild(sizeRow);
    }
    return wrap;
  }

  /** 같은 패널의 표/셀 탭으로 보내는 버튼 — 예전 '표/셀 속성…' 대화상자 자리 */
  private panelLink(label: string, kind: 'table' | 'cell', section: string): HTMLElement {
    const b = mkButton('canva-full-btn', { title: label });
    b.innerHTML = `<i class="ph-duotone ph-${kind === 'table' ? 'table' : 'grid-nine'}"></i><span>${label}</span>`
      + '<i class="ph ph-caret-right canva-full-caret"></i>';
    b.addEventListener('mousedown', (e) => { e.preventDefault(); openTablePanel(kind, section); });
    return b;
  }

  /** 섹션을 지정해 연다 — 명령·우클릭 진입점이 특정 섹션으로 바로 보내려고 쓴다 */
  setSection(kind: 'text' | 'table' | 'cell', section: string): void {
    if (SECTIONS[kind].some(([label]) => label === section)) this.curSection[kind] = section;
  }

  /** 패널 탭 — 컨텍스트 탭: 표 안에서만 표·셀 두 개 */
  setPanelTab(tab: PanelTab): void {
    this.panelTab = tab;
    this.applyContext();
    this.syncTabs();
  }

  /** 표/셀 탭의 섹션 스트립 — 대화상자 탭을 패널 안 아이콘 줄로 (디자인 2c 갱신) */
  private buildSectionStrip(kind: 'text' | 'table' | 'cell'): HTMLElement {
    const strip = mkEl('div', 'canva-sec-strip');
    for (const [label, icon] of SECTIONS[kind]) {
      const b = mkButton('canva-sec-btn', { title: label });
      b.innerHTML = `<i class="ph-duotone ph-${icon}"></i><span>${label}</span>`;
      b.classList.toggle('is-on', label === this.curSection[kind]);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.curSection[kind] = label;
        this.applyContext();
      });
      strip.appendChild(b);
    }
    return strip;
  }

  /** 선택한 섹션의 내용을 그린다 (디자인 2c) */
  private renderSection(kind: 'table' | 'cell', host: HTMLElement,
    ref: { sec: number; ppi: number; ci: number }, cellIdx: number): void {
    const label = this.curSection[kind];
    if (label === '테두리·배경') {
      this.borderSection.mount(host, this.services.wasm, this.services, ref, cellIdx, kind);
      return;
    }
    if (!this.panelSections.mount(host, this.services.wasm, this.services, ref, cellIdx, kind, label)) {
      host.appendChild(mkEl('div', 'canva-hint', '이 설정을 불러오지 못했습니다.'));
    }
  }

  /**
   * 컨텍스트 배너(상태명 + "1쪽 · N번째 문단")를 다시 그린다.
   * ⚠ applyContext 와 분리한 이유: 컨텍스트가 안 바뀌는 커서 이동(본문 안 문단 이동,
   * 셀 사이 이동)에서도 위치 설명은 바뀐다 — 패널 전체 재렌더 없이 이것만 갱신한다
   * (사용자 신고 2026-07-30: 2번째 문단인데 배너는 1번째 문단 고정).
   */
  private paintBanner(): void {
    const c = this.ctx;
    const meta: Record<Ctx, { icon: string; label: string }> = {
      none: { icon: '<circle cx="12" cy="12" r="9"/>', label: '선택 없음' },
      body: { icon: '<path d="M4 6h16M4 12h16M4 18h10"/>', label: '본문 편집' },
      cell: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M3 12h18"/>', label: '표 셀 편집' },
      table: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16"/>', label: '표 개체 선택됨' },
      picture: { icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M4 17l5-5 4 4 3-3 4 4"/>', label: '그림 선택됨' },
      form: { icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12l2 2 4-4"/>', label: '양식 개체 선택됨' },
    };
    const sub = this.describeSelection(c);
    // ⚠ 스타일 편집 바(.sp-editbar)가 이 헤더에 얹혀 있다 — innerHTML 로 갈아엎으면
    //   편집 중에 커서만 움직여도 저장·취소 단추가 사라진다. 떼어 뒀다 다시 붙인다.
    const editBar = this.banner.querySelector('.sp-editbar');
    this.banner.innerHTML =
      `<span class="canva-ctx-tile">${svg(meta[c].icon)}</span>` +
      `<span class="canva-ctx-text"><span class="canva-ctx-label">${meta[c].label}</span>` +
      (sub ? `<span class="canva-ctx-sub">${sub}</span>` : '') + '</span>';
    if (editBar) this.banner.appendChild(editBar);
  }

  private applyContext(): void {
    const c = this.ctx;
    this.paintBanner();

    // 양식 개체가 선택돼 있으면 무엇보다 그 속성판 — 그림/표 선택과 같은 우선순위 규약.
    {
      const ih = this.services.getInputHandler() as any;
      if (ih?.formObjectSelection) {
        this.emptyEl.hidden = true;
        this.fmtPane.hidden = true;
        this.tabPane.hidden = false;
        this.tabPane.innerHTML = '';
        if (buildFormObjectPanel(this.tabPane, this.services)) return;
        // 선택 정보가 낡았으면(개체 삭제 등) 평소 화면으로 계속
        this.tabPane.hidden = true;
      }
    }

    // [디자인 2c 갱신] 속성 외 탭은 섹션 스트립 + 폼. 속성 탭만 기존 서식 화면.
    if (this.panelTab !== 'props') {
      this.emptyEl.hidden = true;
      this.fmtPane.hidden = true;
      this.tabPane.hidden = false;
      this.tabPane.innerHTML = '';

      // 텍스트 탭 = 문단 모양(표와 무관) — 커서만 있으면 된다
      if (this.panelTab === 'text') {
        buildTextTab(this.tabPane, {
          strip: this.buildSectionStrip('text'),
          mount: (host) => this.textSections.mount(host, this.services, this.curSection.text),
          redraw: () => this.applyContext(),
        });
        return;
      }

      // 스타일 탭 = 문서 스타일 목록(이름 있는 스타일) — 카드 클릭으로 적용
      if (this.panelTab === 'style') {
        this.buildStyleTab(this.tabPane);
        return;
      }

      // 셀 편집이면 커서에서, 표 개체 선택이면 선택에서 표를 찾는다
      const ih = this.services.getInputHandler() as any;
      const ref = c === 'table'
        ? ih?.getSelectedTableRef?.()
        : ih?.cursor?.getCellTableContext?.();
      if (!ref) {
        this.tabPane.appendChild(mkEl('div', 'canva-hint',
          '표 안에 커서를 두면 표·셀 설정이 여기 열립니다.'));
        return;
      }

      // 섹션 목차(빠른 이동) + 실제 폼 + 그 아래 조작 칩(컨텍스트 탭으로 속성 탭이
      // 사라지면서, 옛 속성 탭의 표 조작이 성격대로 표/셀 탭에 나뉘어 들어왔다)
      const strip = this.buildSectionStrip(this.panelTab as 'table' | 'cell');
      this.tabPane.appendChild(strip);
      const formHost = mkEl('div', 'canva-props-host');
      this.tabPane.appendChild(formHost);
      const pos = ih.cursor?.getPosition?.();
      this.renderSection(this.panelTab as 'table' | 'cell', formHost,
        { sec: ref.sec, ppi: ref.ppi, ci: ref.ci }, pos?.cellIndex ?? 0);
      this.tabPane.appendChild(this.buildTableOps(this.panelTab as 'table' | 'cell'));
      return;
    }
    this.tabPane.hidden = true;
    this.fmtPane.hidden = false;

    const showFmt = c === 'body' || c === 'cell';
    this.emptyEl.hidden = c !== 'none';
    this.fmtPane.hidden = c === 'none';
    // 글자 서식은 텍스트 편집(본문/셀)일 때만; 개체 선택 시엔 개체 속성만
    for (const el of Array.from(this.fmtPane.children)) {
      if (el !== this.extrasHost) (el as HTMLElement).hidden = !showFmt && c !== 'none';
    }
    this.renderExtras();
  }

  /**
   * 표/셀 탭 하단의 조작 칩 — 성격대로 나눈다:
   * 표 탭 = 표 구조(줄·칸 추가/지우기, 행/열 바꿈, 개체 속성)
   * 셀 탭 = 셀 단위(합치기·나누기·같게, 범위 테두리, 블록 계산)
   * ⚠ 줄·칸 조작은 커서가 셀 안에 있어야 동작한다(canExecute inTable) — 표 개체
   *   선택 상태의 표 탭에서는 안내만 남긴다.
   */
  private buildTableOps(kind: 'table' | 'cell'): HTMLElement {
    const host = mkEl('div', 'canva-tab-ops');
    const disp = (cmd: string) => (e: Event) => { e.preventDefault(); this.services.dispatcher.dispatch(cmd); };

    if (kind === 'table') {
      if (this.ctx === 'table') {
        const objSec = this.section('개체');
        const b = mkButton('canva-full-btn', {
          html: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9 9h6v6H9z"/>') + '<span>개체 속성…</span>',
        });
        b.addEventListener('mousedown', disp('format:object-properties'));
        objSec.appendChild(b);
        objSec.appendChild(mkEl('div', 'canva-hint', '셀을 클릭하면 줄·칸 편집이 열립니다.'));
        host.appendChild(objSec);
        return host;
      }
      const sec = this.section('줄·칸');
      // [캔버스 한컴 포크] 행·열 추가 4버튼을 십자(방향키) 배치 — 버튼 방향이 곧 삽입 위치
      const cross = mkEl('div', 'canva-cross');
      const mk = (title: string, cmd: string, inner: string, pos: string) => {
        const b = mkButton(`canva-icon-btn canva-cross-${pos}`, { title, html: svg(inner) });
        b.addEventListener('mousedown', disp(cmd));
        return b;
      };
      cross.appendChild(mk('위에 줄 추가', 'table:insert-row-above', '<path d="M12 20V8M6 14l6-6 6 6"/>', 'up'));
      cross.appendChild(mk('왼쪽에 칸 추가', 'table:insert-col-left', '<path d="M20 12H8M14 6l-6 6 6 6"/>', 'left'));
      const ctr = mkEl('div', 'canva-cross-center');
      ctr.setAttribute('aria-hidden', 'true');
      ctr.innerHTML = svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 5v14"/>');
      cross.appendChild(ctr);
      cross.appendChild(mk('오른쪽에 칸 추가', 'table:insert-col-right', '<path d="M4 12h12M10 6l6 6-6 6"/>', 'right'));
      cross.appendChild(mk('아래에 줄 추가', 'table:insert-row-below', '<path d="M12 4v12M6 10l6 6 6-6"/>', 'down'));
      sec.appendChild(cross);
      sec.appendChild(this.chipRow([
        ['줄 지우기', 'table:delete-row', 'rows'],
        ['칸 지우기', 'table:delete-col', 'columns'],
        ['바꿈 복사', 'table:transpose-copy', 'swap'],
        ['바꿈 붙여넣기', 'table:transpose-paste', 'clipboard-text'],
        // 표 자체를 지우는 길이 패널에 아예 없었다 — 줄·칸만 지울 수 있었다(2026-08-01 실측).
        ['표 지우기', 'table:delete', 'trash'],
      ]));
      host.appendChild(sec);
      return host;
    }

    const cellSec = this.section('셀 조작');
    cellSec.appendChild(this.chipRow([
      ['셀 합치기', 'table:cell-merge', 'arrows-in'],
      ['셀 나누기', 'table:cell-split', 'square-split-horizontal'],
      ['높이 같게', 'table:cell-height-equal', 'arrows-out-line-vertical'],
      ['너비 같게', 'table:cell-width-equal', 'arrows-out-line-horizontal'],
      // 범위 테두리만 전용 대화상자 — 셀 범위 선택은 패널 섹션이 아직 못 다룬다
      ['범위 테두리', 'table:border-each', 'frame-corners'],
    ]));
    host.appendChild(cellSec);

    const calcSec = this.section('블록 계산');
    calcSec.appendChild(this.chipRow([
      ['합계', 'table:block-formula', 'sigma'],
      ['계산식', 'table:formula', 'math-operations'],
      ['1,000 단위', 'table:thousand-sep', 'currency-krw'],
      // 자릿점은 늘리기만 있고 줄이기가 없었다 — 한 번 늘리면 되돌릴 길이 없었다
      ['자릿점 +', 'table:decimal-add', 'plus'],
      ['자릿점 −', 'table:decimal-remove', 'minus'],
    ]));
    host.appendChild(calcSec);
    return host;
  }

  private renderExtras(): void {
    const host = this.extrasHost;
    host.innerHTML = '';
    const disp = (cmd: string) => (e: Event) => { e.preventDefault(); this.services.dispatcher.dispatch(cmd); };
    const fullBtn = (label: string, cmd: string, icon: string) => {
      const b = mkButton('canva-full-btn', { html: svg(icon) + `<span>${label}</span>` });
      b.addEventListener('mousedown', disp(cmd));
      return b;
    };

    if (this.ctx === 'picture') {
      const sec = this.section('그림');
      // [2026-08-04] 자주 쓰는 것은 **여기서 바로** 끝낸다 — 대화상자(2,825줄)를 열지 않고.
      //   자세한 설정은 아래 「그림 속성…」이 계속 맡는다.
      if (!this.lastMulti) sec.appendChild(this.pictureQuickControls());
      sec.appendChild(fullBtn('그림 속성…', 'format:object-properties', '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M4 17l5-5 4 4 3-3 4 4"/>'));
      host.appendChild(sec);
      // [캔버스 한컴 포크] 다중 선택(2개 이상)일 때만 개체 정렬 노출
      if (this.lastMulti) {
        const alignSec = this.section('개체 정렬');
        const row = mkEl('div', 'canva-btn-row');
        for (const a of OBJ_ALIGN) {
          const b = mkButton('canva-icon-btn', { title: a.title, html: svg(a.icon) });
          b.addEventListener('mousedown', disp(a.cmd));
          row.appendChild(b);
        }
        alignSec.appendChild(row);
        host.appendChild(alignSec);
      }
    }
  }
}

function rgbToHex(v: string): string {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return v.toLowerCase();
  const h = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/** 커서가 지금 어느 표·어느 셀에 있는지의 신원 문자열(없으면 빈 문자열) */
function cellIdentity(ih: any): string {
  const ref = ih?.cursor?.getCellTableContext?.() ?? ih?.getSelectedTableRef?.();
  if (!ref) return '';
  const cellIdx = ih?.cursor?.getPosition?.()?.cellIndex ?? -1;
  return `${ref.sec}/${ref.ppi}/${ref.ci}/${cellIdx}`;
}
