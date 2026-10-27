import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDisposition,reconcileStaleSmartCaptureImports} from '../src/smart-capture-recovery';
import type {Database} from '../src/database';
const project='00000000-0000-4000-8000-000000000001';
test('SC-015 only stale active imports need reconciliation',()=>{
 assert.equal(recoveryDisposition('SCANNING',31),'MANUAL_REVIEW');
 assert.equal(recoveryDisposition('EXTRACTING',30),'MANUAL_REVIEW');
 assert.equal(recoveryDisposition('FETCHING',29),'IGNORE');
 assert.equal(recoveryDisposition('COMMITTING',1000),'IGNORE');
 assert.equal(recoveryDisposition('COMMIT_UNCERTAIN',1000),'IGNORE');
 assert.equal(recoveryDisposition('COMMITTED',1000),'IGNORE');
 assert.equal(recoveryDisposition('REJECTED',1000),'IGNORE');
});
test('SC-015 feature-disabled recovery never touches the database',async()=>{
 let calls=0;const db={forActor:async()=>{calls++;return [[]];}} as unknown as Database;
 await assert.rejects(reconcileStaleSmartCaptureImports(db,'actor',project,{}),
  {code:'SMART_CAPTURE_PROCESSING_DISABLED'});
 assert.equal(calls,0);
});
test('SC-015 stale claim recovery is capped, scoped and never auto-requeues',async()=>{
 let sql='';
 const db={forActor:async(_actor:string,queries:Array<{query:string;params?:unknown[]}>)=>{
  sql=queries[0].query;assert.deepEqual(queries[0].params,[project,'actor']);
  return [[{id:'00000000-0000-4000-8000-000000000002'}]];
 }} as unknown as Database;
 const result=await reconcileStaleSmartCaptureImports(db,'actor',project,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true'});
 assert.equal(result.markedForReview,1);
 assert.match(sql,/LIMIT 20 FOR UPDATE SKIP LOCKED/);
 assert.match(sql,/STALE_CLAIM_REQUIRES_REVIEW/);
 assert.match(sql,/IN \('ADMIN','MANAGER'\)/);
 assert.doesNotMatch(sql,/state='DISCOVERED'/);
});
