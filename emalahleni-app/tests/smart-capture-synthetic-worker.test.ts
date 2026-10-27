import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../docs/smart-capture-synthetic-worker.ts',import.meta.url),'utf8');
test('SC-029 dashboard test Worker only acknowledges explicit synthetic test payloads',()=>{
 assert.match(worker,/SMART_CAPTURE_SYNTHETIC_TEST/);
 assert.match(worker,/synthetic===true/);
 assert.match(worker,/message\.ack\(\)/);
 assert.equal(worker.includes('SMART_CAPTURE_SYNTHETIC_DLQ_TEST'),false);
 assert.equal(worker.includes('message.retry('),false);
});
test('SC-029 dashboard Worker contains no database, Drive or document-processing bindings',()=>{
 for(const forbidden of ['DATABASE_URL','SMART_CAPTURE_ENCRYPTION_KEY','EVIDENCE_BUCKET','googleapis.com','processSmartCaptureImport','SMART_CAPTURE_DRIVE_PRIVATE_KEY'])
  assert.equal(worker.includes(forbidden),false,'Dashboard Worker must not reference '+forbidden);
});
