import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeSmartCaptureBatch,enqueueSmartCaptureImport} from '../src/smart-capture-queue';
import type {Database} from '../src/database';
import type {ProcessingEnv} from '../src/smart-capture-process';
const project='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
test('SC-014 disabled queue refuses enqueue before database writes',async()=>{
 let touched=false;
 const db={forActor:async()=>{touched=true;return [[]];}} as unknown as Database;
 await assert.rejects(enqueueSmartCaptureImport(db,'synthetic',project,id,{}),{code:'SMART_CAPTURE_QUEUE_DISABLED'});
 assert.equal(touched,false);
});
test('SC-014 enqueues only project/import IDs and actor, never OCR or PDF bytes',async()=>{
 let payload:unknown;
 const db={forActor:async()=>[[{id}]]} as unknown as Database;
 const result=await enqueueSmartCaptureImport(db,'synthetic',project,id,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',SMART_CAPTURE_QUEUE_ENABLED:'true',
  SMART_CAPTURE_QUEUE:{send:async(m:unknown)=>{payload=m;}} as never
 });
 assert.equal(result.state,'QUEUED');
 assert.deepEqual(payload,{schema:1,projectId:project,importId:id,actorId:'synthetic'});
});
test('SC-014 disabled consumer requests delayed retry rather than dropping jobs',async()=>{
 let retried=0,acked=0;
 const batch={messages:[{body:{},retry:()=>{retried++;},ack:()=>{acked++;}}]} as never;
 await consumeSmartCaptureBatch(batch,{} as ProcessingEnv);
 assert.equal(retried,1);assert.equal(acked,0);
});
