import test from 'node:test';
import assert from 'node:assert/strict';
import {sealSmartCaptureProposal,openSmartCaptureProposal} from '../src/smart-capture-crypto';
const project='00000000-0000-4000-8000-000000000001',importId='00000000-0000-4000-8000-000000000002';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(29)));
test('SC-007 raw applicant proposals are encrypted and context-bound',async()=>{
 const input={applicant:{firstNames:'Synthetic',idNumber:'0000000000000'}};
 const encrypted=await sealSmartCaptureProposal(input,secret,project,importId);
 assert.ok(encrypted.startsWith('sc1.'));
 assert.equal(encrypted.includes('Synthetic'),false);
 assert.deepEqual(await openSmartCaptureProposal(encrypted,secret,project,importId),input);
 await assert.rejects(openSmartCaptureProposal(encrypted,secret,project,'00000000-0000-4000-8000-000000000003'));
});
test('SC-007 refuses invalid key and corrupted payloads',async()=>{
 await assert.rejects(sealSmartCaptureProposal({},'bad',project,importId));
 await assert.rejects(openSmartCaptureProposal('fake','bad',project,importId));
});
