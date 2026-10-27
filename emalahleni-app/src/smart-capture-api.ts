/**
 * Smart Capture authenticated metadata API.
 * No document bytes are fetched. All writes require project access and feature flag.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { z } from 'zod';
import { Database } from './database';
import { HttpError } from './http';
import { listBeneficiaryPdfs } from './smart-capture-drive';
import { discoveryVersion, publicImportSummary, type ImportState } from './smart-capture-import';

type ServiceEnv = {
 SMART_CAPTURE_ENABLED?: string;
 SMART_CAPTURE_DRIVE_CLIENT_EMAIL?: string;
 SMART_CAPTURE_DRIVE_PRIVATE_KEY?: string;
 SMART_CAPTURE_DRIVE_SOURCES_JSON?: string;
};
const roleSql = `EXISTS (SELECT 1 FROM public.project_memberships m
 WHERE m.project_id=$1 AND m.user_id=$2 AND m.active
 AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))`;
const listRow=z.object({
 id:z.string().uuid(),state:z.string(),application_id:z.string().uuid().nullable(),
 attempt_count:z.number().int(),error_code:z.string().nullable(),
});
const MAX_PAGES = 30;

async function serviceAccountToken(env:ServiceEnv):Promise<string>{
 const email=env.SMART_CAPTURE_DRIVE_CLIENT_EMAIL,secret=env.SMART_CAPTURE_DRIVE_PRIVATE_KEY;
 if(!email||!secret)throw new HttpError(503,'DRIVE_CREDENTIAL_UNAVAILABLE');
 let key: CryptoKey;
 try {key=await importPKCS8(secret.replace(/\\n/g,'\n'),'RS256');}
 catch {throw new HttpError(503,'DRIVE_CREDENTIAL_UNAVAILABLE');}
 const now=Math.floor(Date.now()/1000);
 const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/drive.readonly'})
  .setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(email)
  .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now+300).sign(key);
 let response:Response;
 try{response=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  signal:AbortSignal.timeout(15_000)
 });}catch{throw new HttpError(503,'DRIVE_ACCESS_UNAVAILABLE');}
 if(!response.ok)throw new HttpError(503,'DRIVE_ACCESS_UNAVAILABLE');
 const data=await response.json() as {access_token?:unknown};
 if(typeof data.access_token!=='string'||!data.access_token)throw new HttpError(503,'DRIVE_ACCESS_UNAVAILABLE');
 return data.access_token;
}

function approvedFolder(env:ServiceEnv,sourceId:string):string{
 if(!env.SMART_CAPTURE_DRIVE_SOURCES_JSON)throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 let sources:unknown;
 try{sources=JSON.parse(env.SMART_CAPTURE_DRIVE_SOURCES_JSON);}catch{throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');}
 if(!sources||typeof sources!=='object'||Array.isArray(sources))throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 const folder=(sources as Record<string,unknown>)[sourceId];
 if(typeof folder!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(folder))throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 return folder;
}

export async function smartCaptureList(db:Database,actor:string,projectId:string,limit=50){
 const project=z.string().uuid().parse(projectId);
 const number=Math.max(1,Math.min(100,limit));
 const [membership,imports]=await db.forActor(actor,[
  {query:'SELECT m.role FROM public.project_memberships m WHERE m.project_id=$1 AND m.user_id=$2 AND m.active',params:[project,actor]},
  {query:`SELECT id,state,application_id,attempt_count,error_code
    FROM public.smart_capture_imports WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,params:[project,number]}
 ],true);
 if(!membership.length)throw new HttpError(403,'PROJECT_ACCESS_DENIED');
 return {imports: imports.map(row=>{
  const value=listRow.parse(row);
  return publicImportSummary({id:value.id,projectId:project,
   state:value.state as ImportState,applicationId:value.application_id,
   attemptCount:value.attempt_count,errorCode:value.error_code});
 })};
}

export async function smartCaptureSync(db:Database,actor:string,projectId:string,sourceId:string,env:ServiceEnv){
 if(env.SMART_CAPTURE_ENABLED!=='true')throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=z.string().uuid().parse(projectId),source=z.string().uuid().parse(sourceId);
 const [membership,registered]=await db.forActor(actor,[
  {query:`SELECT 1 AS permitted WHERE ${roleSql}`,params:[project,actor]},
  {query:`SELECT id FROM public.smart_capture_sources WHERE id=$1 AND project_id=$2 AND enabled`,params:[source,project]}
 ],true);
 if(!membership.length)throw new HttpError(403,'PROJECT_WRITE_DENIED');
 if(!registered.length)throw new HttpError(404,'SMART_CAPTURE_SOURCE_UNAVAILABLE');
 const folder=approvedFolder(env,source);
 const token=await serviceAccountToken(env);
 let page:string|null=null, pages=0,discovered=0,newRows=0;
 // One request is bounded by count. Later pages require durable cursor/queue workflow.
 do {
  const result=await listBeneficiaryPdfs({approvedFolderId:folder,accessToken:token,pageToken:page});
  if(result.files.length){
   const identifiers=result.files.map(file=>({
    id:file.providerFileId,version:discoveryVersion(file),size:file.sizeBytes
   }));
   for(const file of identifiers){
    const [rows]=await db.forActor(actor,[{
     query:`INSERT INTO public.smart_capture_imports
      (project_id,source_id,provider_file_id,source_version,content_size_bytes,state)
      VALUES ($1,$2,$3,$4,$5,'DISCOVERED')
      ON CONFLICT (project_id,source_id,provider_file_id,source_version) DO NOTHING RETURNING id`,
     params:[project,source,file.id,file.version,file.size]
    }]);
    newRows+=rows.length;
   }
   discovered+=result.files.length;
  }
  page=result.nextPageToken;
  pages++;
 }while(page&&pages<MAX_PAGES);
 return {discovered,newImports:newRows,hasMore:!!page,processedPages:pages};
}
