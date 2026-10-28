import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const example=readFileSync(new URL('../docs/smart-capture-queue-synthetic.example.jsonc',import.meta.url),'utf8');
const live=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
test('SC-028 synthetic Queue example has bounded retries and DLQ',()=>{
 assert.match(example,/"dead_letter_queue":\s*"vectra-smart-capture-synthetic-test-dlq"/);
 assert.match(example,/"max_batch_size":\s*1/);
 assert.match(example,/"max_retries":\s*3/);
 assert.match(example,/"max_concurrency":\s*1/);
});
test('SC-028 all example flags are disabled and production config is unchanged',()=>{
 for(const flag of ['SMART_CAPTURE_ENABLED','SMART_CAPTURE_PROCESSING_ENABLED','SMART_CAPTURE_QUEUE_ENABLED']){
  assert.match(example,new RegExp('"'+flag+'":\\s*"false"'));
  assert.equal(live.includes('"'+flag+'"'),false);
 }
 assert.equal(live.includes('vectra-smart-capture-synthetic-test'),false);
});
