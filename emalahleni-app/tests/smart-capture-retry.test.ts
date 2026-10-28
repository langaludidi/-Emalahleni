import test from 'node:test';
import assert from 'node:assert/strict';
import {retryDecision,retrySmartCaptureImport} from '../src/smart-capture-retry';
import type {Database} from '../src/database';
const project='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
test('SC-012 retry only transient failed imports below three attempts',()=>{
 assert.deepEqual(retryDecision('FAILED','SCANNER_UNAVAILABLE',2),{allowed:true,reason:null});
 assert.equal(retryDecision('FAILED','SCANNER_UNAVAILABLE',3).allowed,false);
 assert.equal(retryDecision('FAILED','DRIVE_SOURCE_MISMATCH',1).allowed,false);
 assert.equal(retryDecision('REJECTED','SCANNER_UNAVAILABLE',1).allowed,false);
 assert.equal(retryDecision('COMMIT_UNCERTAIN','SCANNER_UNAVAILABLE',1).allowed,false);
 assert.equal(retryDecision('COMMITTED','SCANNER_UNAVAILABLE',1).allowed,false);
});
test('SC-012 a failed transient import resets only through authenticated compare-and-set',async()=>{
 let writes=0;
 const db={forActor:async(_actor:string,queries:Array<{query:string}>)=>{
  if(queries[0].query.includes('SELECT i.state'))return [[{state:'FAILED',error_code:'SCANNER_UNAVAILABLE',attempt_count:1}]];
  writes++;assert.match(queries[0].query,/state='FAILED'/);
  assert.match(queries[0].query,/attempt_count<3/);
  return [[{id}]];
 }} as unknown as Database;
 const result=await retrySmartCaptureImport(db,'synthetic-actor',project,id,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true'});
 assert.deepEqual(result,{importId:id,state:'DISCOVERED',attemptCount:1});
 assert.equal(writes,1);
});
test('SC-012 a rejected import never becomes retryable',async()=>{
 let writes=0;
 const db={forActor:async()=>{
  writes++;return [[{state:'REJECTED',error_code:'SCANNER_UNAVAILABLE',attempt_count:1}]];
 }} as unknown as Database;
 await assert.rejects(retrySmartCaptureImport(db,'synthetic-actor',project,id,{
  SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true'}),{code:'IMPORT_NOT_FAILED'});
 assert.equal(writes,1);
});
