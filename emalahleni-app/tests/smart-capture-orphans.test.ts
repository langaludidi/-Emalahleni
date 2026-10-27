import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySmartCaptureOrphans} from '../src/smart-capture-orphans';
import {smartCaptureQuarantineKey} from '../src/smart-capture-storage';
import type {Database} from '../src/database';
const project='22222222-2222-4222-8222-222222222221';
const id='44444444-4444-4444-8444-444444444441';
const current=smartCaptureQuarantineKey(project,id,'55555555-5555-4555-8555-555555555551');
const abandoned=smartCaptureQuarantineKey(project,id,'55555555-5555-4555-8555-555555555552');
function mockDb(allowed:boolean){
 return {forActor:async(_actor:string,queries:Array<{query:string}>)=>{
  if(queries[0].query.includes('FROM public.project_memberships'))return [allowed?[{role:'MANAGER'}]:[]];
  return [[{id,storage_key:current,state:'NEEDS_REVIEW'}]];
 }} as unknown as Database;
}
test('SC-026 only counts orphan candidates and never deletes R2 objects',async()=>{
 let deletes=0;
 const old=new Date(Date.now()-48*60*60*1000);
 const bucket={list:async()=>({objects:[{key:current,uploaded:old},{key:abandoned,uploaded:old},{key:'smart-capture/quarantine/'+project+'/bad-key',uploaded:old}],truncated:false}),delete:async()=>{deletes++;}} as unknown as R2Bucket;
 const result=await inventorySmartCaptureOrphans(mockDb(true),'synthetic:manager',project,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',EVIDENCE_BUCKET:bucket});
 assert.equal(result.retained,1);
 assert.equal(result.orphanCandidates,1);
 assert.equal(result.invalid,1);
 assert.equal(deletes,0);
});
test('SC-026 rejects unauthorised inventory before listing private keys',async()=>{
 let listed=0;
 const bucket={list:async()=>{listed++;return {objects:[],truncated:false};}} as unknown as R2Bucket;
 await assert.rejects(inventorySmartCaptureOrphans(mockDb(false),'synthetic:outsider',project,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',EVIDENCE_BUCKET:bucket}));
 assert.equal(listed,0);
});

test('SC-026 recent or undated objects are never flagged for deletion',async()=>{
 const fresh=smartCaptureQuarantineKey(project,id,'55555555-5555-4555-8555-555555555553');
 const unknown=smartCaptureQuarantineKey(project,id,'55555555-5555-4555-8555-555555555554');
 const bucket={list:async()=>({objects:[{key:fresh,uploaded:new Date()},{key:unknown}],truncated:false})} as unknown as R2Bucket;
 const result=await inventorySmartCaptureOrphans(mockDb(true),'synthetic:manager',project,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',EVIDENCE_BUCKET:bucket});
 assert.equal(result.orphanCandidates,0);
 assert.equal(result.tooRecent,2);
});
