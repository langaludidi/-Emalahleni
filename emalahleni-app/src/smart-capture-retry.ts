/**
 * Explicit operator-controlled retry for transient import failures.
 * Never retries infected/rejected, completed or ambiguous commit states.
 * No automatic loop and no real-data work until rollout gates are approved.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError} from './http';
type RetryEnv={SMART_CAPTURE_ENABLED?:string;SMART_CAPTURE_PROCESSING_ENABLED?:string};
export const retryableSmartCaptureErrors=new Set([
 'DRIVE_FILE_UNAVAILABLE','DRIVE_BENEFICIARY_FOLDER_UNAVAILABLE',
 'DRIVE_DOWNLOAD_FAILED','SCANNER_UNAVAILABLE','DOCUMENT_AI_UNAVAILABLE',
 'DOCUMENT_AI_PROCESSING_FAILED','SMART_CAPTURE_PROCESSING_FAILED',
]);
export function retryDecision(state:string,error:string|null,attempts:number){
 if(state!=='FAILED')return {allowed:false,reason:'IMPORT_NOT_FAILED'} as const;
 if(!error||!retryableSmartCaptureErrors.has(error))return {allowed:false,reason:'IMPORT_NOT_RETRYABLE'} as const;
 if(!Number.isSafeInteger(attempts)||attempts>=3)return {allowed:false,reason:'IMPORT_RETRY_LIMIT'} as const;
 return {allowed:true,reason:null} as const;
}
export async function retrySmartCaptureImport(db:Database,actor:string,projectId:string,importId:string,env:RetryEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true')
  throw new HttpError(503,'SMART_CAPTURE_PROCESSING_DISABLED');
 const project=z.string().uuid().parse(projectId),id=z.string().uuid().parse(importId);
 const [rows]=await db.forActor(actor,[{query:`
  SELECT i.state,i.error_code,i.attempt_count
  FROM public.smart_capture_imports i
  WHERE i.project_id=$1 AND i.id=$2
  AND EXISTS (SELECT 1 FROM public.project_memberships m
   WHERE m.project_id=i.project_id AND m.user_id=$3 AND m.active
    AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))`,
  params:[project,id,actor]}],true);
 if(!rows.length)throw new HttpError(404,'SMART_CAPTURE_IMPORT_UNAVAILABLE');
 const item=rows[0],decision=retryDecision(String(item.state),
  item.error_code==null?null:String(item.error_code),Number(item.attempt_count));
 if(!decision.allowed)throw new HttpError(409,decision.reason);
 const [changed]=await db.forActor(actor,[{query:`
  UPDATE public.smart_capture_imports i SET
    state='DISCOVERED',error_code=NULL,claimed_at=NULL,claimed_by=NULL,claim_token=NULL,updated_at=now()
  WHERE i.project_id=$1 AND i.id=$2 AND i.state='FAILED'
   AND i.error_code=$3 AND i.attempt_count=$4 AND i.attempt_count<3
   AND EXISTS (SELECT 1 FROM public.project_memberships m
    WHERE m.project_id=i.project_id AND m.user_id=$5 AND m.active
     AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
  RETURNING id`,
  params:[project,id,item.error_code,item.attempt_count,actor]}]);
 if(!changed.length)throw new HttpError(409,'SMART_CAPTURE_STATE_CHANGED');
 return {importId:id,state:'DISCOVERED',attemptCount:Number(item.attempt_count)};
}
