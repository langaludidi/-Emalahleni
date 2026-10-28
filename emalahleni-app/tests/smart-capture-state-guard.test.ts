import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(
 new URL('../migrations/20261027_smart_capture_state_guard_DRAFT.sql',import.meta.url),'utf8'
);
test('SC-020 guards insert and update with one database trigger',()=>{
 assert.match(migration,/BEFORE INSERT OR UPDATE ON public\.smart_capture_imports/);
 assert.match(migration,/SMART_CAPTURE_INVALID_INITIAL_STATE/);
 assert.match(migration,/SMART_CAPTURE_SOURCE_IMMUTABLE/);
});
test('SC-020 rejects invalid transitions and stale-claim races',()=>{
 assert.match(migration,/SMART_CAPTURE_INVALID_STATE_TRANSITION/);
 assert.match(migration,/SMART_CAPTURE_RETRY_NOT_ALLOWED/);
 assert.match(migration,/SMART_CAPTURE_CLAIM_FENCE_CHANGED/);
 assert.match(migration,/NEW\.claim_token IS DISTINCT FROM OLD\.claim_token/);
});
test('SC-020 preserves legitimate quarantine and manual review transitions',()=>{
 assert.match(migration,/OLD\.state='FETCHING' AND NEW\.state='QUARANTINED'/);
 assert.match(migration,/OLD\.state='SCANNING' AND NEW\.state IN \('EXTRACTING','REJECTED'\)/);
 assert.match(migration,/OLD\.state='EXTRACTING' AND NEW\.state='NEEDS_REVIEW'/);
 assert.match(migration,/OLD\.state='NEEDS_REVIEW'/);
});
