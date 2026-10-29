/** [캔버스 한컴 포크] 같은 선택 대상에서는 수동 탭을 유지하고 새 대상에서만 추천한다. */
import type { PanelTab } from './canva-right-inspector';
export function inspectorTabTarget(ih:any,ctx:string,cellKey:string,picKey:string):{key:string;tab:PanelTab} {
 if(ctx==='table')return {key:`table:${cellKey}`,tab:'table'};
 if(ctx==='cell'){
  if(ih.isInCellSelectionMode?.()){
   const range=ih.getSelectedCellRange?.();
   return {key:`cells:${cellKey}:${JSON.stringify(range??null)}`,tab:'cell'};
  }
  return {key:`cell-text:${cellKey}`,tab:'props'};
 }
 if(ctx==='body'){
  const p=ih?.getCursorPosition?.()??ih?.cursor?.getPosition?.();
  return {key:`body:${p?.sectionIndex??0}/${p?.paragraphIndex??0}`,tab:'props'};
 }
 return {key:`${ctx}:${picKey}`,tab:'props'};
}
