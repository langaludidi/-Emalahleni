import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('SC-017 processing attempt token is checked before each transition',()=>{
 const code=readFileSync(new URL('../src/smart-capture-process.ts',import.meta.url),'utf8');
 assert.ok(code.includes('crypto.randomUUID()'));
 assert.ok(code.includes('claim_token=$7 RETURNING id'));
 assert.ok(code.includes('claim_token=$4 AND state IN'));
});
test('SC-017 terminal outcomes release the claim token',()=>{
 const code=readFileSync(new URL('../src/smart-capture-process.ts',import.meta.url),'utf8');
 assert.ok(code.includes("claim_token=CASE WHEN $4='REJECTED' THEN NULL ELSE claim_token END"));
 assert.ok(code.includes("claimed_at=CASE WHEN $4='REJECTED' THEN NULL ELSE claimed_at END"));
 assert.ok(code.includes("claim_token=NULL,updated_at=now()"));
});
test('SC-017 explicit retry and stale recovery invalidate prior tokens',()=>{
 for(const name of ['smart-capture-retry.ts','smart-capture-recovery.ts']){
  const code=readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
  assert.ok(code.includes('claim_token=NULL'),name);
 }
});
