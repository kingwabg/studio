import { WasmBridge } from '@/core/wasm-bridge';
import { showToast } from '@/ui/toast';
import { EventBus } from '@/core/event-bus';
import { CursorState } from './cursor';
import { CaretRenderer } from './caret-renderer';
import { MemoOverlay } from './memo-overlay';
import { GhostOverlay } from './ghost-overlay';
import { clearGhosts, createGhostId, deleteGhost, listGhosts, saveGhost } from '@/media/ghost-store';

import { listVersions, saveVersion, type ParaVersion } from '@/media/timemachine-store';

/** 고스트 앵커 재탐색용 문단 앞머리 길이 — 짧으면 오탐, 길면 사소한 편집에도 앵커를 잃는다 */
const GHOST_HINT_LEN = 24;
/** 타임머신: 편집이 이만큼 멎으면 한 판 남긴다 — 타자 한 글자마다 쌓지 않으려는 값 */
const TIME_MACHINE_IDLE_MS = 1500;
/** 타임머신이 담는 문단 텍스트 상한 — 아주 긴 문단이 저장소를 삼키지 않게 */
const TIME_MACHINE_MAX_CHARS = 4000;
import { FieldMarkerRenderer } from './field-marker-renderer';
import { SelectionRenderer } from './selection-renderer';
import { CommandHistory } from './history';
import { DeleteSelectionCommand, ApplyCharFormatCommand, ApplyParaFormatCommand, SnapshotCommand } from './command';
import type { OperationDescriptor, ParaFormatTarget, RefreshPolicy } from './command';
import { VirtualScroll } from '@/view/virtual-scroll';
import { ViewportManager } from '@/view/viewport-manager';
import { tableHoverFor as _tableHoverFor } from './canvas-snap'; // [캔버스 한컴 포크]
import type {
  DocumentPosition,
  CharProperties,
  ParaProperties,
  CursorRect,
  CellProperties,
  FormObjectHitResult,
  LayerNode,
  LayerTextRunOp,
  PageInfo,
} from '@/core/types';
import type { CommandDispatcher } from '@/command/dispatcher';
import type { EditorEditMode } from '@/command/types';
import { matchShortcut, defaultShortcuts } from '@/command/shortcut-map';
import type { ContextMenu, ContextMenuItem } from '@/ui/context-menu';
import type { CommandPalette } from '@/ui/command-palette';
import type { CellSelectionRenderer } from './cell-selection-renderer';
import type { TableObjectRenderer } from './table-object-renderer';
import type { TableHoverHandles } from './table-hover-handles';
import type { TableResizeRenderer, BorderEdge } from './table-resize-renderer';
import type { CellBbox, CellPathLike } from '@/core/types';
import { showConfirm } from '@/ui/confirm-dialog';
import * as _mouse from './input-handler-mouse';
import * as _table from './input-handler-table';
import * as _keyboard from './input-handler-keyboard';
import * as _text from './input-handler-text';
import * as _pend from './pending-format';
import * as _track from './track-review';
import * as _picture from './input-handler-picture';
import type { AlignMode } from './object-align'; // [캔버스 한컴 포크] 개체 정렬 모드
import { computeHangingIndentPx } from './hanging-indent';
import { isPageLocalTextEditCommand, type PageLocalTextEditOptions } from './input-edit-invalidation';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_SCROLL_EDGE_PX = 48;
const DRAG_SCROLL_MIN_STEP_PX = 2;
const DRAG_SCROLL_MAX_STEP_PX = 20;
const PX_TO_RAW_2X = 150;
const PX_TO_HWPUNIT = 75;
const DEFERRED_PAGINATION_AUTO_FLUSH_DELAY_MS = 10_000;
const DEFERRED_PAGINATION_AUTO_FLUSH_PAGE_LIMIT = 30;

type FormatCopyState = {
  charProps: Partial<CharProperties>;
  paraProps: Partial<ParaProperties>;
  cellProps?: Partial<CellProperties>;
};

type PagePoint = {
  pageIdx: number;
  pageX: number;
  pageY: number;
};

const FORMAT_COPY_CHAR_KEYS: Array<keyof CharProperties> = [
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'textColor',
  'shadeColor',
  'emboss',
  'engrave',
  'fontId',
  'fontIds',
  'underlineType',
  'underlineColor',
  'outlineType',
  'shadowType',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'strikeColor',
  'subscript',
  'superscript',
  'ratios',
  'spacings',
  'relativeSizes',
  'charOffsets',
  'emphasisDot',
  'underlineShape',
  'strikeShape',
  'kerning',
];

const FORMAT_COPY_PARA_KEYS: Array<keyof ParaProperties> = [
  'alignment',
  'lineSpacing',
  'lineSpacingType',
  'marginLeft',
  'marginRight',
  'indent',
  'spacingBefore',
  'spacingAfter',
  'headType',
  'paraLevel',
  'numberingId',
  'widowOrphan',
  'keepWithNext',
  'keepLines',
  'pageBreakBefore',
  'fontLineHeight',
  'singleLine',
  'autoSpaceKrEn',
  'autoSpaceKrNum',
  'verticalAlign',
  'englishBreakUnit',
  'koreanBreakUnit',
  'borderConnect',
  'borderIgnoreMargin',
  // [서식 패리티] 문단 테두리/배경 + 탭 정의 — 판독(build_para_properties_json)과
  // 적용(helpers.rs border/tab 게이트) 모두 raw 단위 왕복이라 normalize 변환 불필요.
  // fillType 은 배경 유무(none/solid) 판별에 필수라 함께 나른다.
  'borderLeft',
  'borderRight',
  'borderTop',
  'borderBottom',
  'fillType',
  'fillColor',
  'patternColor',
  'patternType',
  'borderSpacing',
  'tabStops',
];

const FORMAT_COPY_CELL_KEYS: Array<keyof CellProperties> = [
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'applyInnerMargin',
  'verticalAlign',
  'textDirection',
  'isHeader',
  'cellProtect',
  'fieldName',
  'editableInForm',
  'borderFillId',
];

function pickDefined<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function pxToRaw2x(px: number): number {
  return Math.round(px * PX_TO_RAW_2X);
}

function pxToRaw(px: number): number {
  return Math.round(px * PX_TO_HWPUNIT);
}

function availableDropWidthPx(pageInfo: PageInfo, pageX: number): number {
  const bodyWidth = Math.max(1, pageInfo.width - pageInfo.marginLeft - pageInfo.marginRight);
  const columns = pageInfo.columns?.filter((column) => column.width > 0) ?? [];
  if (columns.length === 0) return bodyWidth;

  const containing = columns.find((column) => pageX >= column.x && pageX <= column.x + column.width);
  if (containing) return Math.min(containing.width, bodyWidth);

  const nearest = columns.reduce((best, column) => {
    const bestCenter = best.x + best.width / 2;
    const columnCenter = column.x + column.width / 2;
    return Math.abs(columnCenter - pageX) < Math.abs(bestCenter - pageX) ? column : best;
  }, columns[0]);
  return Math.min(nearest.width, bodyWidth);
}

function fitDroppedImageSizeRaw(
  naturalWidth: number,
  naturalHeight: number,
  pageInfo: PageInfo | null,
  pageX: number,
): { width: number; height: number } {
  const originalWidth = Math.round(naturalWidth * PX_TO_HWPUNIT);
  const originalHeight = Math.round(naturalHeight * PX_TO_HWPUNIT);
  if (!pageInfo || originalWidth <= 0 || originalHeight <= 0) {
    return { width: originalWidth, height: originalHeight };
  }

  const maxWidth = Math.floor(availableDropWidthPx(pageInfo, pageX) * PX_TO_HWPUNIT);
  const maxHeight = Math.floor(
    Math.max(1, pageInfo.height - pageInfo.marginTop - pageInfo.marginBottom) * PX_TO_HWPUNIT,
  );
  const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    return { width: originalWidth, height: originalHeight };
  }
  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  };
}

function normalizeFormatCopyParaProps(props: Partial<ParaProperties>): Partial<ParaProperties> {
  const normalized = { ...props };
  if (props.marginLeft !== undefined) normalized.marginLeft = pxToRaw2x(props.marginLeft);
  if (props.marginRight !== undefined) normalized.marginRight = pxToRaw2x(props.marginRight);
  if (props.indent !== undefined) normalized.indent = pxToRaw2x(props.indent);
  if (props.spacingBefore !== undefined) normalized.spacingBefore = pxToRaw(props.spacingBefore);
  if (props.spacingAfter !== undefined) normalized.spacingAfter = pxToRaw(props.spacingAfter);
  return normalized;
}

function createOverlaySvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.overflow = 'visible';
  return svg;
}

function setSvgAttrs(el: SVGElement, attrs: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
}

function appendOverlayLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashed = false,
): void {
  const line = document.createElementNS(SVG_NS, 'line');
  setSvgAttrs(line, {
    x1,
    y1,
    x2,
    y2,
    stroke: '#333',
    'stroke-width': 2,
  });
  if (dashed) line.setAttribute('stroke-dasharray', '6,3');
  svg.appendChild(line);
}

function createOverlayLabel(x: number, y: number, text: string): HTMLDivElement {
  const label = document.createElement('div');
  label.style.cssText =
    `position:fixed;left:${x}px;top:${y}px;` +
    'background:rgba(0,0,0,0.75);color:#fff;font-size:11px;padding:2px 6px;' +
    'border-radius:3px;white-space:nowrap;pointer-events:none';
  label.textContent = text;
  return label;
}

/** 클릭 커서 배치 + 키보드 입력을 처리한다 */
export class InputHandler {
  private cursor: CursorState;
  private caret: CaretRenderer;
  private fieldMarker: FieldMarkerRenderer;
  /** 메모 말풍선 오버레이(읽기 전용) */
  private memoOverlay: MemoOverlay;
  private ghostOverlay: GhostOverlay;
  /** 타임머신 포착 디바운스 타이머 */
  private timeMachineTimer: number | undefined;
  /** 변경 추적 오버레이 — 구현 track-review.ts */
  private trackOverlay: _track.TrackOverlay;
  private selectionRenderer: SelectionRenderer;
  private history: CommandHistory;
  private textarea: HTMLTextAreaElement;
  private active = false;
  private insertMode = true;  // true=삽입, false=수정(덮어쓰기)
  private editMode: EditorEditMode = 'normal';
  /** 마지막 셀 키 (눈금자 셀 bbox 중복 조회 방지) */
  private lastCellKey: string | null = null;
  private dispatcher: CommandDispatcher | null = null;
  private contextMenu: ContextMenu | null = null;
  commandPalette: CommandPalette | null = null;
  private cellSelectionRenderer: CellSelectionRenderer | null = null;
  private tableObjectRenderer: TableObjectRenderer | null = null;
  private tableHoverHandles: TableHoverHandles | null = null;
  private tableResizeRenderer: TableResizeRenderer | null = null;
  private pictureObjectRenderer: TableObjectRenderer | null = null;
  /** 마지막 rhwp-studio 내부 복사의 시스템 클립보드 marker token */
  private rhwpClipboardToken: string | null = null;
  /** 누름틀 시작 경계에서 왼쪽/Home 이동으로 필드 밖에 머문 상태 */
  private fieldStartExitKey: string | null = null;
  /** 누름틀 끝 경계에서 오른쪽 이동으로 필드 밖에 머문 상태 */
  private fieldEndExitKey: string | null = null;
  /** 누름틀을 포함한 붙여넣기 직후 마지막 필드 끝을 바깥 위치로 고정한다 */
  private pastedFieldEndOutsidePending = false;
  /** 모양 복사로 기억한 글자/문단 모양 */
  private formatCopyState: FormatCopyState | null = null;

  // 마우스 드래그 선택 상태
  private isDragging = false;
  private dragRafId = 0; // requestAnimationFrame throttle용
  private dragAutoScrollRafId = 0;
  private dragLastClientX = 0;
  private dragLastClientY = 0;
  private cellSelectionDragState: {
    startClientX: number;
    startClientY: number;
    lastClientX: number;
    lastClientY: number;
    startRow: number;
    startCol: number;
    lastRow: number;
    lastCol: number;
    isDragging: boolean;
  } | null = null;
  private cellSelectionDragCandidate: {
    startClientX: number;
    startClientY: number;
    startRow: number;
    startCol: number;
  } | null = null;

  // 표 경계선 hover 상태
  private resizeHoverRafId = 0;
  private cachedTableRef: { sec: number; ppi: number; ci: number; pageHint?: number } | null = null;
  private cachedCellBboxes: CellBbox[] | null = null;
  private protectedCellHitCache: { key: string; protected: boolean } | null = null;
  private protectedCellHoverEl: HTMLDivElement | null = null;
  private deferredPaginationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredPaginationPending = false;

  // 표 경계선 리사이즈 드래그 상태
  private isResizeDragging = false;
  private resizeDragState: {
    edge: BorderEdge;
    tableRef: { sec: number; ppi: number; ci: number };
    bboxes: CellBbox[];
    pageBboxes: CellBbox[];
    affectedCellIndices: number[];
    borderOriginalPos: number;
    minResizePos: number;
    maxResizePos: number;
    resizeTarget?: { cellIdx: number; side: 'start' | 'end' } | null;
    singleCellTarget?: { cellIdx: number; side: 'start' | 'end' } | null;
    shiftResize?: boolean;
  } | null = null;
  private tableLocalResizeSegments = new Set<string>();

  // 표 이동 드래그 상태
  private isMoveDragging = false;
  private moveDragState: {
    tableRef: { sec: number; ppi: number; ci: number };
    startPpi: number;  // 드래그 시작 시 ppi (Undo용)
    startPageX: number;
    startPageY: number;
    lastPageX: number;
    lastPageY: number;
    totalDeltaH: number;  // 누적 HWPUNIT 델타 (Undo용)
    totalDeltaV: number;
  } | null = null;

  // 그림 삽입 배치 모드 상태
  private imagePlacementMode = false;
  private imagePlacementData: {
    data: Uint8Array; ext: string; fileName: string;
    naturalWidth: number; naturalHeight: number;
  } | null = null;
  private imagePlacementDrag: {
    startClientX: number; startClientY: number;
    currentClientX: number; currentClientY: number;
    isDragging: boolean;
  } | null = null;
  private imagePlacementOverlay: HTMLDivElement | null = null;

  // 도형/글상자 삽입 배치 모드 상태
  private shapePlacementType: string = 'rectangle'; // 'rectangle' | 'ellipse' | 'line' | 'arc' | 'polygon' | 'textbox' | 'connector-*'
  private textboxPlacementMode = false;
  private textboxPlacementDrag: {
    startClientX: number; startClientY: number;
    currentClientX: number; currentClientY: number;
    isDragging: boolean;
  } | null = null;
  private textboxPlacementOverlay: HTMLDivElement | null = null;

  // 연결선 드로잉 모드 상태
  private connectorDrawingMode = false;
  private connectorType: string = 'connector-straight';
  private connectorStartRef: { sec: number; ppi: number; ci: number; pointIndex: number; x: number; y: number } | null = null;
  private connectorOverlay: HTMLDivElement | null = null;

  // 다각형 그리기 모드 상태
  private polygonDrawingMode = false;
  private polygonPoints: { x: number; y: number }[] = [];
  private polygonOverlay: HTMLDivElement | null = null;
  private polygonMousePos: { x: number; y: number } | null = null;

  // 그림/글상자 핸들 드래그 리사이즈 상태
  private isPictureResizeDragging = false;
  private pictureResizeState: {
    dir: string;
    ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'; cellPath?: CellPathLike; headerFooter?: { kind: 'header' | 'footer'; outerParaIdx: number; outerControlIdx: number } };
    origWidth: number;
    origHeight: number;
    origHorzOffset?: number;
    origVertOffset?: number;
    startClientX: number;
    startClientY: number;
    pageIndex: number;
    bbox: { x: number; y: number; w: number; h: number };
    /** 다중 선택 리사이즈 시 각 개체의 원래 크기/위치 */
    multiRefs?: { sec: number; ppi: number; ci: number; type: string; origWidth: number; origHeight: number; origHorzOffset: number; origVertOffset: number; bboxX: number; bboxY: number }[];
  } | null = null;

  // 그림/글상자 이동 드래그 상태
  private isPictureMoveDragging = false;
  private pictureMoveState: {
    ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'; cellPath?: CellPathLike; headerFooter?: { kind: 'header' | 'footer'; outerParaIdx: number; outerControlIdx: number } };
    origHorzOffset: number;
    origVertOffset: number;
    startPageX: number;
    startPageY: number;
    lastPageX: number;
    lastPageY: number;
    totalDeltaH: number;
    totalDeltaV: number;
    pageIndex: number;
    /** 다중 선택 이동 시 각 개체의 원래 offset 기록 */
    multiRefs?: { sec: number; ppi: number; ci: number; type: string; origHorzOffset: number; origVertOffset: number }[];
  } | null = null;

  // 그림/글상자 회전 드래그 상태
  private isPictureRotateDragging = false;
  private pictureRotateState: {
    ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'; cellPath?: CellPathLike; headerFooter?: { kind: 'header' | 'footer'; outerParaIdx: number; outerControlIdx: number } };
    origAngle: number;      // 드래그 시작 시 원래 회전각 (도)
    centerX: number;        // 도형 중심 (scroll-content 좌표, px)
    centerY: number;
    startAngle: number;     // 드래그 시작 시 마우스→중심 각도 (rad)
    pageIndex: number;
  } | null = null;

  // 직선 끝점 드래그 상태
  private isLineEndpointDragging = false;
  private lineEndpointState: {
    ref: { sec: number; ppi: number; ci: number; type: string };
    endpoint: 'start' | 'end';
    pageIndex: number;
    pageLeft: number;
    pageOffset: number;
    zoom: number;
  } | null = null;

  // 양식 개체 오버레이
  private formOverlay: HTMLElement | null = null;

  // [Task #394] 셀 진입 자동 ON 로직 비활성화 — checkTransparentBordersTransition 와 동시 주석 처리.
  // 되돌리려면 아래 3 개 변수 + 호출 지점 + 메서드 본체 + 이벤트 핸들러의 주석을 동시에 해제.
  // // 투명선 자동 활성화 상태
  // private wasInCell = false;
  // private manualTransparentBorders = false;
  // private autoTransparentBorders = false;

  // IME 조합 상태
  private isComposing = false;
  private compositionAnchor: DocumentPosition | null = null;
  private compositionLength = 0; // 문서에 삽입된 조합 텍스트 길이
  // iOS 폴백: composition 이벤트 없이 input만으로 한글 조합 처리
  private _iosComposing = false;
  private _iosAnchor: DocumentPosition | null = null;
  private _iosBeforePageIndex: number | undefined = undefined;
  private _iosLength = 0;
  private _iosPrevText = '';
  private _iosInputTimer: any = null;
  private _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  private onClickBound: (e: MouseEvent) => void;
  private onDblClickBound: (e: MouseEvent) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onInputBound: (e?: Event) => void;
  private onCompositionStartBound: () => void;
  private onCompositionEndBound: () => void;
  private onCopyBound: (e: ClipboardEvent) => void;
  private onCutBound: (e: ClipboardEvent) => void;
  private onPasteBound: (e: ClipboardEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onF11InterceptBound: (e: KeyboardEvent) => void;

  constructor(
    private container: HTMLElement,
    private wasm: WasmBridge,
    private eventBus: EventBus,
    private virtualScroll: VirtualScroll,
    private viewportManager: ViewportManager,
  ) {
    this.cursor = new CursorState(wasm);
    this.caret = new CaretRenderer(container, virtualScroll);
    this.fieldMarker = new FieldMarkerRenderer(container, virtualScroll);
    this.memoOverlay = new MemoOverlay(container, virtualScroll);
    this.ghostOverlay = new GhostOverlay(container, virtualScroll);
    this.trackOverlay = new _track.TrackOverlay(container, virtualScroll);
    this.selectionRenderer = new SelectionRenderer(container, virtualScroll);
    this.history = new CommandHistory();

    // Hidden input 요소 생성
    // iOS WebKit에서는 <textarea>로 composition 이벤트가 발생하지 않으므로
    // contentEditable <div>를 사용하고 .value 프록시를 추가한다.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.style.cssText =
        'position:absolute;left:0;top:0;width:2em;height:1.5em;' +
        'color:transparent;background:transparent;caret-color:transparent;' +
        'border:none;outline:none;overflow:hidden;white-space:nowrap;' +
        'z-index:10;font-size:16px;padding:0;margin:0;';
      div.setAttribute('autocomplete', 'off');
      div.setAttribute('autocorrect', 'off');
      div.setAttribute('autocapitalize', 'off');
      div.setAttribute('spellcheck', 'false');
      div.setAttribute('inputmode', 'text');
      document.body.appendChild(div);
      // textarea 인터페이스 호환을 위한 프록시
      Object.defineProperty(div, 'value', {
        get() { return div.textContent || ''; },
        set(v: string) { div.textContent = v; },
      });
      this.textarea = div as unknown as HTMLTextAreaElement;
    } else {
      this.textarea = document.createElement('textarea');
      this.textarea.style.cssText =
        'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      this.textarea.setAttribute('autocomplete', 'off');
      this.textarea.setAttribute('autocorrect', 'off');
      this.textarea.setAttribute('autocapitalize', 'off');
      this.textarea.setAttribute('spellcheck', 'false');
      document.body.appendChild(this.textarea);
    }

    this.onClickBound = this.onClick.bind(this);
    this.onDblClickBound = this.onDblClick.bind(this);
    this.onKeyDownBound = this.onKeyDown.bind(this);
    this.onInputBound = this.onInput.bind(this);
    this.onCompositionStartBound = this.onCompositionStart.bind(this);
    this.onCompositionEndBound = this.onCompositionEnd.bind(this);
    this.onCopyBound = this.onCopy.bind(this);
    this.onCutBound = this.onCut.bind(this);
    this.onPasteBound = this.onPaste.bind(this);
    this.onContextMenuBound = this.onContextMenu.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseUpBound = this.onMouseUp.bind(this);

    // F11 브라우저 fullscreen 방지 (capture 단계에서 차단) + 컨트롤 선택 실행
    this.onF11InterceptBound = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          _keyboard.handleShiftF11.call(this);
        } else {
          _keyboard.handleF11.call(this);
        }
      }
    };
    document.addEventListener('keydown', this.onF11InterceptBound, true);

    container.addEventListener('mousedown', this.onClickBound);
    container.addEventListener('dblclick', this.onDblClickBound);
    container.addEventListener('contextmenu', this.onContextMenuBound);
    container.addEventListener('mousemove', this.onMouseMoveBound);
    this.textarea.addEventListener('keydown', this.onKeyDownBound);
    this.textarea.addEventListener('input', this.onInputBound);
    this.textarea.addEventListener('compositionstart', this.onCompositionStartBound);
    this.textarea.addEventListener('compositionend', this.onCompositionEndBound);
    this.textarea.addEventListener('copy', this.onCopyBound);
    this.textarea.addEventListener('cut', this.onCutBound);
    this.textarea.addEventListener('paste', this.onPasteBound);

    // 줌 변경 시 캐럿/선택 마커 위치 갱신
    eventBus.on('zoom-changed', () => this.refreshOverlayPositions());

    // [용지 재중앙화 2026-07-28] 컨테이너 폭이 바뀌면 용지가 가로로 재중앙 정렬되는데
    // (getPageLeftResolved = (clientWidth - pageWidth)/2), 캔버스만 재배치되고 DOM
    // 오버레이는 옛 좌표에 남아 캐럿이 여백 밖에서 깜빡였다(사용자 보고: "새로고침하면
    // 용지가 오른쪽에 있다가 중앙으로 온다"). 부팅 중 사이드바가 뒤늦게 마운트되며
    // clientWidth 가 줄어드는 경우가 대표적 — 줌 변경과 같은 재도색을 태운다.
    eventBus.on('viewport-resize', () => this.refreshOverlayPositions());
    // 용지 가로 위치가 확정/변경되는 순간(부팅 첫 레이아웃 포함) — 가장 확실한 신호
    eventBus.on('page-layout-changed', () => this.refreshOverlayPositions());

    eventBus.on('document-view-changed', () => {
      if (!this.active) return;
      requestAnimationFrame(() => this.updateCaret(true));
    });

    // 표 객체 선택 변경 시 렌더링
    eventBus.on('table-object-selection-changed', (selected) => {
      if (selected) {
        // [캔버스 한컴 포크] 표 개체 선택 시, 미선택 상태에서 떠 있던 hover 핸들 잔상 제거
        this.tableHoverHandles?.hide();
        this.renderTableObjectSelection();
      } else {
        this.tableObjectRenderer?.clear();
        // [캔버스 한컴 포크] 선택 해제 시 "전체 표 잡기" 호버 강조도 정리
        _tableHoverFor(this.container).clear();
      }
    });

    // 문서 변경 후 그림/표 선택 마커 재렌더링
    eventBus.on('document-changed', () => {
      this.refreshMemoOverlay();
      this.refreshGhostOverlay();
      this.refreshTrackOverlay();
      this.scheduleTimeMachineCapture();
      this.protectedCellHitCache = null;
      this.protectedCellHoverEl?.remove();
      this.protectedCellHoverEl = null;
      // [캔버스 한컴 포크] 문서 변경(표 이동·리사이즈)으로 bbox가 바뀌면 옛 위치의 hover 핸들
      // 잔상을 즉시 감춘다(다음 mousemove가 새 위치에서 canShow 판정 후 재표시).
      this.tableHoverHandles?.hide();
      requestAnimationFrame(() => {
        if (this.cursor.isInPictureObjectSelection()) {
          this.renderPictureObjectSelection();
        }
        if (this.cursor.isInTableObjectSelection()) {
          this.renderTableObjectSelection();
        }
        // [커서 정합 2026-07-30] 조판이 바뀌면 캐럿·선택 화면 좌표를 **다시 조회**한다.
        // 예전엔 이 핸들러가 메모·변경추적·개체선택만 손대서, 편집 용지(여백·방향)를 바꾸거나
        // 표를 옮긴 뒤 캐럿이 옛 자리에 남았다(오프셋은 맞고 화면 좌표만 낡음).
        // 개체 선택 중에는 캐럿을 쓰지 않으므로 건드리지 않는다.
        if (this.active
            && !this.cursor.isInPictureObjectSelection()
            && !this.cursor.isInTableObjectSelection()) {
          try {
            this.cursor.updateRect();
            this.updateCaret(true); // skipScroll: 문서 변경이 화면을 끌고 다니지 않게
          } catch (err) {
            console.warn('[InputHandler] document-changed 캐럿 갱신 실패:', err);
          }
        }
      });
    });
    eventBus.on('create-new-document', () => {
      this.clearTableResizeRuntimeCache();
    });
    eventBus.on('open-document-bytes', () => {
      this.clearTableResizeRuntimeCache();
    });

    // [Task #394] 셀 진입 자동 ON 로직 비활성화 — manual 추적 불필요.
    // transparent-borders-changed 이벤트 자체는 view.ts 에서 emit 되므로 보존됨 (다른 구독자가 사용 가능).
    // // 투명선 수동 토글 상태 추적
    // eventBus.on('transparent-borders-changed', (show) => {
    //   this.manualTransparentBorders = show as boolean;
    // });

    // Toolbar에서 서식 적용 요청 수신 (글꼴명, 크기, 색상 — 커맨드 시스템 미경유)
    eventBus.on('format-char', (props) => {
      if (!this.active) return;
      if (this.editMode === 'form') return;
      if (this.cursor.hasSelection()) {
        this.applyCharFormat(props as Partial<CharProperties>);
      } else this.setPendingCharFormat(props as Partial<CharProperties>);
      // 서식바 조작으로 빠진 포커스를 항상 복원
      this.focusTextarea();
    });
  }

  /**
   * 캐럿·선택·핸들 등 **DOM 오버레이의 화면 좌표만** 다시 계산한다(문서 변경 아님).
   * 용지의 화면 위치가 바뀌는 모든 계기 — 줌 변경, 컨테이너 폭 변경(용지 재중앙화) —
   * 에서 같은 경로를 태워야 오버레이가 용지를 따라간다.
   */
  /** 메모 말풍선을 다시 그린다 — 문서·레이아웃·줌 변경 시 */
  /** 변경 추적 마크를 다시 그린다 — 문서·레이아웃·줌 변경 시(메모와 같은 트리거) */
  refreshTrackOverlay(): void {
    try {
      this.trackOverlay.render(this.wasm, this.viewportManager.getZoom());
    } catch { /* 표시용 — 실패 무시 */ }
  }

  refreshMemoOverlay(): void {
    try {
      const memos = this.wasm.getMemos();
      this.memoOverlay.render(memos, this.viewportManager.getZoom(), (m) => {
        try {
          const r = this.wasm.getCursorRect(m.sectionIndex, m.paragraphIndex, 0);
          return r ? { pageIndex: r.pageIndex, x: r.x, y: r.y, height: r.height } : null;
        } catch {
          return null;
        }
      });
    } catch { /* 메모 조회 실패는 무시 — 표시용 기능 */ }
  }

  /**
   * 문단을 묶는 앵커 키 — 타임머신이 "같은 문단의 판들"을 모으는 기준.
   *
   * ⚠ **앞머리 텍스트를 키로 쓰면 안 된다**: 문단을 고칠 때마다 키가 갈라져 판이
   *   흩어진다(2026-08-02 실측 — 3판이 서로 다른 키 2개로 쪼개짐). 정체성은 변하지
   *   않는 값이어야 한다. 그래서 안정 id → 없으면 **위치**(구역/문단) 순으로 쓴다.
   *   (텍스트 앞머리는 정체성이 아니라 재탐색 힌트로만 쓴다 — hint 로 따로 돌려준다.)
   *
   * ponytail: 위치 키는 문단이 삽입/삭제로 밀리면 갈라진다. 안정 id 가 wasm 에 들어오면
   *   자동으로 그쪽이 쓰인다(이 함수만 보면 된다).
   */
  private paragraphAnchorKey(sec: number, para: number): { key: string; hint: string } {
    let hint = '';
    try {
      hint = this.wasm.getTextRange(sec, para, 0, GHOST_HINT_LEN) ?? '';
    } catch { /* 못 읽으면 힌트 없이 */ }
    let sid = '';
    try {
      this.wasm.ensureParagraphStableIds();
      sid = this.wasm.getParagraphStableId(sec, para) ?? '';
    } catch { /* 안정 id 미구현이면 위치로 */ }
    return { key: sid ? `s:${sid}` : `p:${sec}/${para}`, hint };
  }

  /**
   * 편집이 멎으면 그 문단의 지금 모습을 타임머신에 한 판 남긴다.
   * 문서에는 아무것도 안 쓴다(저장은 브라우저 로컬). 같은 내용이면 안 쌓인다.
   *
   * ponytail: 캐럿이 있는 문단 하나만 남긴다 — 붙여넣기로 여러 문단이 한꺼번에 바뀌면
   *   그중 캐럿 문단만 기록된다. 문단별 dirty 추적이 생기면 그때 넓히면 된다.
   */
  private scheduleTimeMachineCapture(): void {
    if (this.timeMachineTimer !== undefined) window.clearTimeout(this.timeMachineTimer);
    this.timeMachineTimer = window.setTimeout(() => {
      this.timeMachineTimer = undefined;
      const pos = this.cursor.getPosition();
      if (!pos) return;
      const sec = pos.sectionIndex;
      const para = pos.paragraphIndex;
      let text = '';
      try {
        text = this.wasm.getTextRange(sec, para, 0, TIME_MACHINE_MAX_CHARS) ?? '';
      } catch {
        return;
      }
      const { key, hint } = this.paragraphAnchorKey(sec, para);
      void saveVersion({
        docKey: this.wasm.fileName || '(제목 없음)',
        anchorKey: key,
        sectionIndex: sec,
        paragraphIndex: para,
        textHint: hint,
        text,
        savedAt: Date.now(),
      }).catch(() => { /* 기록 실패가 편집을 막으면 안 된다 */ });
    }, TIME_MACHINE_IDLE_MS);
  }

  /** 커서 문단의 과거 판들 (최신 앞) */
  async listParagraphVersions(): Promise<ParaVersion[]> {
    const pos = this.cursor.getPosition();
    if (!pos) return [];
    const { key } = this.paragraphAnchorKey(pos.sectionIndex, pos.paragraphIndex);
    return listVersions(this.wasm.fileName || '(제목 없음)', key);
  }

  /**
   * 커서 문단을 그 판의 내용으로 되돌린다 — **그 문단만**. 스냅샷 커맨드라 Ctrl+Z 한 번에
   * 되돌린 것 자체를 다시 취소할 수 있다.
   */
  restoreParagraphVersion(text: string): boolean {
    const pos = this.cursor.getPosition();
    if (!pos) return false;
    const sec = pos.sectionIndex;
    const para = pos.paragraphIndex;
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'timeMachineRestore',
      operation: (): DocumentPosition => {
        const len = this.wasm.getLogicalLength(sec, para);
        if (len > 0) this.wasm.deleteText(sec, para, 0, len);
        if (text) this.wasm.insertText(sec, para, 0, text);
        return { sectionIndex: sec, paragraphIndex: para, charOffset: 0 };
      },
    });
    return true;
  }

  /**
   * 커서 자리에 고스트 코멘트를 단다 — **문서는 전혀 안 바뀐다**(히스토리·dirty 무영향).
   * 앵커는 (구역, 문단, 오프셋) + 문단 앞머리 텍스트. 저장은 브라우저 로컬.
   */
  addGhostComment(text: string): boolean {
    const body = text.trim();
    if (!body) return false;
    const pos = this.cursor.getPosition();
    if (!pos) return false;
    const sec = pos.sectionIndex;
    const para = pos.paragraphIndex;
    let stableId = '';
    try {
      this.wasm.ensureParagraphStableIds();
      stableId = this.wasm.getParagraphStableId(sec, para) ?? '';
    } catch { /* 안정 id 없으면 좌표 앵커만으로 간다 */ }
    let textHint = '';
    try {
      textHint = this.wasm.getTextRange(sec, para, 0, GHOST_HINT_LEN) ?? '';
    } catch { /* 앞머리 못 읽으면 재탐색만 포기 */ }
    void saveGhost({
      id: createGhostId(),
      docKey: this.wasm.fileName || '(제목 없음)',
      stableId,
      sectionIndex: sec,
      paragraphIndex: para,
      charOffset: pos.charOffset,
      textHint,
      text: body,
      addedAt: Date.now(),
    }).then(() => {
      this.ghostOverlay.setVisible(true);
      this.refreshGhostOverlay();
    });
    return true;
  }

  /** 고스트 코멘트 보기 토글 — 반환값은 토글 후 상태 */
  toggleGhostComments(): boolean {
    const next = !this.ghostOverlay.isVisible();
    this.ghostOverlay.setVisible(next);
    if (next) this.refreshGhostOverlay();
    return next;
  }

  /** 이 문서의 고스트 코멘트를 모두 지운다 — 반환값은 지운 개수 */
  async clearGhostComments(): Promise<number> {
    const n = await clearGhosts(this.wasm.fileName || '(제목 없음)');
    this.refreshGhostOverlay();
    return n;
  }

  /** 고스트 코멘트(문서 무변경 로컬 메모) 다시 그리기 — 저장소 조회가 비동기라 fire-and-forget */
  refreshGhostOverlay(): void {
    const docKey = this.wasm.fileName || '(제목 없음)';
    void listGhosts(docKey)
      .then((ghosts) => {
        this.ghostOverlay.render(
          ghosts,
          this.viewportManager.getZoom(),
          (g) => {
            // 앵커: 저장된 (구역, 문단) 을 먼저 쓰고, 문단이 밀렸으면 앞머리 텍스트로 다시 찾는다.
            const target = this.resolveGhostAnchor(g);
            if (!target) return null;
            try {
              const r = this.wasm.getCursorRect(target.sec, target.para, g.charOffset);
              return r ? { pageIndex: r.pageIndex, x: r.x, y: r.y, height: r.height } : null;
            } catch {
              return null;
            }
          },
          (id) => {
            void deleteGhost(id).then(() => this.refreshGhostOverlay());
          },
        );
      })
      .catch(() => { /* 표시용 — 실패 무시 */ });
  }

  /**
   * 고스트 앵커 해소 — 저장 좌표가 그대로면 그걸 쓰고, 문단이 밀렸으면 textHint 로 다시 찾는다.
   * ponytail: 재탐색은 앞뒤 40문단만 훑는다. 문서 전체 스캔이 필요할 만큼 크게 밀리는 편집은
   *   드물고, 못 찾으면 그 메모만 조용히 안 그린다(본문은 절대 안 건드리므로 손실 없음).
   */
  private resolveGhostAnchor(g: { sectionIndex: number; paragraphIndex: number; textHint: string }):
    { sec: number; para: number } | null {
    const sec = g.sectionIndex;
    let count = 0;
    try {
      count = this.wasm.getParagraphCount(sec);
    } catch {
      return null;
    }
    if (count === 0) return null;
    const hint = g.textHint;
    const textAt = (p: number): string => {
      try {
        return this.wasm.getTextRange(sec, p, 0, GHOST_HINT_LEN) ?? '';
      } catch {
        return '';
      }
    };
    if (g.paragraphIndex < count && (!hint || textAt(g.paragraphIndex) === hint)) {
      return { sec, para: g.paragraphIndex };
    }
    if (!hint) return g.paragraphIndex < count ? { sec, para: g.paragraphIndex } : null;
    for (let d = 1; d <= 40; d++) {
      const back = g.paragraphIndex - d;
      const fwd = g.paragraphIndex + d;
      if (back >= 0 && textAt(back) === hint) return { sec, para: back };
      if (fwd < count && textAt(fwd) === hint) return { sec, para: fwd };
    }
    return null;
  }

  private refreshOverlayPositions(): void {
    this.refreshMemoOverlay();
    this.refreshGhostOverlay();
    this.refreshTrackOverlay();
    if (this.active) {
      if (this.cursor.getRect()) {
        this.caret.updatePosition(this.viewportManager.getZoom());
      }
      if (this.fieldMarker.isVisible) {
        this.updateFieldMarkers();
      }
    }
    if (this.cursor.hasSelection()) {
      this.updateSelection();
    }
    if (this.cursor.isInCellSelectionMode()) {
      this.updateCellSelection();
    }
    if (this.cursor.isInPictureObjectSelection()) {
      this.renderPictureObjectSelection();
    }
    if (this.cursor.isInTableObjectSelection()) {
      this.renderTableObjectSelection();
    }
  }

  /** 클릭 이벤트 처리 — hitTest로 커서 배치 */
  private onClick(e: MouseEvent): void {
    _mouse.onClick.call(this, e);
  }

  /** 우클릭 컨텍스트 메뉴 처리 */
  private onContextMenu(e: MouseEvent): void {
    _mouse.onContextMenu.call(this, e);
  }

  /** 더블클릭: 글상자 객체 선택 → 텍스트 편집 진입 */
  private onDblClick(e: MouseEvent): void {
    _mouse.onDblClick.call(this, e);
  }

  /** 마우스 이동: 드래그 선택 또는 표 객체 선택 중 핸들 위 커서 변경 */
  private onMouseMove(e: MouseEvent): void {
    _mouse.onMouseMove.call(this, e);
  }

  /** 표 경계선 hover 감지 처리 */
  private handleResizeHover(e: MouseEvent): void {
    _mouse.handleResizeHover.call(this, e);
  }

  /** 리사이즈 드래그를 시작한다 */
  private startResizeDrag(
    edge: BorderEdge,
    pageX: number, pageY: number,
    pageBboxes: CellBbox[],
    shiftResize = false,
  ): void {
    _table.startResizeDrag.call(this, edge, pageX, pageY, pageBboxes, shiftResize);
  }

  /** 리사이즈 드래그 중 마커 위치를 갱신한다 */
  private updateResizeDrag(e: MouseEvent): void {
    _table.updateResizeDrag.call(this, e);
  }

  /** 리사이즈 드래그를 완료하고 셀 크기를 적용한다 */
  private finishResizeDrag(e: MouseEvent): void {
    _table.finishResizeDrag.call(this, e);
  }

  /** 리사이즈 드래그 상태를 초기화한다 */
  private cleanupResizeDrag(): void {
    _table.cleanupResizeDrag.call(this);
  }

  // [캔버스 한컴 포크] 셀 선택 중 DEL — 행/열 전체면 삭제 모달, 그 외 내용 지우기 3지선다
  private handleCellSelectionDelete(): void {
    _table.handleCellSelectionDelete.call(this);
  }

  // [캔버스 한컴 포크] 캔버스 모드 — 클릭=개체 선택, 재클릭/더블클릭=텍스트 편집 (캔바 손맛).
  // canvasEditingRef = 현재 텍스트 편집 중인 개체(편집 컨텍스트). 없으면 타이핑도 무시된다.
  canvasMode = false;
  canvasEditingRef: { kind: 'table' | 'shape' | 'body'; sec?: number; ppi?: number; ci?: number } | null = null;
  setCanvasMode(on: boolean): void {
    if (this.canvasMode === on) return;
    this.maybeRemoveEmptyCanvasTextbox();
    this.canvasMode = on;
    this.canvasEditingRef = null;
    if (on) {
      // 켜는 시점에 이미 셀/글상자를 편집 중이면 그 개체를 편집 컨텍스트로 승계
      const pos = this.cursor.getPosition();
      if (pos.parentParaIndex !== undefined && pos.controlIndex !== undefined) {
        this.canvasEditingRef = {
          kind: this.cursor.isInTextBox() ? 'shape' : 'table',
          sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex,
        };
      }
    }
    // 모드에 맞춰 본문 캐럿 표시/숨김 조정 (캔버스 모드 무편집 = 커서 없음)
    if (!this.cursor.isInTableObjectSelection() && !this.cursor.isInPictureObjectSelection()) {
      if (this.shouldShowBodyCaret()) {
        const rect = this.cursor.getRect();
        if (rect) this.caret.show(rect, this.viewportManager.getZoom());
      } else {
        this.caret.hide();
      }
    }
    this.eventBus.emit('canvas-mode-changed', on);
  }

  // [캔버스 한컴 포크] 캔버스 모드: 빈 지면 더블클릭 → 클릭 지점(좌상단)에 새 글상자 + 바로 편집.
  // 이전 /studio 캔버스의 insertTextAt 이식 — 기본 80×12mm, 빈 채로 벗어나면 스스로 사라진다.
  private newCanvasTextboxRef: { sec: number; ppi: number; ci: number } | null = null;
  createCanvasTextboxAt(clientX: number, clientY: number, anchor: { sectionIndex: number; paragraphIndex: number; charOffset: number }): void {
    this.maybeRemoveEmptyCanvasTextbox(); // 직전 빈 박스 정리 (연속 더블클릭)
    const sc = this.container.querySelector('#scroll-content');
    if (!sc) return;
    const zoom = this.viewportManager.getZoom();
    const cr = sc.getBoundingClientRect();
    const cX = clientX - cr.left;
    const cY = clientY - cr.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(cX, cY);
    if (pageIdx < 0) return;
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, sc.clientWidth);
    // 종이 좌표(HWPUNIT). 클릭점 = 글상자 좌상단 (찍은 곳에 생기는 느낌 — 이전 시맨틱)
    const paperX = ((cX - pageLeft) / zoom) * 75;
    const paperY = ((cY - pageOffset) / zoom) * 75;
    const W = Math.round(80 * 283.465); // 이전 텍스트 블록 기본 80×12mm
    const H = Math.round(12 * 283.465);
    let horzOffset = Math.round(paperX);
    let vertOffset = Math.round(paperY);
    try {
      // 페이지 밖으로 삐져나가지 않게 클램프 (이전 clampInsertionAxis와 동일 의도)
      const pd = this.wasm.getPageDef(anchor.sectionIndex);
      horzOffset = Math.max(0, Math.min(horzOffset, pd.width - W));
      vertOffset = Math.max(0, Math.min(vertOffset, pd.height - H));
    } catch { /* 페이지 정보 없으면 원좌표 */ }
    try {
      const result = this.wasm.createShapeControl({
        sectionIdx: anchor.sectionIndex,
        paraIdx: anchor.paragraphIndex,
        charOffset: anchor.charOffset,
        width: W,
        height: H,
        horzOffset,
        vertOffset,
        shapeType: 'textbox',
        treatAsChar: false,
        textWrap: 'InFrontOfText',
      });
      if (!result.ok) return;
      this.eventBus.emit('document-changed');
      // 개체 선택을 거치지 않고 바로 텍스트 편집 (이전 autoEdit 감각)
      this.canvasEditingRef = { kind: 'shape', sec: anchor.sectionIndex, ppi: result.paraIdx, ci: result.controlIdx };
      this.newCanvasTextboxRef = { sec: anchor.sectionIndex, ppi: result.paraIdx, ci: result.controlIdx };
      this.enterTextboxEditing(anchor.sectionIndex, result.paraIdx, result.controlIdx);
      this.active = true;
      this.textarea?.focus();
    } catch (err) {
      console.warn('[InputHandler] 캔버스 텍스트 생성 실패:', err);
    }
  }

  // 더블클릭으로 만든 글상자가 빈 채로 편집을 벗어나면 삭제한다 (캔바: 빈 텍스트는 소멸).
  // 반환값 = 실제로 삭제했는가.
  maybeRemoveEmptyCanvasTextbox(): boolean {
    const ref = this.newCanvasTextboxRef;
    this.newCanvasTextboxRef = null;
    if (!ref) return false;
    try {
      const paraCount = this.wasm.getCellParagraphCount(ref.sec, ref.ppi, ref.ci, 0);
      const len = paraCount === 1 ? this.wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, 0) : 1;
      if (paraCount !== 1 || len !== 0) return false;
      // 삭제 전에 커서를 앵커 문단으로 탈출 (stale 커서 방지)
      if (this.cursor.isInPictureObjectSelection()) {
        this.cursor.exitPictureObjectSelection();
        this.pictureObjectRenderer?.clear();
        this.eventBus.emit('picture-object-selection-changed', false);
      }
      this.cursor.clearSelection();
      this.cursor.moveTo({ sectionIndex: ref.sec, paragraphIndex: ref.ppi, charOffset: 0 });
      this.wasm.deleteShapeControl(ref.sec, ref.ppi, ref.ci);
      this.caret.hide();
      this.eventBus.emit('document-changed');
      return true;
    } catch {
      return false;
    }
  }

  // [캔버스 한컴 포크] 캔바 AI 패널이 커서 위치에 여러 줄 텍스트를 삽입 — 검증된 붙여넣기 경로 재사용
  insertPlainTextAtCursor(text: string): void {
    if (!text) return;
    _keyboard.pastePlainText.call(this, text, this.hasSelection());
    this.updateCaret();
    this.eventBus.emit('document-changed');
    this.textarea?.focus();
  }

  // [캔버스 한컴 포크] 표 개체 핸들(e/s/se) 리사이즈 — 커서만 바뀌고 이동으로 소비되던 불일치 해소
  isTableHandleResizing = false;
  tableHandleResizeState: any = null;
  private startTableHandleResize(dir: string, pageX: number, pageY: number, ref: { sec: number; ppi: number; ci: number }, pageIndex: number): boolean {
    return _table.startTableHandleResize.call(this, dir, pageX, pageY, ref, pageIndex);
  }
  private updateTableHandleResize(e: MouseEvent): void {
    _table.updateTableHandleResize.call(this, e);
  }
  private finishTableHandleResize(e: MouseEvent): void {
    _table.finishTableHandleResize.call(this, e);
  }

  // ─── 격자 이동 크기 (mm) ───────────────────────────────
  private gridStepMm = 3; // 기본 3mm

  /** 격자 간격 설정 (mm 단위) */
  setGridStep(mm: number): void { this.gridStepMm = mm; }

  /** 현재 격자 간격 반환 (mm 단위) */
  getGridStepMm(): number { return this.gridStepMm; }

  /** 문서 스냅샷 전환 뒤 표 resize 런타임 캐시를 비운다. */
  private clearTableResizeRuntimeCache(): void {
    this.tableLocalResizeSegments.clear();
    this.cachedTableRef = null;
    this.cachedCellBboxes = null;
    this.tableResizeRenderer?.clear();
  }

  // ─── 그림 삽입 배치 모드 ───────────────────────────────

  /** 그림 배치 모드 진입: 파일 선택 후 호출. 마우스로 영역 지정 대기 */
  enterImagePlacementMode(data: Uint8Array, ext: string, naturalWidth: number, naturalHeight: number, fileName: string = ''): void {
    this.imagePlacementMode = true;
    this.imagePlacementData = { data, ext, fileName, naturalWidth, naturalHeight };
    this.imagePlacementDrag = null;
    this.container.style.cursor = 'crosshair';
  }

  /** 외부 파일 드롭 그림 삽입: 한컴처럼 원본 크기, 글자처럼 취급으로 바로 넣는다. */
  insertDroppedImageAtClientPoint(
    data: Uint8Array,
    ext: string,
    naturalWidth: number,
    naturalHeight: number,
    fileName: string,
    clientX: number,
    clientY: number,
  ): { ok: boolean; error?: string } {
    const pagePoint = this.pagePointFromClientPoint(clientX, clientY);
    if (!pagePoint) {
      return { ok: false, error: '그림을 넣을 문단을 찾지 못했습니다.' };
    }
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      return { ok: false, error: '이미지 크기를 확인할 수 없습니다.' };
    }

    let hit: DocumentPosition | null = null;
    try {
      hit = this.wasm.hitTest(pagePoint.pageIdx, pagePoint.pageX, pagePoint.pageY);
    } catch {
      hit = null;
    }
    if (!hit) {
      return { ok: false, error: '그림을 넣을 문단을 찾지 못했습니다.' };
    }

    const sec = hit.sectionIndex;
    const isTextBoxHit = hit.isTextBox === true;
    const hasPath = (hit.cellPath?.length ?? 0) > 0 && hit.parentParaIndex !== undefined;
    const inCell = hasPath && !isTextBoxHit;
    const inTextBox = hasPath && isTextBoxHit;
    const paraIdx = (inCell || inTextBox) && hit.parentParaIndex !== undefined
      ? hit.parentParaIndex
      : hit.paragraphIndex;
    const cellPath = (inCell || inTextBox) ? hit.cellPath ?? [] : [];
    const cellPathJson = cellPath.length > 0 ? JSON.stringify(cellPath) : '';
    const pageInfo = this.getPageInfoForDrop(pagePoint.pageIdx);
    const { width, height } = fitDroppedImageSizeRaw(naturalWidth, naturalHeight, pageInfo, pagePoint.pageX);
    const desc =
      `그림입니다.\r\n원본 그림의 이름: ${fileName}\r\n원본 그림의 크기: 가로 ${naturalWidth}pixel, 세로 ${naturalHeight}pixel`;

    try {
      // 삽입 + 인라인 전환을 하나의 스냅샷으로 기록 (Undo 지원, pasteImage 경로와 동일 패턴)
      let insertError: string | null = null;
      this.executeOperation({ kind: 'snapshot', operationType: 'insertPicture', operation: (wasm: WasmBridge) => {
        const result = wasm.insertPicture(
          sec,
          paraIdx,
          hit.charOffset,
          cellPathJson,
          data,
          width,
          height,
          naturalWidth,
          naturalHeight,
          ext,
          desc,
          undefined,
          undefined,
        );
        if (!result.ok) {
          insertError = (result as any).error || '삽입 위치 또는 이미지 정보를 확인할 수 없습니다.';
          return hit;
        }

        const logicalOffset = typeof result.logicalOffset === 'number'
          ? result.logicalOffset
          : hit.charOffset + 1;
        const cursorAfter: DocumentPosition = inTextBox
          ? { ...hit, charOffset: logicalOffset }
          : {
              sectionIndex: sec,
              paragraphIndex: result.paraIdx ?? paraIdx,
              charOffset: logicalOffset,
            };

        if (inTextBox && cellPath.length > 0) {
          wasm.setCellPicturePropertiesByPath(
            sec,
            paraIdx,
            cellPath,
            result.controlIdx,
            { treatAsChar: true },
          );
        } else {
          wasm.setPictureProperties(
            sec,
            result.paraIdx ?? paraIdx,
            result.controlIdx,
            { treatAsChar: true },
          );
        }
        this.cursor.clearSelection();
        return cursorAfter;
      }});
      if (insertError) {
        return { ok: false, error: insertError };
      }
      this.active = true;
      this.focusTextarea();
      return { ok: true };
    } catch (err) {
      console.warn('[InputHandler] 드롭 그림 삽입 실패:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 그림 배치 모드 취소 */
  private cancelImagePlacement(): void {
    _table.cancelImagePlacement.call(this);
  }

  /** 그림 배치 사각형 오버레이 표시/갱신 */
  private showImagePlacementOverlay(x1: number, y1: number, x2: number, y2: number): void {
    _table.showImagePlacementOverlay.call(this, x1, y1, x2, y2);
  }

  /** 그림 배치 오버레이 제거 */
  private hideImagePlacementOverlay(): void {
    _table.hideImagePlacementOverlay.call(this);
  }

  /** 그림 배치 완료: 마우스업 시 호출 */
  private finishImagePlacement(e: MouseEvent): void {
    _table.finishImagePlacement.call(this, e);
  }

  // ─── 글상자 삽입 배치 모드 ───────────────────────────────

  /** 글상자 배치 모드 진입: 메뉴에서 호출. 마우스로 영역 지정 대기 */
  enterTextboxPlacementMode(): void {
    // 글상자는 백엔드에서 text_box(내부 문단)를 가진 도형으로 생성되어야 한다.
    // 'rectangle'을 전달하면 text_box 없는 Rectangle이 만들어져 커서 진입·타이핑·붙여넣기가 모두 실패한다(#1280).
    this.shapePlacementType = 'textbox';
    this.textboxPlacementMode = true;
    this.textboxPlacementDrag = null;
    this.container.style.cursor = 'crosshair';
  }

  /** 도형 배치 모드 진입 (도형 타입 지정) */
  enterShapePlacementMode(shapeType: string): void {
    this.shapePlacementType = shapeType;
    if (shapeType.startsWith('connector-')) {
      // 연결선: 개체 연결점 클릭→드래그→연결점 모드
      this.connectorDrawingMode = true;
      this.connectorType = shapeType;
      this.connectorStartRef = null;
      this.container.style.cursor = 'crosshair';
    } else if (shapeType === 'polygon') {
      // 다각형: 클릭-클릭-더블클릭 모드
      this.polygonDrawingMode = true;
      this.polygonPoints = [];
      this.polygonMousePos = null;
      this.container.style.cursor = 'crosshair';
    } else {
      this.textboxPlacementMode = true;
      this.textboxPlacementDrag = null;
      this.container.style.cursor = 'crosshair';
    }
  }

  /** 다각형 그리기: 꼭짓점 추가 (클릭) */
  private polygonAddPoint(clientX: number, clientY: number): void {
    this.polygonPoints.push({ x: clientX, y: clientY });
    this.updatePolygonOverlay(clientX, clientY);
  }

  /** 다각형 그리기: 마우스 이동 시 프리뷰 갱신 */
  private updatePolygonOverlay(mx: number, my: number): void {
    this.polygonMousePos = { x: mx, y: my };
    if (!this.polygonOverlay) {
      this.polygonOverlay = document.createElement('div');
      this.polygonOverlay.style.cssText =
        'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
      document.body.appendChild(this.polygonOverlay);
    }
    const pts = this.polygonPoints;
    if (pts.length === 0) {
      this.polygonOverlay.replaceChildren();
      return;
    }

    const svg = createOverlaySvg();
    // 확정된 변
    for (let i = 0; i < pts.length - 1; i++) {
      appendOverlayLine(svg, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    // 마지막 점 → 마우스 위치 (프리뷰)
    const last = pts[pts.length - 1];
    appendOverlayLine(svg, last.x, last.y, mx, my, true);
    // 꼭짓점 마커
    for (const p of pts) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      setSvgAttrs(circle, {
        cx: p.x,
        cy: p.y,
        r: 3,
        fill: '#fff',
        stroke: '#333',
        'stroke-width': 1,
      });
      svg.appendChild(circle);
    }
    // 크기 표시
    const allX = [...pts.map(p => p.x), mx];
    const allY = [...pts.map(p => p.y), my];
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const zoom = this.viewportManager.getZoom();
    const wMm = ((maxX - minX) / zoom * 25.4 / 96).toFixed(1);
    const hMm = ((maxY - minY) / zoom * 25.4 / 96).toFixed(1);
    const sizeLabel = createOverlayLabel(maxX + 4, maxY + 4, `${wMm} × ${hMm} mm`);

    this.polygonOverlay.replaceChildren(svg, sizeLabel);
  }

  /** 다각형 그리기: 완료 (더블클릭 또는 시작점 근접) */
  private finishPolygonDrawing(): void {
    const pts = this.polygonPoints;
    if (pts.length < 2) { this.cancelPolygonDrawing(); return; }

    // 화면 좌표 → 종이 좌표 (HWPUNIT)
    const zoom = this.viewportManager.getZoom();
    const scrollContent = this.container.querySelector('#scroll-content');
    const contentRect = scrollContent?.getBoundingClientRect();
    if (!contentRect) { this.cancelPolygonDrawing(); return; }

    // bbox 계산
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const wPx = (maxX - minX) / zoom;
    const hPx = (maxY - minY) / zoom;
    const wHwp = Math.round(wPx * 75);
    const hHwp = Math.round(hPx * 75);

    // 종이 좌표로 오프셋 계산
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const cX = centerX - contentRect.left;
    const cY = centerY - contentRect.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(cX, cY);
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageDisplayWidth = this.virtualScroll.getPageWidth(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, (scrollContent as HTMLElement).clientWidth);
    const paperX = ((cX - pageLeft) / zoom) * 75;
    const paperY = ((cY - pageOffset) / zoom) * 75;
    const horzOffset = Math.max(0, Math.round(paperX - wHwp / 2));
    const vertOffset = Math.max(0, Math.round(paperY - hHwp / 2));

    // 꼭짓점을 HWPUNIT 로컬 좌표로 변환 (bbox 기준)
    const pointsHwp = pts.map(p => ({
      x: Math.round(((p.x - minX) / zoom) * 75),
      y: Math.round(((p.y - minY) / zoom) * 75),
    }));

    // 커서 위치
    const cursorPos = this.cursor.getPosition();
    const sec = cursorPos.sectionIndex;
    const paraIdx = cursorPos.paragraphIndex;
    const charOffset = cursorPos.charOffset;

    try {
      const result = this.wasm.createShapeControl({
        sectionIdx: sec,
        paraIdx,
        charOffset,
        width: wHwp || 2250,
        height: hHwp || 2250,
        horzOffset,
        vertOffset,
        shapeType: 'polygon',
        polygonPoints: pointsHwp,
      });
      if (result.ok) {
        this.eventBus.emit('document-changed');
        this.cursor.enterPictureObjectSelectionDirect(sec, result.paraIdx, result.controlIdx, 'shape');
        this.caret.hide();
        this.selectionRenderer.clear();
        this.renderPictureObjectSelection();
        this.eventBus.emit('picture-object-selection-changed', true);
      }
    } catch (err) {
      console.warn('[InputHandler] 다각형 삽입 실패:', err);
    }

    this.cancelPolygonDrawing();
  }

  /** 다각형 그리기: 취소 */
  private cancelPolygonDrawing(): void {
    this.polygonDrawingMode = false;
    this.polygonPoints = [];
    this.polygonMousePos = null;
    if (this.polygonOverlay) {
      this.polygonOverlay.remove();
      this.polygonOverlay = null;
    }
    this.container.style.cursor = '';
  }

  /** 글상자 배치 모드 취소 */
  private cancelTextboxPlacement(): void {
    this.textboxPlacementMode = false;
    this.textboxPlacementDrag = null;
    this.hideTextboxPlacementOverlay();
    this.container.style.cursor = '';
  }

  /** 도형 배치 오버레이 표시/갱신 (도형 타입별 SVG) */
  private showTextboxPlacementOverlay(x1: number, y1: number, x2: number, y2: number, shiftKey = false): void {
    if (!this.textboxPlacementOverlay) {
      this.textboxPlacementOverlay = document.createElement('div');
      this.textboxPlacementOverlay.style.cssText =
        'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
      document.body.appendChild(this.textboxPlacementOverlay);
    }
    const type = this.shapePlacementType;

    const zoom = this.viewportManager.getZoom();
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    // mm 크기 계산 (96dpi 기준: 1px = 25.4/96 mm)
    const wMm = (w / zoom * 25.4 / 96).toFixed(1);
    const hMm = (h / zoom * 25.4 / 96).toFixed(1);
    const sizeLabel = createOverlayLabel(left + w + 4, top + h + 4, `${wMm} × ${hMm} mm`);

    const svg = createOverlaySvg();
    let customLabel: HTMLDivElement | null = null;
    if (type === 'line') {
      let ex = x2, ey = y2;
      if (shiftKey) {
        const dx = x2 - x1, dy = y2 - y1;
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.sqrt(dx * dx + dy * dy);
        ex = x1 + dist * Math.cos(snapAngle);
        ey = y1 + dist * Math.sin(snapAngle);
      }
      if (this.textboxPlacementDrag && shiftKey) {
        this.textboxPlacementDrag.currentClientX = ex;
        this.textboxPlacementDrag.currentClientY = ey;
      }
      appendOverlayLine(svg, x1, y1, ex, ey, true);
      // 직선: 길이 표시
      const lenPx = Math.hypot(ex - x1, ey - y1);
      const lenMm = (lenPx / zoom * 25.4 / 96).toFixed(1);
      const mx = (x1 + ex) / 2, my = (y1 + ey) / 2;
      customLabel = createOverlayLabel(mx + 8, my + 8, `${lenMm} mm`);
    } else if (type === 'ellipse') {
      const cx = left + w / 2, cy = top + h / 2;
      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      setSvgAttrs(ellipse, {
        cx,
        cy,
        rx: w / 2,
        ry: h / 2,
        fill: 'rgba(0,0,0,0.05)',
        stroke: '#333',
        'stroke-width': 2,
        'stroke-dasharray': '6,3',
      });
      svg.appendChild(ellipse);
    } else if (type === 'arc') {
      // 호: 사각형에 내접하는 타원의 1/4 호
      // 우상 사분면: 상단 중앙 → 우측 중앙
      const rx = w / 2, ry = h / 2;
      if (rx > 1 && ry > 1) {
        const cx = left + w / 2, cy = top + h / 2;
        // 시작: 상단 중앙 (cx, top), 끝: 우측 중앙 (left+w, cy)
        const path = document.createElementNS(SVG_NS, 'path');
        setSvgAttrs(path, {
          d: `M ${cx} ${top} A ${rx} ${ry} 0 0 1 ${left + w} ${cy}`,
          fill: 'none',
          stroke: '#333',
          'stroke-width': 2,
          'stroke-dasharray': '6,3',
        });
        svg.appendChild(path);
        // 보조선: 내접 사각형
        const guide = document.createElementNS(SVG_NS, 'rect');
        setSvgAttrs(guide, {
          x: left,
          y: top,
          width: w,
          height: h,
          fill: 'none',
          stroke: '#ccc',
          'stroke-width': 1,
          'stroke-dasharray': '3,3',
        });
        svg.appendChild(guide);
      }
    } else if (type === 'polygon') {
      // 다각형: 삼각형 프리뷰
      const tx = left + w / 2, ty = top;
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      setSvgAttrs(polygon, {
        points: `${tx},${ty} ${left + w},${top + h} ${left},${top + h}`,
        fill: 'rgba(0,0,0,0.05)',
        stroke: '#333',
        'stroke-width': 2,
        'stroke-dasharray': '6,3',
      });
      svg.appendChild(polygon);
    } else {
      // rectangle / textbox
      const rect = document.createElementNS(SVG_NS, 'rect');
      setSvgAttrs(rect, {
        x: left,
        y: top,
        width: w,
        height: h,
        fill: 'rgba(0,0,0,0.05)',
        stroke: '#333',
        'stroke-width': 2,
        'stroke-dasharray': '6,3',
      });
      svg.appendChild(rect);
    }

    const label = customLabel || (w > 5 || h > 5 ? sizeLabel : null);
    this.textboxPlacementOverlay.replaceChildren(...(label ? [svg, label] : [svg]));
  }

  /** 도형 배치 오버레이 제거 */
  private hideTextboxPlacementOverlay(): void {
    if (this.textboxPlacementOverlay) {
      this.textboxPlacementOverlay.remove();
      this.textboxPlacementOverlay = null;
    }
  }

  /** 글상자 배치 완료: 마우스업 시 호출 */
  private finishTextboxPlacement(e: MouseEvent): void {
    const drag = this.textboxPlacementDrag;
    if (!drag) { this.cancelTextboxPlacement(); return; }

    this.hideTextboxPlacementOverlay();

    // 커서 위치에 도형 컨트롤 삽입 (한컴 동작: 커서 위치에 인라인 컨트롤 배치)
    const cursorPos = this.cursor.getPosition();
    const hit = {
      sectionIndex: cursorPos.sectionIndex,
      paragraphIndex: cursorPos.paragraphIndex,
      charOffset: cursorPos.charOffset,
    };
    if (hit.sectionIndex === undefined) { this.cancelTextboxPlacement(); return; }

    const sec = hit.sectionIndex;
    const paraIdx = hit.paragraphIndex;
    const charOffset = hit.charOffset;

    // 크기 결정
    const zoom = this.viewportManager.getZoom();
    let wPx: number, hPx: number;
    if (drag.isDragging) {
      wPx = Math.abs(drag.currentClientX - drag.startClientX) / zoom;
      hPx = Math.abs(drag.currentClientY - drag.startClientY) / zoom;
      const isLineType = this.shapePlacementType === 'line' || this.shapePlacementType.startsWith('connector-');
      if (!isLineType) {
        if (wPx < 10) wPx = 10;
        if (hPx < 10) hPx = 10;
      }
    } else {
      // 클릭만 한 경우
      const mm30 = 30 * 96 / 25.4; // ≈113.4 px
      if (this.shapePlacementType === 'line' || this.shapePlacementType.startsWith('connector-')) {
        wPx = mm30; hPx = 0; // 수평 직선/연결선
      } else {
        wPx = mm30; hPx = mm30;
      }
    }

    // px → HWPUNIT (1px = 75 HWPUNIT at 96 DPI)
    let wHwp = Math.round(wPx * 75);
    let hHwp = Math.round(hPx * 75);

    // 열 폭 초과 시 비례 축소
    try {
      const pageDef = this.wasm.getPageDef(sec);
      const colWidth = pageDef.width - pageDef.marginLeft - pageDef.marginRight;
      if (wHwp > colWidth) {
        const ratio = colWidth / wHwp;
        wHwp = Math.round(colWidth);
        hHwp = Math.round(hHwp * ratio);
      }
    } catch { /* 페이지 정보 없으면 그대로 */ }

    // 도형 위치 계산 (종이 기준 오프셋, HWPUNIT)
    // [Task #1280 v2] 글상자도 floating(InFrontOfText)으로 삽입하므로 종이 기준 오프셋을
    //   계산한다(기존 사각형 등과 동일 경로). 수정 전엔 글상자만 인라인이라 offset=0 으로 스킵했다.
    let horzOffset = 0;
    let vertOffset = 0;
    {
      // 드래그 영역 중심점의 화면 좌표
      const centerX = (drag.startClientX + drag.currentClientX) / 2;
      const centerY = (drag.startClientY + drag.currentClientY) / 2;
      // 화면 좌표 → 종이 좌표 (px, 줌 보정 전)
      const scrollContent = this.container.querySelector('#scroll-content');
      if (scrollContent) {
        const contentRect = scrollContent.getBoundingClientRect();
        const cX = centerX - contentRect.left;
        const cY = centerY - contentRect.top;
        const pageIdx = this.virtualScroll.getPageAtPoint(cX, cY);
        const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
        const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
        // 종이 좌표 (px → HWPUNIT)
        const paperX = ((cX - pageLeft) / zoom) * 75;
        const paperY = ((cY - pageOffset) / zoom) * 75;
        // 도형 좌상단 = 중심점 - 반폭/반높이
        horzOffset = Math.max(0, Math.round(paperX - wHwp / 2));
        vertOffset = Math.max(0, Math.round(paperY - hHwp / 2));
      }
    }

    // 직선 방향 결정: 드래그 시작→끝의 X/Y 방향
    let lineFlipX = false;
    let lineFlipY = false;
    if ((this.shapePlacementType === 'line' || this.shapePlacementType.startsWith('connector-')) && drag.isDragging) {
      lineFlipX = drag.currentClientX < drag.startClientX;
      lineFlipY = drag.currentClientY < drag.startClientY;
    }

    // WASM 호출로 도형 생성
    try {
      // [Task #1280 v2] 삽입 글상자는 한컴 정답값 floating(treat_as_char=false) + 글앞으로
      //   (InFrontOfText)로 생성한다. 그래야 글상자 위 어울림(Square) 이미지가 글상자 뒤로 가고
      //   (plane 3>2), 로드된 기존 글상자(이미 floating)와도 정합한다.
      const isTextbox = this.shapePlacementType === 'textbox';
      const result = this.wasm.createShapeControl({
        sectionIdx: sec,
        paraIdx,
        charOffset,
        width: wHwp,
        height: hHwp,
        horzOffset,
        vertOffset,
        shapeType: this.shapePlacementType,
        lineFlipX,
        lineFlipY,
        ...(isTextbox ? { treatAsChar: false, textWrap: 'InFrontOfText' } : {}),
      });
      if (result.ok) {
        this.eventBus.emit('document-changed');
        // 생성된 도형을 선택 상태로 진입
        const selType = (this.shapePlacementType === 'line' || this.shapePlacementType.startsWith('connector-')) ? 'line' : 'shape';
        this.cursor.enterPictureObjectSelectionDirect(sec, result.paraIdx, result.controlIdx, selType);
        this.caret.hide();
        this.selectionRenderer.clear();
        this.renderPictureObjectSelection();
        this.eventBus.emit('picture-object-selection-changed', true);
      }
    } catch (err) {
      console.warn('[InputHandler] 글상자 삽입 실패:', err);
    }

    // 모드 종료
    this.textboxPlacementMode = false;
    this.textboxPlacementDrag = null;
    this.container.style.cursor = '';
  }

  /** 표 객체 선택 모드에서 방향키로 표 위치 이동 */
  private moveSelectedTable(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _table.moveSelectedTable.call(this, key);
  }

  /** 그림 객체 선택 모드에서 방향키로 그림 위치 이동 */
  private moveSelectedPicture(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _table.moveSelectedPicture.call(this, key);
  }

  /** 그림 객체 선택 모드에서 Shift+방향키로 개체 크기 조절 (#1231) */
  private resizeSelectedPicture(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _picture.resizeSelectedPicture.call(this, key);
  }

  /** [캔버스 한컴 포크] 다중 선택 개체 정렬 (좌/중/우/상/중/하/간격분배) — 커맨드에서 호출 */
  alignSelectedObjects(mode: AlignMode): void {
    _picture.alignSelectedObjects.call(this, mode);
  }

  /** 마우스 드래그로 표 이동 — 드래그 중 갱신 */
  private updateMoveDrag(e: MouseEvent): void {
    _table.updateMoveDrag.call(this, e);
  }

  /** 마우스 드래그로 표 이동 — 드래그 종료 */
  private finishMoveDrag(): void {
    _table.finishMoveDrag.call(this);
  }

  /** [캔버스 한컴 포크] 셀 선택 Alt+방향키 = 경계선 전체 이동(이웃 보상, 표 유지) */
  private resizeCellBoundaryWhole(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _table.resizeCellBoundaryWhole.call(this, key);
  }

  /** [캔버스 한컴 포크] 셀 선택 Shift+방향키 = 단일 셀 경계만 이동(가로=모델·세로=localResize) */
  private resizeCellBoundarySingle(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _table.resizeCellBoundarySingle.call(this, key);
  }

  private resizeTableProportional(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    _table.resizeTableProportional.call(this, key);
  }

  /** 마우스 버튼 놓기: 드래그 선택 종료 */
  private onMouseUp(_e: MouseEvent): void {
    _mouse.onMouseUp.call(this, _e);
  }

  /** 마우스 이벤트에서 hitTest 결과를 반환한다 */
  private hitTestFromEvent(e: MouseEvent): DocumentPosition | null {
    return this.hitTestFromClientPoint(e.clientX, e.clientY);
  }

  /** 화면 좌표에서 hitTest 결과를 반환한다 */
  private hitTestFromClientPoint(clientX: number, clientY: number): DocumentPosition | null {
    const pagePoint = this.pagePointFromClientPoint(clientX, clientY);
    if (!pagePoint) return null;
    try {
      return this.wasm.hitTest(pagePoint.pageIdx, pagePoint.pageX, pagePoint.pageY);
    } catch {
      return null;
    }
  }

  private pagePointFromClientPoint(clientX: number, clientY: number): PagePoint | null {
    const zoom = this.viewportManager.getZoom();
    const scrollContent = this.container.querySelector('#scroll-content');
    if (!scrollContent) return null;
    const contentRect = scrollContent.getBoundingClientRect();
    // [Task #661 + #685+#689 통합] PR #718 영역 의 clientX/Y parameter 영역 +
    // PR #693 영역 의 getPageAtPoint (그리드 모드 click 좌표 정합) 보존.
    const contentX = clientX - contentRect.left;
    const contentY = clientY - contentRect.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(contentX, contentY);
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
    const pageX = (contentX - pageLeft) / zoom;
    const pageY = (contentY - pageOffset) / zoom;
    return { pageIdx, pageX, pageY };
  }

  private getPageInfoForDrop(pageIdx: number): PageInfo | null {
    try {
      return this.wasm.getPageInfo(pageIdx);
    } catch {
      return null;
    }
  }

  /** 화면 좌표에서 각주/미주 내부 hitTest 결과를 반환한다. */
  private footnoteHitTestFromClientPoint(clientX: number, clientY: number): {
    pageIdx: number;
    hit: {
      hit: boolean;
      fnParaIndex?: number;
      charOffset?: number;
      footnoteIndex?: number;
      cursorRect?: { pageIndex: number; x: number; y: number; height: number };
    };
  } | null {
    const zoom = this.viewportManager.getZoom();
    const scrollContent = this.container.querySelector('#scroll-content');
    if (!scrollContent) return null;
    const contentRect = scrollContent.getBoundingClientRect();
    const contentX = clientX - contentRect.left;
    const contentY = clientY - contentRect.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(contentX, contentY);
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
    const pageX = (contentX - pageLeft) / zoom;
    const pageY = (contentY - pageOffset) / zoom;
    try {
      return { pageIdx, hit: this.wasm.hitTestInFootnote(pageIdx, pageX, pageY) };
    } catch {
      return null;
    }
  }

  /** 텍스트 선택 드래그를 시작한다 */
  private startTextSelectionDrag(e: MouseEvent): void {
    this.isDragging = true;
    this.dragLastClientX = e.clientX;
    this.dragLastClientY = e.clientY;
    document.addEventListener('mousemove', this.onMouseMoveBound);
  }

  /** 텍스트 선택 드래그 포인터 좌표를 갱신한다 */
  private updateTextSelectionDragPointer(e: MouseEvent): void {
    this.dragLastClientX = e.clientX;
    this.dragLastClientY = e.clientY;
    this.updateTextSelectionDragAutoScroll();
  }

  /** 마지막 포인터 좌표 기준으로 드래그 선택 focus를 갱신한다 */
  private updateTextSelectionDragFromPointer(): void {
    if (!this.isDragging) return;

    if (this.cursor.isInFootnote()) {
      const fnHit = this.footnoteHitTestFromClientPoint(this.dragLastClientX, this.dragLastClientY);
      if (
        fnHit?.hit.hit &&
        fnHit.hit.footnoteIndex === this.cursor.fnFootnoteIndex &&
        fnHit.hit.fnParaIndex !== undefined &&
        fnHit.hit.charOffset !== undefined
      ) {
        this.cursor.setFnCursorPosition(fnHit.hit.fnParaIndex, fnHit.hit.charOffset);
        this.updateCaretDuringDrag();
      }
      return;
    }

    const hit = this.hitTestFromClientPoint(this.dragLastClientX, this.dragLastClientY);
    if (hit && hit.paragraphIndex < 0xFFFFFF00) {
      // [Issue #669] 셀 내부 드래그: anchor와 같은 셀 컨텍스트인 경우만 커서 이동.
      // 셀↔본문 혼합은 선택 렌더링 불가이므로 무시 (셀 내 선택 유지).
      const sel = this.cursor.getSelection();
      if (sel) {
        const anchorInCell = sel.anchor.parentParaIndex !== undefined;
        const hitInSameCell = anchorInCell &&
          hit.parentParaIndex === sel.anchor.parentParaIndex &&
          hit.controlIndex === sel.anchor.controlIndex &&
          hit.cellIndex === sel.anchor.cellIndex;
        if (anchorInCell && !hitInSameCell) {
          return;
        }
      }
      this.cursor.moveTo(hit);
      this.updateCaretDuringDrag();
    }
  }

  /** 텍스트 선택 드래그를 종료한다 */
  private stopTextSelectionDrag(): void {
    this.isDragging = false;
    this.cellSelectionDragCandidate = null;
    document.removeEventListener('mousemove', this.onMouseMoveBound);
    this.stopTextSelectionDragAutoScroll();
  }

  private getTextSelectionDragScrollDeltaY(): number {
    const rect = this.container.getBoundingClientRect();
    const topEdge = rect.top + DRAG_SCROLL_EDGE_PX;
    const bottomEdge = rect.top + this.container.clientHeight - DRAG_SCROLL_EDGE_PX;
    const clientY = this.dragLastClientY;

    if (clientY < topEdge) {
      return -this.scaleTextSelectionDragScrollStep(topEdge - clientY);
    }
    if (clientY > bottomEdge) {
      return this.scaleTextSelectionDragScrollStep(clientY - bottomEdge);
    }
    return 0;
  }

  private scaleTextSelectionDragScrollStep(distance: number): number {
    const ratio = Math.min(1, Math.max(0, distance / DRAG_SCROLL_EDGE_PX));
    return Math.round(DRAG_SCROLL_MIN_STEP_PX + (DRAG_SCROLL_MAX_STEP_PX - DRAG_SCROLL_MIN_STEP_PX) * ratio);
  }

  private updateTextSelectionDragAutoScroll(): void {
    if (!this.isDragging) {
      this.stopTextSelectionDragAutoScroll();
      return;
    }
    if (this.getTextSelectionDragScrollDeltaY() === 0) {
      this.stopTextSelectionDragAutoScroll();
      return;
    }
    if (!this.dragAutoScrollRafId) {
      this.dragAutoScrollRafId = requestAnimationFrame(() => this.runTextSelectionDragAutoScroll());
    }
  }

  private runTextSelectionDragAutoScroll(): void {
    this.dragAutoScrollRafId = 0;
    if (!this.isDragging) return;

    const deltaY = this.getTextSelectionDragScrollDeltaY();
    if (deltaY === 0) return;

    const before = this.container.scrollTop;
    const maxScrollTop = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    this.container.scrollTop = Math.max(0, Math.min(maxScrollTop, before + deltaY));

    if (this.container.scrollTop === before) return;

    this.updateTextSelectionDragFromPointer();
    this.dragAutoScrollRafId = requestAnimationFrame(() => this.runTextSelectionDragAutoScroll());
  }

  private stopTextSelectionDragAutoScroll(): void {
    if (this.dragAutoScrollRafId) {
      cancelAnimationFrame(this.dragAutoScrollRafId);
      this.dragAutoScrollRafId = 0;
    }
  }

  /** 클릭 좌표가 표 외곽 경계선 위인지 판별한다 (페이지 좌표 기준) */
  private isTableBorderClick(
    pageX: number, pageY: number,
    sec: number, ppi: number, ci: number,
  ): boolean {
    try {
      const bbox = this.wasm.getTableBBox(sec, ppi, ci);
      const tolerance = 5; // 페이지 좌표 기준 px
      const nearLeft = Math.abs(pageX - bbox.x) <= tolerance;
      const nearRight = Math.abs(pageX - (bbox.x + bbox.width)) <= tolerance;
      const nearTop = Math.abs(pageY - bbox.y) <= tolerance;
      const nearBottom = Math.abs(pageY - (bbox.y + bbox.height)) <= tolerance;
      // 세로 범위 내 좌/우 경계, 가로 범위 내 상/하 경계
      const inVertRange = pageY >= bbox.y - tolerance && pageY <= bbox.y + bbox.height + tolerance;
      const inHorzRange = pageX >= bbox.x - tolerance && pageX <= bbox.x + bbox.width + tolerance;
      return (nearLeft && inVertRange) || (nearRight && inVertRange) ||
             (nearTop && inHorzRange) || (nearBottom && inHorzRange);
    } catch {
      return false;
    }
  }

  /** [Task #919] 클릭 좌표가 (sec, ppi, ci) 글상자의 외곽 경계선 위인지 판정.
   *  isShapeBorderClick(picture 모듈) 의 sec/ppi/ci 변형 — getShapeBBox API 사용
   *  tolerance 5px 한컴 정합 (Native bbox + 5px 안). */
  isShapeBorderClickByRef(
    pageX: number, pageY: number,
    sec: number, ppi: number, ci: number,
  ): boolean {
    try {
      const bbox = this.wasm.getShapeBBox(sec, ppi, ci);
      const tolerance = 5;
      const nearLeft = Math.abs(pageX - bbox.x) <= tolerance;
      const nearRight = Math.abs(pageX - (bbox.x + bbox.width)) <= tolerance;
      const nearTop = Math.abs(pageY - bbox.y) <= tolerance;
      const nearBottom = Math.abs(pageY - (bbox.y + bbox.height)) <= tolerance;
      const inVertRange = pageY >= bbox.y - tolerance && pageY <= bbox.y + bbox.height + tolerance;
      const inHorzRange = pageX >= bbox.x - tolerance && pageX <= bbox.x + bbox.width + tolerance;
      return (nearLeft && inVertRange) || (nearRight && inVertRange) ||
             (nearTop && inHorzRange) || (nearBottom && inHorzRange);
    } catch {
      return false;
    }
  }

  /** [Task #919] 클릭 좌표 근처에 글상자가 있는지 확인 (글상자 바깥에서 외곽 근처 클릭) */
  findShapeByOuterClick(
    pageX: number, pageY: number,
    sec: number, paragraphIndex: number,
  ): { sec: number; ppi: number; ci: number } | null {
    // 현재 문단 및 인접 문단 (±2) 검사 — findTableByOuterClick 동일 패턴
    for (let offset = 0; offset <= 2; offset++) {
      const candidates = offset === 0
        ? [paragraphIndex]
        : [paragraphIndex - offset, paragraphIndex + offset];
      for (const ppi of candidates) {
        if (ppi < 0) continue;
        // Shape 컨트롤은 paragraph 의 어느 위치든 있을 수 있으므로 0..N 시도
        for (let ci = 0; ci < 10; ci++) {
          if (this.isShapeBorderClickByRef(pageX, pageY, sec, ppi, ci)) {
            return { sec, ppi, ci };
          }
        }
      }
    }
    return null;
  }

  /**
   * 클릭 좌표 근처에 표가 있는지 확인한다 (표 바깥에서 클릭한 경우).
   * 페이지 레이아웃의 실제 표 컨트롤 인덱스를 우선 사용하고, 보조로 주변 문단을 검사한다.
   */
  private findTableByOuterClick(
    pageIdx: number,
    pageX: number, pageY: number,
    sec: number, paragraphIndex: number,
  ): { sec: number; ppi: number; ci: number } | null {
    try {
      const layout = this.wasm.getPageControlLayout(pageIdx);
      const tolerance = 5;
      const isNearBorder = (x: number, y: number, w: number, h: number): boolean => {
        const nearLeft = Math.abs(pageX - x) <= tolerance;
        const nearRight = Math.abs(pageX - (x + w)) <= tolerance;
        const nearTop = Math.abs(pageY - y) <= tolerance;
        const nearBottom = Math.abs(pageY - (y + h)) <= tolerance;
        const inVertRange = pageY >= y - tolerance && pageY <= y + h + tolerance;
        const inHorzRange = pageX >= x - tolerance && pageX <= x + w + tolerance;
        return (nearLeft && inVertRange) || (nearRight && inVertRange) ||
               (nearTop && inHorzRange) || (nearBottom && inHorzRange);
      };

      for (const item of layout.controls) {
        if (item.type !== 'table') continue;
        if (item.paraIdx === undefined || item.controlIdx === undefined) continue;
        if ((item.secIdx ?? sec) !== sec) continue;
        if (Math.abs(item.paraIdx - paragraphIndex) > 2) continue;
        if (isNearBorder(item.x, item.y, item.w, item.h)) {
          return { sec: item.secIdx ?? sec, ppi: item.paraIdx, ci: item.controlIdx };
        }
      }
    } catch { /* 레이아웃 조회 실패 시 주변 문단 스캔으로 보조 */ }

    // 현재 문단 및 인접 문단 (±2) 검사. 컨트롤 인덱스는 0 고정이 아니므로 일부 범위를 시도한다.
    for (let offset = 0; offset <= 2; offset++) {
      const candidates = offset === 0
        ? [paragraphIndex]
        : [paragraphIndex - offset, paragraphIndex + offset];
      for (const ppi of candidates) {
        if (ppi < 0) continue;
        for (let ci = 0; ci < 10; ci++) {
          if (this.isTableBorderClick(pageX, pageY, sec, ppi, ci)) {
            return { sec, ppi, ci };
          }
        }
      }
    }
    return null;
  }

  /** 표 객체 선택 상태 컨텍스트 메뉴 항목 */
  private getTableObjectContextMenuItems(): ContextMenuItem[] {
    return [
      { type: 'command', commandId: 'edit:cut' },
      { type: 'command', commandId: 'edit:copy' },
      { type: 'command', commandId: 'edit:paste' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:caption-toggle', label: '캡션 넣기(A)' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:cell-props', label: '표 속성' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:delete' },
    ];
  }

  /** 그림 객체 선택 컨텍스트 메뉴 항목 */
  private getPictureObjectContextMenuItems(): ContextMenuItem[] {
    const ref = this.cursor.getSelectedPictureRef();

    // 다중 선택: 개체 묶기 메뉴
    if (this.cursor.isMultiPictureSelection()) {
      return [
        { type: 'command', commandId: 'insert:group-shapes', label: '개체 묶기(G)' },
        { type: 'separator' },
        { type: 'command', commandId: 'insert:picture-delete', label: '지우기(D)' },
      ];
    }

    const items: ContextMenuItem[] = [
      { type: 'command', commandId: 'edit:cut' },
      { type: 'command', commandId: 'edit:copy' },
      { type: 'command', commandId: 'edit:paste' },
      { type: 'separator' },
    ];
    // [캔버스 한컴 포크] 글상자: AI 대화형 수정 (셀 안 글상자 제외 — 1-depth만)
    if (ref?.type === 'shape' && !ref.cellPath) {
      items.unshift(
        { type: 'command', commandId: 'ai:edit-shape', label: 'AI에게 수정하기…' },
        { type: 'separator' },
      );
    }
    // 수식 객체: "수식 편집..." 항목 추가
    if (ref?.type === 'equation') {
      items.push(
        { type: 'command', commandId: 'insert:equation-edit', label: '수식 편집...' },
        { type: 'separator' },
      );
    }
    items.push(
      { type: 'command', commandId: 'insert:arrange-front', label: '맨 앞으로' },
      { type: 'command', commandId: 'insert:arrange-forward', label: '앞으로' },
      { type: 'command', commandId: 'insert:arrange-backward', label: '뒤로' },
      { type: 'command', commandId: 'insert:arrange-back', label: '맨 뒤로' },
      { type: 'separator' },
    );
    // 그룹 개체: 개체 풀기
    if (ref?.type === 'group') {
      items.push(
        { type: 'command', commandId: 'insert:ungroup-shapes', label: '개체 풀기(U)' },
        { type: 'separator' },
      );
    }
    // 그림/도형 객체: 캡션 넣기
    if (ref?.type === 'image' || ref?.type === 'shape') {
      items.push(
        { type: 'command', commandId: 'insert:caption-toggle', label: '캡션 넣기(A)' },
      );
    }
    items.push(
      { type: 'command', commandId: 'insert:picture-props', label: '개체 속성(P)...' },
      { type: 'separator' },
      { type: 'command', commandId: 'insert:picture-delete', label: '지우기(D)' },
    );
    return items;
  }

  /** 표 셀 내부 컨텍스트 메뉴 항목 */
  private getTableContextMenuItems(): ContextMenuItem[] {
    return [
      { type: 'command', commandId: 'edit:cut' },
      { type: 'command', commandId: 'edit:copy' },
      { type: 'command', commandId: 'edit:paste' },
      { type: 'command', commandId: 'edit:format-copy' },
      { type: 'command', commandId: 'edit:format-paste' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:cell-props', label: '셀 속성' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:insert-row-col' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:delete-row-col' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:cell-height-equal' },
      { type: 'command', commandId: 'table:cell-width-equal' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:cell-merge' },
      { type: 'command', commandId: 'table:cell-split' },
      { type: 'command', commandId: 'table:transpose-copy' },
      { type: 'command', commandId: 'table:transpose-paste' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:border-each', label: '셀 테두리/배경 - 각 셀마다 적용(E)...' },
      { type: 'command', commandId: 'table:border-one', label: '셀 테두리/배경 - 하나의 셀처럼 적용(Z)...' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:caption-toggle', label: '캡션 넣기(A)' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:formula', label: '계산식(F)...' },
      { type: 'separator' },
      { type: 'command', commandId: 'table:delete' },
    ];
  }

  /** 일반 컨텍스트 메뉴 항목 */
  private getDefaultContextMenuItems(): ContextMenuItem[] {
    return [
      { type: 'command', commandId: 'edit:cut' },
      { type: 'command', commandId: 'edit:copy' },
      { type: 'command', commandId: 'edit:paste' },
      { type: 'command', commandId: 'edit:format-copy' },
      { type: 'command', commandId: 'edit:format-paste' },
      { type: 'command', commandId: 'table:transpose-paste' },
      { type: 'separator' },
      { type: 'command', commandId: 'format:char-shape', label: '글자 모양' },
      { type: 'command', commandId: 'format:para-shape', label: '문단 모양' },
      { type: 'separator' },
      { type: 'command', commandId: 'format:para-num-shape', label: '문단 번호 모양(N)...' },
    ];
  }

  /** 특수 키 처리 (Backspace, Enter, 화살표, Ctrl+Z/Y) */
  private onKeyDown(e: KeyboardEvent): void {
    // 잠긴 셀: 타이핑은 readOnly 로 조용히 죽는다 — 왜 안 되는지는 알려준다(이동·복사는 그대로)
    if ((e.key.length === 1 || e.key === 'Process') && !e.ctrlKey && !e.metaKey && !e.altKey
        && this.textarea.readOnly && this.cursorLockedCell()) {
      this.notifyCellLockBlocked();
    }
    _keyboard.onKeyDown.call(this, e);
  }

  /** Ctrl/Meta 단축키 처리 */
  private handleCtrlKey(e: KeyboardEvent): void {
    _keyboard.handleCtrlKey.call(this, e);
  }

  /** Ctrl+A: 전체 선택 */
  private handleSelectAll(): void {
    _keyboard.handleSelectAll.call(this);
  }

  // ─── 클립보드 이벤트 처리 ─────────────────────────────

  /** 복사 이벤트 처리 */
  private onCopy(e: ClipboardEvent): void {
    _keyboard.onCopy.call(this, e);
  }

  /** 잘라내기 이벤트 처리 */
  private onCut(e: ClipboardEvent): void {
    _keyboard.onCut.call(this, e);
  }

  /** 붙여넣기 이벤트 처리 */
  private onPaste(e: ClipboardEvent): void {
    _keyboard.onPaste.call(this, e);
  }

  // ─── 서식 적용 ─────────────────────────────────────────

  /** 선택 범위에 글자 서식을 적용한다 */
  private applyCharFormat(props: Partial<CharProperties>): void {
    const sel = this.cursor.getSelectionOrdered();
    if (!sel) return;
    const cmd = new ApplyCharFormatCommand(sel.start, sel.end, props);
    this.executeOperation({ kind: 'command', command: cmd });
  }

  /** 토글 서식 적용 (상호 배타 처리 포함) */
  private applyToggleFormat(prop: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'emboss' | 'engrave' | 'outline' | 'superscript' | 'subscript'): void {
    if (!this.cursor.hasSelection()) { _pend.togglePending.call(this, prop); return; }  // 대기 서식
    const current = this.getCharPropertiesAtCursor();

    if (prop === 'emboss') {
      const newVal = !current.emboss;
      const mods: Partial<CharProperties> = { emboss: newVal };
      if (newVal) mods.engrave = false;
      this.applyCharFormat(mods);
    } else if (prop === 'engrave') {
      const newVal = !current.engrave;
      const mods: Partial<CharProperties> = { engrave: newVal };
      if (newVal) mods.emboss = false;
      this.applyCharFormat(mods);
    } else if (prop === 'outline') {
      const curOutline = current.outlineType ?? 0;
      this.applyCharFormat({ outlineType: curOutline ? 0 : 1 });
    } else if (prop === 'superscript') {
      const newVal = !current.superscript;
      const mods: Partial<CharProperties> = { superscript: newVal };
      if (newVal) mods.subscript = false;
      this.applyCharFormat(mods);
    } else if (prop === 'subscript') {
      const newVal = !current.subscript;
      const mods: Partial<CharProperties> = { subscript: newVal };
      if (newVal) mods.superscript = false;
      this.applyCharFormat(mods);
    } else {
      this.applyCharFormat({ [prop]: !current[prop] });
    }
  }

  /** 대기 서식 — 상태만 여기, 구현은 pending-format.ts */
  pendingChar: Partial<CharProperties> | null = null;
  pendingAt: string | null = null;
  setPendingCharFormat(props: Partial<CharProperties>): void { _pend.setPendingCharFormat.call(this, props); }
  getPendingCharFormat(): Partial<CharProperties> | null { return _pend.getPendingCharFormat.call(this); }
  getPendingOrCurrentChar(): CharProperties { return _pend.getPendingOrCurrentChar.call(this); }
  applyPendingToInserted(pos: DocumentPosition, length: number): void { _pend.applyPendingToInserted.call(this, pos, length); }

  /** 커서 위치의 글자 서식을 조회한다 */
  getCharPropertiesAtCursor(): CharProperties {
    const pos = this.cursor.getPosition();
    // offset이 0이면 해당 위치, 아니면 offset-1 위치의 서식 반환 (커서 앞 글자 기준)
    const queryOffset = pos.charOffset > 0 ? pos.charOffset - 1 : 0;
    if (pos.parentParaIndex !== undefined) {
      return this.wasm.getCellCharPropertiesAt(
        pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,
        pos.cellIndex!, pos.cellParaIndex!, queryOffset,
      );
    }
    return this.wasm.getCharPropertiesAt(pos.sectionIndex, pos.paragraphIndex, queryOffset);
  }

  /** 커서 위치 문단에 문단 서식을 적용한다 */
  private applyParaFormat(props: Record<string, unknown>): void {
    try {
      const targets = this.getParaFormatTargetsAtCursor();
      this.executeParaFormatCommand(targets, props);
    } catch (err) {
      console.warn('[InputHandler] applyParaFormat 실패:', err);
    }
  }

  private executeParaFormatCommand(targets: ParaFormatTarget[], props: Record<string, unknown>): boolean {
    if (targets.length === 0) {
      console.info('[InputHandler] 문단 서식 Undo/Redo: unsupported context');
      return false;
    }
    const cmd = new ApplyParaFormatCommand(targets, props as Partial<ParaProperties>, this.cursor.getPosition());
    this.executeOperation({ kind: 'command', command: cmd });
    return true;
  }

  private getParaFormatTargetsAtCursor(): ParaFormatTarget[] {
    const sel = this.cursor.getSelectionOrdered();
    if (sel) return this.getParaFormatTargetsForRange(sel.start, sel.end);
    const pos = this.cursor.getPosition();
    return this.getParaFormatTargetsForRange(pos, pos);
  }

  private getParaFormatTargetsForRange(start: DocumentPosition, end: DocumentPosition): ParaFormatTarget[] {
    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return [];
    if (start.isTextBox || end.isTextBox) return [];
    if ((start.cellPath?.length ?? 0) > 1 || (end.cellPath?.length ?? 0) > 1) return [];

    const startInCell = start.parentParaIndex !== undefined;
    const endInCell = end.parentParaIndex !== undefined;
    if (startInCell || endInCell) {
      if (!startInCell || !endInCell) return [];
      if (start.sectionIndex !== end.sectionIndex) return [];
      if (start.parentParaIndex !== end.parentParaIndex) return [];
      const startPath = start.cellPath?.[0];
      const endPath = end.cellPath?.[0];
      const startControl = startPath?.controlIndex ?? start.controlIndex;
      const endControl = endPath?.controlIndex ?? end.controlIndex;
      const startCell = startPath?.cellIndex ?? start.cellIndex;
      const endCell = endPath?.cellIndex ?? end.cellIndex;
      const startCellPara = startPath?.cellParaIndex ?? start.cellParaIndex;
      const endCellPara = endPath?.cellParaIndex ?? end.cellParaIndex;
      if (
        startControl === undefined ||
        endControl === undefined ||
        startCell === undefined ||
        endCell === undefined ||
        startCellPara === undefined ||
        endCellPara === undefined ||
        startControl !== endControl ||
        startCell !== endCell
      ) {
        return [];
      }
      const from = Math.min(startCellPara, endCellPara);
      const to = Math.max(startCellPara, endCellPara);
      const targets: ParaFormatTarget[] = [];
      for (let cp = from; cp <= to; cp++) {
        targets.push({
          kind: 'cell',
          sec: start.sectionIndex,
          parentPara: start.parentParaIndex!,
          controlIdx: startControl,
          cellIdx: startCell,
          cellParaIdx: cp,
        });
      }
      return targets;
    }

    if (start.sectionIndex !== end.sectionIndex) return [];
    const from = Math.min(start.paragraphIndex, end.paragraphIndex);
    const to = Math.max(start.paragraphIndex, end.paragraphIndex);
    const targets: ParaFormatTarget[] = [];
    for (let p = from; p <= to; p++) {
      targets.push({ kind: 'body', sec: start.sectionIndex, para: p });
    }
    return targets;
  }

  /** 한컴식 Shift+Tab: 첫 줄 시작 위치를 기준으로 문단 내어쓰기를 설정한다. */
  applyHangingIndentAtCursor(): boolean {
    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) {
      console.info('[InputHandler] Shift+Tab hanging indent: unsupported note/header context');
      return false;
    }

    const pos = this.cursor.getPosition();
    if (pos.isTextBox || (pos.cellPath?.length ?? 0) > 1) {
      console.info('[InputHandler] Shift+Tab hanging indent: unsupported nested/textbox context');
      return false;
    }

    try {
      let cursorRect: CursorRect | null = this.cursor.getRect();
      let firstLineStartRect: CursorRect;

      if (pos.parentParaIndex !== undefined) {
        const pathEntry = pos.cellPath?.[0];
        const controlIndex = pathEntry?.controlIndex ?? pos.controlIndex;
        const cellIndex = pathEntry?.cellIndex ?? pos.cellIndex;
        const cellParaIndex = pathEntry?.cellParaIndex ?? pos.cellParaIndex;

        if (controlIndex === undefined || cellIndex === undefined || cellParaIndex === undefined) {
          console.warn('[InputHandler] Shift+Tab hanging indent: incomplete cell position', pos);
          return false;
        }

        const firstLineInfo = this.wasm.getLineInfoInCell(
          pos.sectionIndex,
          pos.parentParaIndex,
          controlIndex,
          cellIndex,
          cellParaIndex,
          0,
        );

        if (pos.cellPath?.length === 1) {
          const pathJson = JSON.stringify(pos.cellPath);
          firstLineStartRect = this.wasm.getCursorRectByPath(
            pos.sectionIndex,
            pos.parentParaIndex,
            pathJson,
            firstLineInfo.charStart,
          );
          cursorRect ??= this.wasm.getCursorRectByPath(
            pos.sectionIndex,
            pos.parentParaIndex,
            pathJson,
            pos.charOffset,
          );
        } else {
          firstLineStartRect = this.wasm.getCursorRectInCell(
            pos.sectionIndex,
            pos.parentParaIndex,
            controlIndex,
            cellIndex,
            cellParaIndex,
            firstLineInfo.charStart,
          );
          cursorRect ??= this.wasm.getCursorRectInCell(
            pos.sectionIndex,
            pos.parentParaIndex,
            controlIndex,
            cellIndex,
            cellParaIndex,
            pos.charOffset,
          );
        }

        const hangingPx = computeHangingIndentPx(cursorRect.x, firstLineStartRect.x);
        this.executeParaFormatCommand(
          [{
            kind: 'cell',
            sec: pos.sectionIndex,
            parentPara: pos.parentParaIndex,
            controlIdx: controlIndex,
            cellIdx: cellIndex,
            cellParaIdx: cellParaIndex,
          }],
          { indent: -pxToRaw2x(hangingPx) },
        );
        return true;
      }

      const firstLineInfo = this.wasm.getLineInfo(pos.sectionIndex, pos.paragraphIndex, 0);
      firstLineStartRect = this.wasm.getCursorRect(
        pos.sectionIndex,
        pos.paragraphIndex,
        firstLineInfo.charStart,
      );
      cursorRect ??= this.wasm.getCursorRect(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);

      const hangingPx = computeHangingIndentPx(cursorRect.x, firstLineStartRect.x);
      this.executeParaFormatCommand(
        [{ kind: 'body', sec: pos.sectionIndex, para: pos.paragraphIndex }],
        { indent: -pxToRaw2x(hangingPx) },
      );
      return true;
    } catch (err) {
      console.warn('[InputHandler] Shift+Tab hanging indent 실패:', err);
      return false;
    }
  }

  /** 커서 위치 서식 상태를 Toolbar에 알린다 */
  private emitCursorFormatState(): void {
    if (!this.active) return;
    try {
      const props = this.getCharPropertiesAtCursor();
      this.eventBus.emit('cursor-format-changed', props);
    } catch {
      // 문서 없거나 위치 초과 시 무시
    }
    // 문단 속성 (눈금자 마커용) + 스타일
    try {
      const pos = this.cursor.getPosition();
      const inFootnote = this.cursor.isInFootnote();
      const inCell = !inFootnote && pos.parentParaIndex !== undefined;
      const paraProps = inFootnote
        ? this.wasm.getParaPropertiesInFootnote(
            this.cursor.fnSectionIdx,
            this.cursor.fnParaIdx,
            this.cursor.fnControlIdx,
            this.cursor.fnInnerParaIdx,
          )
        : inCell
        ? this.wasm.getCellParaPropertiesAt(
            pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!,
            pos.cellIndex!, pos.cellParaIndex!,
          )
        : this.wasm.getParaPropertiesAt(pos.sectionIndex, pos.paragraphIndex);
      this.eventBus.emit('cursor-para-changed', paraProps);

      // 스타일 드롭다운 갱신용
      try {
        const styleInfo = inCell
          ? this.wasm.getCellStyleAt(
              pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!,
              pos.cellIndex!, pos.cellParaIndex!,
            )
          : this.wasm.getStyleAt(pos.sectionIndex, pos.paragraphIndex);
        this.eventBus.emit('cursor-style-changed', styleInfo);
      } catch { /* 스타일 조회 실패 시 무시 */ }

      // 셀 영역 정보 (눈금자 셀 너비 표시용)
      // getTableCellBboxes는 대형/중첩 표에서 수 초 동안 main thread를 막을 수 있다.
      // 일반 커서 이동/텍스트 입력 경로에서는 새 bbox 조회를 하지 않고, 표 hover/resize 경로에서
      // 이미 확보한 캐시가 있을 때만 재사용한다.
      if (inCell) {
        const cellKey = `${pos.sectionIndex}:${pos.parentParaIndex}:${pos.controlIndex}:${pos.cellIndex}`;
        if (cellKey !== this.lastCellKey) {
          this.lastCellKey = cellKey;
          const sec = pos.sectionIndex;
          const ppi = pos.parentParaIndex!;
          const ci = pos.controlIndex!;
          const cellIdx = pos.cellIndex!;
          const cached = this.cachedTableRef?.sec === sec
            && this.cachedTableRef.ppi === ppi
            && this.cachedTableRef.ci === ci
            ? this.cachedCellBboxes
            : null;
          const bbox = cached?.find(b => b.cellIdx === cellIdx);
          if (bbox) {
            this.eventBus.emit('cursor-cell-changed', {
              inCell: true, cellX: bbox.x, cellWidth: bbox.w,
            });
          } else {
            this.eventBus.emit('cursor-cell-changed', { inCell: false });
          }
        }
      } else if (this.lastCellKey !== null) {
        this.lastCellKey = null;
        this.eventBus.emit('cursor-cell-changed', { inCell: false });
      }
    } catch {
      // 무시
    }
  }

  /** 선택 영역을 삭제한다 */
  private deleteSelection(): void {
    const sel = this.cursor.getSelectionOrdered();
    if (!sel) return;
    if (!this.canDeleteSelectionInFormMode()) return;

    // [범위 삭제 2026-07-30] 선택이 인라인 표·그림을 덮으면 한컴처럼 컨트롤까지 함께
    // 지운다(부록2 O8 — 확인 대화상자 없음). 텍스트만 되돌리는 DeleteSelectionCommand
    // 로는 undo 에서 컨트롤이 살아나지 않으므로 스냅샷 연산으로 처리한다.
    if (this.selectionSpansInlineControl(sel.start, sel.end)) {
      this.cursor.clearSelection();
      this.executeOperation({ kind: 'snapshot', operationType: 'deleteSelection', operation: (wasm: WasmBridge) => {
        wasm.deleteRangeLogical(
          sel.start.sectionIndex,
          sel.start.paragraphIndex, sel.start.charOffset,
          sel.end.paragraphIndex, sel.end.charOffset,
        );
        return { ...sel.start };
      }});
      return;
    }

    const cmd = new DeleteSelectionCommand(sel.start, sel.end);
    this.cursor.clearSelection();
    this.executeOperation({ kind: 'command', command: cmd });
  }

  /** 본문 선택이 인라인(글자취급) 컨트롤을 덮는가 — 셀 안 선택은 규격 부재로 false */
  private selectionSpansInlineControl(start: DocumentPosition, end: DocumentPosition): boolean {
    if (start.parentParaIndex !== undefined || end.parentParaIndex !== undefined) return false;
    try {
      for (let p = start.paragraphIndex; p <= end.paragraphIndex; p++) {
        const from = p === start.paragraphIndex ? start.charOffset : 0;
        const to = p === end.paragraphIndex
          ? end.charOffset
          : this.wasm.getLogicalLength(start.sectionIndex, p);
        for (let off = from; off < to; off++) {
          if (this.wasm.getInlineControlIndexAtLogical(start.sectionIndex, p, off) >= 0) return true;
        }
      }
    } catch { /* 조회 실패는 종전 경로로 */ }
    return false;
  }

  /** Undo 처리 */
  private handleUndo(): void {
    const newPos = this.history.undo(this.wasm);
    if (newPos) {
      this.clearFormObjectSelection(); // 스냅숏 복원 뒤 개체 인덱스가 낡는다
      this.clearTableResizeRuntimeCache();
      this.cursor.moveTo(newPos);
      this.afterEdit();
    }
  }

  /** Redo 처리 */
  private handleRedo(): void {
    const newPos = this.history.redo(this.wasm);
    if (newPos) {
      this.clearFormObjectSelection();
      this.clearTableResizeRuntimeCache();
      this.cursor.moveTo(newPos);
      this.afterEdit();
    }
  }

  /**
   * 편집 작업 통합 라우터.
   * 호출부는 OperationDescriptor로 "무엇을 하려는가"만 서술하고,
   * 라우터가 적절한 Undo 전략을 자동 선택한다.
   */
  executeOperation(desc: OperationDescriptor): void {
    if (!this.isOperationAllowedInEditMode(desc)) return;
    // 잠긴 셀(셀 보호): **내용** 편집만 라우터에서 차단한다. 속성 적용(objectProps — 셀 패널의
    // patchCell 경로)은 면제 — 안 그러면 「셀 보호」 해제 스위치까지 스스로 막는다(2026-08-04 실측).
    // ponytail: 커서 위치 기준 판정 — 표 구조 명령(직접 wasm 경로)은 v1 미차단.
    const isPropsOp = desc.kind === 'snapshot' && desc.operationType === 'objectProps';
    if (!isPropsOp && this.cursorLockedCell()) { this.notifyCellLockBlocked(); return; }
    // [변경 추적] ON 이면 텍스트 명령을 스냅샷으로 승격한다 — 구현·이유는 track-review.ts
    const promoted = _track.promoteWhileTracking?.call(this, desc);
    if (promoted) desc = promoted;
    switch (desc.kind) {
      case 'command': {
        const beforePos = this.cursor.getPosition();
        const beforePageIndex = this.cursor.getRect()?.pageIndex;
        const keepFieldStartOutside = (desc.command.type === 'insertText' || desc.command.type === 'deleteText')
          && this.isExitedFieldStartPosition(beforePos);
        if (keepFieldStartOutside) {
          this.wasm.clearActiveField();
        }
        const newPos = this.history.execute(desc.command, this.wasm);
        // 글자/문단 서식 변경은 문서 구조 불변 → 선택 영역 유지
        if (desc.command.type !== 'applyCharFormat' && desc.command.type !== 'applyParaFormat') {
          this.cursor.moveTo(newPos);
          this.cursor.resetPreferredX();
        }
        if (keepFieldStartOutside) {
          this.markCurrentFieldStartOutside();
        }
        this.refreshAfterOperation(desc.meta?.refresh, 'auto', desc.command.type, beforePos, newPos, {
          ...desc.command.getPageLocalTextEditOptions?.(),
          beforePageIndex,
          afterPageIndex: this.cursor.getRect()?.pageIndex,
        });
        break;
      }
      case 'snapshot': {
        const cursorBefore = this.cursor.getPosition();
        const cmd = new SnapshotCommand(desc.operationType, cursorBefore, cursorBefore, desc.operation);
        const newPos = this.history.execute(cmd, this.wasm);
        const markPastedFieldEndOutside = this.pastedFieldEndOutsidePending;
        this.pastedFieldEndOutsidePending = false;
        this.cursor.moveTo(newPos);
        this.cursor.resetPreferredX();
        if (markPastedFieldEndOutside) {
          this.markCurrentFieldEndOutside();
        }
        this.refreshAfterOperation(desc.meta?.refresh, 'full', desc.operationType, cursorBefore, newPos);
        break;
      }
      case 'record': {
        const pos = this.cursor.getPosition();
        this.history.recordWithoutExecute(desc.command, this.wasm);
        this.refreshAfterOperation(desc.meta?.refresh, 'none', desc.command.type, pos, pos);
        break;
      }
    }
  }

  /** Backspace 처리 */
  private handleBackspace(pos: DocumentPosition, inCell: boolean): void {
    _text.handleBackspace.call(this, pos, inCell);
  }

  /** Delete 처리 */
  private handleDelete(pos: DocumentPosition, inCell: boolean): void {
    _text.handleDelete.call(this, pos, inCell);
  }

  /** IME 조합 시작 */
  private onCompositionStart(): void {
    _text.onCompositionStart.call(this);
  }

  /** IME 조합 완료 — 조합 텍스트를 Command로 기록 */
  private onCompositionEnd(): void {
    _text.onCompositionEnd.call(this);
  }

  /** 위치에서 텍스트를 읽는다 (본문/셀 자동 분기) */
  private getTextAt(pos: DocumentPosition, count: number): string {
    return _text.getTextAt.call(this, pos, count);
  }

  /** 텍스트 입력 처리 (textarea input 이벤트) */
  private onInput(e?: Event): void {
    _text.onInput.call(this, e as InputEvent);
  }

  /** 위치에 텍스트를 삽입한다 (WASM 직접 호출, IME 조합용) */
  private insertTextAtRaw(pos: DocumentPosition, text: string): void {
    _text.insertTextAtRaw.call(this, pos, text);
    this.applyPendingToInserted(pos, text.length);  // 대기 서식 (IME 조합 경로)
  }

  /** 위치에서 텍스트를 삭제한다 (WASM 직접 호출, IME 조합용) */
  private deleteTextAt(pos: DocumentPosition, count: number): void {
    _text.deleteTextAt.call(this, pos, count);
  }

  /** textarea에 포커스를 설정한다 (iOS 호환) */
  /** 편집기 포커스 복원 — 커맨드(삽입 등)가 끝난 뒤 키 입력이 살아나게 */
  focusTextarea(): void {
    // 양식 오버레이(캡션·내용 입력)가 떠 있으면 편집기가 포커스를 뺏으면 안 된다 —
    // 뺏기면 사용자가 친 글이 개체가 아니라 **본문에 들어간다**(2026-08-03 배포본 실측).
    if (this.formOverlay) return;
    this.textarea.focus();
  }

  /** 편집 후 처리: 재렌더링 + 캐럿 갱신 */
  private afterEdit(): void {
    this.flushDeferredPaginationIfNeeded('before-full-edit', false);
    this.lastCellKey = null; // 편집 후 셀 bbox 캐시 무효화
    this.protectedCellHitCache = null;
    this.eventBus.emit('document-mutated', 'input-handler-edit');
    this.eventBus.emit('document-changed');
    this.updateCaret();
  }

  /** 셀 내부 단일 텍스트 편집 후 처리: 현재 페이지 canvas만 갱신한다. */
  private afterPageLocalEdit(): void {
    if (this.flushDeferredPaginationForCellOverflow()) return;

    // 텍스트 입력은 셀 폭을 바꾸지 않으므로 눈금자 셀 bbox 캐시를 무효화하지 않는다.
    this.protectedCellHitCache = null;
    this.eventBus.emit('document-mutated', 'input-handler-edit');
    const pageIndex = this.cursor.getRect()?.pageIndex;
    if (typeof pageIndex === 'number' && Number.isInteger(pageIndex) && pageIndex >= 0) {
      this.eventBus.emit('document-page-invalidated', { pageIndex, reason: 'text-edit' });
    } else {
      this.eventBus.emit('document-changed');
    }
    this.scheduleDeferredPaginationFlush();
    this.updateCaret();
  }

  /** 셀 안 새 줄이 기존 가시 높이를 넘으면 즉시 전체 표 레이아웃을 다시 계산한다. */
  private flushDeferredPaginationForCellOverflow(): boolean {
    if (!this.cursor.getRect()?.cellOverflowed) return false;

    this.cancelDeferredPaginationFlush();
    try {
      this.wasm.flushDeferredPagination();
      this.deferredPaginationPending = false;
      this.lastCellKey = null;
      this.protectedCellHitCache = null;
      this.eventBus.emit('document-mutated', 'input-handler-cell-overflow');
      this.eventBus.emit('document-changed', 'cell-overflow-pagination');
      this.cursor.moveTo(this.cursor.getPosition());
      this.updateCaret();
      return true;
    } catch (err) {
      console.warn('[InputHandler] 셀 overflow 페이지네이션 flush 실패:', err);
      return false;
    }
  }

  private scheduleDeferredPaginationFlush(): void {
    this.cancelDeferredPaginationFlush();
    this.deferredPaginationPending = true;
    if (!this.shouldAutoFlushDeferredPagination()) {
      return;
    }
    this.deferredPaginationFlushTimer = setTimeout(() => {
      this.flushDeferredPaginationIfNeeded('idle-auto');
    }, DEFERRED_PAGINATION_AUTO_FLUSH_DELAY_MS);
  }

  private cancelDeferredPaginationFlush(): void {
    if (this.deferredPaginationFlushTimer) {
      clearTimeout(this.deferredPaginationFlushTimer);
      this.deferredPaginationFlushTimer = null;
    }
  }

  private shouldAutoFlushDeferredPagination(): boolean {
    return this.wasm.pageCount <= DEFERRED_PAGINATION_AUTO_FLUSH_PAGE_LIMIT;
  }

  hasDeferredPaginationPending(): boolean {
    return this.deferredPaginationPending;
  }

  flushDeferredPaginationIfNeeded(reason = 'manual', emitChange = true): boolean {
    const shouldFlush = this.deferredPaginationPending || this.deferredPaginationFlushTimer !== null;
    this.cancelDeferredPaginationFlush();
    if (!shouldFlush) return false;

    try {
      this.wasm.flushDeferredPagination();
      this.deferredPaginationPending = false;
      if (emitChange) {
        this.eventBus.emit('document-changed', `deferred-pagination-flush:${reason}`);
      }
      return true;
    } catch (err) {
      this.deferredPaginationPending = true;
      console.warn('[InputHandler] 지연 페이지네이션 flush 실패:', err);
      return false;
    }
  }

  /** raw IME/iOS 텍스트 입력처럼 command를 거치지 않는 경로의 갱신 라우터. */
  private afterTextInputEdit(
    beforePos: DocumentPosition,
    afterPos: DocumentPosition,
    pageLocalOptions: PageLocalTextEditOptions = {},
  ): void {
    if (this.shouldUsePageLocalRefresh('insertText', beforePos, afterPos, pageLocalOptions)) {
      this.afterPageLocalEdit();
    } else {
      this.afterEdit();
    }
  }

  private refreshAfterOperation(
    requested: RefreshPolicy | undefined,
    fallback: RefreshPolicy,
    commandType: string,
    beforePos: DocumentPosition,
    afterPos: DocumentPosition,
    pageLocalOptions: PageLocalTextEditOptions = {},
  ): void {
    const policy = requested ?? fallback;
    switch (policy) {
      case 'none':
        return;
      case 'selectionOnly':
        this.updateCaret();
        return;
      case 'pageLocal':
        this.afterPageLocalEdit();
        return;
      case 'full':
        this.afterEdit();
        return;
      case 'auto':
      default:
        if (this.shouldUsePageLocalRefresh(commandType, beforePos, afterPos, pageLocalOptions)) {
          this.afterPageLocalEdit();
        } else {
          this.afterEdit();
        }
    }
  }

  private shouldUsePageLocalRefresh(
    commandType: string,
    beforePos: DocumentPosition,
    afterPos: DocumentPosition,
    pageLocalOptions: PageLocalTextEditOptions = {},
  ): boolean {
    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return false;
    return isPageLocalTextEditCommand(commandType, beforePos, afterPos, pageLocalOptions);
  }

  /**
   * 캐럿 위치를 갱신한다.
   *
   * @param skipScroll true 시 `scrollCaretIntoView` 호출 skip — cursor 변경 trigger 가 동반되지 않은
   *                   onMouseUp (예: drag-during-scroll 영역, scrollbar release 영역) 의 자동 scroll back
   *                   결함 차단 영역. (Task #779)
   */
  private updateCaret(skipScroll: boolean = false): void {
    this.updateCellLockState();
    const rect = this.cursor.getRect();
    if (rect) {
      const zoom = this.viewportManager.getZoom();
      const caretRect = this.adjustExitedFieldEndCaretRect(rect);

      // IME 조합 중: 블랙박스 캐럿 표시
      if (this.isComposing && this.compositionAnchor && this.compositionLength > 0) {
        try {
          const anchor = this.compositionAnchor;
          let startRect: CursorRect;
          if (this.cursor.isInHeaderFooter()) {
            const isHeader = this.cursor.headerFooterMode === 'header';
            startRect = this.wasm.getCursorRectInHeaderFooter(
              this.cursor.hfSectionIdx, isHeader, this.cursor.hfApplyTo,
              this.cursor.hfParaIdx, anchor.charOffset, this.cursor.getRect()?.pageIndex ?? 0,
            )!;
          } else if (this.cursor.isInFootnote()) {
            startRect = this.wasm.getCursorRectInFootnote(
              this.cursor.fnPageNum, this.cursor.fnFootnoteIndex,
              this.cursor.fnInnerParaIdx, anchor.charOffset,
            )!;
          } else if ((anchor.cellPath?.length ?? 0) > 1 && anchor.parentParaIndex !== undefined) {
            startRect = this.wasm.getCursorRectByPath(
              anchor.sectionIndex, anchor.parentParaIndex,
              JSON.stringify(anchor.cellPath), anchor.charOffset,
            );
          } else if (anchor.parentParaIndex !== undefined) {
            startRect = this.wasm.getCursorRectInCell(
              anchor.sectionIndex, anchor.parentParaIndex,
              anchor.controlIndex!, anchor.cellIndex!,
              anchor.cellParaIndex!, anchor.charOffset,
            );
          } else {
            startRect = this.wasm.getCursorRect(
              anchor.sectionIndex, anchor.paragraphIndex, anchor.charOffset,
            );
          }
          const charWidth = rect.x - startRect.x;
          const text = this.textarea.value || '';
          // 현재 커서 위치의 글꼴 정보
          let fontFamily = 'sans-serif';
          try {
            const props = this.getCharPropertiesAtCursor();
            if (props.fontFamily) fontFamily = props.fontFamily;
          } catch { /* fallback */ }
          this.caret.showComposition(startRect, charWidth, zoom, text, fontFamily);
        } catch {
          // getCursorRect 실패 시 일반 캐럿
          this.caret.hideComposition();
          this.caret.update(rect, zoom);
        }
      } else {
        this.caret.hideComposition();
        this.caret.update(caretRect, zoom);
      }
      if (!skipScroll) {
        this.scrollCaretIntoView(caretRect);
      }
    } else {
      // [커서 정합 2026-07-30] rect 조회 실패(개체 삭제·컨테이너 소멸·범위 초과)에서 예전엔
      // 아무것도 하지 않아 **옛 좌표의 캐럿이 화면에 얼어붙어** 남았다. 유효 위치를 못 찾으면
      // 캐럿을 감춘다 — 다음 유효 갱신에서 다시 나타난다.
      this.caret.hideComposition();
      this.caret.hide();
    }
    this.updateSelection();
    this.emitCursorFormatState();
    // [Task #394] 셀 진입 자동 ON 로직 비활성화 — 한컴 출력 정합성을 위해 OFF 기본값 유지.
    // 되돌리려면 아래 호출 + line ~1520 의 동일 호출 + 메서드 본체 / 상태 변수 / 이벤트 핸들러
    // 의 주석을 동시에 풀면 이전 동작 복원.
    // this.checkTransparentBordersTransition();
    this.updateFieldMarkers();
    // 눈금자 다단 영역 표시용 커서 좌표 전달
    const cursorRect = this.cursor.getRect();
    if (cursorRect) {
      const adjustedCursorRect = this.adjustExitedFieldEndCaretRect(cursorRect);
      this.eventBus.emit('cursor-rect-updated', { x: adjustedCursorRect.x, y: adjustedCursorRect.y });
    }
  }

  /** 빈 누름틀 끝 바깥 상태에서는 caret을 안내문 오른쪽에 둔다. */
  private adjustExitedFieldEndCaretRect(rect: CursorRect): CursorRect {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (!fi.inField || fi.fieldType !== 'clickhere' || !fi.isGuide || !fi.guideName) {
        return rect;
      }
      if (!this.isAtExitedFieldEnd(pos, fi)) return rect;

      const guideRect = this.findGuideTextRect(rect, fi.guideName);
      if (guideRect) {
        return { ...rect, x: guideRect.x + guideRect.width };
      }

      const measured = this.measureGuideTextWidth(fi.guideName, rect);
      return measured > 0 ? { ...rect, x: rect.x + measured } : rect;
    } catch {
      return rect;
    }
  }

  private findGuideTextRect(
    caretRect: CursorRect,
    guideName: string,
  ): { x: number; y: number; width: number; height: number } | null {
    let best: { x: number; y: number; width: number; height: number; score: number } | null = null;
    try {
      const tree = this.wasm.getPageLayerTreeObject(caretRect.pageIndex);
      const visit = (node: LayerNode | undefined): void => {
        if (!node) return;
        if (node.kind === 'group') {
          for (const child of node.children) visit(child);
          return;
        }
        if (node.kind === 'clipRect') {
          visit(node.child);
          return;
        }
        for (const op of node.ops) {
          if (op.type !== 'textRun') continue;
          const textOp = op as LayerTextRunOp;
          if (textOp.text !== guideName) continue;
          const b = textOp.bbox;
          const score = Math.abs(b.y - caretRect.y) + Math.abs(b.x - caretRect.x) * 0.25;
          if (!best || score < best.score) {
            best = { x: b.x, y: b.y, width: b.width, height: b.height, score };
          }
        }
      };
      visit(tree.root);
    } catch {
      return null;
    }
    const found = best as { x: number; y: number; width: number; height: number; score: number } | null;
    return found ? { x: found.x, y: found.y, width: found.width, height: found.height } : null;
  }

  private measureGuideTextWidth(guideName: string, rect: CursorRect): number {
    const measure = (globalThis as { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth;
    if (typeof measure !== 'function') return 0;
    try {
      const props = this.getCharPropertiesAtCursor();
      const fontFamily = props.fontFamily || 'sans-serif';
      const font = `italic ${Math.max(1, rect.height)}px ${fontFamily}`;
      return measure(font, guideName);
    } catch {
      return 0;
    }
  }

  /** 캐럿 위치를 갱신하되 스크롤하지 않는다 (머리말/꼬리말 닫기 등) */
  private updateCaretNoScroll(): void {
    const rect = this.cursor.getRect();
    if (rect) {
      this.caret.update(rect, this.viewportManager.getZoom());
    }
    this.updateSelection();
    this.emitCursorFormatState();
    // [Task #394] 셀 진입 자동 ON 로직 비활성화 — 위 updateCaretAndScroll 의 코멘트 참고.
    // this.checkTransparentBordersTransition();
  }

  /** 드래그 중 캐럿/선택만 가볍게 갱신한다 */
  private updateCaretDuringDrag(): void {
    if (this.isComposing) {
      this.updateCaret();
      return;
    }

    const rect = this.cursor.getRect();
    if (rect) {
      const zoom = this.viewportManager.getZoom();
      this.caret.hideComposition();
      this.caret.updateLive(rect, zoom);
      // [Task #661] 드래그 중 스크롤은 caret rect 가 아니라 포인터 edge 기준 경로에서만 처리한다.
      // 메인테이너 통합 정정: devel 의 updateLive (PR #664 깜박임 타이머 유지 본질) 보존 +
      // PR #718 의 scrollCaretIntoView 부재 본질 적용.
    }
    this.updateSelection();

    const cursorRect = this.cursor.getRect();
    if (cursorRect) {
      this.eventBus.emit('cursor-rect-updated', { x: cursorRect.x, y: cursorRect.y });
    }
  }

  /** 클릭 좌표에서 같은 표 내 셀의 row/col을 반환한다. 다른 표이거나 셀이 아니면 null. */
  private hitTestCellRowCol(e: MouseEvent): { row: number; col: number } | null {
    const ctx = this.cursor.getCellTableContext();
    if (!ctx) return null;
    const zoom = this.viewportManager.getZoom();
    const scrollContent = this.container.querySelector('#scroll-content')!;
    const contentRect = scrollContent.getBoundingClientRect();
    const contentX = e.clientX - contentRect.left;
    const contentY = e.clientY - contentRect.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(contentX, contentY);
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageDisplayWidth = this.virtualScroll.getPageWidth(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, scrollContent.clientWidth);
    const pageX = (contentX - pageLeft) / zoom;
    const pageY = (contentY - pageOffset) / zoom;
    try {
      const hit = this.wasm.hitTest(pageIdx, pageX, pageY);
      // 같은 표인지 확인
      if (hit.parentParaIndex !== ctx.ppi || hit.controlIndex !== ctx.ci) return null;
      if (hit.cellIndex === undefined) return null;
      if (ctx.cellPath && ctx.cellPath.length > 1 && hit.cellPath) {
        // 중첩 표: 경로 기반으로 셀 정보 조회
        const pathJson = JSON.stringify(hit.cellPath);
        const info = this.wasm.getCellInfoByPath(ctx.sec, ctx.ppi, pathJson);
        return { row: info.row, col: info.col };
      }
      const info = this.wasm.getCellInfo(ctx.sec, ctx.ppi, ctx.ci, hit.cellIndex);
      return { row: info.row, col: info.col };
    } catch {
      return null;
    }
  }

  /** F5 셀 선택 하이라이트를 갱신한다 */
  private updateCellSelection(): void {
    if (!this.cellSelectionRenderer) return;
    const range = this.cursor.getSelectedCellRange();
    const ctx = this.cursor.getCellTableContext();
    if (!range || !ctx) {
      this.cellSelectionRenderer.clear();
      return;
    }
    try {
      let bboxes;
      if (ctx.cellPath && ctx.cellPath.length > 1) {
        // 중첩 표: 경로 기반 API 사용
        const pathJson = JSON.stringify(ctx.cellPath);
        bboxes = this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, pathJson);
      } else {
        bboxes = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);
      }
      const zoom = this.viewportManager.getZoom();
      const excluded = this.cursor.getExcludedCells();
      this.cellSelectionRenderer.render(bboxes, range, zoom, excluded.size > 0 ? excluded : undefined);
    } catch (e) {
      console.warn('[InputHandler] updateCellSelection 실패:', e);
      this.cellSelectionRenderer.clear();
    }
  }

  /** 선택 영역 하이라이트를 갱신한다 */
  private updateSelection(): void {
    const fnSel = this.cursor.getFootnoteSelectionOrdered();
    if (fnSel) {
      const { start, end, pageNum, footnoteIndex } = fnSel;
      const zoom = this.viewportManager.getZoom();
      try {
        const rects = this.wasm.getSelectionRectsInFootnote(
          pageNum,
          footnoteIndex,
          start.fnParaIdx,
          start.charOffset,
          end.fnParaIdx,
          end.charOffset,
        );
        this.selectionRenderer.render(rects, zoom);
      } catch (e) {
        console.warn('[InputHandler] getSelectionRectsInFootnote 실패:', e);
        this.selectionRenderer.clear();
      }
      return;
    }

    const sel = this.cursor.getSelectionOrdered();
    if (!sel) {
      this.selectionRenderer.clear();
      return;
    }

    const { start, end } = sel;
    const zoom = this.viewportManager.getZoom();

    try {
      let rects;
      const startInCell = start.parentParaIndex !== undefined;
      const endInCell = end.parentParaIndex !== undefined;

      if (startInCell && endInCell &&
          start.parentParaIndex === end.parentParaIndex &&
          start.controlIndex === end.controlIndex &&
          start.cellIndex === end.cellIndex) {
        // 같은 셀 내부 선택
        rects = this.wasm.getSelectionRectsInCell(
          start.sectionIndex, start.parentParaIndex!, start.controlIndex!, start.cellIndex!,
          start.cellParaIndex!, start.charOffset,
          end.cellParaIndex!, end.charOffset,
        );
      } else if (!startInCell && !endInCell) {
        // 본문 선택
        rects = this.wasm.getSelectionRects(
          start.sectionIndex,
          start.paragraphIndex, start.charOffset,
          end.paragraphIndex, end.charOffset,
        );
      } else {
        // 셀↔본문 또는 셀↔다른 셀 혼합 선택: 렌더링 생략
        this.selectionRenderer.clear();
        return;
      }
      this.selectionRenderer.render(rects, zoom);
    } catch (e) {
      console.warn('[InputHandler] getSelectionRects 실패:', e);
      this.selectionRenderer.clear();
    }
  }

  /** 표 객체 선택 시 외곽선 + 핸들을 렌더링한다 */
  private renderTableObjectSelection(): void {
    // [캔버스 한컴 포크] 재배치(이동·리사이즈·문서변경)로 선택 오버레이를 다시 그릴 때, 옛 bbox에
    // 남은 "전체 표 잡기" 호버 강조(accent)를 먼저 지운다 — 안 지우면 이동 전 위치에 잔상이 남는다.
    _tableHoverFor(this.container).clear();
    if (!this.tableObjectRenderer) return;
    const ref = this.cursor.getSelectedTableRef();
    if (!ref) {
      this.tableObjectRenderer.clear();
      return;
    }
    try {
      const zoom = this.viewportManager.getZoom();
      const pageHint = this.cursor.getRect()?.pageIndex;
      // 셀 bbox를 페이지별로 그룹화하여 합집합 계산 (다중 페이지 표 지원)
      let cellBboxes: { cellIdx: number; row: number; col: number; rowSpan: number; colSpan: number; pageIndex: number; x: number; y: number; w: number; h: number }[];
      if (ref.cellPath && ref.cellPath.length > 1) {
        // 중첩 표: 경로 기반 API
        const pathJson = JSON.stringify(ref.cellPath);
        cellBboxes = this.wasm.getTableCellBboxesByPath(ref.sec, ref.ppi, pathJson);
      } else {
        // 외부 표: flat API
        cellBboxes = this.wasm.getTableCellBboxes(ref.sec, ref.ppi, ref.ci, pageHint);
      }
      if (cellBboxes.length === 0) {
        this.tableObjectRenderer.clear();
        return;
      }
      // 페이지별 그룹화
      const byPage = new Map<number, typeof cellBboxes>();
      for (const b of cellBboxes) {
        let arr = byPage.get(b.pageIndex);
        if (!arr) { arr = []; byPage.set(b.pageIndex, arr); }
        arr.push(b);
      }
      const pageBboxes: { pageIndex: number; x: number; y: number; width: number; height: number }[] = [];
      for (const [pageIndex, cells] of byPage) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cells) {
          minX = Math.min(minX, c.x);
          minY = Math.min(minY, c.y);
          maxX = Math.max(maxX, c.x + c.w);
          maxY = Math.max(maxY, c.y + c.h);
        }
        pageBboxes.push({ pageIndex, x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      }
      // [캔버스 한컴 포크] 표 개체 선택 시 hover "전체 잡기" 강조를 상시 표시(wholeHighlight)
      this.tableObjectRenderer.renderMultiPage(pageBboxes, zoom, false, true);
    } catch (e) {
      console.warn('[InputHandler] renderTableObjectSelection 실패:', e);
      this.tableObjectRenderer.clear();
    }
  }

  /** 그림/글상자 클릭 감지 — getPageControlLayout으로 개체 bbox 겹침 확인 */
  private findPictureAtClick(
    pageIdx: number, pageX: number, pageY: number,
  ): { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'; cellIdx?: number; cellParaIdx?: number; noteRef?: any; x1?: number; y1?: number; x2?: number; y2?: number } | null {
    return _picture.findPictureAtClick.call(this, pageIdx, pageX, pageY);
  }

  /** 선택된 그림/글상자의 bbox를 페이지 레이아웃에서 찾는다 */
  private findPictureBbox(
    ref: { sec: number; ppi: number; ci: number; type?: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole' },
  ): { pageIndex: number; x: number; y: number; w: number; h: number } | null {
    return _picture.findPictureBbox.call(this, ref);
  }

  /** 개체 속성을 타입에 따라 조회한다 (그림/글상자 분기) */
  private getObjectProperties(ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole' }): any {
    return _picture.getObjectProperties.call(this, ref);
  }

  /** 개체 속성을 타입에 따라 변경한다 (그림/글상자 분기) */
  private setObjectProperties(ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole' }, props: Record<string, unknown>): void {
    _picture.setObjectProperties.call(this, ref, props);
  }

  /** 개체를 타입에 따라 삭제한다 (그림/글상자 분기) */
  private deleteObjectControl(ref: { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole' }): void {
    _picture.deleteObjectControl.call(this, ref);
  }

  /** 그림 객체 선택 시 외곽선 + 핸들을 렌더링한다 */
  private renderPictureObjectSelection(): void {
    _picture.renderPictureObjectSelection.call(this);
  }

  /** 그림 객체 선택을 해제한다 (있으면) */
  private exitPictureObjectSelectionIfNeeded(): void {
    _picture.exitPictureObjectSelectionIfNeeded.call(this);
  }

  /** 클릭 좌표가 글상자의 경계선 위인지 판정한다 */
  private isShapeBorderClick(
    pageX: number, pageY: number,
    shape: { sec: number; ppi: number; ci: number },
  ): boolean {
    return _picture.isShapeBorderClick.call(this, pageX, pageY, shape);
  }

  // ─── 그림 핸들 드래그 리사이즈 ─────────────────────────


  /** 드래그 중 실시간 피드백: 핸들 위치를 새 bbox에 맞춰 재렌더 */
  private updatePictureResizeDrag(e: MouseEvent): void {
    _picture.updatePictureResizeDrag.call(this, e);
  }

  /** 드래그 완료: 새 크기를 WASM에 반영 */
  private finishPictureResizeDrag(e: MouseEvent): void {
    _picture.finishPictureResizeDrag.call(this, e);
  }

  /** 드래그 delta로 새 bbox 계산 (page coords) */
  private calcResizedBbox(e: MouseEvent, zoom: number): { x: number; y: number; width: number; height: number } {
    return _picture.calcResizedBbox.call(this, e, zoom);
  }

  private cleanupPictureResizeDrag(): void {
    _picture.cleanupPictureResizeDrag.call(this);
  }

  // ─── 그림 이동 드래그 ──────────────────────────────

  /** 마우스 드래그로 그림 이동 — 드래그 중 갱신 */
  private updatePictureMoveDrag(e: MouseEvent): void {
    _picture.updatePictureMoveDrag.call(this, e);
  }

  /** 마우스 드래그로 그림 이동 — 드래그 종료 */
  private finishPictureMoveDrag(): void {
    _picture.finishPictureMoveDrag.call(this);
  }

  /** 마우스 드래그로 그림 회전 — 드래그 업데이트 */
  private updatePictureRotateDrag(e: MouseEvent): void {
    _picture.updatePictureRotateDrag.call(this, e);
  }

  /** 마우스 드래그로 그림 회전 — 드래그 종료 */
  private finishPictureRotateDrag(e: MouseEvent): void {
    _picture.finishPictureRotateDrag.call(this, e);
  }

  /* [Task #394] 셀 진입 자동 ON 로직 비활성화 — 호출 지점 (updateCaretAndScroll, updateCaretNoScroll)
     의 호출도 같이 주석 처리됨. 되돌리려면 본 블록 주석 + 호출 지점 주석 + 상태 변수 / 이벤트 핸들러
     주석을 동시에 풀면 이전 동작 복원.

  // 셀 진입/탈출 시 투명선 자동 ON/OFF
  private checkTransparentBordersTransition(): void {
    const nowInCell = this.cursor.isInCell() && !this.cursor.isInTextBox();
    if (nowInCell && !this.wasInCell) {
      // 셀 밖 → 셀 진입: 자동 ON
      if (!this.manualTransparentBorders) {
        this.autoTransparentBorders = true;
        this.wasm.setShowTransparentBorders(true);
        document.querySelectorAll('[data-cmd="view:border-transparent"]').forEach(el => {
          el.classList.add('active');
        });
        this.eventBus.emit('document-changed');
      }
    } else if (!nowInCell && this.wasInCell) {
      // 셀 안 → 셀 탈출: 자동으로 켜진 경우에만 OFF
      if (this.autoTransparentBorders && !this.manualTransparentBorders) {
        this.autoTransparentBorders = false;
        this.wasm.setShowTransparentBorders(false);
        document.querySelectorAll('[data-cmd="view:border-transparent"]').forEach(el => {
          el.classList.remove('active');
        });
        this.eventBus.emit('document-changed');
      }
    }
    this.wasInCell = nowInCell;
  }
  */

  /** 캐럿이 화면 밖이면 스크롤을 조정한다 */
  private scrollCaretIntoView(rect: import('@/core/types').CursorRect): void {
    const zoom = this.viewportManager.getZoom();
    const pageOffset = this.virtualScroll.getPageOffset(rect.pageIndex);
    const caretDocY = pageOffset + rect.y * zoom;
    const caretHeight = rect.height * zoom;

    const scrollTop = this.container.scrollTop;
    const viewHeight = this.container.clientHeight;
    const margin = 20; // 여백 px

    if (caretDocY < scrollTop + margin) {
      // 캐럿이 화면 위쪽 밖
      this.container.scrollTop = Math.max(0, caretDocY - margin);
    } else if (caretDocY + caretHeight > scrollTop + viewHeight - margin) {
      // 캐럿이 화면 아래쪽 밖
      this.container.scrollTop = caretDocY + caretHeight - viewHeight + margin;
    }
  }

  /** 문서 로딩 후 저장된 캐럿 위치에 캐럿을 배치한다 */
  activateWithCaretPosition(): void {
    try {
      const savedPos = this.wasm.getCaretPosition();
      if (savedPos) {
        this.cursor.moveTo(savedPos);
      } else {
        this.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
      }
      this.cursor.resetPreferredX();
      this.active = true;

      // [캔버스 한컴 포크] 캔버스 모드는 본문이 '본문 프레임'이라 편집 컨텍스트가 없으면
      // 캐럿을 띄우지 않는다 (캔바: 빈 캔버스엔 깜빡이는 커서가 없다).
      const rect = this.cursor.getRect();
      if (rect && this.shouldShowBodyCaret()) {
        this.caret.show(rect, this.viewportManager.getZoom());
      }
      this.emitCursorFormatState();
      this.focusTextarea();
    } catch (e) {
      console.warn('[InputHandler] 캐럿 자동 배치 실패:', e);
      // 실패 시 문서 시작에 배치
      this.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
      this.active = true;
      const rect = this.cursor.getRect();
      if (rect && this.shouldShowBodyCaret()) {
        this.caret.show(rect, this.viewportManager.getZoom());
      }
      this.focusTextarea();
    }
  }

  // [캔버스 한컴 포크] 본문 캐럿을 보여도 되는가 — 캔버스 모드에선 편집 컨텍스트가 있을 때만.
  private shouldShowBodyCaret(): boolean {
    return !this.canvasMode || !!this.canvasEditingRef;
  }

  /** 캐럿을 숨기고 히스토리를 초기화한다 */
  /** textarea에 포커스를 복원한다 (대화상자 닫힌 후 등) */
  focus(): void {
    this.focusTextarea();
  }

  deactivate(): void {
    this.active = false;
    this.caret.hide();
    this.fieldMarker.hide();
    this.cursor.clearSelection();
    this.selectionRenderer.clear();
    this.history.clear(this.wasm);
  }

  dispose(): void {
    if (this.isResizeDragging) {
      this.cleanupResizeDrag();
    }
    if (this.dragRafId) {
      cancelAnimationFrame(this.dragRafId);
      this.dragRafId = 0;
    }
    this.cellSelectionDragState = null;
    this.cellSelectionDragCandidate = null;
    this.stopTextSelectionDragAutoScroll();
    if (this.resizeHoverRafId) {
      cancelAnimationFrame(this.resizeHoverRafId);
      this.resizeHoverRafId = 0;
    }
    this.cancelDeferredPaginationFlush();
    document.removeEventListener('keydown', this.onF11InterceptBound, true);
    this.container.removeEventListener('mousedown', this.onClickBound);
    this.container.removeEventListener('dblclick', this.onDblClickBound);
    this.container.removeEventListener('contextmenu', this.onContextMenuBound);
    this.container.removeEventListener('mousemove', this.onMouseMoveBound);
    document.removeEventListener('mousemove', this.onMouseMoveBound);
    document.removeEventListener('mouseup', this.onMouseUpBound);
    this.textarea.removeEventListener('keydown', this.onKeyDownBound);
    this.textarea.removeEventListener('input', this.onInputBound);
    this.textarea.removeEventListener('compositionstart', this.onCompositionStartBound);
    this.textarea.removeEventListener('compositionend', this.onCompositionEndBound);
    this.textarea.removeEventListener('copy', this.onCopyBound);
    this.textarea.removeEventListener('cut', this.onCutBound);
    this.textarea.removeEventListener('paste', this.onPasteBound);
    this.textarea.remove();
    this.caret.dispose();
    this.fieldMarker.dispose();
    this.selectionRenderer.dispose();
    this.cellSelectionRenderer?.dispose();
    this.tableObjectRenderer?.dispose();
    this.tableHoverHandles?.dispose();
    this.tableResizeRenderer?.dispose();
    this.protectedCellHoverEl?.remove();
    this.contextMenu?.dispose();
  }

  // ─── 커맨드 시스템용 public 접근자 ─────────────────────────

  /** 커맨드 디스패처를 주입한다 (main.ts에서 호출) */
  setDispatcher(d: CommandDispatcher): void { this.dispatcher = d; }

  /** 현재 편집 모드를 설정한다 */
  setEditMode(mode: EditorEditMode): void {
    this.editMode = mode;
    if (mode === 'form') {
      if (this.cursor.isInPictureObjectSelection()) {
        this.cursor.moveOutOfSelectedPicture();
        this.pictureObjectRenderer?.clear();
        this.eventBus.emit('picture-object-selection-changed', false);
      }
      if (this.cursor.isInTableObjectSelection()) {
        this.cursor.moveOutOfSelectedTable();
        this.tableObjectRenderer?.clear();
        this.eventBus.emit('table-object-selection-changed', false);
      }
    }
    this.eventBus.emit('command-state-changed');
  }

  /** 양식 모드인가? */
  isFormMode(): boolean { return this.editMode === 'form'; }

  /** 현재 커서가 양식 모드에서 편집 가능한 누름틀 안인가? */
  canEditCurrentFormField(): boolean {
    return this.isEditableFormFieldPosition(this.cursor.getPosition());
  }

  private isSameTextContainer(a: DocumentPosition, b: DocumentPosition): boolean {
    if (a.sectionIndex !== b.sectionIndex) return false;
    if (a.paragraphIndex !== b.paragraphIndex) return false;
    if (a.parentParaIndex !== b.parentParaIndex) return false;
    if (a.controlIndex !== b.controlIndex) return false;
    if (a.cellIndex !== b.cellIndex) return false;
    if (a.cellParaIndex !== b.cellParaIndex) return false;
    if ((a.isTextBox ?? false) !== (b.isTextBox ?? false)) return false;
    return JSON.stringify(a.cellPath ?? []) === JSON.stringify(b.cellPath ?? []);
  }

  private getFormFieldInfoAt(pos: DocumentPosition): any | null {
    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return null;
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (!fi?.inField) return null;
      if (fi.fieldType !== 'clickhere') return null;
      return fi;
    } catch {
      return null;
    }
  }

  private isEditableFormFieldPosition(pos: DocumentPosition): boolean {
    const fi = this.getFormFieldInfoAt(pos);
    if (!fi?.editableInForm) return false;
    const start = fi.startCharIdx ?? -1;
    const end = fi.endCharIdx ?? -1;
    return pos.charOffset >= start && pos.charOffset <= end;
  }

  canInsertTextInFormMode(pos: DocumentPosition): boolean {
    if (this.editMode !== 'form') return true;
    return this.isEditableFormFieldPosition(pos);
  }

  canDeleteTextInFormMode(pos: DocumentPosition, count: number): boolean {
    if (this.editMode !== 'form') return true;
    const fi = this.getFormFieldInfoAt(pos);
    if (!fi?.editableInForm) return false;
    const start = fi.startCharIdx ?? -1;
    const end = fi.endCharIdx ?? -1;
    return pos.charOffset >= start && pos.charOffset + count <= end;
  }

  canDeleteSelectionInFormMode(): boolean {
    if (this.editMode !== 'form') return true;
    const sel = this.cursor.getSelectionOrdered();
    if (!sel) return this.canEditCurrentFormField();
    if (!this.isSameTextContainer(sel.start, sel.end)) return false;
    const fi = this.getFormFieldInfoAt(sel.start);
    if (!fi?.editableInForm) return false;
    if (fi.fieldId === undefined) return false;
    const endInfo = this.getFormFieldInfoAt(sel.end);
    if (!endInfo?.editableInForm || endInfo.fieldId !== fi.fieldId) return false;
    const start = fi.startCharIdx ?? -1;
    const end = fi.endCharIdx ?? -1;
    return sel.start.charOffset >= start && sel.end.charOffset <= end;
  }

  moveToAdjacentFormField(delta: number): boolean {
    if (this.editMode !== 'form') return false;
    const currentInfo = this.getFormFieldInfoAt(this.cursor.getPosition());
    const currentFieldId = currentInfo?.fieldId;
    const currentKey = this.formFieldSortKey(this.cursor.getPosition());
    const fields = this.wasm.getFieldList()
      .filter((field: any) =>
        field.fieldType === 'clickhere'
        && field.editableInForm === true
        && typeof field.startCharIdx === 'number')
      .map((field: any) => {
        const pos = this.formFieldPosition(field);
        return pos ? { field, pos, key: this.formFieldSortKey(pos) } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => this.compareFormFieldKeys(a.key, b.key));

    if (fields.length === 0) return false;

    const forward = delta >= 0;
    const withoutCurrent = fields.filter((entry: any) => entry.field.fieldId !== currentFieldId);
    const candidates = withoutCurrent.length > 0 ? withoutCurrent : fields;
    const target = forward
      ? candidates.find((entry: any) => this.compareFormFieldKeys(entry.key, currentKey) > 0) ?? candidates[0]
      : [...candidates].reverse().find((entry: any) => this.compareFormFieldKeys(entry.key, currentKey) < 0) ?? candidates[candidates.length - 1];

    if (!target) return false;
    this.cursor.clearSelection();
    this.cursor.moveTo(target.pos);
    this.cursor.resetPreferredX();
    this.active = true;
    this.updateCaret();
    this.updateFieldMarkers();
    this.focusTextarea();
    this.eventBus.emit('command-state-changed');
    return true;
  }

  private formFieldPosition(field: any): DocumentPosition | null {
    const loc = field.location;
    if (!loc || typeof loc.sectionIndex !== 'number' || typeof loc.paraIndex !== 'number') {
      return null;
    }
    const charOffset = typeof field.startCharIdx === 'number' ? field.startCharIdx : 0;
    const path = Array.isArray(loc.path) ? loc.path : [];
    if (path.length === 0) {
      return { sectionIndex: loc.sectionIndex, paragraphIndex: loc.paraIndex, charOffset };
    }

    const cellPath = path.map((entry: any) => ({
      controlIndex: entry.controlIndex ?? 0,
      cellIndex: entry.type === 'textbox' ? 0 : (entry.cellIndex ?? 0),
      cellParaIndex: entry.paraIndex ?? 0,
    }));
    const last = cellPath[cellPath.length - 1];
    const lastRaw = path[path.length - 1] ?? {};
    return {
      sectionIndex: loc.sectionIndex,
      paragraphIndex: last.cellParaIndex,
      charOffset,
      parentParaIndex: loc.paraIndex,
      controlIndex: cellPath[0].controlIndex,
      cellIndex: last.cellIndex,
      cellParaIndex: last.cellParaIndex,
      cellPath,
      isTextBox: lastRaw.type === 'textbox',
    };
  }

  private formFieldSortKey(pos: DocumentPosition): number[] {
    const pathKey = (pos.cellPath ?? [])
      .flatMap((entry: any) => [
        entry.controlIndex ?? entry.controlIdx ?? 0,
        entry.cellIndex ?? entry.cellIdx ?? 0,
        entry.cellParaIndex ?? entry.cellParaIdx ?? 0,
      ]);
    return [
      pos.sectionIndex,
      pos.parentParaIndex ?? pos.paragraphIndex,
      ...pathKey,
      pos.paragraphIndex,
      pos.charOffset,
    ];
  }

  private compareFormFieldKeys(a: number[], b: number[]): number {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? -1;
      const bv = b[i] ?? -1;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  private isOperationAllowedInEditMode(desc: OperationDescriptor): boolean {
    if (this.editMode !== 'form') return true;
    if (desc.kind === 'snapshot') return false;

    const command = desc.command as any;
    switch (command.type) {
      case 'insertText':
        return this.canInsertTextInFormMode(command.position ?? this.cursor.getPosition());
      case 'deleteText':
        return this.canDeleteTextInFormMode(command.position ?? this.cursor.getPosition(), command.count ?? 1);
      case 'deleteSelection':
        return this.canDeleteSelectionInFormMode();
      default:
        return false;
    }
  }

  /** 편집 영역이 활성 상태인지 (문서 로드 + 편집 영역 포커스) */
  isActive(): boolean { return this.active; }

  /** 컨텍스트 메뉴를 주입한다 (main.ts에서 호출) */
  setContextMenu(cm: ContextMenu): void { this.contextMenu = cm; }

  /** 커맨드 팔레트를 주입한다 (main.ts에서 호출) */
  setCommandPalette(cp: CommandPalette): void { this.commandPalette = cp; }

  /** 셀 선택 렌더러를 주입한다 (main.ts에서 호출) */
  setCellSelectionRenderer(r: CellSelectionRenderer): void { this.cellSelectionRenderer = r; }

  /** 표 객체 선택 렌더러를 주입한다 (main.ts에서 호출) */
  setTableObjectRenderer(r: TableObjectRenderer): void { this.tableObjectRenderer = r; }

  /** [캔버스 한컴 포크] 표 hover 핸들 오버레이 주입 (main.ts에서 호출) */
  setTableHoverHandles(h: TableHoverHandles): void { this.tableHoverHandles = h; }

  /** hover 핸들 호스트 API — 현재 배율 */
  getZoom(): number { return this.viewportManager.getZoom(); }

  /** 표 hover 핸들을 지금 보여도 되는가 (캔버스 모드·개체 미선택·드래그/리사이즈 아님) */
  canShowTableHoverHandles(): boolean {
    return this.canvasMode
      && !this.cursor.isInTableObjectSelection()
      && !this.cursor.isInPictureObjectSelection()
      && !this.isMoveDragging
      && !this.isTableHandleResizing;
  }

  /** hover 핸들 잡음 → 표 전체 선택(+ e/s/se면 기존 리사이즈 시작). 클릭=선택·드래그=리사이즈. */
  onTableHoverHandleGrab(
    ref: { sec: number; ppi: number; ci: number },
    _dir: string, _pageX: number, _pageY: number, _pageIndex: number,
  ): void {
    // [캔버스 한컴 포크] 선택 전 핸들 잡기 = "표 전체 개체 선택"만 한다. 리사이즈(늘리기/줄이기)는
    // 표가 선택된 다음에만 — 선택된 표의 핸들을 다시 드래그하면 startTableHandleResize가 동작한다
    // (input-handler-mouse.ts 선택 상태 mousedown). 이전엔 e/s/se 잡는 순간 선택과 동시에 즉시
    // 리사이즈가 시작돼, "선택 → 그 후 크기 조절" 단계 없이 곧바로 크기가 바뀌었다.
    _mouse.selectTableObject.call(this, ref);
  }

  /** 그림 객체 선택 렌더러를 주입한다 (main.ts에서 호출) */
  setPictureObjectRenderer(r: TableObjectRenderer): void { this.pictureObjectRenderer = r; }

  /** 그림 객체 선택 모드인가? */
  isInPictureObjectSelection(): boolean { return this.cursor.isInPictureObjectSelection(); }

  /** 선택된 그림/글상자 참조 반환 ([Task #825] headerFooter 동반 시 머리말/꼬리말 picture marker) */
  getSelectedPictureRef(): { sec: number; ppi: number; ci: number; type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'; cellIdx?: number; cellParaIdx?: number; outerTableControlIdx?: number; cellPath?: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>; noteRef?: any; headerFooter?: { kind: 'header' | 'footer'; outerParaIdx: number; outerControlIdx: number } } | null { return this.cursor.getSelectedPictureRef(); }

  /** 다중 선택된 개체 목록 */
  getSelectedPictureRefs(): { sec: number; ppi: number; ci: number; type: string }[] { return this.cursor.getSelectedPictureRefs(); }

  /** 다중 선택 상태인가? */
  isMultiPictureSelection(): boolean { return this.cursor.isMultiPictureSelection(); }

  /** 지정 개체를 선택 상태로 진입 */
  selectPictureObject(sec: number, ppi: number, ci: number, type: 'image' | 'shape' | 'equation' | 'group' | 'line' | 'ole'): void {
    this.cursor.enterPictureObjectSelectionDirect(sec, ppi, ci, type);
    this.renderPictureObjectSelection();
    this.eventBus.emit('picture-object-selection-changed', true);
  }

  /** 그림 삭제 후: 선택 해제 + afterEdit */
  /** 커서 위치 반환 */
  getPosition(): { sectionIndex: number; paragraphIndex: number; charOffset: number } {
    return this.cursor.getPosition();
  }

  /** 편집 완료 후 렌더링 갱신 */
  triggerAfterEdit(): void {
    this.afterEdit();
  }

  exitPictureObjectSelectionAndAfterEdit(): void {
    this.exitPictureObjectSelectionIfNeeded();
    this.afterEdit();
  }

  /** 글상자 내부 텍스트 편집 모드 진입 */
  private enterTextboxEditing(sec: number, ppi: number, ci: number): void {
    this.enterInlineEditing(sec, ppi, ci, 0);
  }

  /** 캡션/글상자 내부 텍스트 편집 모드 진입 (charOffset 지정 가능) */
  enterInlineEditing(sec: number, ppi: number, ci: number, charOffset = 0): void {
    this.cursor.clearSelection();
    this.cursor.moveTo({
      sectionIndex: sec,
      paragraphIndex: 0,
      charOffset,
      parentParaIndex: ppi,
      controlIndex: ci,
      cellIndex: 0,
      cellParaIndex: 0,
      isTextBox: true,
    });
    this.cursor.resetPreferredX();
    this.updateCaret();
    this.focusTextarea();
  }

  /** 표 캡션 텍스트 편집 모드 진입 (cellIndex=65534로 캡션 구분) */
  enterTableCaptionEditing(sec: number, ppi: number, ci: number, charOffset = 0): void {
    this.cursor.clearSelection();
    this.cursor.moveTo({
      sectionIndex: sec,
      paragraphIndex: 0,
      charOffset,
      parentParaIndex: ppi,
      controlIndex: ci,
      cellIndex: 65534,
      cellParaIndex: 0,
    });
    this.cursor.resetPreferredX();
    this.updateCaret();
    this.focusTextarea();
  }

  /** 표 경계선 리사이즈 렌더러를 주입한다 (main.ts에서 호출) */
  setTableResizeRenderer(r: TableResizeRenderer): void { this.tableResizeRenderer = r; }

  /** 선택 영역이 있는가? */
  hasSelection(): boolean { return this.cursor.hasSelection(); }

  /** 모양 복사 상태가 있는가? */
  hasCopiedFormat(): boolean { return this.formatCopyState !== null; }

  /** 모양 복사 상태를 해제한다 (Esc — 한컴 반복 적용 모드 종료) */
  clearCopiedFormat(): void { this.formatCopyState = null; }

  /** 현재 커서 위치를 반환한다 */
  getCursorPosition(): DocumentPosition { return this.cursor.getPosition(); }

  /** [캔버스 한컴 포크] 표 안 커서를 본문으로 빼낸다 — '표 안에서 표 만들기'(table.ts)가
   *  두 번째 표를 본문에 만들 수 있게 한다(커서가 셀 안이면 표 생성이 막히던 버그). */
  exitTableToBody(): boolean { return this.cursor.exitTableToBody(); }

  /** 커서를 지정 위치로 이동하고 캐럿을 표시한다. 성공하면 true 반환. */
  moveCursorTo(pos: DocumentPosition): boolean {
    // 이동 전 위치가 유효한지 사전 검증 (경고 로그 방지)
    try {
      const testRect = this.wasm.getCursorRect(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
      if (!testRect || testRect.pageIndex === undefined) return false;
    } catch {
      return false;
    }

    this.cursor.clearSelection();
    this.cursor.moveTo(pos);
    this.cursor.resetPreferredX();
    this.active = true;
    const rect = this.cursor.getRect();
    if (rect) {
      this.caret.show(rect, this.viewportManager.getZoom());
      this.updateCaret();
      this.focusTextarea();
      return true;
    }
    this.focusTextarea();
    return false;
  }

  /** 현재 커서 위치의 누름틀 필드와 내용을 제거한다. */
  removeCurrentField(posOverride?: DocumentPosition): void {
    const pos = posOverride ?? this.cursor.getPosition();
    let restorePos: DocumentPosition | null = null;
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (fi.inField && fi.fieldType === 'clickhere') {
        restorePos = {
          ...pos,
          charOffset: fi.startCharIdx ?? pos.charOffset,
        };
      }
    } catch {
      restorePos = null;
    }

    try {
      const result = this.wasm.removeFieldAt(pos);
      if (result.ok) {
        if (restorePos) {
          this.cursor.clearSelection();
          this.cursor.moveTo(restorePos);
          this.cursor.resetPreferredX();
        }
        this.fieldMarker.hide();
        this.fieldStartExitKey = null;
        this.fieldEndExitKey = null;
        this.wasm.clearActiveField();
        this.afterEdit();
        this.eventBus.emit('field-info-changed', null);
      }
    } catch (err) {
      console.warn('[InputHandler] 누름틀 제거 실패:', err);
    }
  }

  /** 현재 커서 위치의 누름틀 제거를 한컴처럼 확인 후 수행한다. */
  confirmRemoveCurrentField(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (!fi.inField || fi.fieldType !== 'clickhere') return false;
    } catch {
      return false;
    }

    void showConfirm('지우기', '[누름틀]을 지울까요?')
      .then((ok) => {
        if (ok) this.removeCurrentField(pos);
        this.focusTextarea();
      })
      .catch(() => {
        this.focusTextarea();
      });
    return true;
  }

  /** 누름틀 끝에서 오른쪽 이동 시 같은 charOffset을 필드 밖 위치로 취급한다. */
  tryExitCurrentFieldEnd(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const start = fi.startCharIdx ?? -1;
      const end = fi.endCharIdx ?? -1;
      if (!fi.inField || fi.fieldType !== 'clickhere' || start < 0 || end < 0) return false;
      if (this.isAtExitedFieldEnd(pos, fi)) return false;
      if (pos.charOffset < end) return false;
      this.fieldStartExitKey = null;
      this.fieldEndExitKey = this.fieldBoundaryKey(pos, fi.fieldId, end);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      this.eventBus.emit('document-changed');
      this.updateCaret(true);
      requestAnimationFrame(() => this.updateCaret(true));
      return true;
    } catch {
      return false;
    }
  }

  /** 누름틀 시작에서 왼쪽 이동 시 같은 charOffset을 필드 밖 위치로 취급한다. */
  tryExitCurrentFieldStart(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const start = fi.startCharIdx ?? -1;
      const end = fi.endCharIdx ?? -1;
      if (!fi.inField || fi.fieldType !== 'clickhere' || start < 0 || end < 0) return false;
      if (this.isAtExitedFieldStart(pos, fi)) return false;
      if (start === end || pos.charOffset > start) return false;
      this.fieldEndExitKey = null;
      this.fieldStartExitKey = this.fieldBoundaryKey(pos, fi.fieldId, start);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      this.eventBus.emit('document-changed');
      return true;
    } catch {
      return false;
    }
  }

  /** 누름틀 시작 밖 위치에서 오른쪽 이동하면 같은 charOffset의 필드 내부 시작으로 들어간다. */
  tryEnterExitedFieldStart(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (!fi.inField || fi.fieldType !== 'clickhere' || !this.isAtExitedFieldStart(pos, fi)) {
        return false;
      }
      this.fieldStartExitKey = null;
      this.updateFieldMarkers();
      return true;
    } catch {
      return false;
    }
  }

  /** 누름틀 끝 밖 위치에서 왼쪽 이동하면 같은 charOffset의 필드 내부 끝으로 들어간다. */
  tryEnterExitedFieldEnd(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      if (!fi.inField || fi.fieldType !== 'clickhere' || !this.isAtExitedFieldEnd(pos, fi)) {
        return false;
      }
      this.fieldEndExitKey = null;
      this.updateFieldMarkers();
      return true;
    } catch {
      return false;
    }
  }

  /** Home 이동 결과가 누름틀 시작이면 한컴처럼 누름틀 이전 위치로 취급한다. */
  markCurrentFieldStartOutside(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const start = fi.startCharIdx ?? -1;
      const end = fi.endCharIdx ?? -1;
      if (!fi.inField || fi.fieldType !== 'clickhere' || start < 0 || end < 0) return false;
      if (start === end || pos.charOffset !== start) return false;
      this.fieldEndExitKey = null;
      this.fieldStartExitKey = this.fieldBoundaryKey(pos, fi.fieldId, start);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      this.eventBus.emit('document-changed');
      this.updateCaret(true);
      requestAnimationFrame(() => this.updateCaret(true));
      return true;
    } catch {
      return false;
    }
  }

  /** End 이동 결과가 누름틀 끝이면 한컴처럼 누름틀 이후 위치로 취급한다. */
  markCurrentFieldEndOutside(): boolean {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const start = fi.startCharIdx ?? -1;
      const end = fi.endCharIdx ?? -1;
      if (!fi.inField || fi.fieldType !== 'clickhere' || start < 0 || end < 0) return false;
      if (pos.charOffset !== end) return false;
      this.fieldStartExitKey = null;
      this.fieldEndExitKey = this.fieldBoundaryKey(pos, fi.fieldId, end);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      this.eventBus.emit('document-changed');
      this.updateCaret(true);
      requestAnimationFrame(() => this.updateCaret(true));
      return true;
    } catch {
      return false;
    }
  }

  isAtExitedFieldStart(pos: DocumentPosition, fi?: { fieldId?: number; startCharIdx?: number }): boolean {
    const start = fi?.startCharIdx ?? pos.charOffset;
    return this.fieldStartExitKey === this.fieldBoundaryKey(pos, fi?.fieldId, start);
  }

  private isExitedFieldStartPosition(pos: DocumentPosition): boolean {
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      return fi.inField
        && fi.fieldType === 'clickhere'
        && this.isAtExitedFieldStart(pos, fi);
    } catch {
      return false;
    }
  }

  isAtExitedFieldEnd(pos: DocumentPosition, fi?: { fieldId?: number; endCharIdx?: number }): boolean {
    const end = fi?.endCharIdx ?? pos.charOffset;
    return this.fieldEndExitKey === this.fieldBoundaryKey(pos, fi?.fieldId, end);
  }

  /** 빈 누름틀 안내문 클릭 후 첫 입력 위치를 실제 field start로 정규화한다. */
  prepareClickHereInputPosition(): DocumentPosition {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const start = fi.startCharIdx ?? -1;
      if (!fi.inField || fi.fieldType !== 'clickhere' || !fi.isGuide || start < 0) {
        return pos;
      }

      const normalized = { ...pos, charOffset: start };
      this.fieldStartExitKey = null;
      this.fieldEndExitKey = null;
      this.cursor.clearSelection();
      if (pos.charOffset !== start) {
        this.cursor.moveTo(normalized);
      }
      this.wasm.setActiveField(normalized);
      return normalized;
    } catch {
      return pos;
    }
  }

  /** 마우스로 누름틀 위치를 직접 클릭하면 키보드 경계 이탈 상태를 해제한다. */
  prepareClickHerePointerEntry(pageX?: number): void {
    const pos = this.cursor.getPosition();
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      const guidePos = this.findEmptyClickHereGuideHitPosition(pos);
      if (guidePos) {
        this.fieldStartExitKey = null;
        this.fieldEndExitKey = null;
        this.cursor.moveTo(guidePos);
        const fieldChanged = this.wasm.setActiveField(guidePos);
        if (fieldChanged) this.eventBus.emit('document-changed');
        return;
      }

      if (!fi.inField || fi.fieldType !== 'clickhere') {
        return;
      }

      if (typeof pageX === 'number' && this.prepareClickHerePointerBoundaryExit(pos, fi, pageX)) {
        return;
      }

      this.fieldStartExitKey = null;
      this.fieldEndExitKey = null;

      if (!fi.isGuide || fi.startCharIdx === undefined) return;

      const normalized = { ...pos, charOffset: fi.startCharIdx };
      if (pos.charOffset !== fi.startCharIdx) {
        this.cursor.moveTo(normalized);
      }
      const fieldChanged = this.wasm.setActiveField(normalized);
      if (fieldChanged) this.eventBus.emit('document-changed');
    } catch {
      // 클릭 hit-test 직후 필드 조회 실패는 일반 클릭 처리로 흘려보낸다.
    }
  }

  private prepareClickHerePointerBoundaryExit(pos: DocumentPosition, fi: any, pageX: number): boolean {
    const start = fi.startCharIdx ?? -1;
    const end = fi.endCharIdx ?? -1;
    if (start < 0 || end < 0 || start === end) return false;

    const rects = this.getClickHereBoundaryRects(pos, start, end);
    if (!rects) return false;

    const tolerance = 1;
    if (pos.charOffset <= start && pageX < rects.startRect.x - tolerance) {
      this.fieldEndExitKey = null;
      this.fieldStartExitKey = this.fieldBoundaryKey(pos, fi.fieldId, start);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      return true;
    }

    if (pos.charOffset >= end && pageX > rects.endRect.x + tolerance) {
      this.fieldStartExitKey = null;
      this.fieldEndExitKey = this.fieldBoundaryKey(pos, fi.fieldId, end);
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      return true;
    }

    return false;
  }

  private findEmptyClickHereGuideHitPosition(pos: DocumentPosition): DocumentPosition | null {
    try {
      const fields = this.wasm.getFieldList()
        .filter((field: any) =>
          field.fieldType === 'clickhere'
          && typeof field.startCharIdx === 'number'
          && field.startCharIdx === field.endCharIdx)
        .map((field: any) => {
          const fieldPos = this.formFieldPosition(field);
          if (!fieldPos || !this.isSameTextContainer(pos, fieldPos)) return null;
          const guideLen = Array.from(field.guide ?? '').length;
          if (guideLen <= 0) return null;
          const start = field.startCharIdx;
          const guideEnd = start + guideLen;
          if (pos.charOffset < start || pos.charOffset > guideEnd) return null;
          return fieldPos;
        })
        .filter((fieldPos: DocumentPosition | null): fieldPos is DocumentPosition => fieldPos !== null)
        .sort((a: DocumentPosition, b: DocumentPosition) => b.charOffset - a.charOffset);
      return fields[0] ?? null;
    } catch {
      return null;
    }
  }

  /** 현재 위치가 빈 누름틀 안내문 영역인지 확인한다. */
  isClickHereGuidePosition(pos: DocumentPosition): boolean {
    try {
      const fi = this.wasm.getFieldInfoAt(pos);
      return fi.inField && fi.fieldType === 'clickhere' && fi.isGuide === true;
    } catch {
      return false;
    }
  }

  /** 빈 누름틀 첫 입력 직후 안내문/마커 캐시를 새 field value 기준으로 다시 잡는다. */
  refreshClickHereAfterFirstInput(): void {
    this.lastCellKey = null;
    this.fieldStartExitKey = null;
    this.fieldEndExitKey = null;
    this.fieldMarker.hide();
    this.wasm.clearActiveField();
    this.eventBus.emit('document-changed');
    requestAnimationFrame(() => {
      this.updateCaret();
      this.eventBus.emit('document-changed');
    });
  }

  private fieldBoundaryKey(pos: DocumentPosition, fieldId: number | undefined, charOffset: number): string {
    const path = JSON.stringify(pos.cellPath ?? []);
    return [
      pos.sectionIndex,
      pos.parentParaIndex ?? -1,
      pos.paragraphIndex,
      pos.controlIndex ?? -1,
      pos.cellIndex ?? -1,
      pos.cellParaIndex ?? -1,
      pos.isTextBox ? 1 : 0,
      path,
      fieldId ?? -1,
      charOffset,
    ].join(':');
  }

  private getClickHereBoundaryRects(pos: DocumentPosition, start: number, end: number): { startRect: CursorRect; endRect: CursorRect } | null {
    try {
      if ((pos.cellPath?.length ?? 0) > 1 && pos.parentParaIndex !== undefined) {
        const pathJson = JSON.stringify(pos.cellPath);
        return {
          startRect: this.wasm.getCursorRectByPath(
            pos.sectionIndex, pos.parentParaIndex, pathJson, start,
          ),
          endRect: this.wasm.getCursorRectByPath(
            pos.sectionIndex, pos.parentParaIndex, pathJson, end,
          ),
        };
      }

      if (pos.parentParaIndex !== undefined) {
        return {
          startRect: this.wasm.getCursorRectInCell(
            pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,
            pos.cellIndex!, pos.cellParaIndex!, start,
          ),
          endRect: this.wasm.getCursorRectInCell(
            pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,
            pos.cellIndex!, pos.cellParaIndex!, end,
          ),
        };
      }

      return {
        startRect: this.wasm.getCursorRect(pos.sectionIndex, pos.paragraphIndex, start),
        endRect: this.wasm.getCursorRect(pos.sectionIndex, pos.paragraphIndex, end),
      };
    } catch {
      return null;
    }
  }

  /** 커서 위치의 필드 상태에 따라 낫표 마커를 표시/숨김한다 */
  private updateFieldMarkers(): void {
    const wasVisible = this.fieldMarker.isVisible;
    if (this.cursor.hasSelection()) {
      if (wasVisible) this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('field-info-changed', null);
      return;
    }
    try {
      const pos = this.cursor.getPosition();
      const fi = this.wasm.getFieldInfoAt(pos);
      if (fi.inField && fi.startCharIdx !== undefined && fi.endCharIdx !== undefined) {
        if (this.isAtExitedFieldStart(pos, fi) || this.isAtExitedFieldEnd(pos, fi)) {
          if (wasVisible) this.fieldMarker.hide();
          this.wasm.clearActiveField();
          this.eventBus.emit('field-info-changed', null);
          return;
        }
        this.fieldStartExitKey = null;
        this.fieldEndExitKey = null;
        // 활성 필드 설정 → 안내문 숨김 + 페이지 캐시 무효화
        const fieldChanged = this.wasm.setActiveField(pos);
        const zoom = this.viewportManager.getZoom();
        const rects = this.getClickHereBoundaryRects(pos, fi.startCharIdx, fi.endCharIdx);
        if (!rects) return;
        const { startRect, endRect } = rects;
        this.fieldMarker.show(startRect, endRect, zoom);
        // 필드 진입 또는 다른 필드로 전환 시 재렌더링 (안내문 표시/숨김 반영)
        if (!wasVisible || fieldChanged) {
          this.eventBus.emit('document-changed');
          // 재렌더링 후 캐럿 위치 재계산 (가이드 텍스트 제거로 좌표 변경됨)
          this.cursor.updateRect();
          this.updateCaret();
        }
        // 상태 표시줄에 필드 정보 표시
        this.eventBus.emit('field-info-changed', {
          fieldId: fi.fieldId, fieldType: fi.fieldType, guideName: fi.guideName,
        });
        return;
      }
    } catch (err) { console.warn('[updateFieldMarkers] 필드 마커 갱신 실패:', err); }
    // 필드 밖이면 마커 숨김 + 활성 필드 해제
    this.fieldStartExitKey = null;
    this.fieldEndExitKey = null;
    if (wasVisible) {
      this.fieldMarker.hide();
      this.wasm.clearActiveField();
      this.eventBus.emit('document-changed');
      this.eventBus.emit('field-info-changed', null);
    }
  }

  /** 커서가 누름틀 필드 내부인가? */
  isInField(): boolean {
    try {
      const fi = this.wasm.getFieldInfoAt(this.cursor.getPosition());
      return fi.inField;
    } catch { return false; }
  }

  /** 현재 커서 위치의 필드 정보를 반환한다. */
  getFieldInfo(): { fieldId: number; fieldType: string; guideName: string } | null {
    try {
      const fi = this.wasm.getFieldInfoAt(this.cursor.getPosition());
      if (fi.inField && fi.fieldId !== undefined) {
        return { fieldId: fi.fieldId, fieldType: fi.fieldType ?? '', guideName: fi.guideName ?? '' };
      }
    } catch { /* 무시 */ }
    return null;
  }

  /** 커서가 표 셀 내부인가? */
  isInTable(): boolean { return this.cursor.isInCell(); }

  /** 셀 선택 모드인가? */
  isInCellSelectionMode(): boolean { return this.cursor.isInCellSelectionMode(); }

  /** 여러 셀이 선택된 상태인가? */
  hasMultiCellSelection(): boolean {
    const range = this.cursor.getSelectedCellRange();
    return Boolean(range && (range.startRow !== range.endRow || range.startCol !== range.endCol));
  }

  /** 표 객체 선택 모드인가? */
  isInTableObjectSelection(): boolean { return this.cursor.isInTableObjectSelection(); }

  /** 선택된 표의 참조 정보 반환 */
  getSelectedTableRef() { return this.cursor.getSelectedTableRef(); }

  /** 표 객체 선택 해제 + 재렌더링 */
  exitTableObjectSelection(): void {
    this.cursor.exitTableObjectSelection();
    this.afterEdit();
  }

  /** 셀 선택 범위 반환 (셀 선택 모드가 아니면 null) */
  getSelectedCellRange() { return this.cursor.getSelectedCellRange(); }

  /** 셀 선택 중인 표의 컨텍스트 반환 */
  getCellTableContext() { return this.cursor.getCellTableContext(); }

  /** 제외 셀이 있는 비직사각형 셀 선택인가? */
  hasExcludedCellSelection(): boolean { return this.cursor.getExcludedCells().size > 0; }

  /** 셀 선택 모드 종료 */
  exitCellSelectionMode(): void {
    this.cursor.exitCellSelectionMode();
    this.cellSelectionRenderer?.clear();
    this.updateCaret();
  }

  /** Undo 가능한가? */
  canUndo(): boolean { return this.history.canUndo(); }

  /** Redo 가능한가? */
  canRedo(): boolean { return this.history.canRedo(); }

  /** Undo 실행 (커맨드 시스템용) */
  performUndo(): void { this.handleUndo(); }

  /** Redo 실행 (커맨드 시스템용) */
  performRedo(): void { this.handleRedo(); }

  /** 복사 (커맨드 시스템용 — 컨텍스트 메뉴/도구 상자에서 호출) */
  performCopy(): void {
    // 개체 선택 모드 → 직접 클립보드 기록 (textarea 포커스 불필요)
    if (this.cursor.isInPictureObjectSelection()) {
      const ref = this.cursor.getSelectedPictureRef();
      if (ref) {
        try {
          const cellPathJson = _keyboard.pictureCellPathJson(ref);
          this.wasm.copyControl(ref.sec, ref.ppi, ref.ci, cellPathJson);
          const text = this.wasm.getClipboardText() || '[그림]';
          let html = '';
          try { html = this.wasm.exportControlHtml(ref.sec, ref.ppi, ref.ci, cellPathJson) || ''; } catch { /* 무시 */ }
          const markedHtml = _keyboard.prepareRhwpInternalClipboardHtml(this, html, text);
          if (ref.type === 'image') {
            _keyboard.writeImageToClipboard(this.wasm, ref.sec, ref.ppi, ref.ci, text, markedHtml, cellPathJson)
              .catch(() => navigator.clipboard.writeText(text).catch(() => {}));
          } else {
            _keyboard.writeTextHtmlToClipboard(text, markedHtml)
              .catch(() => navigator.clipboard.writeText(text).catch(() => {}));
          }
        } catch (err) {
          console.warn('[InputHandler] 개체 복사 실패:', err);
        }
      }
      return;
    }
    if (this.cursor.isInTableObjectSelection()) {
      const ref = this.cursor.getSelectedTableRef();
      if (ref) {
        try {
          this.wasm.copyControl(ref.sec, ref.ppi, ref.ci);
          const text = this.wasm.getClipboardText() || '[표]';
          let html = '';
          try { html = this.wasm.exportControlHtml(ref.sec, ref.ppi, ref.ci) || ''; } catch { /* 무시 */ }
          const markedHtml = _keyboard.prepareRhwpInternalClipboardHtml(this, html, text);
          _keyboard.writeTextHtmlToClipboard(text, markedHtml)
            .catch(() => navigator.clipboard.writeText(text).catch(() => {}));
        } catch (err) {
          console.warn('[InputHandler] 표 복사 실패:', err);
        }
      }
      return;
    }
    // 텍스트 선택 → textarea 포커스 후 execCommand
    this.focusTextarea();
    document.execCommand('copy');
  }

  /** 붙이기 (커맨드 시스템용 — 컨텍스트 메뉴/도구 상자에서 호출) */
  performPaste(): boolean {
    if (this.editMode === 'form') return false;
    this.focusTextarea();
    return document.execCommand('paste');
  }

  /** 잘라내기 (커맨드 시스템용 — 컨텍스트 메뉴/도구 상자에서 호출) */
  performCut(): void {
    if (this.editMode === 'form') return;
    // 개체 선택 모드 → 복사 + 삭제
    if (this.cursor.isInPictureObjectSelection()) {
      const ref = this.cursor.getSelectedPictureRef();
      if (ref) {
        // 클립보드에 복사
        this.performCopy();
        // 삭제
        this.cursor.moveOutOfSelectedPicture();
        this.pictureObjectRenderer?.clear();
        this.eventBus.emit('picture-object-selection-changed', false);
        this.executeOperation({ kind: 'snapshot', operationType: 'cutObject', operation: (wasm: WasmBridge) => {
          if (ref.type === 'image' && ref.cellPath && ref.cellPath.length > 0) {
            wasm.deleteCellPictureControlByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci);
          } else if (ref.type === 'image') {
            wasm.deletePictureControl(ref.sec, ref.ppi, ref.ci);
          } else if (ref.type === 'equation') {
            wasm.deleteEquationControl(ref.sec, ref.ppi, ref.ci);
          } else {
            wasm.deleteShapeControl(ref.sec, ref.ppi, ref.ci);
          }
          return this.cursor.getPosition();
        }});
      }
      return;
    }
    if (this.cursor.isInTableObjectSelection()) {
      const ref = this.cursor.getSelectedTableRef();
      if (ref) {
        this.performCopy();
        this.cursor.moveOutOfSelectedTable();
        this.eventBus.emit('table-object-selection-changed', false);
        this.executeOperation({ kind: 'snapshot', operationType: 'cutTable', operation: (wasm: WasmBridge) => {
          wasm.deleteTableControl(ref.sec, ref.ppi, ref.ci);
          return this.cursor.getPosition();
        }});
      }
      return;
    }
    // 텍스트 선택 → textarea 포커스 후 execCommand
    this.focusTextarea();
    document.execCommand('cut');
  }

  /** 선택 영역 삭제 (커맨드 시스템용 — 편집 > 지우기) */
  performDelete(): void {
    if (this.editMode === 'form') return;
    if (this.cursor.isInPictureObjectSelection()) {
      const ref = this.cursor.getSelectedPictureRef();
      if (ref) {
        this.cursor.moveOutOfSelectedPicture();
        this.pictureObjectRenderer?.clear();
        this.eventBus.emit('picture-object-selection-changed', false);
        this.executeOperation({ kind: 'snapshot', operationType: 'deleteObject', operation: (wasm: WasmBridge) => {
          this.deleteObjectControl(ref);
          return this.cursor.getPosition();
        }});
      }
      return;
    }
    if (this.cursor.isInTableObjectSelection()) {
      const ref = this.cursor.getSelectedTableRef();
      if (!ref) return;
      if (ref.cellPath && ref.cellPath.length > 1) {
        this.cursor.moveOutOfSelectedTable();
        this.eventBus.emit('table-object-selection-changed', false);
        return;
      }
      this.cursor.moveOutOfSelectedTable();
      this.eventBus.emit('table-object-selection-changed', false);
      this.executeOperation({ kind: 'snapshot', operationType: 'deleteTable', operation: (wasm: WasmBridge) => {
        wasm.deleteTableControl(ref.sec, ref.ppi, ref.ci);
        return this.cursor.getPosition();
      }});
      return;
    }
    if (this.cursor.hasSelection()) {
      this.deleteSelection();
    }
  }

  /** 전체 선택 (커맨드 시스템용) */
  performSelectAll(): void { this.handleSelectAll(); }

  /** 모양 복사/붙여넣기 (커맨드 시스템용) */
  performFormatCopy(): void {
    // armed 상태에선 apply-first — sticky 이후 선택 상태로 Opt+C 를 눌러도 재복사가
    // 아니라 적용이다(재복사는 Esc 해제 후). 반복 적용 시맨틱과 정합인 의도된 동작.
    if (this.applyCopiedFormatToCurrentTarget()) return;
    this.copyFormatAtCursor();
  }

  /** 모양 붙여넣기만 수행한다 (커맨드 시스템용) */
  performFormatPaste(): void {
    this.applyCopiedFormatToCurrentTarget();
  }

  private applyCopiedFormatToCurrentTarget(): boolean {
    if (!this.formatCopyState) return false;

    if (this.cursor.isInCellSelectionMode()) {
      if (this.formatCopyState.cellProps && Object.keys(this.formatCopyState.cellProps).length > 0) {
        return this.applyCopiedCellPropsToSelection(this.formatCopyState.cellProps);
      }
      return false;
    }

    const sel = this.getSelection();
    if (!sel) return false;

    const { charProps, paraProps } = this.formatCopyState;
    if (Object.keys(charProps).length > 0) {
      this.applyCharPropsToRange(sel.start, sel.end, charProps);
    }
    if (Object.keys(paraProps).length > 0) {
      this.applyParaPropsToRange(sel.start, sel.end, paraProps);
    }
    // 한컴(데스크톱) 호환: 모양 복사는 Esc 로 해제할 때까지 반복 적용된다.
    this.focusTextarea();
    return true;
  }

  private copyFormatAtCursor(): void {
    const currentCharProps = this.getCharProperties();
    const charProps = pickDefined(currentCharProps, FORMAT_COPY_CHAR_KEYS) as Partial<CharProperties>;
    if (charProps.fontIds === undefined && charProps.fontId === undefined) {
      const fontFamily = currentCharProps.fontFamily;
      if (fontFamily) {
        const fontId = this.wasm.findOrCreateFontId(fontFamily);
        if (fontId >= 0) charProps.fontId = fontId;
      }
    }
    const paraProps = normalizeFormatCopyParaProps(
      pickDefined(this.getParaProperties(), FORMAT_COPY_PARA_KEYS) as Partial<ParaProperties>,
    );
    const pos = this.cursor.getPosition();
    const cellProps = pos.parentParaIndex !== undefined
      ? pickDefined(
          this.wasm.getCellOwnProperties(pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!, pos.cellIndex!),
          FORMAT_COPY_CELL_KEYS,
        ) as Partial<CellProperties>
      : undefined;
    this.formatCopyState = {
      charProps: JSON.parse(JSON.stringify(charProps)),
      paraProps: JSON.parse(JSON.stringify(paraProps)),
      cellProps: cellProps ? JSON.parse(JSON.stringify(cellProps)) : undefined,
    };
    this.focusTextarea();
  }

  private applyCopiedCellPropsToSelection(cellProps: Partial<CellProperties>): boolean {
    const ctx = this.cursor.getCellTableContext();
    const range = this.cursor.getSelectedCellRange();
    if (!ctx || !range) {
      this.focusTextarea();
      return false;
    }
    if (ctx.cellPath && ctx.cellPath.length > 1) {
      console.info('[InputHandler] 중첩 표 셀 모양복사는 아직 지원하지 않습니다');
      this.focusTextarea();
      return false;
    }

    const props = JSON.parse(JSON.stringify(cellProps)) as Partial<CellProperties>;
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'formatCopyCellProps',
      operation: (wasm) => {
        const dims = wasm.getTableDimensions(ctx.sec, ctx.ppi, ctx.ci);
        const excluded = this.cursor.getExcludedCells();
        for (let cellIdx = 0; cellIdx < dims.cellCount; cellIdx++) {
          const info = wasm.getCellInfo(ctx.sec, ctx.ppi, ctx.ci, cellIdx);
          if (info.row < range.startRow || info.row > range.endRow ||
              info.col < range.startCol || info.col > range.endCol) {
            continue;
          }
          if (excluded.has(`${info.row},${info.col}`)) continue;
          wasm.setCellProperties(ctx.sec, ctx.ppi, ctx.ci, cellIdx, props);
        }
        return this.cursor.getPosition();
      },
    });
    this.focusTextarea();
    return true;
  }

  /** 서식 토글 (커맨드 시스템용) */
  toggleFormat(prop: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'emboss' | 'engrave' | 'outline' | 'superscript' | 'subscript'): void {
    this.applyToggleFormat(prop);
  }

  /** 문단 정렬 적용 (커맨드 시스템용) */
  applyParaAlign(align: string): void {
    this.applyParaFormat({ alignment: align });
  }

  /** 줄 간격 적용 (커맨드 시스템용, Percent 타입) */
  setLineSpacing(value: number): void {
    this.applyParaFormat({ lineSpacing: value, lineSpacingType: 'Percent' });
  }

  /** 글자 크기 지정 (리본 값 상자용, pt) — 증감이 아니라 절대값 */
  setFontSizePt(pt: number): void {
    if (!Number.isFinite(pt) || pt <= 0) return;
    this.applyCharFormat({ fontSize: Math.round(pt * 100) });
  }

  /** 문단 왼쪽 여백 지정 (리본 값 상자용, pt) — 증감이 아니라 절대값 */
  setParaIndentPt(pt: number): void {
    if (!Number.isFinite(pt)) return;
    this.applyParaFormat({ marginLeft: (pt * 96) / 72 } as Partial<import('@/core/types').ParaProperties>);
  }

  /** 첫 줄 내어쓰기 양 지정 (리본 값 상자용, pt) — 저장은 음수 indent 다 */
  setParaOutdentPt(pt: number): void {
    if (!Number.isFinite(pt)) return;
    this.applyParaFormat({ indent: (-pt * 96) / 72 } as Partial<import('@/core/types').ParaProperties>);
  }

  /**
   * 쪽 줄이기 — 문서 전체에 줄간격(주 레버, 한컴 정합)을 조금씩 줄이고, 부족하면
   * 자간까지 좁혀 페이지 수를 줄인다.
   *
   * - `mode:'one'` (한 쪽 줄이기): 목표 = 현재 쪽수 − 1. Word 'Shrink One Page' 정합.
   *   목표를 채우는 **가장 약한** 조합에서 멈춘다 — 필요 이상으로 조이지 않는다.
   * - `mode:'max'` (전체 쪽 줄이기): 가독 하한까지 가 보고 **가장 적은 쪽수**를 찾은 뒤,
   *   그 쪽수를 내는 **가장 약한** 조합으로 확정한다(같은 결과면 덜 조인 쪽이 낫다).
   *
   * 후보 사다리: 줄간격 155→130%(5%p 스텝) → 그래도 부족하면 줄간격 130% 고정 +
   * 자간 -3→-12%(3%p 스텝). 가독성 하한: 줄간격 130%, 자간 -12%.
   *
   * 탐색은 wasm 스냅샷 위에서만 시도해 히스토리를 더럽히지 않고(applyParaFormat/
   * applyCharFormat 은 호출마다 rebuild_section→paginate 하므로 pageCount 가 즉시
   * 갱신된다), 성공 조합을 찾으면 스냅샷 커맨드 1회로 확정 → Ctrl+Z 한 번에 원상복귀.
   *
   * ponytail: 후보마다 전체 문단×paginate = O(paras·candidates) 재조판. 보통 문서엔
   *   충분히 빠르다. 문제 되면 beginBatch/endBatch 로 조판을 후보당 1회로 묶을 것.
   */
  autoFitToPage(mode: 'one' | 'max' = 'one'): {
    status: 'already' | 'failed' | 'ok';
    lineSpacing?: number;
    charSpacing?: number;
    pagesBefore?: number;
    pagesAfter?: number;
  } {
    const LS_FLOOR = 130; // 줄간격 하한 (%)
    const LS_STEP = 5;
    const CS_FLOOR = -12; // 자간 하한 (%)
    const CS_STEP = 3;
    const total = this.wasm.pageCount;
    if (total <= 1) return { status: 'already' };
    const target = total - 1;

    const secCount = this.wasm.getSectionCount();
    const p0 = this.wasm.getParaPropertiesAt(0, 0);
    const startLS =
      p0.lineSpacingType === 'Percent' && p0.lineSpacing
        ? Math.round(p0.lineSpacing)
        : 160;

    const applyLS = (v: number): void => {
      const json = JSON.stringify({ lineSpacing: v, lineSpacingType: 'Percent' });
      for (let s = 0; s < secCount; s++) {
        const pc = this.wasm.getParagraphCount(s);
        for (let p = 0; p < pc; p++) this.wasm.applyParaFormat(s, p, json);
      }
    };
    const applyCS = (v: number): void => {
      const json = JSON.stringify({ spacings: Array(7).fill(v) });
      for (let s = 0; s < secCount; s++) {
        const pc = this.wasm.getParagraphCount(s);
        for (let p = 0; p < pc; p++) {
          const len = this.wasm.getLogicalLength(s, p);
          if (len > 0) this.wasm.applyCharFormat(s, p, 0, len, json);
        }
      }
    };

    // 후보 사다리: [줄간격, 자간] 조합. 줄간격 먼저(한컴 주 레버), 이후 자간 추가.
    const ladder: Array<[number, number]> = [];
    for (let v = startLS - LS_STEP; v >= LS_FLOOR; v -= LS_STEP) ladder.push([v, 0]);
    const lsFinal = Math.min(startLS, LS_FLOOR);
    for (let c = -CS_STEP; c >= CS_FLOOR; c -= CS_STEP) ladder.push([lsFinal, c]);
    if (ladder.length === 0) return { status: 'failed' };

    // 스냅샷 위에서 "어느 조합이면 되는지"만 탐색 (히스토리 무오염).
    //   one: 목표(쪽수-1)를 채우는 첫(=가장 약한) 조합에서 멈춘다.
    //   max: 사다리를 끝까지 훑어 최소 쪽수를 찾고, 그 쪽수를 처음 낸 조합을 쓴다
    //        — 더 조여도 쪽수가 같으면 덜 조인 쪽이 낫다.
    const snap = this.wasm.saveSnapshot();
    let winner: [number, number] | null = null;
    let bestPages = total;
    let prevCS = 0;
    for (const [ls, cs] of ladder) {
      applyLS(ls);
      if (cs !== prevCS) { applyCS(cs); prevCS = cs; }
      const pages = this.wasm.pageCount;
      if (mode === 'one') {
        if (pages <= target) { winner = [ls, cs]; bestPages = pages; break; }
      } else if (pages < bestPages) {
        winner = [ls, cs];
        bestPages = pages;
        if (pages <= 1) break; // 더 줄일 곳이 없다
      }
    }
    this.wasm.restoreSnapshot(snap);
    this.wasm.discardSnapshot(snap);

    if (winner === null) return { status: 'failed' };

    // 확정 1회 — 스냅샷 커맨드라 Ctrl+Z 한 번에 원문 그대로 복원된다.
    const cursorBefore = this.cursor.getPosition();
    const [lsWin, csWin] = winner;
    this.executeOperation({
      kind: 'snapshot',
      operationType: 'autoFitPage',
      operation: (): DocumentPosition => {
        applyLS(lsWin);
        if (csWin !== 0) applyCS(csWin);
        return cursorBefore;
      },
    });
    return {
      status: 'ok',
      lineSpacing: lsWin,
      charSpacing: csWin,
      pagesBefore: total,
      pagesAfter: bestPages,
    };
  }

  /** 글꼴 크기 증감 (커맨드 시스템용, delta: HWPUNIT, 1pt=100) */
  adjustFontSize(delta: number): void {
    if (!this.cursor.hasSelection()) return;
    const current = this.getCharPropertiesAtCursor();
    const newSize = Math.max(100, (current.fontSize ?? 1000) + delta); // 최소 1pt
    this.applyCharFormat({ fontSize: newSize });
  }

  /** 장평 증감 (커맨드 시스템용, delta: percent point) */
  adjustCharRatio(delta: number): void {
    if (!this.cursor.hasSelection()) return;
    const current = this.getCharPropertiesAtCursor();
    const currentRatio = current.ratios?.[0] ?? 100;
    const nextRatio = Math.max(50, Math.min(200, Math.round(currentRatio + delta)));
    this.applyCharFormat({ ratios: Array(7).fill(nextRatio) });
  }

  /** 자간 증감 (커맨드 시스템용, delta: percent point) */
  adjustCharSpacing(delta: number): void {
    if (!this.cursor.hasSelection()) return;
    const current = this.getCharPropertiesAtCursor();
    const currentSpacing = current.spacings?.[0] ?? 0;
    const nextSpacing = Math.max(-50, Math.min(50, Math.round(currentSpacing + delta)));
    this.applyCharFormat({ spacings: Array(7).fill(nextSpacing) });
  }

  /** 스타일 적용 (커맨드 시스템용).
   * @param overwrite 한컴 「본문을 [X] 스타일 모양으로 덮어 쓸까요?」의 '예' — 직접 문단서식까지
   *                  스타일 모양으로 덮는다. 확인 대화상자는 명령 계층(style.ts)이 띄운다. */
  applyStyle(styleId: number, overwrite = false): void {
    try {
      const targets = this.getParaFormatTargetsAtCursor();
      if (targets.length === 0) return;
      const cursorBefore = this.cursor.getPosition();
      const operation = (wasm: WasmBridge): DocumentPosition => {
        for (const target of targets) {
          if (target.kind === 'body') {
            wasm.applyStyle(target.sec, target.para, styleId, overwrite);
            continue;
          }
          wasm.applyCellStyle(
            target.sec,
            target.parentPara,
            target.controlIdx,
            target.cellIdx,
            target.cellParaIdx,
            styleId,
          );
        }
        return { ...cursorBefore };
      };
      this.executeOperation({ kind: 'snapshot', operationType: 'applyStyle', operation });
    } catch (err) {
      console.warn('[InputHandler] applyStyle 실패:', err);
    }
  }

  /** 개요 수준 변경 (delta: +1=한 수준 증가, -1=한 수준 감소) */
  changeOutlineLevel(delta: number): void {
    const pos = this.cursor.getPosition();
    try {
      const inCell = pos.parentParaIndex !== undefined;
      const currentStyle = inCell
        ? this.wasm.getCellStyleAt(
            pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!,
            pos.cellIndex!, pos.cellParaIndex!,
          )
        : this.wasm.getStyleAt(pos.sectionIndex, pos.paragraphIndex);

      // 현재 개요 수준 파싱 (개요 1~7)
      const match = currentStyle.name.match(/^개요\s*(\d)$/);
      if (!match) {
        // [다단계 되살리기 2026-07-28] 스타일명이 "개요 N" 이 아니어도, 번호·글머리표
        // 문단이면 문단모양의 수준(para_level 0~6)을 직접 증감한다 — 엔진 렌더러는
        // 이미 수준별 번호 서식을 조판한다(expand_numbering_format). 과거엔 여기서
        // 그냥 return 해 한컴식 다단계 번호가 전혀 동작하지 않았다.
        const props = this.getParaProperties();
        if (!props.headType || props.headType === 'None') return;
        const cur = props.paraLevel ?? 0;
        const next = Math.max(0, Math.min(6, cur + delta));
        if (next === cur) return;
        this.applyParaFormat({ paraLevel: next } as Partial<import('@/core/types').ParaProperties>);
        this.focusTextarea();
        return;
      }

      const currentLevel = parseInt(match[1], 10);
      const targetLevel = currentLevel + delta;
      if (targetLevel < 1 || targetLevel > 7) return;

      // 스타일 목록에서 대상 개요 스타일 찾기
      const styles = this.wasm.getStyleList();
      const targetStyle = styles.find(s => {
        const m = s.name.match(/^개요\s*(\d)$/);
        return m && parseInt(m[1], 10) === targetLevel;
      });
      if (!targetStyle) return;

      this.applyStyle(targetStyle.id);
    } catch (err) {
      console.warn('[InputHandler] changeOutlineLevel 실패:', err);
    }
  }

  /** 문단 번호 토글: None→Number, Number/Outline→None */
  toggleNumbering(): void {
    try {
      const props = this.getParaProperties();
      if (props.headType && props.headType !== 'None') {
        // 번호 해제
        this.applyParaFormat({ headType: 'None' } as Partial<import('@/core/types').ParaProperties>);
      } else {
        // 번호 적용
        const nid = this.wasm.ensureDefaultNumbering();
        this.applyParaFormat({
          headType: 'Number',
          numberingId: nid,
          // [다단계 되살리기 2026-07-28] 0 하드코딩이던 자리 — 엔진은 7수준을 전부
          // 조판하는데 studio 가 항상 0으로 덮어써 다단계 번호가 사장돼 있었다.
          paraLevel: props.paraLevel ?? 0,
        } as Partial<import('@/core/types').ParaProperties>);
      }
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] toggleNumbering 실패:', err);
    }
  }

  /**
   * [일반 문단 들여쓰기 2026-08-02] 목록이 아닌 일반 문단을 원클릭으로 왼쪽 여백
   * (marginLeft) 한 스텝 증감. 개요/번호 문단은 changeOutlineLevel 이 수준을 바꾸지만,
   * 일반 문단엔 안 먹어서(headType==='None' 이면 return) 매번 문단모양 대화상자를
   * 열어야 했다.
   *
   * 단위: 이 경로의 marginLeft 은 **px(96dpi, zoom=1)** 다 — getParaProperties() 도,
   * applyParaFormat/applyParaPropsToRange(→ executeParaFormatCommand → wasm.applyParaFormat)
   * 도 px 로 주고받는다(2026-08-02 실측: marginLeft=28 → 화면 28px 들여쓰기, =4000 이면
   * 4000px 로 화면 밖). ※ para-shape-dialog 의 ptToRaw2x(여백 set)는 별개 버그다.
   * 스텝은 한컴 기본 들여쓰기 ≈ 2글자 ≈ 20pt = 27px.
   */
  private static readonly INDENT_STEP_PX = Math.round(20 * 96 / 72); // 20pt ≈ 27px

  increaseParaIndent(): void {
    try {
      const curPx = this.getParaProperties().marginLeft ?? 0;
      this.applyParaFormat({
        marginLeft: curPx + InputHandler.INDENT_STEP_PX,
      } as Partial<import('@/core/types').ParaProperties>);
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] increaseParaIndent 실패:', err);
    }
  }

  decreaseParaIndent(): void {
    try {
      const curPx = this.getParaProperties().marginLeft ?? 0;
      const next = Math.max(0, curPx - InputHandler.INDENT_STEP_PX); // 0 미만 clamp
      this.applyParaFormat({
        marginLeft: next,
      } as Partial<import('@/core/types').ParaProperties>);
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] decreaseParaIndent 실패:', err);
    }
  }

  /**
   * [한컴 패리티 2026-08-01] 빈 자동번호/글머리표 문단에서 Enter → 목록 이탈.
   * 한컴은 빈 번호 항목에서 Enter 를 누르면 새 항목을 만드는 대신 그 문단의 번호/
   * 글머리표를 뗀다(수준>0 이면 한 수준 낮추고, 0 이면 완전히 해제). 우리는 여태
   * 무조건 문단 분할만 해 빈 번호 항목이 계속 쌓였다(사용자 신고). 재료는
   * toggleNumbering 과 동일(applyParaFormat).
   * @returns 이탈을 처리했으면 true(= Enter 소비, 분할 안 함), 아니면 false.
   */
  tryExitEmptyListOnEnter(): boolean {
    const pos = this.cursor.getPosition();
    if (this.wasm.getParagraphLength(pos.sectionIndex, pos.paragraphIndex) !== 0) return false;
    return this.exitListLevelAtCursor();
  }

  /**
   * [한컴 패리티] 현재 문단이 자동번호/글머리표면 한 수준 이탈한다
   * (수준>0 → 수준-1, 수준 0 → 번호/글머리표 해제). 텍스트 유무는 보지 않는다.
   * Enter(빈 문단 이탈)·Backspace(문단 시작 이탈) 공용 코어.
   * @returns 번호/글머리표라 처리했으면 true, 아니면 false.
   */
  exitListLevelAtCursor(): boolean {
    try {
      const props = this.getParaProperties();
      if (!props.headType || props.headType === 'None') return false;
      const lvl = props.paraLevel ?? 0;
      if (lvl > 0) {
        this.applyParaFormat({ paraLevel: lvl - 1 } as Partial<import('@/core/types').ParaProperties>);
      } else {
        this.applyParaFormat({ headType: 'None' } as Partial<import('@/core/types').ParaProperties>);
      }
      this.focusTextarea();
      return true;
    } catch (err) {
      console.warn('[InputHandler] exitListLevelAtCursor 실패:', err);
      return false;
    }
  }

  /** 글머리표 토글: None→Bullet, Bullet→None */
  toggleBullet(bulletChar = '●'): void {
    try {
      const props = this.getParaProperties();
      if (props.headType === 'Bullet') {
        // 글머리표 해제
        this.applyParaFormat({ headType: 'None' } as Partial<import('@/core/types').ParaProperties>);
      } else {
        // 글머리표 적용
        const bid = this.wasm.ensureDefaultBullet(bulletChar);
        this.applyParaFormat({
          headType: 'Bullet',
          numberingId: bid,
          paraLevel: props.paraLevel ?? 0, // 현재 수준 유지(구 0 하드코딩)
        } as Partial<import('@/core/types').ParaProperties>);
      }
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] toggleBullet 실패:', err);
    }
  }

  /** 글머리표 적용 (팝업에서 선택한 문자, 토글 없이 항상 적용) */
  applyBullet(bulletChar: string): void {
    try {
      const bid = this.wasm.ensureDefaultBullet(bulletChar);
      this.applyParaFormat({
        headType: 'Bullet',
        numberingId: bid,
        paraLevel: this.getParaProperties().paraLevel ?? 0, // 현재 수준 유지
      } as Partial<import('@/core/types').ParaProperties>);
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] applyBullet 실패:', err);
    }
  }

  /** 문단 번호 모양 적용 (대화상자에서 선택한 numberingId) */
  applyNumbering(numberingId: number): void {
    try {
      this.applyParaFormat({
        headType: 'Number',
        numberingId,
        paraLevel: this.getParaProperties().paraLevel ?? 0, // 현재 수준 유지
      } as Partial<import('@/core/types').ParaProperties>);
      this.focusTextarea();
    } catch (err) {
      console.warn('[InputHandler] applyNumbering 실패:', err);
    }
  }

  /** 글자 모양 대화상자용: 커서 위치의 글자 서식 조회 (커맨드 시스템용) */
  getCharProperties(): CharProperties {
    return this.getCharPropertiesAtCursor();
  }

  /** 문단 모양 대화상자용: 커서 위치의 문단 서식 조회 (커맨드 시스템용) */
  getParaProperties(): ParaProperties {
    // 머리말/꼬리말 모드
    if (this.cursor.isInHeaderFooter()) {
      const isHeader = this.cursor.headerFooterMode === 'header';
      return this.wasm.getParaPropertiesInHf(
        this.cursor.hfSectionIdx, isHeader, this.cursor.hfApplyTo, this.cursor.hfParaIdx,
      );
    }
    if (this.cursor.isInFootnote()) {
      return this.wasm.getParaPropertiesInFootnote(
        this.cursor.fnSectionIdx,
        this.cursor.fnParaIdx,
        this.cursor.fnControlIdx,
        this.cursor.fnInnerParaIdx,
      );
    }
    const pos = this.cursor.getPosition();
    if (pos.parentParaIndex !== undefined) {
      return this.wasm.getCellParaPropertiesAt(
        pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,
        pos.cellIndex!, pos.cellParaIndex!,
      );
    }
    return this.wasm.getParaPropertiesAt(pos.sectionIndex, pos.paragraphIndex);
  }

  /** 커서 위치의 문단 스타일 ID를 반환한다 (스타일 대화상자용) */
  getCurrentStyleId(): number {
    try {
      const pos = this.cursor.getPosition();
      const info = pos.parentParaIndex !== undefined
        ? this.wasm.getCellStyleAt(
            pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,
            pos.cellIndex!, pos.cellParaIndex!,
          )
        : this.wasm.getStyleAt(pos.sectionIndex, pos.paragraphIndex);
      return info.id;
    } catch {
      return 0;
    }
  }

  /** 현재 선택 범위를 반환한다 (커맨드 시스템용) */
  getSelection(): { start: DocumentPosition; end: DocumentPosition } | null {
    return this.cursor.getSelectionOrdered();
  }

  /** 지정된 선택 범위에 글자 서식을 적용한다 (커맨드 시스템용) */
  applyCharPropsToRange(
    start: DocumentPosition,
    end: DocumentPosition,
    props: Partial<CharProperties>,
  ): void {
    const cmd = new ApplyCharFormatCommand(start, end, props);
    this.executeOperation({ kind: 'command', command: cmd });
  }

  /** 지정된 선택 범위에 문단 서식을 적용한다 (커맨드 시스템용) */
  applyParaPropsToRange(
    start: DocumentPosition,
    end: DocumentPosition,
    props: Partial<ParaProperties>,
  ): void {
    try {
      const targets = this.getParaFormatTargetsForRange(start, end);
      this.executeParaFormatCommand(targets, props as Record<string, unknown>);
    } catch (err) {
      console.warn('[InputHandler] applyParaPropsToRange 실패:', err);
    }
  }

  /** 커서 위치 문단에 문단 서식을 적용한다 (커맨드 시스템용) */
  applyParaPropsAtCursor(props: Partial<ParaProperties>): void {
    this.applyParaFormat(props as Record<string, unknown>);
  }

  /** 양식 개체 클릭 처리 */
  handleFormObjectClick(formHit: FormObjectHitResult, pageIdx: number, _zoom: number): void {
    if (!formHit.found || formHit.sec === undefined || formHit.para === undefined || formHit.ci === undefined) return;

    const { sec, para, ci, formType } = formHit;

    // 셀 내부 폼 값 설정 헬퍼
    const setFormVal = (valueJson: string) => {
      if (formHit.inCell && formHit.tablePara !== undefined && formHit.tableCi !== undefined
          && formHit.cellIdx !== undefined && formHit.cellPara !== undefined) {
        this.wasm.setFormValueInCell(sec, formHit.tablePara, formHit.tableCi,
          formHit.cellIdx, formHit.cellPara, ci, valueJson);
      } else {
        this.wasm.setFormValue(sec, para, ci, valueJson);
      }
    };

    switch (formType) {
      case 'CheckBox': {
        // 체크박스 토글: value 0↔1
        const newValue = (formHit.value ?? 0) === 0 ? 1 : 0;
        setFormVal(JSON.stringify({ value: newValue }));
        this.afterEdit();
        break;
      }
      case 'RadioButton': {
        // 라디오 버튼: 같은 그룹 내 다른 라디오 버튼 해제 후 선택
        this.handleRadioButtonClick(sec, para, ci);
        break;
      }
      case 'PushButton': {
        // 명령 단추: 웹 환경에서는 보안상 비활성 (클릭 무시)
        break;
      }
      case 'ComboBox': {
        this.showComboBoxOverlay(sec, para, ci, formHit, pageIdx);
        break;
      }
      case 'Edit': {
        this.showEditOverlay(sec, para, ci, formHit, pageIdx);
        break;
      }
    }
  }

  /** 라디오 버튼 클릭: 같은 그룹 내 다른 라디오 버튼 해제 */
  private handleRadioButtonClick(sec: number, para: number, ci: number): void {
    // 현재 클릭된 라디오 버튼의 그룹 이름 조회
    const info = this.wasm.getFormObjectInfo(sec, para, ci);
    if (!info.ok) return;

    const groupName = info.properties?.['GroupName'] ?? '';

    // 같은 문단 내 다른 라디오 버튼 찾아서 해제
    // (HWP 양식에서 라디오 버튼은 보통 같은 문단에 배치됨)
    const section = sec;
    // 동일 문단의 모든 컨트롤을 순회하여 같은 그룹의 라디오 버튼 해제
    for (let i = 0; i < 50; i++) { // 최대 50개 컨트롤 검사
      if (i === ci) continue;
      const otherInfo = this.wasm.getFormObjectInfo(section, para, i);
      if (!otherInfo.ok || otherInfo.formType !== 'RadioButton') continue;
      const otherGroup = otherInfo.properties?.['GroupName'] ?? '';
      if (otherGroup === groupName && otherInfo.value !== 0) {
        this.wasm.setFormValue(section, para, i, JSON.stringify({ value: 0 }));
      }
    }

    // 클릭된 라디오 버튼 선택
    this.wasm.setFormValue(sec, para, ci, JSON.stringify({ value: 1 }));
    this.afterEdit();
  }

  /** 양식 개체 bbox를 scroll-content 내 절대 좌표로 변환 */
  // ─── 양식 개체 선택 (그림 개체 선택의 얇은 판) ─────────────────────────
  // 편집 모드에서 양식을 클릭하면 개체로 선택되고(테두리+모서리), 오른쪽 패널이
  // 양식 속성을 보여준다. 실제 동작(체크 토글 등)은 「양식 모드」에서만 클릭으로 돈다
  // — 한컴과 같은 이분법. 더블클릭은 어느 모드든 텍스트/캡션 수정.
  // ponytail: 핸들 드래그 리사이즈는 없다(크기는 패널 숫자로) — 요구가 생기면 그림 배관 재사용.

  /** 지금 선택된 양식 개체 (없으면 null). 패널이 읽는다. */
  formObjectSelection: { hit: FormObjectHitResult; pageIdx: number } | null = null;
  private formSelectionEl: HTMLElement | null = null;
  private formKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * 개체 조작 키를 **문서 수준**에서 받는다 — 편집기(textarea)에만 걸면 오른쪽 패널을
   * 만졌거나 포커스가 본문 밖으로 나간 뒤 화살표가 먹지 않는다(사용자 신고 2026-08-03).
   * 패널 입력칸에서 타이핑 중일 때는 가로채지 않는다(글자·화살표는 그 칸의 것이다).
   */
  private installFormKeyHandler(): void {
    if (this.formKeyHandler) return;
    this.formKeyHandler = (e: KeyboardEvent): void => {
      if (!this.formObjectSelection) return;
      if (this.formOverlay) return; // 캡션/내용 입력 중 — 그 입력창이 주인
      const t = e.target as HTMLElement | null;
      if (t && t !== this.textarea) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.moveSelectedFormObject(e.key === 'ArrowLeft' ? -1 : 1);
      } else if ((e.key.length === 1 || e.key === 'Process') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 글자를 치기 시작하면 개체 선택을 접고 평소 타이핑으로 — 가로채지 않는다.
        // (한글 조합 입력은 keydown 이 'Process' 로 온다 — 안 접으면 테두리 잔상이 남는다)
        this.clearFormObjectSelection();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // 전파를 막지 않으면 같은 키가 textarea 핸들러로 흘러가 본문 글자까지 지운다
        e.stopPropagation();
        const { hit } = this.formObjectSelection;
        if (hit.sec !== undefined && hit.para !== undefined && hit.ci !== undefined) {
          try {
            const { sec, para, ci } = hit as { sec: number; para: number; ci: number };
            this.runFormObjectOp('deleteFormObject', () => { this.wasm.deleteFormObject(sec, para, ci); });
            this.clearFormObjectSelection();
            this.eventBus.emit('document-changed');
          } catch (err) {
            console.warn('[InputHandler] 양식 개체 삭제 실패:', err);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.clearFormObjectSelection();
      }
    };
    document.addEventListener('keydown', this.formKeyHandler, true);
  }

  // ─── 셀 잠금 (셀 보호 cellProtect 강제) ────────────────────────────────
  // 엔진 비트(HWP5 리스트헤더/HWPX protect)는 예전부터 왕복됐지만 편집 차단이 없었다.
  // 방향 결정(2026-08-04): 항상 잠김 / 패널 토글로 해제 / 캐럿 진입 시에만 자물쇠 표시.

  private cellLockBadgeEl: HTMLElement | null = null;
  private lastCellLockToastAt = 0;

  /** 커서가 잠긴 셀 안이면 그 셀 좌표를 준다(아니면 null). 중첩 표는 바깥 표 기준(v1). */
  private cursorLockedCell(): { sec: number; ppi: number; ci: number; cellIdx: number } | null {
    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return null;
    const pos = this.cursor.getPosition();
    if (pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined) {
      return null;
    }
    try {
      const cp = this.wasm.getCellProperties(
        pos.sectionIndex, pos.parentParaIndex, pos.controlIndex, pos.cellIndex);
      if (!cp?.cellProtect) return null;
      return { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex, cellIdx: pos.cellIndex };
    } catch {
      return null;
    }
  }

  private notifyCellLockBlocked(): void {
    const now = Date.now();
    if (now - this.lastCellLockToastAt < 1500) return; // 키 반복 스팸 방지
    this.lastCellLockToastAt = now;
    showToast({
      message: '잠긴 셀이라 고칠 수 없어요.\n오른쪽 패널 「속성 → 셀 보호」를 끄면 풀립니다.',
      durationMs: 4000,
    });
  }

  /** 캐럿이 움직일 때마다: 잠긴 셀이면 입력을 뿌리(readOnly)에서 막고 자물쇠 배지를 단다 */
  private updateCellLockState(): void {
    const locked = this.cursorLockedCell();
    this.textarea.readOnly = !!locked; // 타이핑·IME 조합 원천 차단 (키 이동·클릭은 그대로)
    if (!locked) {
      this.cellLockBadgeEl?.remove();
      this.cellLockBadgeEl = null;
      return;
    }
    try {
      const bb = this.wasm.getTableCellBboxes(locked.sec, locked.ppi, locked.ci)
        .find((b) => b.cellIdx === locked.cellIdx);
      if (!bb) return;
      const rect = this.formBboxToOverlayRect({ x: bb.x, y: bb.y, w: bb.w, h: bb.h }, bb.pageIndex);
      if (!this.cellLockBadgeEl) {
        const el = document.createElement('div');
        el.className = 'cell-lock-badge';
        el.textContent = '\u{1F512}';
        el.style.cssText = 'position:absolute;pointer-events:none;z-index:30;font-size:11px;line-height:1;opacity:.75';
        (this.container.querySelector('#scroll-content') ?? this.container).appendChild(el);
        this.cellLockBadgeEl = el;
      }
      this.cellLockBadgeEl.style.left = `${rect.left + rect.width - 15}px`;
      this.cellLockBadgeEl.style.top = `${rect.top + 2}px`;
    } catch { /* bbox 조회 실패 시 배지만 생략 — 차단은 이미 걸려 있다 */ }
  }

  /** 양식 개체 조작을 스냅숏 undo 로 태운다 — 그림 개체와 같은 전략(2026-08-04 요청) */
  runFormObjectOp(operationType: string, op: () => DocumentPosition | void): void {
    this.executeOperation({
      kind: 'snapshot',
      operationType,
      operation: () => op() ?? this.cursor.getPosition(),
    });
  }

  selectFormObject(formHit: FormObjectHitResult, pageIdx: number): void {
    this.installFormKeyHandler();
    this.exitPictureObjectSelectionIfNeeded();
    this.formObjectSelection = { hit: formHit, pageIdx };
    this.caret.hide();
    this.selectionRenderer.clear();
    this.renderFormObjectSelection();
    this.eventBus.emit('form-object-selection-changed', true);
  }

  clearFormObjectSelection(): void {
    if (!this.formObjectSelection) return;
    this.formObjectSelection = null;
    this.formSelectionEl?.remove();
    this.formSelectionEl = null;
    this.eventBus.emit('form-object-selection-changed', false);
  }

  /** 선택 테두리 + 모서리 사각형 — 그림 선택과 같은 인상만 준다(드래그 없음) */
  private renderFormObjectSelection(): void {
    this.formSelectionEl?.remove();
    this.formSelectionEl = null;
    const sel = this.formObjectSelection;
    if (!sel?.hit.bbox) return;
    const rect = this.formBboxToOverlayRect(sel.hit.bbox, sel.pageIdx);
    const box = document.createElement('div');
    box.className = 'form-object-selection';
    box.style.cssText = [
      'position:absolute;pointer-events:none;z-index:30',
      `left:${rect.left - 2}px;top:${rect.top - 2}px`,
      `width:${rect.width + 4}px;height:${rect.height + 4}px`,
      'border:1.5px solid var(--color-primary,#00647f)',
    ].join(';');
    for (const [hx, hy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const h = document.createElement('div');
      h.style.cssText = [
        'position:absolute;width:7px;height:7px;background:#fff',
        'border:1.5px solid var(--color-primary,#00647f)',
        `left:${hx === 0 ? -4 : 'calc(100% - 4px)'}`.replace('left:-4', 'left:-4px'),
        `top:${hy === 0 ? '-4px' : 'calc(100% - 4px)'}`,
      ].join(';');
      if (hx === 1) h.style.left = 'calc(100% - 4px)';
      else h.style.left = '-4px';
      box.appendChild(h);
    }
    const scrollContent = this.container.querySelector('#scroll-content');
    (scrollContent ?? this.container).appendChild(box);
    this.formSelectionEl = box;
  }

  /**
   * 패널에서 속성을 고친 뒤 — bbox 가 변했을 수 있어 옛 중심으로 다시 히트해 갱신한다.
   * 못 찾으면(재조판으로 밀림) 선택을 접는다 — 엉뚱한 좌표에 테두리를 남기지 않는다.
   */
  refreshFormObjectSelection(): void {
    const sel = this.formObjectSelection;
    if (!sel?.hit.bbox) return;
    const cx = sel.hit.bbox.x + sel.hit.bbox.w / 2;
    const cy = sel.hit.bbox.y + sel.hit.bbox.h / 2;
    try {
      const hit = this.wasm.getFormObjectAt(sel.pageIdx, cx, cy);
      if (hit.found && hit.sec === sel.hit.sec && hit.para === sel.hit.para && hit.ci === sel.hit.ci) {
        this.formObjectSelection = { hit, pageIdx: sel.pageIdx };
        this.renderFormObjectSelection();
        this.eventBus.emit('form-object-selection-changed', true);
        return;
      }
    } catch { /* 조회 실패 → 접기 */ }
    this.clearFormObjectSelection();
  }

  /** 선택된 양식 개체를 텍스트 사이에서 옮긴다(delta=±1 화살표, 또는 절대 낙하점) */
  moveSelectedFormObject(deltaOrProps: number | { toPara: number; offset: number }): void {
    const sel = this.formObjectSelection;
    if (!sel?.hit || sel.hit.sec === undefined || sel.hit.para === undefined || sel.hit.ci === undefined) return;
    try {
      const props = typeof deltaOrProps === 'number' ? { delta: deltaOrProps } : deltaOrProps;
      const { sec, para, ci } = sel.hit as { sec: number; para: number; ci: number };
      // ponytail: 경계에서 실패한 이동도 no-op 스냅숏 한 장이 스택에 남는다 — 신고되면 pre-check
      let r: { ok: boolean; paraIdx: number; controlIdx: number } | undefined;
      this.runFormObjectOp('moveFormObject', () => { r = this.wasm.moveFormObject(sec, para, ci, props as any); });
      const moved = r as { ok: boolean; paraIdx: number; controlIdx: number } | undefined;
      if (!moved?.ok) return;
      this.eventBus.emit('document-changed');
      // 새 위치로 재히트해 선택 테두리를 따라 옮긴다 — 낙하점을 모르니 개체 정보로 재조회
      const hit2 = { ...sel.hit, para: moved.paraIdx, ci: moved.controlIdx };
      this.formObjectSelection = { hit: hit2 as FormObjectHitResult, pageIdx: sel.pageIdx };
      // bbox 는 재조판 후 바뀐다 — 화면 전체에서 이 개체를 다시 찾는 대신, 문서 변경 후
      // 한 프레임 뒤 옛 중심 근처를 다시 히트한다(가로 이동은 근처에 남는다).
      requestAnimationFrame(() => this.rehitFormSelectionNear(sel.hit.bbox, sel.pageIdx, moved.paraIdx, moved.controlIdx));
    } catch (err) {
      console.warn('[InputHandler] 양식 개체 이동 실패:', err);
    }
  }

  /** 옛 bbox 주변을 넓혀가며 재히트 — 같은 (para, ci) 를 찾으면 선택 갱신 */
  private rehitFormSelectionNear(
    bbox: { x: number; y: number; w: number; h: number } | undefined,
    pageIdx: number, para: number, ci: number,
  ): void {
    if (!bbox) return;
    const cy = bbox.y + bbox.h / 2;
    const step = Math.max(bbox.w / 2, 8);
    for (let i = -8; i <= 8; i++) {
      const cx = bbox.x + bbox.w / 2 + i * step;
      try {
        const hit = this.wasm.getFormObjectAt(pageIdx, cx, cy);
        if (hit.found && hit.para === para && hit.ci === ci) {
          this.formObjectSelection = { hit, pageIdx };
          this.renderFormObjectSelection();
          this.eventBus.emit('form-object-selection-changed', true);
          return;
        }
      } catch { /* 계속 탐색 */ }
    }
    // 못 찾으면(줄바꿈으로 멀리 감) 선택 유지하되 테두리만 숨긴다 — 다음 클릭이 정리한다
    this.formSelectionEl?.remove();
    this.formSelectionEl = null;
  }

  // ─── 양식 개체 드래그 이동 ─────────────────────────
  formMoveDrag: { startX: number; startY: number; moved: boolean } | null = null;

  updateFormMoveDrag(e: MouseEvent): void {
    const drag = this.formMoveDrag;
    if (!drag || !this.formSelectionEl) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return; // 클릭 떨림 무시
    drag.moved = true;
    this.formSelectionEl.style.transform = `translate(${dx}px, ${dy}px)`;
    this.formSelectionEl.style.opacity = '0.6';
  }

  finishFormMoveDrag(e: MouseEvent): void {
    const drag = this.formMoveDrag;
    this.formMoveDrag = null;
    if (!drag) return;
    if (this.formSelectionEl) {
      this.formSelectionEl.style.transform = '';
      this.formSelectionEl.style.opacity = '';
    }
    if (!drag.moved) {
      // 제자리 클릭 = 선택 토글 해제 — "선택→해제→선택"이 클릭만으로 오간다
      // (사용자 요청 2026-08-04). 끌면(moved) 여전히 드래그 이동이다.
      this.clearFormObjectSelection();
      return;
    }

    const sel = this.formObjectSelection;
    if (!sel?.hit || sel.hit.sec === undefined) return;
    const sc = this.container.querySelector('#scroll-content');
    if (!sc) return;
    const cr = sc.getBoundingClientRect();
    const zoom = this.viewportManager.getZoom();
    const contentX = e.clientX - cr.left;
    const contentY = e.clientY - cr.top;
    const pageIdx = this.virtualScroll.getPageAtPoint(contentX, contentY);
    if (pageIdx < 0) return;
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, (sc as HTMLElement).clientWidth);
    const pageX = (contentX - pageLeft) / zoom;
    const pageY = (contentY - pageOffset) / zoom;
    try {
      const hit = this.wasm.hitTest(pageIdx, pageX, pageY);
      if (hit.paragraphIndex === undefined || (hit as any).parentParaIndex !== undefined) return; // 셀 안 낙하는 v1 밖
      if (hit.sectionIndex !== sel.hit.sec) return;
      const textOffset = this.wasm.logicalToTextOffset(hit.sectionIndex, hit.paragraphIndex, hit.charOffset);
      this.moveSelectedFormObject({ toPara: hit.paragraphIndex, offset: textOffset });
    } catch (err) {
      console.warn('[InputHandler] 양식 드래그 낙하 실패:', err);
    }
  }

  /**
   * 방금 삽입한 양식 개체를 선택 상태로 만든다 — 한컴 관례(개체 삽입 직후 = 선택).
   * 넣자마자 ←/→ 로 자리를 옮기고 Delete 로 지울 수 있다(2026-08-03 사용자 신고:
   * 삽입 직후 화살표가 개체가 아니라 캐럿을 움직여 "이동이 안 된다"로 보였다).
   * 캐럿(개체 바로 뒤) 왼쪽 지점을 히트해 개체를 찾는다.
   */
  selectJustInsertedForm(sec: number, para: number, ci: number, logicalAfter: number): void {
    try {
      // ⚠ 화면 캐럿(this.cursor.getRect())은 재조판 뒤 rAF 에서 갱신된다 — 연속 삽입이
      //   겹치면 낡은 좌표를 히트해 자동 선택이 조용히 실패했다(2026-08-03 실측:
      //   두 번째 개체부터 테두리가 안 뜨고 화살표가 캐럿만 움직임).
      //   엔진은 삽입 직후 이미 최신이므로 **엔진에 직접** 개체 뒤 캐럿 좌표를 묻는다.
      const rect = this.wasm.getCursorRect(sec, para, logicalAfter);
      if (!rect) { console.warn('[form-autosel] rect 없음', { sec, para, logicalAfter }); return; }
      const pageIdx = rect.pageIndex ?? 0;
      const hit = this.wasm.getFormObjectAt(pageIdx, rect.x - 3, rect.y + rect.height / 2);
      if (hit.found && hit.sec === sec && hit.para === para && hit.ci === ci) {
        this.selectFormObject(hit, pageIdx);
      } else {
        console.warn('[form-autosel] 히트 불일치', { want: { sec, para, ci }, rect, hit });
      }
    } catch (err) { console.warn('[form-autosel] 예외', err); }
  }

  /** 더블클릭 텍스트/캡션 수정 — Edit·콤보는 text, 나머지는 caption 을 고친다 */
  openFormObjectTextEditor(formHit: FormObjectHitResult, pageIdx: number): void {
    const { sec, para, ci, formType } = formHit;
    if (sec === undefined || para === undefined || ci === undefined) return;
    // 더블클릭도 개체를 선택 상태로 — "선택 + 바로 수정"(사용자 요청 2026-08-03)
    this.selectFormObject(formHit, pageIdx);
    if (formType === 'Edit' || formType === 'ComboBox') {
      this.showEditOverlay(sec, para, ci, formHit, pageIdx);
      return;
    }
    // 캡션 수정 — showEditOverlay 와 같은 겉모습, 커밋만 caption 으로
    this.removeFormOverlay();
    if (!formHit.bbox) return;
    const rect = this.formBboxToOverlayRect(formHit.bbox, pageIdx);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = formHit.caption ?? '';
    input.className = 'form-edit-input';
    input.style.left = `${rect.left}px`;
    input.style.top = `${rect.top}px`;
    input.style.width = `${rect.width}px`;
    input.style.height = `${rect.height}px`;
    input.style.fontSize = `${Math.max(rect.height * 0.5, 10)}px`;
    const commit = () => {
      if (input.value !== (formHit.caption ?? '')) {
        this.runFormObjectOp('setFormObjectProps', () => {
          this.wasm.setFormObjectProps(sec, para, ci, { caption: input.value });
        });
      }
      this.removeFormOverlay();
      this.afterEdit();
      this.refreshFormObjectSelection();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); this.removeFormOverlay(); }
    });
    input.addEventListener('blur', () => commit());
    const scrollContent = this.container.querySelector('#scroll-content');
    (scrollContent ?? this.container).appendChild(input);
    this.formOverlay = input;
    const grab = () => { if (this.formOverlay === input) { input.focus(); input.select(); } };
    requestAnimationFrame(grab);
    setTimeout(grab, 0);
  }

  private formBboxToOverlayRect(bbox: { x: number; y: number; w: number; h: number }, pageIdx: number): { left: number; top: number; width: number; height: number } {
    const zoom = this.viewportManager.getZoom();
    const pageOffset = this.virtualScroll.getPageOffset(pageIdx);
    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;
    const pageLeft = this.virtualScroll.getPageLeftResolved(pageIdx, contentWidth);

    return {
      left: pageLeft + bbox.x * zoom,
      top: pageOffset + bbox.y * zoom,
      width: bbox.w * zoom,
      height: bbox.h * zoom,
    };
  }

  /** 기존 양식 오버레이 제거 */
  private removeFormOverlay(): void {
    if (this.formOverlay) {
      try { this.formOverlay.remove(); } catch { /* 이미 제거됨 */ }
      this.formOverlay = null;
    }
  }

  /** ComboBox 드롭다운 오버레이 */
  private showComboBoxOverlay(sec: number, para: number, ci: number, formHit: FormObjectHitResult, pageIdx: number): void {
    this.removeFormOverlay();
    if (!formHit.bbox) return;

    const info = this.wasm.getFormObjectInfo(sec, para, ci);
    if (!info.ok) return;

    // 항목 목록: 스크립트 InsertString 추출 결과 (WASM에서 제공)
    const items: string[] = info.items ?? [];
    const currentText = formHit.text ?? '';

    if (items.length === 0) {
      // 항목 없으면 Edit 오버레이로 대체
      this.showEditOverlay(sec, para, ci, formHit, pageIdx);
      return;
    }

    const rect = this.formBboxToOverlayRect(formHit.bbox, pageIdx);
    const fontSize = Math.max(rect.height * 0.6, 10);
    const itemHeight = fontSize * 1.6;

    // 컨테이너 (콤보박스 위치에 드롭다운 리스트 표시)
    const dropdown = document.createElement('div');
    dropdown.className = 'form-combo-dropdown';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.top + rect.height}px`;
    dropdown.style.width = `${rect.width}px`;

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'form-combo-item' + (item === currentText ? ' selected' : '');
      row.textContent = item;
      row.style.fontSize = `${fontSize}px`;
      row.style.lineHeight = `${itemHeight}px`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.wasm.setFormValue(sec, para, ci, JSON.stringify({ text: item }));
        this.removeFormOverlay();
        this.afterEdit();
      });
      dropdown.appendChild(row);
    }

    // 외부 클릭 시 닫기
    const onDocClick = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node)) {
        this.removeFormOverlay();
        document.removeEventListener('mousedown', onDocClick, true);
      }
    };
    // 다음 프레임에 등록 (현재 클릭 이벤트 무시)
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', onDocClick, true);
    });

    const scrollContent = this.container.querySelector('#scroll-content');
    (scrollContent ?? this.container).appendChild(dropdown);
    this.formOverlay = dropdown;
  }

  /** Edit 입력 오버레이 */
  private showEditOverlay(sec: number, para: number, ci: number, formHit: FormObjectHitResult, pageIdx: number): void {
    this.removeFormOverlay();
    if (!formHit.bbox) return;

    const rect = this.formBboxToOverlayRect(formHit.bbox, pageIdx);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = formHit.text ?? '';
    input.className = 'form-edit-input';
    input.style.left = `${rect.left}px`;
    input.style.top = `${rect.top}px`;
    input.style.width = `${rect.width}px`;
    input.style.height = `${rect.height}px`;
    input.style.fontSize = `${rect.height * 0.6}px`;

    const commit = () => {
      this.wasm.setFormValue(sec, para, ci, JSON.stringify({ text: input.value }));
      this.removeFormOverlay();
      this.afterEdit();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.removeFormOverlay();
      }
    });
    input.addEventListener('blur', () => {
      commit();
    });

    const scrollContent = this.container.querySelector('#scroll-content');
    (scrollContent ?? this.container).appendChild(input);
    this.formOverlay = input;

    // rAF 한 번으로는 편집기(textarea)에 포커스를 뺏길 수 있다 — 다음 틱까지 붙잡는다.
    const grab = () => { if (this.formOverlay === input) { input.focus(); input.select(); } };
    requestAnimationFrame(grab);
    setTimeout(grab, 0);
  }
}
