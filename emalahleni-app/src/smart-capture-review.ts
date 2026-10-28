/**
 * Human review and draft handoff for Smart Capture.
 * Confirmations use the same application encryption and project role rules.
 * Assessor/evidence/DoHS decisions are never modified here.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError} from './http';
import {extractionProposalSchema,proposeCaseForm} from './smart-capture-proposal';
import {sealSmartCaptureProposal,openSmartCaptureProposal} from './smart-capture-crypto';
import {encryptForm} from './crypto';
import {validSmartCaptureQuarantineKey} from './smart-capture-storage';

type ReviewEnv={SMART_CAPTURE_ENABLED?:string;SMART_CAPTURE_PROCESSING_ENABLED?:string;
 SMART_CAPTURE_ENCRYPTION_KEY?:string;FORM_ENCRYPTION_KEY?:string;EVIDENCE_BUCKET?:R2Bucket;};
const uuid=z.string().uuid();
const roles=['ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'];
const saveSchema=z.object({version:z.number().int().min(0),proposal:extractionProposalSchema}).strict();
const confirmSchema=z.object({version:z.number().int().min(0),confirmedFields:z.array(z.string().min(1).max(128)).max(100)}).strict();
async function authorise(db:Database,actor:string,project:string){
 const [rows]=await db.forActor(actor,[{query:`SELECT role FROM public.project_memberships
  WHERE project_id=$1 AND user_id=$2 AND active`,params:[project,actor]}],true);
 if(!rows.length||!roles.includes(rows[0].role))throw new HttpError(403,'SMART_CAPTURE_REVIEW_DENIED');
}
async function selectProposal(db:Database,actor:string,project:string,id:string){
 const [rows]=await db.forActor(actor,[{query:`SELECT p.ciphertext,p.review_version,
  i.state,i.application_id,i.content_sha256,i.storage_key
  FROM public.smart_capture_imports i
  JOIN public.smart_capture_proposals p ON p.import_id=i.id AND p.project_id=i.project_id
  WHERE i.project_id=$1 AND i.id=$2`,params:[project,id]}],true);
 if(!rows.length)throw new HttpError(404,'SMART_CAPTURE_PROPOSAL_UNAVAILABLE');
 return rows[0] as {ciphertext:string;review_version:number;state:string;
  application_id:string|null;content_sha256:string|null;storage_key:string|null};
}
export async function readSmartCaptureProposal(db:Database,actor:string,projectId:string,importId:string,env:ReviewEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||!env.SMART_CAPTURE_ENCRYPTION_KEY)throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=uuid.parse(projectId),id=uuid.parse(importId);
 await authorise(db,actor,project);
 const row=await selectProposal(db,actor,project,id);
 const proposal=extractionProposalSchema.parse(await openSmartCaptureProposal(
  row.ciphertext,env.SMART_CAPTURE_ENCRYPTION_KEY,project,id));
 return {id,projectId:project,state:row.state,version:row.review_version,proposal,applicationId:row.application_id};
}
export async function saveSmartCaptureProposal(db:Database,actor:string,projectId:string,importId:string,input:unknown,env:ReviewEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||!env.SMART_CAPTURE_ENCRYPTION_KEY)throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=uuid.parse(projectId),id=uuid.parse(importId),parsed=saveSchema.parse(input);
 await authorise(db,actor,project);
 const sealed=await sealSmartCaptureProposal(parsed.proposal,env.SMART_CAPTURE_ENCRYPTION_KEY,project,id);
 const [saved]=await db.forActor(actor,[{query:`UPDATE public.smart_capture_proposals p
   SET ciphertext=$4,review_version=review_version+1,reviewed_by=$5,reviewed_at=now(),updated_at=now()
   WHERE p.project_id=$1 AND p.import_id=$2 AND p.review_version=$3
   AND EXISTS (SELECT 1 FROM public.smart_capture_imports i
     WHERE i.project_id=p.project_id AND i.id=p.import_id AND i.state='NEEDS_REVIEW')
   RETURNING review_version`,params:[project,id,parsed.version,sealed,actor]}]);
 if(!saved.length)throw new HttpError(409,'SMART_CAPTURE_REVIEW_CONFLICT');
 return {version:Number(saved[0].review_version)};
}
export async function confirmSmartCaptureProposal(db:Database,actor:string,projectId:string,importId:string,input:unknown,env:ReviewEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true'
  ||!env.SMART_CAPTURE_ENCRYPTION_KEY||!env.FORM_ENCRYPTION_KEY)
  throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=uuid.parse(projectId),id=uuid.parse(importId),confirmation=confirmSchema.parse(input);
 await authorise(db,actor,project);
 const row=await selectProposal(db,actor,project,id);
 if(row.state==='COMMITTED'&&row.application_id)return {applicationId:row.application_id,state:'COMMITTED'};
 if(row.state!=='NEEDS_REVIEW'||row.review_version!==confirmation.version)
  throw new HttpError(409,'SMART_CAPTURE_REVIEW_CONFLICT');
 // UI checks are advisory: require a recorded, bounded quarantine PDF at the API boundary.
 if(!row.content_sha256||!/^[a-f0-9]{64}$/.test(row.content_sha256)||
  !row.storage_key||!validSmartCaptureQuarantineKey(row.storage_key,project,id))
  throw new HttpError(409,'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE');
 const proposal=extractionProposalSchema.parse(await openSmartCaptureProposal(
  row.ciphertext,env.SMART_CAPTURE_ENCRYPTION_KEY,project,id));
 const check=proposeCaseForm({proposal,confirmedFields:confirmation.confirmedFields,confirmedUnknownBooleans:[]});
 if(check.blockingIssues.length||check.reviewIssues.length)
  throw new HttpError(422,'SMART_CAPTURE_REVIEW_INCOMPLETE');
 // Supporting-document PDFs from one beneficiary folder must not create
 // independent beneficiary records. Database unique index is the final guard.
 const [sameFolder]=await db.forActor(actor,[{query:`
  SELECT existing.application_id FROM public.smart_capture_imports current_import
  JOIN public.smart_capture_imports existing
    ON existing.project_id=current_import.project_id
   AND existing.source_id=current_import.source_id
   AND existing.provider_folder_id=current_import.provider_folder_id
  WHERE current_import.id=$1 AND current_import.project_id=$2
   AND existing.state='COMMITTED' AND existing.id<>current_import.id
  LIMIT 1`,params:[id,project]}],true);
 if(sameFolder.length)throw new HttpError(409,'BENEFICIARY_FOLDER_ALREADY_LINKED');
 const caseId=crypto.randomUUID();
 const reference='SYN-SC-'+id.replace(/-/g,'').toUpperCase();
 const sealed=await encryptForm(check.form,env.FORM_ENCRYPTION_KEY,project,caseId);
 const [rows]=await db.forActor(actor,[{query:`
  WITH claimed AS (
    SELECT i.id FROM public.smart_capture_imports i
    WHERE i.id=$1 AND i.project_id=$2 AND i.state='NEEDS_REVIEW'
      AND EXISTS (SELECT 1 FROM public.smart_capture_proposals p
       WHERE p.import_id=i.id AND p.project_id=i.project_id AND p.review_version=$3)
    FOR UPDATE OF i
  ), created AS (
    INSERT INTO public.applications (id,organisation_id,project_id,reference,fields_ciphertext)
     SELECT $4,p.organisation_id,p.id,$5,$6 FROM claimed c
     JOIN public.projects p ON p.id=$2 RETURNING id
  ), completed AS (
    UPDATE public.smart_capture_imports i SET state='COMMITTED',application_id=$4,updated_at=now()
    WHERE i.project_id=$2 AND i.id=$1 AND EXISTS (SELECT 1 FROM created)
    RETURNING application_id
  ), audited AS (
    INSERT INTO public.audit_events (project_id,actor_id,action,metadata)
     SELECT $2,$7,'DRAFT_CREATED',jsonb_build_object('applicationId',application_id,'source','SMART_CAPTURE')
     FROM completed RETURNING id
  ) SELECT application_id FROM completed`,
  params:[id,project,confirmation.version,caseId,reference,sealed,actor]}]);
 if(!rows.length)throw new HttpError(409,'SMART_CAPTURE_CONFIRM_CONFLICT');
 return {applicationId:rows[0].application_id as string,state:'COMMITTED'};
}
export async function downloadSmartCapturePdf(db:Database,actor:string,projectId:string,importId:string,env:ReviewEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||!env.EVIDENCE_BUCKET)throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=uuid.parse(projectId),id=uuid.parse(importId);
 await authorise(db,actor,project);
 const [rows]=await db.forActor(actor,[{query:`SELECT state,content_sha256,storage_key
  FROM public.smart_capture_imports WHERE project_id=$1 AND id=$2
   AND state IN ('NEEDS_REVIEW','VERIFIED','COMMITTING','COMMIT_UNCERTAIN','COMMITTED')`,
  params:[project,id]}],true);
 if(!rows.length||!rows[0].storage_key||!rows[0].content_sha256)
  throw new HttpError(404,'SMART_CAPTURE_PDF_UNAVAILABLE');
 const key=String(rows[0].storage_key);
 if(!validSmartCaptureQuarantineKey(key,project,id))
  throw new HttpError(409,'SMART_CAPTURE_STORAGE_MISMATCH');
 const stored=await env.EVIDENCE_BUCKET.get(key);
 if(!stored||stored.size>5*1024*1024)throw new HttpError(404,'SMART_CAPTURE_PDF_UNAVAILABLE');
 const bytes=new Uint8Array(await stored.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==rows[0].content_sha256)throw new HttpError(409,'SMART_CAPTURE_STORAGE_MISMATCH');
 return new Response(bytes,{headers:{'Content-Type':'application/pdf','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="application-pack.pdf"',
  'Referrer-Policy':'no-referrer'}});
}
