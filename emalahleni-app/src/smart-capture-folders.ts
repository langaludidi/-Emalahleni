/** A bounded discovery page of immediate beneficiary folders, not mixed packs. */
import {HttpError} from './http';
export type DriveFolder={id:string;name:string};
export type FolderPage={folders:DriveFolder[];nextPageToken:string|null};
export async function listBeneficiaryFolders(input:{rootFolderId:string;accessToken:string;pageToken?:string|null;fetcher?:(r:Request)=>Promise<Response>}):Promise<FolderPage>{
 const {rootFolderId,accessToken,pageToken=null}=input;
 if(!/^[A-Za-z0-9_-]{10,128}$/.test(rootFolderId))throw new HttpError(400,'DRIVE_FOLDER_INVALID');
 if(!accessToken||/\s/.test(accessToken))throw new HttpError(503,'DRIVE_CREDENTIAL_UNAVAILABLE');
 if(pageToken!==null&&(pageToken.length>1024||!/^[A-Za-z0-9_./+=:-]+$/.test(pageToken)))throw new HttpError(400,'DRIVE_PAGE_TOKEN_INVALID');
 const url=new URL('https://www.googleapis.com/drive/v3/files');
 url.searchParams.set('q',`'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
 url.searchParams.set('fields','nextPageToken,files(id,name,parents,mimeType,trashed)');
 url.searchParams.set('pageSize','20');url.searchParams.set('orderBy','name');
 url.searchParams.set('supportsAllDrives','true');url.searchParams.set('includeItemsFromAllDrives','true');
 if(pageToken)url.searchParams.set('pageToken',pageToken);
 let response:Response;
 try{response=await (input.fetcher??fetch)(new Request(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)}));}
 catch{throw new HttpError(503,'DRIVE_FETCH_UNAVAILABLE');}
 if(!response.ok)throw new HttpError(503,'DRIVE_FOLDER_LIST_FAILED');
 let data:unknown;try{data=await response.json();}catch{throw new HttpError(502,'DRIVE_RESPONSE_INVALID');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(502,'DRIVE_RESPONSE_INVALID');
 const value=data as {files?:unknown;nextPageToken?:unknown};
 if(!Array.isArray(value.files)||value.files.length>20)throw new HttpError(502,'DRIVE_RESPONSE_INVALID');
 const folders:DriveFolder[]=[];
 const ids=new Set<string>();
 for(const item of value.files){
  if(!item||typeof item!=='object')throw new HttpError(502,'DRIVE_RESPONSE_INVALID');
  const f=item as {id?:unknown;name?:unknown;parents?:unknown;mimeType?:unknown;trashed?:unknown};
  if(typeof f.id!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(f.id)||ids.has(f.id)||
   typeof f.name!=='string'||f.name.length>200||!Array.isArray(f.parents)||!f.parents.includes(rootFolderId)||
   f.mimeType!=='application/vnd.google-apps.folder'||f.trashed===true)
   throw new HttpError(502,'DRIVE_RESPONSE_INVALID');
  ids.add(f.id);folders.push({id:f.id,name:f.name});
 }
 const next=value.nextPageToken;
 if(next!=null&&(typeof next!=='string'||next.length>1024||!/^[A-Za-z0-9_./+=:-]+$/.test(next)))throw new HttpError(502,'DRIVE_RESPONSE_INVALID');
 return {folders,nextPageToken:next==null?null:next};
}
