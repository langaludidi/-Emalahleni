/**
 * SC-014: opt-in Cloudflare Queue orchestration.
 * A queued message carries only project/import UUIDs and the requesting actor.
 * The worker rechecks membership/source before processing. No PDF, OCR or ID
 * numbers are placed in the queue. Acknowledged errors remain in the DB for
 * explicit operator retry; do not automatically replay malware or AI work.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError} from './http';
import {processSmartCaptureImport,type ProcessingEnv} from './smart-capture-process';
const uuid=z.string().uuid();
export const smartCaptureQueueMessage=z.object({
 schema:z.literal(1),projectId:uuid,importId:uuid,actorId:z.string().min(1).max(200),
}).strict();
export type SmartCaptureQueueMessage=z.infer<typeof smartCaptureQueueMessage>;
export interface QueueEnv extends ProcessingEnv{
 SMART_CAPTURE_QUEUE_ENABLED?:string;
 SMART_CAPTURE_QUEUE?:Queue<SmartCaptureQueueMessage>;
 DATABASE_URL?:string;
}
export async function enqueueSmartCaptureImport(db:Database,actor:string,projectId:string,importId:string,env:QueueEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true'||
  env.SMART_CAPTURE_QUEUE_ENABLED!=='true'||!env.SMART_CAPTURE_QUEUE)
  throw new HttpError(503,'SMART_CAPTURE_QUEUE_DISABLED');
 const project=uuid.parse(projectId),id=uuid.parse(importId);
 const [rows]=await db.forActor(actor,[{query:`
  SELECT i.id FROM public.smart_capture_imports i
  WHERE i.id=$1 AND i.project_id=$2 AND i.state='DISCOVERED' AND i.attempt_count<3
   AND EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=i.project_id
    AND m.user_id=$3 AND m.active
    AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
   AND EXISTS (SELECT 1 FROM public.smart_capture_sources s
    WHERE s.project_id=i.project_id AND s.id=i.source_id AND s.enabled)
  LIMIT 1`,params:[id,project,actor]}],true);
 if(!rows.length)throw new HttpError(409,'SMART_CAPTURE_QUEUE_NOT_ELIGIBLE');
 const message=smartCaptureQueueMessage.parse({schema:1,projectId:project,importId:id,actorId:actor});
 try{await env.SMART_CAPTURE_QUEUE.send(message,{contentType:'json'});}
 catch{throw new HttpError(503,'SMART_CAPTURE_QUEUE_UNAVAILABLE');}
 // Multiple enqueue requests are harmless: the processing CAS allows one winner.
 return {importId:id,state:'QUEUED',note:'Pending queue delivery; import state remains DISCOVERED until claimed'};
}
export async function consumeSmartCaptureBatch(
 batch:MessageBatch<unknown>,env:QueueEnv,process:typeof processSmartCaptureImport=processSmartCaptureImport
):Promise<void>{
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true'||
   env.SMART_CAPTURE_QUEUE_ENABLED!=='true'||!env.DATABASE_URL){
  // Disabled consumers must not silently discard pending work.
  for(const message of batch.messages)message.retry({delaySeconds:300});
  return;
 }
 const db=new Database(env.DATABASE_URL);
 // Sequential handling limits scanner/AI concurrency per consumer invocation.
 for(const message of batch.messages){
  const parsed=smartCaptureQueueMessage.safeParse(message.body);
  if(!parsed.success){message.ack();continue;}
  try{
   await process(db,parsed.data.actorId,parsed.data.projectId,parsed.data.importId,env);
   message.ack();
  }catch(error){
   // A duplicate delivery may encounter a prior successful atomic claim.
   // Do not requeue failed, rejected or uncertain jobs: operator reviews DB.
   if(error instanceof HttpError&&error.code==='SMART_CAPTURE_CLAIM_DENIED'){
    message.ack();continue;
   }
   // If the database/processor fails before claim, a later operator can
   // explicitly recover. No unbounded queue replay.
   message.ack();
  }
 }
}
