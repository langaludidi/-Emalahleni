import test from 'node:test';
import assert from 'node:assert/strict';
import syntheticWorker,{checkSyntheticDatabaseUrl,probeSyntheticNeon} from '../src/smart-capture-synthetic-neon-worker';

test('SC-031 rejects owner credentials and non-Neon hosts',()=>{
 assert.throws(()=>checkSyntheticDatabaseUrl(
  'postgresql://vectra_preview_owner:fake@synthetic.neon.tech/vectra_preview?sslmode=require'));
 assert.throws(()=>checkSyntheticDatabaseUrl(
  'postgresql://vectra_sc_synthetic_limited:fake@not-neon.example/vectra_preview?sslmode=require'));
 assert.throws(()=>checkSyntheticDatabaseUrl(
  'postgresql://vectra_sc_synthetic_limited:fake@synthetic.neon.tech/vectra_preview'));
 assert.throws(()=>checkSyntheticDatabaseUrl(
  'postgresql://vectra_sc_synthetic_limited:fake@synthetic.neon.tech/production?sslmode=require'));
 assert.equal(checkSyntheticDatabaseUrl(
  'postgresql://vectra_sc_synthetic_limited:fake@synthetic.neon.tech/vectra_preview?sslmode=require'),
  'postgresql://vectra_sc_synthetic_limited:fake@synthetic.neon.tech/vectra_preview?sslmode=require');
});
test('SC-031 probe requires explicit test feature flag before DB access',async()=>{
 await assert.rejects(probeSyntheticNeon({}));
 await assert.rejects(probeSyntheticNeon({SYNTHETIC_NEON_PROBE_ENABLED:'true'}));
});
test('SC-031 invalid queue payloads do not access Neon',async()=>{
 let acknowledged=0,retried=0;
 const batch={messages:[{body:{schema:1,projectId:'synthetic',importId:'synthetic'},
  ack:()=>acknowledged++,retry:()=>retried++}]} as never;
 await syntheticWorker.queue(batch,{});
 assert.equal(acknowledged,1);
 assert.equal(retried,0);
});
test('SC-031 failed synthetic probe goes to bounded queue retry',async()=>{
 let acknowledged=0,retried=0;
 const batch={messages:[{body:{type:'SMART_CAPTURE_SYNTHETIC_NEON_PROBE',synthetic:true},
  ack:()=>acknowledged++,retry:()=>retried++}]} as never;
 await syntheticWorker.queue(batch,{SYNTHETIC_NEON_PROBE_ENABLED:'false'});
 assert.equal(acknowledged,0);
 assert.equal(retried,1);
});
test('SC-031 HTTP endpoint returns no database details',async()=>{
 const result=await syntheticWorker.fetch();
 const body=await result.text();
 assert.equal(result.status,200);
 assert.doesNotMatch(body,/password|neon\.tech|application_id/i);
});
