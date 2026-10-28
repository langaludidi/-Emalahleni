import test from 'node:test';
import assert from 'node:assert/strict';
import { listBeneficiaryPdfs } from '../src/smart-capture-drive';

const folder = 'approvedFolder_12345';
const file = {
 id:'beneficiaryFile_12345',name:'Synthetic Beneficiary.pdf',mimeType:'application/pdf',
 size:'450000',modifiedTime:'2026-10-27T10:20:00.000Z',version:'4',
 md5Checksum:'a'.repeat(32),parents:[folder],trashed:false
};
const fetcher = (handler: (req: Request)=>Response|Promise<Response>) => async (req:Request)=> handler(req);

test('SC-002 only lists PDFs directly inside approved Drive folder and limits requested metadata',async()=>{
 let called = false;
 const result = await listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'synthetic-access-token',fetcher:fetcher(req=>{
   called = true;
   const url=new URL(req.url);
   assert.equal(url.hostname,'www.googleapis.com');
   assert.match(url.searchParams.get('q')??'',/mimeType = 'application\/pdf'/);
   assert.match(url.searchParams.get('q')??'',/trashed = false/);
   assert.match(url.searchParams.get('q')??'',/approvedFolder_12345/);
   assert.equal(url.searchParams.get('pageSize'),'100');
   assert.equal(url.searchParams.get('pageToken'),null);
   assert.equal(req.headers.get('Authorization'),'Bearer synthetic-access-token');
   return Response.json({files:[file],nextPageToken:'safeToken_2'});
 })});
 assert.ok(called);
 assert.deepEqual(result,{files:[{
   providerFileId:file.id,name:file.name,mimeType:'application/pdf',sizeBytes:450000,
   modifiedTime:file.modifiedTime,revision:'4',checksum:'a'.repeat(32)
 }],nextPageToken:'safeToken_2'});
});

test('SC-002 forwards opaque pagination tokens in next discovery call',async()=>{
 await listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'test',
   pageToken:'safeToken_2',fetcher:fetcher(req=>{
     assert.equal(new URL(req.url).searchParams.get('pageToken'),'safeToken_2');
     return Response.json({files:[]});
   })});
});

test('SC-002 rejects cross-folder, non-PDF and malformed provider metadata',async()=>{
 for(const bad of [
   {...file,parents:['otherFolder_123456']},
   {...file,mimeType:'application/vnd.google-apps.document'},
   {...file,size:'not-a-number'},
   {...file,trashed:true},
 ]) {
   await assert.rejects(listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'test',
     fetcher:fetcher(()=>Response.json({files:[bad]}))}),{code:'DRIVE_RESPONSE_INVALID'});
 }
});

test('SC-002 fails closed on credentials, bad folder ID, provider denial and malformed pagination',async()=>{
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:'bad!',accessToken:'test'}),{code:'DRIVE_FOLDER_INVALID'});
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:folder,accessToken:''}),{code:'DRIVE_CREDENTIAL_UNAVAILABLE'});
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'test',pageToken:'&q=evil'}),{code:'DRIVE_PAGE_TOKEN_INVALID'});
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'test',fetcher:fetcher(()=>new Response('PII',{status:403}))}),{code:'DRIVE_ACCESS_UNAVAILABLE'});
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:folder,accessToken:'test',fetcher:fetcher(()=>Response.json({files:[],nextPageToken:'bad token'}))}),{code:'DRIVE_RESPONSE_INVALID'});
});
