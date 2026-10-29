/** [캔버스 한컴 포크] 원본 이미지→비전 모델 명령→새 HWP 문서. 기존 본문은 모델로 보내지 않는다. */
import type { CanvaServices } from './canva-services';
import { executeEditPlan } from './ai-editor-tools';
import { IMAGE_LAYOUT_PROMPT, imageLayoutToPlan } from './ai-image-layout';
import { callAi } from './canva-ai-client';
import { summarizeEditReport } from './ai-edit-report';
export function parseImagePlan(raw:string):{version:1;operations:any[]} {
 const source=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const plan=JSON.parse(source);
 if(plan.version!==1||!Array.isArray(plan.operations)||!plan.operations.length||plan.operations.length>199)throw Error('이미지 분석 결과의 편집 명령 형식이 올바르지 않습니다');
 const allowed=['set_page','define_style','insert_paragraph','create_table','inspect_document'];
 if(plan.operations.some((op:any)=>!op||!allowed.includes(op.tool)))throw Error('새 문서 생성에 허용되지 않은 명령이 포함되어 있습니다');
 return plan;
}
export async function generateImageDocument(services:CanvaServices,images:string[],request:string,
 callModel=callAi):Promise<string> {
 if(images.length!==1)throw Error('참고 이미지 한 장 필요');
 console.info('[ai-image-document]',JSON.stringify({phase:'analyzing',images:1}));
 const raw=await callModel(IMAGE_LAYOUT_PROMPT,request,6144,images);
 const parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 const plan=parsed.version===1?parseImagePlan(raw):imageLayoutToPlan(parsed);
 console.info('[ai-image-document]',JSON.stringify({phase:'plan',operations:plan.operations.length}));
 // 분석 실패 전에는 현재 문서를 교체하지 않는다. 기존 저장 확인 절차도 그대로 거친다.
 await new Promise<void>((resolve,reject)=>services.eventBus.emit('create-new-document',{
  onReady:resolve,onCancel:()=>reject(Error('새 문서 생성을 취소했습니다')),
 }));
 const result=executeEditPlan(services,{version:1,operations:[...plan.operations,{tool:'inspect_document'}]});
 console.info('[ai-image-document]',JSON.stringify({phase:'applied',ok:result.ok}));
 if(!result.ok)throw Error(result.error||'문서 생성 실패');
 return '이미지를 분석해 새 문서를 생성했습니다. 원본 글꼴·치수는 이미지에서 추정한 값입니다.\n'+summarizeEditReport(result,5000);
}
