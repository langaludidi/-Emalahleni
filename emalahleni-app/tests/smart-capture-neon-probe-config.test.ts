import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const probe=readFileSync(new URL('../wrangler.smart-capture-neon-probe.jsonc',import.meta.url),'utf8');
const existing=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');

test('SC-032 isolated probe has a different Worker and queue from all existing workloads',()=>{
 assert.match(probe,/"name":\s*"vectra-smart-capture-neon-probe"/);
 assert.match(probe,/"queue":\s*"vectra-smart-capture-neon-probe-test"/);
 assert.match(probe,/"dead_letter_queue":\s*"vectra-smart-capture-neon-probe-test-dlq"/);
 assert.equal(probe.includes('vectra-smart-capture-synthetic-test"'),false);
 assert.equal(probe.includes('"emalahleni-api-staging"'),false);
 assert.equal(existing.includes('vectra-smart-capture-neon-probe'),false);
});
test('SC-032 standalone probe is disabled by default and has no beneficiary bindings',()=>{
 assert.match(probe,/"SYNTHETIC_NEON_PROBE_ENABLED":\s*"false"/);
 assert.match(probe,/"workers_dev":\s*false/);
 assert.match(probe,/"max_batch_size":\s*1/);
 assert.match(probe,/"max_retries":\s*3/);
 assert.match(probe,/"max_concurrency":\s*1/);
 for(const forbidden of ['DATABASE_URL','SYNTHETIC_NEON_DATABASE_URL"','FORM_ENCRYPTION_KEY','EVIDENCE_BUCKET','SCANNER_CONTAINER','SMART_CAPTURE_DRIVE_PRIVATE_KEY']){
  assert.equal(probe.includes(forbidden),false);
 }
});
