import type { CommandDef, EditorContext, CommandServices } from '../types';
import { PicturePropsDialog } from '@/ui/picture-props-dialog';
import { EquationEditorDialog } from '@/ui/equation-editor-dialog';
import { EquationPropertiesDialog } from '@/ui/equation-props-dialog';
import { SymbolsDialog } from '@/ui/symbols-dialog';
import { EmojiPicker } from '@/ui/emoji-picker';
import { BookmarkDialog } from '@/ui/bookmark-dialog';
import { SnippetDialog } from '@/ui/snippet-dialog';
import { TocDialog } from '@/ui/toc-dialog';
import { userSettings } from '@/core/user-settings';
import { EndnoteShapeDialog } from '@/ui/endnote-shape-dialog';
import { FieldInsertDialog } from '@/ui/field-insert-dialog';
import { showShapePicker } from '@/ui/shape-picker';
import { showPhotoPicker } from '@/ui/photo-picker';
import { showToast } from '@/ui/toast';
import type { ShapeType } from '@/ui/shape-picker';
import type { CellPathLike } from '@/core/types';

/** 캡션 기본 크기 — insert:caption-toggle 과 같은 값(30mm / 3mm)을 쓴다. */
const CAPTION_DEFAULT_WIDTH = Math.round(30 * 283.46);
const CAPTION_DEFAULT_SPACING = Math.round(3 * 283.46);

/** 파일 선택 → 배치 모드 진입 (insert:image 와 '내 사진'의 "파일에서 추가" 공용). */
function pickAndPlaceImageFile(ih: any): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let objectUrl = '';
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const img = new Image();
      objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
            reject(new Error('이미지 크기를 확인할 수 없습니다.'));
            return;
          }
          resolve();
        };
        img.onerror = () => reject(new Error('브라우저가 이 이미지 파일을 읽지 못했습니다.'));
        img.src = objectUrl;
      });
      ih.enterImagePlacementMode(data, ext, img.naturalWidth, img.naturalHeight, file.name);
      showToast({
        message: '그림을 넣을 위치를 문서 본문 또는 표 셀 안에서 클릭하거나 드래그하세요.',
        durationMs: 3500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[insert:image] 이미지 준비 실패:', err);
      showToast({ message: `그림을 삽입할 수 없습니다.\n${msg}`, durationMs: 6000 });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };
  input.click();
}

/**
 * 캡션 위치 프리셋 커맨드. direction=null 이면 "캡션 없음"(해제).
 *
 * 캡션이 이미 있으면 방향·정렬만 바꾸고 폭·간격은 그대로 둔다 — 사용자가 손으로 조정한
 * 값을 프리셋 한 번에 기본값으로 되돌리면 안 되기 때문(표 폭 복원 사고와 같은 부류).
 * vertAlign 은 Left/Right 캡션에서만 의미가 있어 Top/Bottom 일 땐 보내지 않는다.
 */
function captionPreset(
  id: string,
  label: string,
  direction: 'Top' | 'Bottom' | 'Left' | 'Right' | null,
  vertAlign?: 'Top' | 'Center' | 'Bottom',
): CommandDef {
  return {
    id,
    label,
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      // 수식·그룹은 캡션 대상이 아니다(caption-toggle 과 같은 가드).
      if (!ref || ref.type === 'equation' || ref.type === 'group') return;

      let props: any;
      try {
        props = getProps(services, ref);
      } catch { return; }
      if (!props) return;

      try {
        if (direction === null) {
          if (!props.hasCaption) return;   // 이미 없으면 문서를 건드리지 않는다
          setProps(services, ref, { hasCaption: false });
        } else {
          const next: Record<string, unknown> = {
            hasCaption: true,
            captionDirection: direction,
          };
          if (vertAlign) next.captionVertAlign = vertAlign;
          // 새로 다는 캡션에만 기본 크기를 준다(기존 캡션의 손조정 폭·간격 보존).
          if (!props.hasCaption) {
            next.captionWidth = CAPTION_DEFAULT_WIDTH;
            next.captionSpacing = CAPTION_DEFAULT_SPACING;
            next.captionIncludeMargin = false;
          }
          setProps(services, ref, next);
        }
        services.eventBus.emit('document-mutated', 'caption-preset');
        services.eventBus.emit('document-changed');
      } catch (err) {
        console.warn(`[${id}] 캡션 위치 적용 실패:`, err);
      }
    },
  };
}

/** 스텁 커맨드 생성 헬퍼 */
function stub(id: string, label: string, icon?: string, shortcut?: string): CommandDef {
  return {
    id,
    label,
    icon,
    shortcutLabel: shortcut,
    canExecute: () => false,
    execute() { /* TODO */ },
  };
}

let picturePropsDialog: PicturePropsDialog | null = null;
let equationEditorDialog: EquationEditorDialog | null = null;
let equationPropsDialog: EquationPropertiesDialog | null = null;
let emojiPicker: EmojiPicker | null = null;
let symbolsDialog: SymbolsDialog | null = null;
let bookmarkDialog: BookmarkDialog | null = null;
let endnoteShapeDialog: EndnoteShapeDialog | null = null;
let fieldInsertDialog: FieldInsertDialog | null = null;

function enterNoteEditing(
  services: any,
  ih: any,
  sectionIdx: number,
  paraIdx: number,
  controlIdx: number,
): void {
  const info = services.wasm.getNoteEditInfo(sectionIdx, paraIdx, controlIdx);
  if (!info?.ok) return;
  const cursor = (ih as any).cursor;
  if (!cursor?.enterFootnoteMode) return;
  cursor.enterFootnoteMode(
    sectionIdx,
    paraIdx,
    controlIdx,
    info.footnoteIndex ?? 0,
    info.pageNum ?? 0,
  );
  cursor.setFnCursorPosition(info.fnParaIndex ?? 0, info.charOffset ?? 2);
  services.eventBus.emit('footnoteModeChanged', true);
  (ih as any).active = true;
  (ih as any).updateCaret?.();
  (ih as any).textarea?.focus();
}

export const insertCommands: CommandDef[] = [
  {
    id: 'insert:shape',
    label: '도형',
    icon: 'icon-shape',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const anchor = document.getElementById('tb-shape');
      if (!anchor) return;
      showShapePicker(anchor, {
        onSelect(type: ShapeType) {
          const ih = services.getInputHandler();
          if (ih) ih.enterShapePlacementMode(type);
        },
      });
    },
  },
  {
    id: 'insert:image',
    label: '그림',
    icon: 'icon-image',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      pickAndPlaceImageFile(ih);
    },
  },
  {
    id: 'insert:my-photos',
    label: '내 사진',
    icon: 'icon-image',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const anchor = document.querySelector<HTMLElement>('[data-cmd="insert:my-photos"]');
      if (!anchor) return;
      showPhotoPicker(anchor, {
        onPick(entry) {
          ih.enterImagePlacementMode(entry.data, entry.ext, entry.width, entry.height, entry.name);
          showToast({
            message: '그림을 넣을 위치를 문서 본문 또는 표 셀 안에서 클릭하거나 드래그하세요.',
            durationMs: 3500,
          });
        },
        onAddFromFile() {
          pickAndPlaceImageFile(ih);
        },
      });
    },
  },
  {
    id: 'insert:textbox',
    label: '글상자',
    icon: 'icon-textbox',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      ih.enterTextboxPlacementMode();
    },
  },
  // ── 양식 개체 5종 — 엔진 insertFormObject 한 경로. 기본값(크기·캡션·색)은 엔진이
  //    한컴 정답지(samples/form-01.hwp) 값으로 채우므로 여기선 종류만 넘긴다.
  //    라디오는 GroupName 이 있어야 클릭 상호배타가 돌아 기본 그룹을 준다.
  ...([
    ['insert:form-button', '명령 단추', 'PushButton', {}],
    ['insert:form-checkbox', '선택 상자', 'CheckBox', {}],
    ['insert:form-combobox', '콤보 상자', 'ComboBox', {}],
    ['insert:form-radio', '라디오 단추', 'RadioButton', { groupName: '그룹1' }],
    ['insert:form-edit', '입력 상자', 'Edit', {}],
  ] as const).map(([id, label, formType, extra]) => ({
    id,
    label,
    canExecute: (ctx: EditorContext) => ctx.hasDocument && !ctx.inTable && !ctx.isFormMode,
    execute(services: CommandServices) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getPosition();
      // 본문 전용(수식과 같은 제약) — 셀 안 삽입 배관은 아직 없다
      if ((pos as any).cellIndex !== undefined && (pos as any).cellIndex >= 0) return;
      try {
        // 커서는 논리 좌표(개체=1칸), 엔진 삽입은 텍스트 좌표 — 변환해서 넘긴다.
        // 안 하면 개체 뒤에서 두 번째 개체를 넣을 때 자리가 어긋난다.
        const textOffset = services.wasm.logicalToTextOffset(
          pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
        // 스냅숏 undo 로 태운다 — ⌘Z 로 삽입이 되돌아간다(2026-08-04 요청).
        // 라우터가 커서를 새 개체 **뒤**로 옮긴다 — 안 옮기면 이어서 치는 글자·다음
        // 개체가 전부 개체 앞에 쌓인다(2026-08-03 사용자 신고 "연속으로 만들기 잘 안돼").
        let result: { ok: boolean; paraIdx: number; controlIdx: number } | undefined;
        ih.executeOperation({
          kind: 'snapshot',
          operationType: 'insertFormObject',
          operation: () => {
            result = services.wasm.insertFormObject(
              pos.sectionIndex, pos.paragraphIndex, textOffset,
              { formType, ...extra },
            );
            return result.ok
              ? { sectionIndex: pos.sectionIndex, paragraphIndex: result.paraIdx, charOffset: pos.charOffset + 1 }
              : pos;
          },
        });
        if (result?.ok) {
          services.eventBus.emit('document-mutated', 'insert-form');
          services.eventBus.emit('document-changed');
          // 삽입 직후 포커스가 편집기 밖에 남아 →·타이핑이 무시된다(2026-08-03 배포본 실측)
          (ih as any).focusTextarea?.();
          // 한컴 관례: 삽입 직후 개체가 선택 상태 — 바로 ←/→ 이동·Delete 가 된다.
          // 엔진 좌표로 동기 선택(rAF 대기 없음 — 화면 캐럿 타이밍에 기대면 연속 삽입에서 빗나간다).
          (ih as any).selectJustInsertedForm?.(
            pos.sectionIndex, result.paraIdx, result.controlIdx, pos.charOffset + 1);
        }
      } catch (err) {
        console.warn(`[${id}] 양식 개체 삽입 실패:`, err);
      }
    },
  })),
  {
    id: 'insert:equation',
    label: '수식',
    shortcutLabel: 'Ctrl+M,M',
    canExecute: (ctx) => ctx.hasDocument && !ctx.inTable,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getPosition();
      // 본문 전용 — 표 셀 내부에서는 실행하지 않음
      if ((pos as any).cellIndex !== undefined && (pos as any).cellIndex >= 0) return;
      try {
        const defaultFontSize = 1000; // 10pt → HWPUNIT
        const defaultColor = 0x00000000; // 검정
        const result = services.wasm.insertEquation(
          pos.sectionIndex, pos.paragraphIndex, pos.charOffset,
          '', defaultFontSize, defaultColor
        );
        if (result.ok) {
          services.eventBus.emit('document-changed');
          if (!equationEditorDialog) {
            equationEditorDialog = new EquationEditorDialog(services.wasm, services.eventBus);
          }
          equationEditorDialog.open(pos.sectionIndex, result.paraIdx, result.controlIdx);
        }
      } catch (err) {
        console.warn('[insert:equation] 수식 삽입 실패:', err);
      }
    },
  },
  {
    id: 'insert:field',
    label: '필드 입력',
    shortcutLabel: 'Ctrl+K+E',
    canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getCursorPosition();
      fieldInsertDialog = new FieldInsertDialog();
      fieldInsertDialog.onApply = (props) => {
        try {
          const result = services.wasm.insertClickHereField(
            pos,
            props.guide,
            props.memo,
            props.name,
            props.editable,
          );
          if (result.ok) {
            const insertedPos = { ...pos, charOffset: result.charOffset ?? pos.charOffset };
            ih.moveCursorTo(insertedPos);
            ih.markCurrentFieldEndOutside();
            services.wasm.clearActiveField();
            services.eventBus.emit('document-mutated', 'insert-field');
            services.eventBus.emit('document-changed');
          }
        } catch (err) {
          console.warn('[insert:field] 누름틀 삽입 실패:', err);
        }
      };
      fieldInsertDialog.show();
    },
  },
  captionPreset('insert:caption-top', '캡션 - 위', 'Top'),
  captionPreset('insert:caption-lt', '캡션 - 왼쪽 위', 'Left', 'Top'),
  captionPreset('insert:caption-lm', '캡션 - 왼쪽 가운데', 'Left', 'Center'),
  captionPreset('insert:caption-lb', '캡션 - 왼쪽 아래', 'Left', 'Bottom'),
  captionPreset('insert:caption-rt', '캡션 - 오른쪽 위', 'Right', 'Top'),
  captionPreset('insert:caption-rm', '캡션 - 오른쪽 가운데', 'Right', 'Center'),
  captionPreset('insert:caption-rb', '캡션 - 오른쪽 아래', 'Right', 'Bottom'),
  captionPreset('insert:caption-bottom', '캡션 - 아래', 'Bottom'),
  captionPreset('insert:caption-none', '캡션 없음', null),
  stub('insert:para-band', '문단 띠'),
  stub('insert:comment', '주석', 'icon-comment'),
  {
    id: 'insert:footnote',
    label: '각주',
    icon: 'icon-footnote',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!services.getContext().hasDocument) return;
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getPosition();
      try {
        const result = services.wasm.insertFootnote(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
        if (result.ok) {
          services.eventBus.emit('document-changed');
          enterNoteEditing(services, ih, pos.sectionIndex, result.paraIdx, result.controlIdx);
        }
      } catch (err) {
        console.warn('[insert:footnote] 각주 삽입 실패:', err);
      }
    },
  },
  {
    id: 'insert:endnote',
    label: '미주',
    icon: 'icon-endnote',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!services.getContext().hasDocument) return;
      const ih = services.getInputHandler();
      if (!ih) return;
      const pos = ih.getPosition();
      try {
        const result = services.wasm.insertEndnote(pos.sectionIndex, pos.paragraphIndex, pos.charOffset);
        if (result.ok) {
          services.eventBus.emit('document-changed');
          enterNoteEditing(services, ih, pos.sectionIndex, result.paraIdx, result.controlIdx);
        }
      } catch (err) {
        console.warn('[insert:endnote] 미주 삽입 실패:', err);
      }
    },
  },
  {
    id: 'insert:note-close',
    label: '닫기',
    icon: 'icon-delete',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const cursor = (ih as any).cursor;
      if (!cursor?.isInFootnote?.()) return;
      cursor.exitFootnoteMode();
      services.eventBus.emit('footnoteModeChanged', false);
      (ih as any).updateCaret?.();
      (ih as any).textarea?.focus();
    },
  },
  {
    id: 'insert:endnote-shape',
    label: '미주 모양',
    icon: 'icon-endnote',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const pos = services.getInputHandler()?.getPosition();
      const sectionIdx = pos?.sectionIndex ?? 0;
      endnoteShapeDialog = new EndnoteShapeDialog(services.wasm, services.eventBus, sectionIdx);
      endnoteShapeDialog.show();
    },
  },
  {
    id: 'insert:symbols',
    label: '문자표',
    icon: 'icon-symbols',
    shortcutLabel: 'Alt+F10',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!symbolsDialog) {
        symbolsDialog = new SymbolsDialog(services);
      }
      symbolsDialog.show();
    },
  },
  {
    // 이모지 넣기 — 피커 본문은 ui/emoji-picker.ts (emoji-picker-element, 한국어 데이터)
    id: 'insert:emoji',
    label: '이모지',
    icon: 'icon-symbols',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services, opts) {
      if (!emojiPicker) emojiPicker = new EmojiPicker(services);
      emojiPicker.toggle((opts as { anchorEl?: HTMLElement } | undefined)?.anchorEl ?? null);
    },
  },
  stub('insert:hyperlink', '하이퍼링크', 'icon-hyperlink', 'Ctrl+K+H'),
  {
    id: 'insert:bookmark',
    label: '책갈피',
    shortcutLabel: 'Ctrl+K,B',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      if (!bookmarkDialog) {
        bookmarkDialog = new BookmarkDialog(services);
      }
      bookmarkDialog.show();
    },
  },
  {
    // [차례 2026-07-28] 한컴 [도구-차례/색인] — 구조 추출 + 쪽번호로 목차 문단 생성.
    id: 'insert:toc',
    label: '차례 만들기',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      new TocDialog(services).show();
    },
  },
  {
    // [상용구 2026-07-28] 한컴 [입력-상용구] — 목록에서 골라 커서에 삽입, 등록/삭제도 여기서.
    id: 'insert:snippet',
    label: '상용구',
    shortcutLabel: 'Ctrl+F3',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      // 선택 텍스트가 있으면 '내용'에 미리 채워 등록을 한 번에 끝낸다
      let initial = '';
      try {
        const sel = (ih as any).cursor?.getSelectionOrdered?.();
        if (sel) {
          initial = (ih as any).wasm.copySelection(
            sel.start.sectionIndex, sel.start.paragraphIndex, sel.start.charOffset,
            sel.end.paragraphIndex, sel.end.charOffset,
          ) ?? '';
        }
      } catch { /* 선택 없거나 표/글상자 안이면 빈 값으로 연다 */ }
      const dlg = new SnippetDialog(initial);
      dlg.onInsert = (text) => { (ih as any).insertPlainTextAtCursor(text); };
      dlg.show();
    },
  },
  {
    // 커서 앞 준말 → 상용구 확장 (한컴 Alt+I 대응)
    id: 'insert:snippet-expand',
    label: '상용구 준말 확장',
    shortcutLabel: 'Alt+I',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler() as any;
      if (!ih) return;
      try {
        const pos = ih.cursor.getPosition();
        if (pos.parentParaIndex !== undefined || pos.charOffset === 0) return;
        // 커서 앞 최대 12자에서 가장 긴 준말 일치를 찾는다
        const from = Math.max(0, pos.charOffset - 12);
        const before: string = ih.wasm.getTextRange(
          pos.sectionIndex, pos.paragraphIndex, from, pos.charOffset - from,
        ) ?? '';
        const snippets = userSettings.getSnippets().filter((s) => s.abbrev);
        let hit: { abbrev: string; text: string } | null = null;
        for (const s of snippets) {
          if (before.endsWith(s.abbrev) && (!hit || s.abbrev.length > hit.abbrev.length)) {
            hit = { abbrev: s.abbrev, text: s.text };
          }
        }
        if (!hit) return;
        // 준말을 지우고 그 자리에 조각을 넣는다 — 되돌리기는 두 연산 모두 스택에 쌓인다
        ih.wasm.replaceText(
          pos.sectionIndex, pos.paragraphIndex,
          pos.charOffset - hit.abbrev.length, hit.abbrev.length, '',
        );
        ih.cursor.moveTo({
          sectionIndex: pos.sectionIndex,
          paragraphIndex: pos.paragraphIndex,
          charOffset: pos.charOffset - hit.abbrev.length,
        });
        ih.insertPlainTextAtCursor(hit.text);
      } catch (err) {
        console.warn('[snippet] 준말 확장 실패:', err);
      }
    },
  },
  {
    id: 'insert:picture-props',
    label: '개체 속성',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref) return;
      if (ref.type === 'equation') {
        if (!equationPropsDialog) {
          equationPropsDialog = new EquationPropertiesDialog(services.wasm, services.eventBus, services);
        }
        equationPropsDialog.open(ref.sec, ref.ppi, ref.ci, ref.cellIdx, ref.cellParaIdx, ref.noteRef);
        return;
      }
      if (!picturePropsDialog) {
        picturePropsDialog = new PicturePropsDialog(services.wasm, services.eventBus, services);
      }
      // [Task #825] 머리말/꼬리말 그림은 ref.headerFooter 동반 — dialog 에 전달.
      // [Task #1138] 표 셀 내 도형(shape/line) 은 cellPath 구성하여 dialog 에 전달
      // → by_path API 사용.
      // [Task #1151 v4] picture (image) 도 셀 안 inline picture (tac-img-02.hwp 같은
      // 케이스) 의 경우 cellPath 구성 필요 — getCellPicturePropertiesByPath /
      // setCellPicturePropertiesByPath wasm API 호출. cell context (cellIdx/cellParaIdx/
      // outerTableControlIdx) 가 모두 있으면 셀 안 picture.
      const cellPath: CellPathLike | undefined = ref.cellPath ?? (
        (
          ref.cellIdx !== undefined &&
          ref.cellParaIdx !== undefined &&
          (ref as any).outerTableControlIdx !== undefined &&
          (ref.type === 'shape' || ref.type === 'line' || ref.type === 'image' || ref.type === 'ole')
        )
          ? [{
              controlIdx: (ref as any).outerTableControlIdx as number,
              cellIdx: ref.cellIdx,
              cellParaIdx: ref.cellParaIdx,
            }]
          : undefined
      );
      picturePropsDialog.open(
        ref.sec, ref.ppi, ref.ci, ref.type, ref.headerFooter,
        cellPath, cellPath ? ref.ci : undefined,
      );
    },
  },
  {
    id: 'insert:equation-edit',
    label: '수식 편집',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'equation') return;
      if (!equationEditorDialog) {
        equationEditorDialog = new EquationEditorDialog(services.wasm, services.eventBus);
      }
      equationEditorDialog.open(ref.sec, ref.ppi, ref.ci, ref.cellIdx, ref.cellParaIdx, ref.noteRef);
    },
  },
  {
    id: 'insert:caption-toggle',
    label: '캡션 넣기',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type === 'equation' || ref.type === 'group') return;
      // 현재 캡션 상태 조회
      let props: any;
      try {
        props = getProps(services, ref);
      } catch (e) { return; }
      if (!props) return;
      // 캡션 없으면 추가 (기본: 아래, 크기 30mm, 간격 3mm)
      let charOffset = 0;
      if (!props.hasCaption) {
        const captionProps = {
          hasCaption: true,
          captionDirection: 'Bottom',
          captionVertAlign: 'Top',
          captionWidth: Math.round(30 * 283.46),
          captionSpacing: Math.round(3 * 283.46),
          captionIncludeMargin: false,
        };
        let result: any;
        result = setProps(services, ref, captionProps);
        // "그림 N " 끝 위치를 Rust가 반환
        charOffset = result?.captionCharOffset ?? 4;
        services.eventBus.emit('document-changed');
      } else {
        // 이미 캡션이 있으면 캡션 텍스트 끝에 캐럿
        try {
          const len = services.wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 0, 0);
          charOffset = len;
        } catch { charOffset = 0; }
      }
      // 캡션 텍스트 편집 모드 진입
      ih.exitPictureObjectSelectionAndAfterEdit();
      ih.enterInlineEditing(ref.sec, ref.ppi, ref.ci, charOffset);
    },
  },
  {
    id: 'insert:arrange-front',
    label: '맨 앞으로',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'shape') return;
      services.wasm.changeShapeZOrder(ref.sec, ref.ppi, ref.ci, 'front');
      ih.exitPictureObjectSelectionAndAfterEdit();
    },
  },
  {
    id: 'insert:arrange-forward',
    label: '앞으로',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'shape') return;
      services.wasm.changeShapeZOrder(ref.sec, ref.ppi, ref.ci, 'forward');
      ih.exitPictureObjectSelectionAndAfterEdit();
    },
  },
  {
    id: 'insert:arrange-backward',
    label: '뒤로',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'shape') return;
      services.wasm.changeShapeZOrder(ref.sec, ref.ppi, ref.ci, 'backward');
      ih.exitPictureObjectSelectionAndAfterEdit();
    },
  },
  {
    id: 'insert:arrange-back',
    label: '맨 뒤로',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'shape') return;
      services.wasm.changeShapeZOrder(ref.sec, ref.ppi, ref.ci, 'back');
      ih.exitPictureObjectSelectionAndAfterEdit();
    },
  },
  {
    id: 'insert:picture-delete',
    label: '개체 지우기',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref) return;
      if (ref.type === 'shape' || ref.type === 'line' || ref.type === 'group') {
        services.wasm.deleteShapeControl(ref.sec, ref.ppi, ref.ci);
      } else if (ref.type === 'equation') {
        services.wasm.deleteEquationControl(ref.sec, ref.ppi, ref.ci);
      } else if (ref.cellPath && ref.cellPath.length > 0) {
        services.wasm.deleteCellPictureControlByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci);
      } else {
        services.wasm.deletePictureControl(ref.sec, ref.ppi, ref.ci);
      }
      ih.exitPictureObjectSelectionAndAfterEdit();
    },
  },
  // ─── 개체 묶기/풀기 ──────────────────────────────
  {
    id: 'insert:group-shapes',
    label: '개체 묶기',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const refs = ih.getSelectedPictureRefs();
      if (refs.length < 2) return;
      const sec = refs[0].sec;
      const targets = refs.map(r => ({ paraIdx: r.ppi, controlIdx: r.ci }));
      try {
        const result = services.wasm.groupShapes(sec, targets);
        ih.exitPictureObjectSelectionAndAfterEdit();
        // 생성된 GroupShape를 선택
        ih.selectPictureObject(sec, result.paraIdx, result.controlIdx, 'group');
      } catch (err) {
        console.warn('[group-shapes] 개체 묶기 실패:', err);
      }
    },
  },
  {
    id: 'insert:ungroup-shapes',
    label: '개체 풀기',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;
      const ref = ih.getSelectedPictureRef();
      if (!ref || ref.type !== 'group') return;
      try {
        services.wasm.ungroupShape(ref.sec, ref.ppi, ref.ci);
        ih.exitPictureObjectSelectionAndAfterEdit();
      } catch (err) {
        console.warn('[ungroup-shapes] 개체 풀기 실패:', err);
      }
    },
  },
  // ─── 회전/대칭 ──────────────────────────────────
  {
    id: 'insert:rotate-cw',
    label: '오른쪽 90° 회전',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      applyRotationDelta(services, 90);
    },
  },
  {
    id: 'insert:rotate-ccw',
    label: '왼쪽 90° 회전',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      applyRotationDelta(services, -90);
    },
  },
  {
    id: 'insert:flip-horz',
    label: '좌우 대칭',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      toggleFlip(services, 'horzFlip');
    },
  },
  {
    id: 'insert:flip-vert',
    label: '상하 대칭',
    canExecute: (ctx) => ctx.inPictureObjectSelection,
    execute(services) {
      toggleFlip(services, 'vertFlip');
    },
  },
];

/** 선택 개체 ref 타입 — cursor.selectedPictureRef 와 정합 (headerFooter optional, [Task #831]) */
type PictureRef = {
  sec: number;
  ppi: number;
  ci: number;
  type: string;
  cellPath?: CellPathLike;
  headerFooter?: { kind: 'header' | 'footer'; outerParaIdx: number; outerControlIdx: number };
};

/** 선택 개체의 속성을 조회/변경 헬퍼 (shape/picture 분기) */
function getProps(services: import('../types').CommandServices, ref: PictureRef): Record<string, unknown> {
  if (ref.type === 'shape') {
    if (ref.cellPath && ref.cellPath.length > 0) {
      return services.wasm.getCellShapePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci) as unknown as Record<string, unknown>;
    }
    return services.wasm.getShapeProperties(ref.sec, ref.ppi, ref.ci) as unknown as Record<string, unknown>;
  }
  // [Task #831] 머리말/꼬리말 picture 의 경우 별도 API 호출 (PR #832 의 wasm-bridge).
  // 미적용 시 본문 lookup 실패 → props 빈/stale → 회전/대칭 무동작.
  if (ref.headerFooter) {
    return services.wasm.getHeaderFooterPictureProperties(
      ref.sec,
      ref.headerFooter.outerParaIdx,
      ref.headerFooter.outerControlIdx,
      ref.ppi,
      ref.ci,
    ) as unknown as Record<string, unknown>;
  }
  if (ref.cellPath && ref.cellPath.length > 0) {
    return services.wasm.getCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci) as unknown as Record<string, unknown>;
  }
  return services.wasm.getPictureProperties(ref.sec, ref.ppi, ref.ci) as unknown as Record<string, unknown>;
}

function setProps(services: import('../types').CommandServices, ref: PictureRef, props: Record<string, unknown>): any {
  if (ref.type === 'shape') {
    if (ref.cellPath && ref.cellPath.length > 0) {
      return services.wasm.setCellShapePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci, props);
    }
    return services.wasm.setShapeProperties(ref.sec, ref.ppi, ref.ci, props);
  } else if (ref.headerFooter) {
    // [Task #831] 머리말/꼬리말 picture setter — 5-tuple lookup 으로 IR 갱신.
    return services.wasm.setHeaderFooterPictureProperties(
      ref.sec,
      ref.headerFooter.outerParaIdx,
      ref.headerFooter.outerControlIdx,
      ref.ppi,
      ref.ci,
      props,
    );
  } else {
    if (ref.cellPath && ref.cellPath.length > 0) {
      return services.wasm.setCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci, props);
    }
    return services.wasm.setPictureProperties(ref.sec, ref.ppi, ref.ci, props);
  }
}

/** 현재 회전각에 delta(도)를 더한다 (shape + image 지원). */
function applyRotationDelta(services: import('../types').CommandServices, delta: number): void {
  const ih = services.getInputHandler();
  if (!ih) return;
  const ref = ih.getSelectedPictureRef();
  if (!ref || ref.type === 'equation' || ref.type === 'group' || ref.type === 'line') return;
  const props = getProps(services, ref);
  if (props.sizeProtect) return;
  const cur = ((props.rotationAngle as number) ?? 0);
  let next = cur + delta;
  // -180 ~ 180 범위로 정규화
  next = ((next % 360) + 360) % 360;
  if (next > 180) next -= 360;
  setProps(services, ref, { rotationAngle: next });
  services.eventBus.emit('document-changed');
}

/** horzFlip/vertFlip을 토글한다 (shape + image 지원). */
function toggleFlip(services: import('../types').CommandServices, key: 'horzFlip' | 'vertFlip'): void {
  const ih = services.getInputHandler();
  if (!ih) return;
  const ref = ih.getSelectedPictureRef();
  if (!ref || ref.type === 'equation' || ref.type === 'group' || ref.type === 'line') return;
  const props = getProps(services, ref);
  if (props.sizeProtect) return;
  const cur = !!props[key];
  setProps(services, ref, { [key]: !cur });
  services.eventBus.emit('document-changed');
}
