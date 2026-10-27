import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../src/worker';
const project='00000000-0000-4000-8000-000000000001';

test('Smart Capture endpoint remains unavailable until explicitly activated',async()=>{
 const handler=createHandler(async()=> 'synthetic-officer');
 const response=await handler(
  new Request(`https://app.vectrasa.co.za/api/projects/${project}/smart-capture/imports`),
  {ENABLE_CASE_API:'true',DATABASE_URL:'configured',FORM_ENCRYPTION_KEY:'configured'});
 assert.equal(response.status,503);
 assert.equal((await response.json() as {error:string}).error,'SMART_CAPTURE_NOT_ENABLED');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('Smart Capture requires authentication even while feature is disabled',async()=>{
 const handler=createHandler(async()=>{throw Error('unauthenticated');});
 const response=await handler(
  new Request(`https://app.vectrasa.co.za/api/projects/${project}/smart-capture/sources`),
  {ENABLE_CASE_API:'true',DATABASE_URL:'configured',FORM_ENCRYPTION_KEY:'configured'});
 assert.equal(response.status,401);
});
test('No anonymous Smart Capture data endpoint is exposed',async()=>{
 const handler=createHandler(async()=>{throw Error('unauthenticated');});
 for(const path of ['imports','sources']){
  const response=await handler(new Request(`https://app.vectrasa.co.za/api/projects/${project}/smart-capture/${path}`),
   {ENABLE_CASE_API:'true',DATABASE_URL:'configured',FORM_ENCRYPTION_KEY:'configured'});
  assert.equal(response.status,401);
 }
});
