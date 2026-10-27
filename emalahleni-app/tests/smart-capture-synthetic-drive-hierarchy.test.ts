import test from 'node:test';
import assert from 'node:assert/strict';
import {listBeneficiaryFolders} from '../src/smart-capture-folders';
import {listBeneficiaryPdfs} from '../src/smart-capture-drive';

const ROOT='1jTDNtpo0KAp27vf4f6G6eBTYc8HKS2tA';
const CHILD='1ukw-8tFxcdfB2G-L8fs_VBKBOhsQNSh5';
const FILE='1YUJLAGci2yHXAXpwKFYJtfthQK9MnGZd';

test('SC-I04 synthetic Drive fixture uses root → beneficiary folder → PDF hierarchy',async()=>{
 const queries:string[]=[];
 const fetcher=async(request:Request)=>{
  const url=new URL(request.url),q=url.searchParams.get('q')??'';
  queries.push(q);
  assert.equal(url.hostname,'www.googleapis.com');
  if(q.includes('application/vnd.google-apps.folder')){
   assert.match(q,new RegExp(ROOT));
   return Response.json({files:[{id:CHILD,name:'SYNTHETIC-APPLICANT-001',
    parents:[ROOT],mimeType:'application/vnd.google-apps.folder',trashed:false}]});
  }
  assert.match(q,new RegExp(CHILD));
  return Response.json({files:[{id:FILE,name:'vectrasa_synthetic_housing_application.pdf',
   parents:[CHILD],mimeType:'application/pdf',size:'27213',
   modifiedTime:'2026-10-27T19:18:49.794Z',version:'1',trashed:false}]});
 };
 const folders=await listBeneficiaryFolders({rootFolderId:ROOT,accessToken:'synthetic-token',fetcher});
 assert.deepEqual(folders.folders.map(f=>f.id),[CHILD]);
 const pdfs=await listBeneficiaryPdfs({approvedFolderId:folders.folders[0].id,accessToken:'synthetic-token',fetcher});
 assert.deepEqual(pdfs.files.map(f=>f.providerFileId),[FILE]);
 assert.equal(queries.length,2);
});

test('SC-I04 rejects a PDF falsely reported under another beneficiary folder',async()=>{
 await assert.rejects(listBeneficiaryPdfs({approvedFolderId:CHILD,accessToken:'synthetic-token',
  fetcher:async()=>Response.json({files:[{id:FILE,name:'test.pdf',parents:[ROOT],
   mimeType:'application/pdf',size:'27213',modifiedTime:'2026-10-27T19:18:49.794Z'}]})
 }),/DRIVE_RESPONSE_INVALID/);
});

test('SC-I04 rejects an unapproved child folder returned by the provider',async()=>{
 await assert.rejects(listBeneficiaryFolders({rootFolderId:ROOT,accessToken:'synthetic-token',
  fetcher:async()=>Response.json({files:[{id:CHILD,name:'SYNTHETIC-APPLICANT-001',
   parents:['1notTheApprovedParent'],mimeType:'application/vnd.google-apps.folder',trashed:false}]})
 }),/DRIVE_RESPONSE_INVALID/);
});

test('SC-I04 discovery never downloads PDF bytes',async()=>{
 const methods:string[]=[];
 const fetcher=async(request:Request)=>{
  methods.push(request.method);
  const q=new URL(request.url).searchParams.get('q')??'';
  return Response.json({files:q.includes('google-apps.folder')?[{
   id:CHILD,name:'SYNTHETIC-APPLICANT-001',parents:[ROOT],
   mimeType:'application/vnd.google-apps.folder',trashed:false
  }]:[{id:FILE,name:'synthetic.pdf',parents:[CHILD],mimeType:'application/pdf',
   size:'27213',modifiedTime:'2026-10-27T19:18:49.794Z'}]});
 };
 await listBeneficiaryFolders({rootFolderId:ROOT,accessToken:'synthetic-token',fetcher});
 await listBeneficiaryPdfs({approvedFolderId:CHILD,accessToken:'synthetic-token',fetcher});
 assert.deepEqual(methods,['GET','GET']);
});
