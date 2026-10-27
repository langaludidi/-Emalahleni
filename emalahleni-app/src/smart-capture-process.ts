/**
 * SC-008: controlled per-PDF import processor.
 * Requires an authorised project writer, approved source, explicit feature flags,
 * an applied reviewed migration and dedicated provider credentials.
 * No case/application is created by this endpoint.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError,readBytes} from './http';
import {digest,validSignature} from './evidence';
import {approvedFolder,googleServiceToken,type ServiceEnv} from './smart-capture-api';
import {processScannedPdfWithDocumentAi} from './smart-capture-document-ai';
import {sealSmartCaptureProposal} from './smart-capture-crypto';

export interface ProcessingEnv extends ServiceEnv {
 SMART_CAPTURE_PROCESSING_ENABLED?:string;
 SMART_CAPTURE_AI_CLIENT_EMAIL?:string;
 SMART_CAPTURE_AI_PRIVATE_KEY?:string;
 SMART_CAPTURE_AI_PROCESSOR_NAME?:string;
 SMART_CAPTURE_ENCRYPTION_KEY?:string;
 EVIDENCE_BUCKET?:R2Bucket;
 SCANNER?:Fetcher;
 SCANNER_TOKEN?:string;
}
const MAX_PDF=5*1024*1024; // Scanner safety limit retained until separately redesigned.
const fileMetadata=z.object({
 id:z.string(),parents:z.array(z.string()),mimeType:z.literal('application/pdf'),
 size:z.union([z.string(),z.number()]),version:z.union([z.string(),z.number()]).optional(),
 modifiedTime:z.string(),md5Checksum:z.string().optional(),
}).passthrough();

async function updateState(db:Database,actor:string,project:string,id:string,from:string,to:string,sha?:string,key?:string){
 const [rows]=await db.forActor(actor,[{query:`UPDATE public.smart_capture_imports SET state=$4,
  content_sha256=COALESCE($5,content_sha256),storage_key=COALESCE($6,storage_key),updated_at=now()
  WHERE id=$1 AND project_id=$2 AND state=$3 RETURNING id`,params:[id,project,from,to,sha??null,key??null]}]);
 if(!rows.length)throw new HttpError(409,'SMART_CAPTURE_STATE_CHANGED');
}
async function markFailed(db:Database,actor:string,project:string,id:string,code:string){
 await db.forActor(actor,[{query:`UPDATE public.smart_capture_imports
  SET state='FAILED',error_code=$3,claimed_at=NULL,claimed_by=NULL,updated_at=now()
  WHERE id=$1 AND project_id=$2 AND state IN ('FETCHING','QUARANTINED','SCANNING','EXTRACTING')`,
  params:[id,project,code]}]);
}

export async function processSmartCaptureImport(db:Database,actor:string,projectId:string,importId:string,env:ProcessingEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true')
  throw new HttpError(503,'SMART_CAPTURE_PROCESSING_DISABLED');
 if(!env.EVIDENCE_BUCKET||!env.SCANNER||!env.SCANNER_TOKEN||
   !env.SMART_CAPTURE_ENCRYPTION_KEY||!env.SMART_CAPTURE_AI_PROCESSOR_NAME)
  throw new HttpError(503,'SMART_CAPTURE_PROCESSING_NOT_CONFIGURED');
 const project=z.string().uuid().parse(projectId),id=z.string().uuid().parse(importId);
 // Atomic compare-and-set claim; two concurrent requests cannot claim a single DISCOVERED item.
 const [claimed]=await db.forActor(actor,[{query:`
  UPDATE public.smart_capture_imports i SET
   state='FETCHING',claimed_at=now(),claimed_by=$3,attempt_count=attempt_count+1,updated_at=now()
  WHERE i.project_id=$1 AND i.id=$2 AND i.state='DISCOVERED'
   AND EXISTS (SELECT 1 FROM public.project_memberships m
    WHERE m.project_id=i.project_id AND m.user_id=$3 AND m.active
    AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
   AND EXISTS (SELECT 1 FROM public.smart_capture_sources s
    WHERE s.project_id=i.project_id AND s.id=i.source_id AND s.enabled)
  RETURNING i.source_id,i.provider_folder_id,i.provider_file_id,i.source_version,i.content_size_bytes`,
  params:[project,id,actor]}]);
 if(!claimed.length)throw new HttpError(409,'SMART_CAPTURE_CLAIM_DENIED');
 const item=claimed[0] as {source_id:string;provider_folder_id:string;provider_file_id:string;source_version:string;content_size_bytes:number|string};
 let stage='FETCHING',errorCode='SMART_CAPTURE_PROCESSING_FAILED';
 try{
  const folder=approvedFolder(env,item.source_id);
  const driveToken=await googleServiceToken(env.SMART_CAPTURE_DRIVE_CLIENT_EMAIL,
   env.SMART_CAPTURE_DRIVE_PRIVATE_KEY,'https://www.googleapis.com/auth/drive.readonly');
  // The imported file must remain in its own beneficiary folder, which must
  // still be an immediate child of the approved source root.
  const folderUrl=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(item.provider_folder_id));
  folderUrl.searchParams.set('fields','id,parents,mimeType,trashed');
  folderUrl.searchParams.set('supportsAllDrives','true');
  const folderResponse=await fetch(folderUrl,{headers:{Authorization:`Bearer ${driveToken}`},signal:AbortSignal.timeout(15_000)});
  if(!folderResponse.ok){errorCode='DRIVE_BENEFICIARY_FOLDER_UNAVAILABLE';throw Error(errorCode);}
  const folderInfo=z.object({id:z.string(),parents:z.array(z.string()),
   mimeType:z.literal('application/vnd.google-apps.folder'),trashed:z.boolean().optional()}).safeParse(await folderResponse.json());
  if(!folderInfo.success||folderInfo.data.id!==item.provider_folder_id||
   !folderInfo.data.parents.includes(folder)||folderInfo.data.trashed===true){
   errorCode='DRIVE_BENEFICIARY_FOLDER_MISMATCH';throw Error(errorCode);
  }
  // Verify file metadata again at processing time, not just when discovered.
  const metaUrl=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(item.provider_file_id));
  metaUrl.searchParams.set('fields','id,parents,mimeType,size,version,modifiedTime,md5Checksum');
  metaUrl.searchParams.set('supportsAllDrives','true');
  const getHeaders={Authorization:`Bearer ${driveToken}`};
  const metaResponse=await fetch(metaUrl,{headers:getHeaders,signal:AbortSignal.timeout(15_000)});
  if(!metaResponse.ok){errorCode='DRIVE_FILE_UNAVAILABLE';throw Error(errorCode);}
  const meta=fileMetadata.safeParse(await metaResponse.json());
  if(!meta.success||meta.data.id!==item.provider_file_id||!meta.data.parents.includes(item.provider_folder_id)){
   errorCode='DRIVE_SOURCE_MISMATCH';throw Error(errorCode);
  }
  if(Number(meta.data.size)<=0||Number(meta.data.size)>MAX_PDF){
   errorCode='SMART_CAPTURE_PDF_TOO_LARGE';throw Error(errorCode);
  }
  const remoteRevision=meta.data.version==null?null:`v:${meta.data.version}`;
  const md5Version=meta.data.md5Checksum&&Number.isFinite(Date.parse(meta.data.modifiedTime))
    ?`m:${Date.parse(meta.data.modifiedTime)}:${meta.data.md5Checksum.toLowerCase()}`:null;
  if((remoteRevision!==null&&remoteRevision!==item.source_version)||
     (remoteRevision===null&&md5Version!==item.source_version)){
   errorCode='DRIVE_SOURCE_CHANGED';throw Error(errorCode);
  }
  const mediaUrl=new URL(metaUrl);
  mediaUrl.searchParams.set('alt','media');
  const response=await fetch(mediaUrl,{headers:getHeaders,signal:AbortSignal.timeout(25_000)});
  if(!response.ok){errorCode='DRIVE_DOWNLOAD_FAILED';throw Error(errorCode);}
  const pdf=await readBytes(response,MAX_PDF);
  if(pdf.length!==Number(meta.data.size)||!validSignature(pdf,'application/pdf')){
   errorCode='PDF_INTEGRITY_MISMATCH';throw Error(errorCode);
  }
  const hash=await digest(pdf);
  const storageKey=`smart-capture/quarantine/${project}/${id}/original.pdf`;
  await env.EVIDENCE_BUCKET.put(storageKey,pdf,{httpMetadata:{contentType:'application/pdf'}});
  await updateState(db,actor,project,id,stage,'QUARANTINED',hash,storageKey);stage='QUARANTINED';
  await updateState(db,actor,project,id,stage,'SCANNING');stage='SCANNING';
  let scanResponse:Response,scan:unknown;
  try{
   scanResponse=await env.SCANNER.fetch(new Request('https://scanner.internal/scan',{
    method:'POST',headers:{Authorization:`Bearer ${env.SCANNER_TOKEN}`,'Content-Type':'application/octet-stream'},
    body:pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength),
    signal:AbortSignal.timeout(120_000),
   }));
   scan=JSON.parse(new TextDecoder().decode(await readBytes(scanResponse,8192)));
  }catch{errorCode='SCANNER_UNAVAILABLE';throw Error(errorCode);}
  if(scanResponse.status!==200){errorCode='SCANNER_UNAVAILABLE';throw Error(errorCode);}
  const verdict=scan as {sha256?:string;verdict?:string};
  if(verdict.sha256!==hash||!['CLEAN','INFECTED'].includes(verdict.verdict??'')){
   errorCode='SCANNER_RESULT_INVALID';throw Error(errorCode);
  }
  if(verdict.verdict==='INFECTED'){
   await env.EVIDENCE_BUCKET.delete(storageKey);
   await updateState(db,actor,project,id,stage,'REJECTED');
   return {importId:id,state:'REJECTED'};
  }
  if(!scanResponse.ok){errorCode='SCANNER_UNAVAILABLE';throw Error(errorCode);}
  await updateState(db,actor,project,id,stage,'EXTRACTING');stage='EXTRACTING';
  const aiToken=await googleServiceToken(env.SMART_CAPTURE_AI_CLIENT_EMAIL,
   env.SMART_CAPTURE_AI_PRIVATE_KEY,'https://www.googleapis.com/auth/cloud-platform');
  const proposal=await processScannedPdfWithDocumentAi({pdf,accessToken:aiToken,
   processorName:env.SMART_CAPTURE_AI_PROCESSOR_NAME});
  const ciphertext=await sealSmartCaptureProposal(proposal,env.SMART_CAPTURE_ENCRYPTION_KEY,project,id);
  // One database transaction ensures the proposal and NEEDS_REVIEW state appear together.
  const [saved]=await db.forActor(actor,[{query:`
   WITH inserted AS (
    INSERT INTO public.smart_capture_proposals (import_id,project_id,ciphertext)
    SELECT $1,$2,$3 WHERE EXISTS (
      SELECT 1 FROM public.smart_capture_imports WHERE id=$1 AND project_id=$2 AND state='EXTRACTING'
    ) ON CONFLICT (import_id) DO NOTHING RETURNING import_id
   ), advanced AS (
    UPDATE public.smart_capture_imports SET state='NEEDS_REVIEW',
    claimed_at=NULL,claimed_by=NULL,updated_at=now()
    WHERE id=$1 AND project_id=$2 AND state='EXTRACTING'
     AND EXISTS (SELECT 1 FROM inserted)
    RETURNING id
   ) SELECT id FROM advanced`,
   params:[id,project,ciphertext]}]);
  if(!saved.length)throw new HttpError(409,'SMART_CAPTURE_STATE_CHANGED');
  return {importId:id,state:'NEEDS_REVIEW'};
 }catch(cause){
  // Map known provider failures to stable non-PII codes for controlled retries.
  // Never return raw provider errors, scanned content or extracted identity data.
  if(cause instanceof Error&&[
   'DOCUMENT_AI_UNAVAILABLE','DOCUMENT_AI_PROCESSING_FAILED',
   'DOCUMENT_AI_RESPONSE_INVALID','DOCUMENT_AI_RESPONSE_TOO_LARGE',
   'DOCUMENT_AI_PDF_SIZE','DOCUMENT_AI_PDF_INVALID',
  ].includes(cause.message))errorCode=cause.message;
  try{await markFailed(db,actor,project,id,errorCode);}catch{}
  throw new HttpError(503,errorCode);
 }
}
