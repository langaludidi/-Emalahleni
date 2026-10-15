import { z } from 'zod';
import { Database } from './database';
import { HttpError, readBytes } from './http';
import { MAX_UPLOAD,evidenceKinds,subtypes,evidenceWriterRoles } from './evidence-contracts';
export { MAX_UPLOAD,evidenceKinds,subtypes } from './evidence-contracts';
export const uploadSchema=z.object({kind:z.enum(evidenceKinds),filename:z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f/\\]+$/),contentType:z.enum(['application/pdf','image/jpeg','image/png']),size:z.number().int().min(1).max(MAX_UPLOAD),sha256:z.string().regex(/^[a-f0-9]{64}$/),dependantOrdinal:z.union([z.literal(1),z.literal(2)]).nullable().default(null)}).strict().refine(v=>(v.kind==='DEPENDANT_ID_OR_BIRTH_CERT')===(v.dependantOrdinal!==null),{message:'A dependant document must identify dependant 1 or 2.'});
export const reviewSchema=z.object({decision:z.enum(['VERIFIED','REJECTED']),note:z.string().trim().min(10).max(500),documentSubtype:z.enum(subtypes),documentDate:z.iso.date().nullable(),certificationConfirmed:z.boolean(),contentConfirmed:z.boolean()}).strict();
export interface EvidenceEnv { EVIDENCE_BUCKET?:R2Bucket; SCANNER?:Fetcher; SCANNER_TOKEN?:string; ENABLE_DOCUMENT_UPLOADS?:string; }
const writer=`m.role IN ('${evidenceWriterRoles.join("','")}')`;
const reviewer="m.role IN ('ADMIN','ASSESSOR')";
const scope=(roles:string)=>`EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=$1 AND m.user_id=current_setting('app.actor_id',true) AND m.active AND ${roles})`;
export async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function validSignature(bytes:Uint8Array,type:string){
 if(type==='application/pdf')return new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(type==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 return false;
}
async function roleCheck(db:Database,actor:string,project:string,roles:string){const [rows]=await db.forActor(actor,[{query:`SELECT 1 FROM public.project_memberships m WHERE m.project_id=$1 AND m.user_id=$2 AND m.active AND ${roles}`,params:[project,actor]}]);if(!rows.length)throw new HttpError(403,'EVIDENCE_ACTION_DENIED');}
export function uploadsConfigured(env:EvidenceEnv){return env.ENABLE_DOCUMENT_UPLOADS==='true'&&!!env.EVIDENCE_BUCKET&&!!env.SCANNER&&!!env.SCANNER_TOKEN;}
function requireUploads(env:EvidenceEnv){if(!uploadsConfigured(env))throw new HttpError(503,'DOCUMENT_UPLOADS_NOT_CONFIGURED');}
export async function createIntent(db:Database,actor:string,project:string,application:string,input:unknown,env:EvidenceEnv){
 requireUploads(env);const v=uploadSchema.parse(input);await roleCheck(db,actor,project,writer);
 const id=crypto.randomUUID();const key=`quarantine/${project}/${application}/${id}`;
 const [rows]=await db.forActor(actor,[{query:`WITH created AS (INSERT INTO public.evidence (id,project_id,application_id,kind,storage_key,filename,content_type,certification_required,dependant_ordinal) SELECT $3,$1,a.id,$4,$5,$6,$7,$8,$9 FROM public.applications a WHERE a.project_id=$1 AND a.id=$2 AND ${scope(writer)} RETURNING id), intent AS (INSERT INTO public.evidence_upload_intents (evidence_id,project_id,application_id,expected_size,expected_sha256,expected_content_type,expires_at,created_by) SELECT id,$1,$2,$10,$11,$7,now()+interval '15 minutes',$12 FROM created), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$12,'EVIDENCE_UPLOAD_INTENT',jsonb_build_object('applicationId',$2::text,'evidenceId',id) FROM created) SELECT id FROM created`,params:[project,application,id,v.kind,key,v.filename,v.contentType,['APPLICANT_ID','SPOUSE_ID'].includes(v.kind),v.dependantOrdinal,v.size,v.sha256,actor]}]);
 if(!rows.length)throw new HttpError(404,'NOT_FOUND');return {id,uploadPath:`/api/projects/${project}/applications/${application}/evidence/${id}/upload`,expiresInSeconds:900};
}
export async function scanVerdict(bytes:Uint8Array,sha256:string,env:EvidenceEnv):Promise<'CLEAN'|'INFECTED'|'SCAN_FAILED'>{
 if(!env.SCANNER||!env.SCANNER_TOKEN)return 'SCAN_FAILED';
 try{const response=await env.SCANNER.fetch(new Request('https://scanner.internal/scan',{method:'POST',headers:{'Content-Type':'application/octet-stream',Authorization:`Bearer ${env.SCANNER_TOKEN}`},body:new Uint8Array(bytes).buffer,signal:AbortSignal.timeout(45000)}));if(!response.ok)return 'SCAN_FAILED';const value=z.object({sha256:z.string(),verdict:z.enum(['CLEAN','INFECTED'])}).strict().parse(await response.json());return value.sha256===sha256?value.verdict:'SCAN_FAILED';}catch{return 'SCAN_FAILED';}
}
async function recordScan(db:Database,actor:string,project:string,application:string,id:string,hash:string,verdict:string){
 const status=verdict==='CLEAN'?'PENDING_REVIEW':verdict==='INFECTED'?'REJECTED':'PENDING_SCAN';
 const [rows]=await db.forActor(actor,[{query:`WITH scanned AS (UPDATE public.evidence SET malware_status=$5,status=$6 WHERE project_id=$1 AND application_id=$2 AND id=$3 AND sha256=$4 AND status='PENDING_SCAN' AND ${scope(writer)} RETURNING id,status,malware_status), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$7,'EVIDENCE_SCANNED',jsonb_build_object('evidenceId',id,'verdict',malware_status) FROM scanned) SELECT * FROM scanned`,params:[project,application,id,hash,verdict,status,actor]}]);
 if(!rows.length)throw new HttpError(409,'EVIDENCE_STATE_CHANGED');return rows[0];
}
export async function upload(db:Database,actor:string,project:string,application:string,id:string,request:Request,env:EvidenceEnv){
 requireUploads(env);await roleCheck(db,actor,project,writer);
 const [rows]=await db.forActor(actor,[{query:`SELECT e.storage_key,e.status,i.expected_size,i.expected_sha256,i.expected_content_type FROM public.evidence e JOIN public.evidence_upload_intents i ON i.evidence_id=e.id WHERE e.project_id=$1 AND e.application_id=$2 AND e.id=$3 AND i.created_by=$4 AND i.expires_at>now() AND (e.status='PENDING_UPLOAD' OR (e.status='PENDING_SCAN' AND e.uploaded_at IS NULL))`,params:[project,application,id,actor]}]);
 if(!rows.length)throw new HttpError(409,'UPLOAD_INTENT_UNAVAILABLE');const intent=rows[0];
 const bytes=await readBytes(request,MAX_UPLOAD);const hash=await digest(bytes);
 if(bytes.length!==Number(intent.expected_size)||hash!==intent.expected_sha256||request.headers.get('Content-Type')!==intent.expected_content_type||!validSignature(bytes,intent.expected_content_type))throw new HttpError(400,'FILE_INTEGRITY_MISMATCH');
 const [claimed]=await db.forActor(actor,[{query:`UPDATE public.evidence SET status='PENDING_SCAN',sha256=$4 WHERE project_id=$1 AND application_id=$2 AND id=$3 AND (status='PENDING_UPLOAD' OR (status='PENDING_SCAN' AND uploaded_at IS NULL AND sha256=$4)) AND ${scope(writer)} RETURNING id`,params:[project,application,id,hash]}]);
 if(!claimed.length)throw new HttpError(409,'UPLOAD_ALREADY_CLAIMED');
 try{await env.EVIDENCE_BUCKET!.put(intent.storage_key,bytes,{httpMetadata:{contentType:intent.expected_content_type},customMetadata:{sha256:hash}});}catch{throw new HttpError(503,'STORAGE_UNAVAILABLE');}
 await db.forActor(actor,[{query:"UPDATE public.evidence SET uploaded_at=now() WHERE project_id=$1 AND application_id=$2 AND id=$3 AND status='PENDING_SCAN'",params:[project,application,id]}]);
 return recordScan(db,actor,project,application,id,hash,await scanVerdict(bytes,hash,env));
}
export async function rescan(db:Database,actor:string,project:string,application:string,id:string,env:EvidenceEnv){
 requireUploads(env);await roleCheck(db,actor,project,writer);const [rows]=await db.forActor(actor,[{query:"SELECT storage_key,sha256 FROM public.evidence WHERE project_id=$1 AND application_id=$2 AND id=$3 AND status='PENDING_SCAN' AND uploaded_at IS NOT NULL",params:[project,application,id]}]);
 if(!rows.length)throw new HttpError(409,'SCAN_NOT_PENDING');const object=await env.EVIDENCE_BUCKET!.get(rows[0].storage_key);if(!object)throw new HttpError(503,'STORAGE_UNAVAILABLE');
 if(object.size>MAX_UPLOAD)throw new HttpError(413,'BODY_TOO_LARGE');const bytes=new Uint8Array(await object.arrayBuffer());const hash=await digest(bytes);if(hash!==rows[0].sha256)throw new HttpError(409,'STORED_FILE_CHANGED');
 return recordScan(db,actor,project,application,id,hash,await scanVerdict(bytes,hash,env));
}
export async function review(db:Database,actor:string,project:string,application:string,id:string,input:unknown){
 await roleCheck(db,actor,project,reviewer);const v=reviewSchema.parse(input);
 if(v.decision==='VERIFIED'&&!v.contentConfirmed)throw new HttpError(400,'CONTENT_REVIEW_REQUIRED');
 const [rows]=await db.forActor(actor,[{query:`WITH reviewed AS (UPDATE public.evidence SET status=$4,review_notes=$5,document_subtype=$6,document_date=$7,reviewed_by=$8,reviewed_at=now(),certification_acknowledged=$9,certification_acknowledged_by=CASE WHEN $9 THEN $8 ELSE NULL END,certification_acknowledged_at=CASE WHEN $9 THEN now() ELSE NULL END WHERE project_id=$1 AND application_id=$2 AND id=$3 AND status='PENDING_REVIEW' AND malware_status='CLEAN' AND (NOT certification_required OR $4='REJECTED' OR $9) AND ${scope(reviewer)} RETURNING id,status,malware_status), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$8,'EVIDENCE_REVIEWED',jsonb_build_object('evidenceId',id,'decision',status,'contentConfirmed',$10::boolean) FROM reviewed) SELECT * FROM reviewed`,params:[project,application,id,v.decision,v.note,v.documentSubtype,v.documentDate,actor,v.certificationConfirmed,v.contentConfirmed]}]);
 if(!rows.length)throw new HttpError(409,'REVIEW_STATE_OR_CERTIFICATION_INVALID');return rows[0];
}
export async function listEvidence(db:Database,actor:string,project:string,application:string){const [rows]=await db.forActor(actor,[{query:'SELECT id,kind,filename,content_type,status,malware_status,document_subtype,document_date,reviewed_by,reviewed_at,review_notes,certification_acknowledged,dependant_ordinal FROM public.evidence WHERE project_id=$1 AND application_id=$2 ORDER BY uploaded_at DESC NULLS LAST,id',params:[project,application]}]);return rows;}
export async function download(db:Database,actor:string,project:string,application:string,id:string,env:EvidenceEnv){
 const [rows]=await db.forActor(actor,[{query:"SELECT storage_key,filename,content_type,sha256 FROM public.evidence WHERE project_id=$1 AND application_id=$2 AND id=$3 AND malware_status='CLEAN' AND status IN ('PENDING_REVIEW','VERIFIED','REJECTED')",params:[project,application,id]}]);
 if(!rows.length)throw new HttpError(404,'NOT_FOUND');if(!env.EVIDENCE_BUCKET)throw new HttpError(503,'STORAGE_UNAVAILABLE');const e=rows[0];const object=await env.EVIDENCE_BUCKET.get(e.storage_key);if(!object)throw new HttpError(404,'NOT_FOUND');
 if(object.size>MAX_UPLOAD)throw new HttpError(413,'BODY_TOO_LARGE');const bytes=new Uint8Array(await object.arrayBuffer());if(await digest(bytes)!==e.sha256)throw new HttpError(409,'STORED_FILE_CHANGED');
 return new Response(bytes,{headers:{'Content-Type':e.content_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(e.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
