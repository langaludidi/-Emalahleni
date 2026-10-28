import test from 'node:test';
import assert from 'node:assert/strict';
import {listBeneficiaryFolders} from '../src/smart-capture-folders';
const root='RootFolderAbc_12345',child='BeneficiaryFolderAbc_12345';
test('SC-010 finds beneficiary subfolders, not a flat collection of root PDFs',async()=>{
 const result=await listBeneficiaryFolders({rootFolderId:root,accessToken:'synthetic',
  fetcher:async request=>{
   const url=new URL(request.url);
   assert.match(url.searchParams.get('q')??'',/application\/vnd.google-apps.folder/);
   assert.ok((url.searchParams.get('q')??'').includes(root));
   return Response.json({files:[{id:child,name:'Synthetic beneficiary',parents:[root],
    mimeType:'application/vnd.google-apps.folder'}]});
  }});
 assert.equal(result.folders[0].id,child);
 assert.equal(result.nextPageToken,null);
});
test('SC-010 rejects folders outside the approved root',async()=>{
 await assert.rejects(listBeneficiaryFolders({rootFolderId:root,accessToken:'synthetic',
  fetcher:async()=>Response.json({files:[{id:child,name:'Wrong source',
   parents:['DifferentRootFolderAbc_12345'],mimeType:'application/vnd.google-apps.folder'}]})}),
  {code:'DRIVE_RESPONSE_INVALID'});
});
test('SC-010 bounded folder cursor is validated',async()=>{
 await assert.rejects(listBeneficiaryFolders({rootFolderId:root,accessToken:'synthetic',pageToken:'!bad'}),
  {code:'DRIVE_PAGE_TOKEN_INVALID'});
});
