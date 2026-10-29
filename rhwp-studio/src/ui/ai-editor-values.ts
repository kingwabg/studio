/** [캔버스 한컴 포크] AI 입력 단위는 mm/pt, 변환은 엔진 경계 한 곳에서만 한다. */
export type Obj = Record<string, any>;
export function object(v: unknown, label = '객체'): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label}: 객체 필요`);
  return v;
}
export function keys(v: Obj, allowed: string[]): void {
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new Error(`지원하지 않는 속성: ${k}`);
}
export function number(v: unknown, label: string, min = 0, max = 10000): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${label}: ${min}~${max} 숫자 필요`);
  return v;
}
export function integer(v: unknown, label: string, min = 0, max = 10000): number {
  const n = number(v, label, min, max);
  if (!Number.isInteger(n)) throw new Error(`${label}: 정수 필요`);
  return n;
}
export function text(v: unknown, label: string, max = 10000): string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${label}: ${max}자 이하 문자열 필요`);
  return v;
}
export const hu = (mm: number): number => Math.round(mm * 7200 / 25.4);
export const mm = (hu: number): number => hu * 25.4 / 7200;
function copyFields(p: Obj, bools: string[], enums: Record<string, string[]>): Obj {
  const out: Obj = {};
  for (const key of bools) if (key in p) {
    if (typeof p[key] !== 'boolean') throw new Error(`${key}: boolean 필요`);
    out[key] = p[key];
  }
  for (const [key, values] of Object.entries(enums)) if (key in p) {
    if (!values.includes(p[key])) throw new Error(`${key}: ${values.join('|')}`);
    out[key] = p[key];
  }
  return out;
}
const charBools = ['bold','italic','underline','strikethrough','superscript','subscript','kerning'];
export function charValues(raw: unknown, fontId: (lang: number, name: string) => number): Obj {
  const p = object(raw, 'char');
  keys(p, ['fontPt','fontName','widthPercent','spacingPercent','textColor','shadeColor',...charBools]);
  const out = copyFields(p, charBools, {});
  if ('fontPt' in p) out.fontSize = Math.round(number(p.fontPt,'fontPt',0.1,500)*100);
  if ('fontName' in p) {
    const name = text(p.fontName,'fontName',100).trim();
    if (!name) throw new Error('글꼴 이름 필요');
    out.fontIds = Array.from({length:7},(_,i)=>fontId(i,name));
    if (out.fontIds.some((n: number)=>n<0)) throw new Error('글꼴 등록 실패');
  }
  for (const [key, dest, min, max] of [['widthPercent','ratios',50,200],['spacingPercent','spacings',-50,50]] as const)
    if (key in p) out[dest] = Array(7).fill(integer(p[key],key,min,max));
  for (const key of ['textColor','shadeColor']) if (key in p) {
    if (!/^#[0-9a-f]{6}$/i.test(p[key])) throw new Error(`${key}: #RRGGBB 필요`);
    out[key] = p[key];
  }
  return out;
}
const paraBools = ['keepWithNext','keepLines','pageBreakBefore','widowOrphan'];
export function paraValues(raw: unknown, style = false): Obj {
  const p = object(raw, 'para');
  const dimensions = {leftMm:'marginLeft',rightMm:'marginRight',indentMm:'indent',beforePt:'spacingBefore',afterPt:'spacingAfter'};
  keys(p, ['alignment','linePercent',...Object.keys(dimensions),...paraBools]);
  const out = copyFields(p, paraBools, {alignment:['left','center','right','justify','distribute','split']});
  if ('linePercent' in p) { out.lineSpacingType = 'Percent'; out.lineSpacing = integer(p.linePercent,'linePercent',1,500); }
  for (const [key, dest] of Object.entries(dimensions)) if (key in p) {
    const value = number(p[key],key,key === 'indentMm' ? -200 : 0,500);
    const points = key.endsWith('Pt');
    // updateStyleShapes는 저장 단위, applyParaFormat은 정수 CSS px다.
    out[dest] = Math.round(style ? (points ? value*100 : hu(value)*2) : (points ? value*96/72 : value*96/25.4));
  }
  return out;
}
export function cellValues(raw: unknown): Obj {
  const p = object(raw,'cell');
  const lengths = ['paddingLeft','paddingRight','paddingTop','paddingBottom'];
  const borders = ['borderLeft','borderRight','borderTop','borderBottom'];
  keys(p,[...lengths.map(k=>k+'Mm'),...borders,'fillColor','verticalAlign','textDirection','isHeader','applyInnerMargin']);
  const out = copyFields(p,['isHeader','applyInnerMargin'],{});
  for (const key of lengths) if (key+'Mm' in p) out[key] = hu(number(p[key+'Mm'],key,0,20));
  for (const key of ['verticalAlign','textDirection']) if (key in p) out[key] = integer(p[key],key,0,key==='verticalAlign'?2:1);
  if ('fillColor' in p) {
    if (!/^#[0-9a-f]{6}$/i.test(p.fillColor)) throw new Error('fillColor: #RRGGBB 필요');
    out.fillType = 'solid'; out.fillColor = p.fillColor;
  }
  for (const key of borders) if (key in p) {
    const b = object(p[key]); keys(b,['type','width','color']);
    if (!/^#[0-9a-f]{6}$/i.test(b.color)) throw new Error('테두리 색상: #RRGGBB 필요');
    out[key] = {type:integer(b.type,'선 종류',0,15),width:integer(b.width,'선 굵기 인덱스',0,15),color:b.color};
  }
  return out;
}
export function tableValues(raw: unknown): Obj {
  const p = object(raw,'table');
  const lengths = ['horzOffset','vertOffset','outerLeft','outerRight','outerTop','outerBottom'];
  const bools = ['treatAsChar','restrictInPage','allowOverlap','keepWithAnchor','repeatHeader'];
  const enums = {textWrap:['Square','TopAndBottom','BehindText','InFrontOfText'],textFlow:['BothSides','LeftOnly','RightOnly','LargestOnly'],horzRelTo:['Paper','Page','Column','Para'],vertRelTo:['Paper','Page','Para'],horzAlign:['Left','Center','Right','Inside','Outside'],vertAlign:['Top','Center','Bottom','Inside','Outside']};
  keys(p,[...lengths.map(k=>k+'Mm'),...bools,...Object.keys(enums)]);
  const out = copyFields(p,bools,enums);
  for (const key of lengths) if (key+'Mm' in p) out[key] = hu(number(p[key+'Mm'],key,key.includes('Offset')?-500:0,key.includes('Offset')?500:100));
  return out;
}
