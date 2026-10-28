import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const guard=readFileSync(
 new URL('../migrations/20261027_smart_capture_proposal_guard_DRAFT.sql',import.meta.url),'utf8'
);
test('SC-021 extraction proposal requires active, actor-owned claim',()=>{
 assert.match(guard,/i\.state='EXTRACTING' AND i\.claimed_by=actor/);
 assert.match(guard,/i\.claim_token IS NOT NULL/);
 assert.match(guard,/SMART_CAPTURE_PROPOSAL_INSERT_DENIED/);
});
test('SC-021 edits require human-review state and optimistic revision',()=>{
 assert.match(guard,/i\.state='NEEDS_REVIEW'/);
 assert.match(guard,/NEW\.review_version<>OLD\.review_version\+1/);
 assert.match(guard,/NEW\.reviewed_by IS DISTINCT FROM actor/);
 assert.match(guard,/SMART_CAPTURE_PROPOSAL_UPDATE_DENIED/);
});
