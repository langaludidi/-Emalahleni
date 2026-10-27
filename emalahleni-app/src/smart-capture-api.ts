/**
 * Smart Capture authenticated metadata API.
 * No document bytes are fetched. All writes require project access and feature flag.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { z } from 'zod';
import { Database } from './database';
import { HttpError } from './http';
import { listBeneficiaryPdfs } from './smart-capture-drive';
import {listBeneficiaryFolders} from './smart-capture-folders';
import { discoveryVersion, publicImportSummary, type ImportState } from './smart-capture-import';

export type ServiceEnv = {
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

export async function googleServiceToken(email:string|undefined,secret:string|undefined,scope:string):Promise<string>{
 if(!email||!secret)throw new HttpError(503,'DRIVE_CREDENTIAL_UNAVAILABLE');
 let key: CryptoKey;
 try {key=await importPKCS8(secret.replace(/\\n/g,'\n'),'RS256');}
 catch {throw new HttpError(503,'DRIVE_CREDENTIAL_UNAVAILABLE');}
 const now=Math.floor(Date.now()/1000);
 const assertion=await new SignJWT({scope})
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

export function approvedFolder(env:ServiceEnv,sourceId:string):string{
 if(!env.SMART_CAPTURE_DRIVE_SOURCES_JSON)throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 let sources:unknown;
 try{sources=JSON.parse(env.SMART_CAPTURE_DRIVE_SOURCES_JSON);}catch{throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');}
 if(!sources||typeof sources!=='object'||Array.isArray(sources))throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 const folder=(sources as Record<string,unknown>)[sourceId];
 if(typeof folder!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(folder))throw new HttpError(503,'SMART_CAPTURE_SOURCE_NOT_CONFIGURED');
 return folder;
}


export async function smartCaptureSources(db:Database,actor:string,projectId:string){
 const project=z.string().uuid().parse(projectId);
 const [membership,sources]=await db.forActor(actor,[
  {query:'SELECT role FROM public.project_memberships WHERE project_id=$1 AND user_id=$2 AND active',params:[project,actor]},
  {query:'SELECT id,label,enabled FROM public.smart_capture_sources WHERE project_id=$1 ORDER BY label LIMIT 100',params:[project]},
 ],true);
 if(!membership.length)throw new HttpError(403,'PROJECT_ACCESS_DENIED');
 return {sources:sources.map(row=>({id:String(row.id),label:String(row.label),enabled:row.enabled===true}))};
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

export async function smartCaptureSync(db:Database,actor:string,projectId:string,sourceId:string,env:ServiceEnv,pageToken:string|null=null){
 if(env.SMART_CAPTURE_ENABLED!=='true')throw new HttpError(503,'SMART_CAPTURE_NOT_ENABLED');
 const project=z.string().uuid().parse(projectId),source=z.string().uuid().parse(sourceId);
 const [membership,registered]=await db.forActor(actor,[
  {query:`SELECT 1 AS permitted WHERE ${roleSql}`,params:[project,actor]},
  {query:`SELECT id FROM public.smart_capture_sources WHERE id=$1 AND project_id=$2 AND enabled`,params:[source,project]}
 ],true);
 if(!membership.length)throw new HttpError(403,'PROJECT_WRITE_DENIED');
 if(!registered.length)throw new HttpError(404,'SMART_CAPTURE_SOURCE_UNAVAILABLE');
 const folder=approvedFolder(env,source);
 const token=await googleServiceToken(env.SMART_CAPTURE_DRIVE_CLIENT_EMAIL,env.SMART_CAPTURE_DRIVE_PRIVATE_KEY,'https://www.googleapis.com/auth/drive.readonly');
 // Root contains one separate folder per beneficiary. Do not scan only root PDFs.
 const folderPage=await listBeneficiaryFolders({rootFolderId:folder,accessToken:token,pageToken});
 const identifiers:Array<{id:string;folderId:string;version:string;size:number}>=[];
 for(const child of folderPage.folders){
  const files=await listBeneficiaryPdfs({approvedFolderId:child.id,accessToken:token});
  if(files.nextPageToken!==null)throw new HttpError(409,'BENEFICIARY_FOLDER_PDF_LIMIT');
  for(const file of files.files)identifiers.push({
   id:file.providerFileId,folderId:child.id,version:discoveryVersion(file),size:file.sizeBytes
  });
 }
 let newRows=0;
 if(identifiers.length){
  const [rows]=await db.forActor(actor,[{
   query:`INSERT INTO public.smart_capture_imports
    (project_id,source_id,provider_folder_id,provider_file_id,source_version,content_size_bytes,state)
    SELECT $1::uuid,$2::uuid,f.folder_id,f.id,f.version,f.size,'DISCOVERED'
    FROM jsonb_to_recordset($3::jsonb) AS f(id text,folder_id text,version text,size bigint)
    ON CONFLICT (project_id,source_id,provider_file_id,source_version) DO NOTHING
    RETURNING id`,
   params:[project,source,JSON.stringify(identifiers)]
  }]);
  newRows=rows.length;
 }
 return {discovered:identifiers.length,newImports:newRows,
   foldersChecked:folderPage.folders.length,
   hasMore:folderPage.nextPageToken!==null,nextPageToken:folderPage.nextPageToken};

}
