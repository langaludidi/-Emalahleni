import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSmartCaptureBatch} from '../src/smart-capture-batch';
const id1='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002';
test('SC-013 batch planner orders oldest first and deduplicates IDs',()=>{
 assert.deepEqual(selectSmartCaptureBatch([
  {id:id2,state:'DISCOVERED',attemptCount:0,createdAt:'2026-10-27T12:00:00Z'},
  {id:id1,state:'DISCOVERED',attemptCount:0,createdAt:'2026-10-27T10:00:00Z'},
  {id:id1,state:'DISCOVERED',attemptCount:0,createdAt:'2026-10-27T10:00:00Z'},
 ],2),[id1,id2]);
});
test('SC-013 never batches failed, committed or exhausted imports',()=>{
 assert.deepEqual(selectSmartCaptureBatch([
  {id:id1,state:'FAILED',attemptCount:1,createdAt:'2026-10-27'},
  {id:id2,state:'DISCOVERED',attemptCount:3,createdAt:'2026-10-27'},
 ]),[]);
});
test('SC-013 batch is strictly capped',()=>{
 assert.throws(()=>selectSmartCaptureBatch([],11),/BATCH_LIMIT_INVALID/);
});
