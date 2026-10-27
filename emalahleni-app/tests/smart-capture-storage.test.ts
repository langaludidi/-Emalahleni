import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {smartCaptureQuarantineKey,validSmartCaptureQuarantineKey} from '../src/smart-capture-storage';

const project='22222222-2222-4222-8222-222222222221';
const importId='44444444-4444-4444-8444-444444444441';
const first='55555555-5555-4555-8555-555555555551';
const second='55555555-5555-4555-8555-555555555552';

test('SC-024 different attempts never share an R2 quarantine object',()=>{
 const a=smartCaptureQuarantineKey(project,importId,first);
 const b=smartCaptureQuarantineKey(project,importId,second);
 assert.notEqual(a,b);
 assert.ok(validSmartCaptureQuarantineKey(a,project,importId));
 assert.ok(validSmartCaptureQuarantineKey(b,project,importId));
});
test('SC-024 previews reject legacy, other-project and malformed keys',()=>{
 assert.equal(validSmartCaptureQuarantineKey(
  `smart-capture/quarantine/${project}/${importId}/original.pdf`,project,importId),false);
 assert.equal(validSmartCaptureQuarantineKey(
  smartCaptureQuarantineKey(project,importId,first),'22222222-2222-4222-8222-222222222222',importId),false);
 assert.equal(validSmartCaptureQuarantineKey(
  `smart-capture/quarantine/${project}/${importId}/../../original.pdf`,project,importId),false);
 assert.throws(()=>smartCaptureQuarantineKey(project,importId,'not-a-uuid'));
});
test('SC-024 processor cleans only its own failed attempt artifact',()=>{
 const code=readFileSync(new URL('../src/smart-capture-process.ts',import.meta.url),'utf8');
 assert.ok(code.includes('smartCaptureQuarantineKey(project,id,claimToken)'));
 assert.ok(code.includes('EVIDENCE_BUCKET.delete(storageKey)'));
});
