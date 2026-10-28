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

test('SC-027 enabled consumer acknowledges successful synthetic processing',async()=>{
 let acked=0,retried=0,processed=0;
 const batch={messages:[{
  body:{schema:1,projectId:project,importId:id,actorId:'synthetic'},
  ack:()=>{acked++;},retry:()=>{retried++;}
 }]} as never;
 await consumeSmartCaptureBatch(batch,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
  SMART_CAPTURE_QUEUE_ENABLED:'true',DATABASE_URL:'postgresql://emalahleni_worker:synthetic@synthetic.neon.tech/synthetic?sslmode=require'
 } as never,async()=>{processed++;return {state:'NEEDS_REVIEW'} as never;});
 assert.equal(processed,1);assert.equal(acked,1);assert.equal(retried,0);
});
test('SC-027 malformed queue messages never invoke the processor',async()=>{
 let processed=0,acked=0;
 const batch={messages:[{body:{schema:1,projectId:project,importId:id,actorId:'synthetic',pdf:'secret'},ack:()=>{acked++;}}]} as never;
 await consumeSmartCaptureBatch(batch,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
  SMART_CAPTURE_QUEUE_ENABLED:'true',DATABASE_URL:'postgresql://emalahleni_worker:synthetic@synthetic.neon.tech/synthetic?sslmode=require'
 } as never,async()=>{processed++;return {} as never;});
 assert.equal(processed,0);assert.equal(acked,1);
});
test('SC-027 duplicate atomic-claim denials are acknowledged, not replayed',async()=>{
 let acked=0,retried=0;
 const batch={messages:[{body:{schema:1,projectId:project,importId:id,actorId:'synthetic'},
  ack:()=>{acked++;},retry:()=>{retried++;}}]} as never;
 await consumeSmartCaptureBatch(batch,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
  SMART_CAPTURE_QUEUE_ENABLED:'true',DATABASE_URL:'postgresql://emalahleni_worker:synthetic@synthetic.neon.tech/synthetic?sslmode=require'
 } as never,async()=>{throw Object.assign(new Error('duplicate'),{code:'SMART_CAPTURE_CLAIM_DENIED'});});
 assert.equal(acked,1);assert.equal(retried,0);
});
