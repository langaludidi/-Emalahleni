import {z} from 'zod';
import type {Database} from './database';
import {digest,uploadsConfigured,validSignature,type EvidenceEnv} from './evidence';
import {MAX_UPLOAD,evidenceWriterRoles} from './evidence-contracts';
import {HttpError,readBytes} from './http';
import {parseIdText,type IdReading} from './id-reading';

export interface IdReadingEnv extends EvidenceEnv {ENABLE_ID_READING?:string;}
export function idReadingConfigured(env:IdReadingEnv){return env.ENABLE_ID_READING==='true'&&uploadsConfigured(env);}
const responseSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),text:z.string().max(16000)}).strict();
const infectedSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.literal('INFECTED')}).strict();
const writerScope=`EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=$1 AND m.user_id=current_setting('app.actor_id',true) AND m.active AND m.role IN ('${evidenceWriterRoles.join("','")}'))`;

export async function readIdDocument(db:Database,actor:string,project:string,application:string,id:string,env:IdReadingEnv):Promise<IdReading>{
 if(!idReadingConfigured(env))throw new HttpError(503,'ID_READING_NOT_CONFIGURED');
 const [rows]=await db.forActor(actor,[{query:`SELECT e.storage_key,e.content_type,e.sha256,e.kind,e.status,e.malware_status,m.role FROM public.evidence e JOIN public.project_memberships m ON m.project_id=e.project_id AND m.user_id=$4 AND m.active WHERE e.project_id=$1 AND e.application_id=$2 AND e.id=$3`,params:[project,application,id,actor]}]);
 const document=rows[0];if(!document)throw new HttpError(404,'NOT_FOUND');
 if(!evidenceWriterRoles.includes(document.role))throw new HttpError(403,'EVIDENCE_ACTION_DENIED');
 if(document.kind!=='APPLICANT_ID'||document.malware_status!=='CLEAN'||!['PENDING_REVIEW','VERIFIED'].includes(document.status))throw new HttpError(409,'CLEAN_APPLICANT_ID_REQUIRED');
 const object=await env.EVIDENCE_BUCKET!.get(document.storage_key);if(!object)throw new HttpError(404,'NOT_FOUND');
 if(object.size>MAX_UPLOAD)throw new HttpError(413,'BODY_TOO_LARGE');
 const bytes=new Uint8Array(await object.arrayBuffer());const sha256=await digest(bytes);
 if(sha256!==document.sha256||!validSignature(bytes,document.content_type))throw new HttpError(409,'STORED_FILE_CHANGED');
 let response:Response,value:unknown;
 try{
  response=await env.SCANNER!.fetch(new Request('https://scanner.internal/read-id',{method:'POST',headers:{Authorization:`Bearer ${env.SCANNER_TOKEN}`,'Content-Type':document.content_type},body:new Uint8Array(bytes).buffer,signal:AbortSignal.timeout(120000)}));
  value=JSON.parse(new TextDecoder().decode(await readBytes(response,131072)));
 }catch{throw new HttpError(503,'ID_READING_UNAVAILABLE');}
 if(response.status===422){
  const infected=infectedSchema.safeParse(value);
  if(infected.success&&infected.data.sha256===sha256){
   await db.forActor(actor,[{query:`WITH rejected AS (UPDATE public.evidence SET malware_status='INFECTED',status='REJECTED' WHERE project_id=$1 AND application_id=$2 AND id=$3 AND sha256=$4 AND ${writerScope} RETURNING id), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$5,'EVIDENCE_SCANNED',jsonb_build_object('evidenceId',id,'verdict','INFECTED','source','ID_READING') FROM rejected) SELECT id FROM rejected`,params:[project,application,id,sha256,actor]}]);
   throw new HttpError(409,'ID_READING_FILE_REJECTED');
  }
  throw new HttpError(503,'ID_READING_UNAVAILABLE');
 }
 const result=responseSchema.safeParse(value);
 if(!response.ok||!result.success||result.data.sha256!==sha256)throw new HttpError(503,'ID_READING_UNAVAILABLE');
 const parsed=parseIdText(result.data.text);
 // Recheck access/state after OCR. Officers may insert audits but cannot read them, so return the authorised document row.
 // Keep extracted identity values in the response only; audit metadata contains no OCR text or ID details.
 const [audited]=await db.forActor(actor,[{query:`WITH current_document AS (SELECT id FROM public.evidence WHERE project_id=$1 AND application_id=$2 AND id=$3 AND sha256=$5 AND malware_status='CLEAN' AND status IN ('PENDING_REVIEW','VERIFIED') AND ${writerScope}), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$4,'ID_DETAILS_READ',jsonb_build_object('applicationId',$2::text,'evidenceId',id) FROM current_document) SELECT id FROM current_document`,params:[project,application,id,actor,sha256]}]);
 if(!audited.length)throw new HttpError(409,'ID_READING_STATE_CHANGED');
 return {evidenceId:id,sha256,...parsed,requiresConfirmation:true,
  provenance:{sourceEvidenceId:id,sourceSha256:sha256,method:'SCANNER_OCR_LABELLED_ID_V1',observedAt:new Date().toISOString()}};
}
