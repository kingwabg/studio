import {createHash} from 'node:crypto';
const hu=(mm:number)=>Math.round(mm*7200/25.4);
const parse=(s:string)=>JSON.parse(s);
export function createPageReorderFixture(HwpDocument:any) {
  const doc=HwpDocument.createEmpty();doc.createBlankDocument();
  doc.setPageDef(0,JSON.stringify({width:hu(210),height:hu(297),marginLeft:hu(20),marginRight:hu(20),marginTop:hu(20),marginBottom:hu(20),marginHeader:hu(10),marginFooter:hu(10),marginGutter:0,landscape:false,binding:0}));
  let p=0;
  const newPara=()=>{p=parse(doc.splitParagraph(0,p,doc.getLogicalLength(0,p))).paraIdx;};
  for(let page=1;page<=4;page++){
    const title=`쪽-${page} 문서 순서 테스트`;
    doc.insertText(0,p,0,title);doc.applyCharFormat(0,p,0,title.length,JSON.stringify({fontSize:1800,bold:true,textColor:page%2?'#173e72':'#743b14'}));
    newPara();const body=`고유 본문 ${page} — 문장과 표, 글자 모양과 문단 서식이 함께 이동해야 합니다.`;
    doc.insertText(0,p,0,body);doc.applyCharFormat(0,p,0,body.length,JSON.stringify({fontSize:1000,bold:false,italic:page===2,textColor:'#000000'}));
    doc.applyParaFormat(0,p,JSON.stringify({alignment:'left',lineSpacingType:'Percent',lineSpacing:150+page*10,marginLeft:page*3}));
    if(page===1||page===3){
      newPara();const t=parse(doc.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:p,charOffset:0,rowCount:3,colCount:2,treatAsChar:true,colWidths:[hu(35),hu(40)],rowHeights:[hu(7),hu(7),hu(7)]})));
      doc.mergeTableCells(0,t.paraIdx,t.controlIdx,0,0,0,1);
      const grid=parse(doc.getTableGrid(0,t.paraIdx,t.controlIdx));
      const ids=[...new Set(grid.cellGrid)] as number[];
      for(const cell of ids){
        const text=`표${page} 셀${cell}`;doc.insertTextInCell(0,t.paraIdx,t.controlIdx,cell,0,0,text);
        doc.applyCharFormatInCell(0,t.paraIdx,t.controlIdx,cell,0,0,text.length,JSON.stringify({fontSize:900,bold:cell===0,textColor:cell===0?'#173e72':'#000000'}));
        if(cell===0)doc.setCellProperties(0,t.paraIdx,t.controlIdx,cell,JSON.stringify({fillType:'solid',fillColor:'#d9e8f7'}));
      }
      p=doc.getParagraphCount(0)-1;
    }
    if(page<4)p=parse(doc.insertPageBreak(0,p,doc.getLogicalLength(0,p))).paraIdx;
  }
  return doc;
}
export function pageOrder(doc:any):string[] {
  return Array.from({length:parse(doc.getDocumentInfo()).pageCount},(_,page)=>{
    const pos=parse(doc.getPositionOfPage(page));
    return doc.getTextRange(pos.sec,pos.para,0,100).match(/쪽-\d+/)?.[0]??`unknown:${page}`;
  });
}
export function semanticInventory(doc:any, selectedPages?:number[]) {
  const paragraphs:any[]=[],tables:any[]=[],seen=new Set<string>(),pages=parse(doc.getDocumentInfo()).pageCount;
  const selectedParas=new Set<string>();
  if(selectedPages)for(const page of selectedPages){
    const start=parse(doc.getPositionOfPage(page)),next=page+1<pages?parse(doc.getPositionOfPage(page+1)):null;
    const end=next?.sec===start.sec?next.para:doc.getParagraphCount(start.sec);
    for(let p=start.para;p<end;p++)selectedParas.add(`${start.sec}/${p}`);
  }
  for(let sec=0;sec<doc.getSectionCount();sec++)for(let p=0;p<doc.getParagraphCount(sec);p++){
    if(selectedPages&&!selectedParas.has(`${sec}/${p}`))continue;
    const text=doc.getTextRange(sec,p,0,doc.getParagraphLength(sec,p));
    const para=parse(doc.getParaPropertiesAt(sec,p));delete para.pageBreakBefore;delete para.paraShapeId;
    const chars=Array.from({length:Math.max(1,doc.getParagraphLength(sec,p))},(_,i)=>parse(doc.getCharPropertiesAt(sec,p,i)));
    paragraphs.push({text,para,chars});
  }
  for(let page=0;page<pages;page++)for(const c of parse(doc.getPageControlLayout(page)).controls){
    if(selectedPages&&!selectedPages.includes(page))continue;
    if(c.type!=='table')continue;const key=`${c.secIdx}/${c.paraIdx}/${c.controlIdx}`;if(seen.has(key))continue;seen.add(key);
    const args=[c.secIdx,c.paraIdx,c.controlIdx],grid=parse(doc.getTableGrid(...args));
    const cells=[...new Set(grid.cellGrid)].map((cell:any)=>({
      text:doc.getTextInCell(...args,cell,0,0,1000),props:parse(doc.getCellProperties(...args,cell)),
      chars:parse(doc.getCellCharPropertiesAt(...args,cell,0,0)),
    }));
    tables.push({grid,props:parse(doc.getTableProperties(...args)),cells});
  }
  const sorted=(a:any[])=>a.map(x=>JSON.stringify(x)).sort();
  return {paragraphs:sorted(paragraphs),tables:sorted(tables),pageDefs:Array.from({length:doc.getSectionCount()},(_,s)=>parse(doc.getPageDef(s)))};
}
export const inventoryHash=(inventory:unknown)=>createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
