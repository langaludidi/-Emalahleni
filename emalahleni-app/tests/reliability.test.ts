import test from 'node:test';
import assert from 'node:assert/strict';
import {neonConfig} from '@neondatabase/serverless';
import {limitActorAction,type RateLimitEnv} from '../src/rate-limit';
import {handle,createHandler} from '../src/worker';
import {blankForm} from '../src/contracts';
import {Database} from '../src/database';
import {digest,scanResult,upload,type EvidenceEnv} from '../src/evidence';

const uuid='10000000-0000-4000-8000-000000000001';
const url=`https://app.example/api/projects/${uuid}/applications/${uuid}/evidence/${uuid}/scan`;
const connection='postgresql://emalahleni_worker:synthetic@ep-test.neon.tech/vectra_ci?sslmode=require';
const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic concurrency check');
const token='synthetic-private-scanner-token-00000000';

test('API rate rejection occurs before authentication or data access, preserves no-store and supplies Retry-After',async()=>{
 let authenticated=0;const keys:string[]=[];
 const app=createHandler(async()=>{authenticated++;return 'actor';});
 const response=await app(new Request(url,{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':'other'}}),{ENABLE_API_RATE_LIMITS:'true',API_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:false};}}});
 assert.equal(response.status,429);assert.equal(authenticated,0);assert.deepEqual(await response.json(),{error:'TOO_MANY_REQUESTS'});
 assert.equal(response.headers.get('Retry-After'),'60');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(keys[0],/^[a-f0-9]{64}$/);
 for(const binding of [undefined,{limit:async()=>{throw Error('private provider message');}}]){
  const unavailable=await handle(new Request('https://app.example/api/preview',{method:'POST'}),{ENABLE_API_RATE_LIMITS:'true',API_RATE_LIMITER:binding});
  assert.equal(unavailable.status,503);assert.equal((await unavailable.text()).includes('private provider'),false);
 }
 assert.equal((await handle(new Request('https://app.example/healthz'),{ENABLE_API_RATE_LIMITS:'true'})).status,200);
});

test('API quotas cannot be reset by forwarded headers; actor writes and scans use separate quotas',async()=>{
 const publicKeys:string[]=[];const env={ENABLE_API_RATE_LIMITS:'true',API_RATE_LIMITER:{limit:async({key}:{key:string})=>{publicKeys.push(key);return {success:true};}}};
 for(const forwarded of ['192.0.2.2','192.0.2.3']){
  const response=await handle(new Request('https://app.example/api/preview',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':forwarded,'Content-Type':'application/json'},body:JSON.stringify(blankForm())}),env);
  assert.equal(response.status,200);
 }
 assert.equal(publicKeys[0],publicKeys[1]);
 const writes:string[]=[],documents:string[]=[];
 const scoped:RateLimitEnv={ENABLE_API_RATE_LIMITS:'true',WRITE_RATE_LIMITER:{limit:async({key})=>{writes.push(key);return {success:true};}},DOCUMENT_RATE_LIMITER:{limit:async({key})=>{documents.push(key);return {success:true};}}};
 await limitActorAction(new Request(url,{method:'GET'}),scoped,'actor-a');assert.equal(writes.length,0);
 await limitActorAction(new Request(url,{method:'POST'}),scoped,'actor-a');
 await limitActorAction(new Request(url.replace(/\/scan$/,'/upload'),{method:'PUT'}),scoped,'actor-a');
 await limitActorAction(new Request(url,{method:'POST'}),scoped,'actor-b');
 assert.equal(writes[0],writes[1]);assert.equal(documents[0],documents[1]);assert.notEqual(writes[0],writes[2]);assert.notEqual(documents[0],documents[2]);assert.notEqual(writes[0],documents[0]);
 scoped.DOCUMENT_RATE_LIMITER={limit:async()=>({success:false})};
 await assert.rejects(limitActorAction(new Request(url,{method:'POST'}),scoped,'actor-a'),(e:any)=>e.status===429);
});

test('scanner retries only transient failures, honors Retry-After, grows backoff and keeps one total deadline',async t=>{
 const waits:number[]=[],deadlines:number[]=[];const timeout=setTimeout,abortTimeout=AbortSignal.timeout;
 t.mock.method(Math,'random',()=>0);
 t.mock.method(globalThis,'setTimeout',((fn:()=>void,ms:number)=>{waits.push(ms);return timeout(fn,0);}) as typeof setTimeout);
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{deadlines.push(ms);return abortTimeout(ms);});
 const hash=await digest(bytes);let attempts=0;
 const env:EvidenceEnv={SCANNER_TOKEN:token,SCANNER:{fetch:async()=>{
  attempts++;return attempts===1?Response.json({error:'SCANNER_BUSY'},{status:429,headers:{'Retry-After':'1'}}):attempts===2?Response.json({error:'SCAN_UNAVAILABLE'},{status:503}):Response.json({sha256:hash,verdict:'CLEAN'});
 }} as unknown as Fetcher};
 assert.deepEqual(await scanResult(bytes,hash,env),{verdict:'CLEAN'});assert.equal(attempts,3);assert.deepEqual(waits,[1000,1000]);assert.deepEqual(deadlines,[120000]);
 waits.length=0;attempts=0;
 env.SCANNER={fetch:async()=>{attempts++;throw Error('temporary connection failure');}} as unknown as Fetcher;
 assert.deepEqual(await scanResult(bytes,hash,env),{verdict:'SCAN_FAILED',failure:'CONNECTION'});assert.equal(attempts,3);assert.deepEqual(waits,[500,1000]);
 for(const [status,value,expected] of [[401,{},'CREDENTIALS'],[200,{verdict:'CLEAN',sha256:'wrong'},'HASH_MISMATCH'],[503,{error:'SIGNATURES_NOT_READY'},'SIGNATURES_NOT_READY']] as const){
  attempts=0;env.SCANNER={fetch:async()=>{attempts++;return Response.json(value,{status});}} as unknown as Fetcher;
  assert.deepEqual(await scanResult(bytes,hash,env),{verdict:'SCAN_FAILED',failure:expected});assert.equal(attempts,1);
 }
 attempts=0;env.SCANNER={fetch:async()=>{attempts++;return Response.json({error:'SCANNER_BUSY'},{status:429,headers:{'Retry-After':'300'}});}} as unknown as Fetcher;
 assert.deepEqual(await scanResult(bytes,hash,env),{verdict:'SCAN_FAILED',failure:'BUSY'});assert.equal(attempts,1);
});

test('upload claims are exclusive and transient scan retries never repeat storage writes',async t=>{
 const timeout=setTimeout;t.mock.method(globalThis,'setTimeout',((fn:()=>void)=>timeout(fn,0)) as typeof setTimeout);
 const hash=await digest(bytes);let claimed=false,puts=0,scans=0,release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const db={forActor:async(_actor:string,statements:{query:string;params?:unknown[]}[])=>{
  const {query,params=[]}=statements[0];
  if(query.startsWith('SELECT 1 FROM'))return [[{allowed:1}]];
  if(query.startsWith('SELECT e.storage_key'))return [[{storage_key:'synthetic/key',expected_size:bytes.length,expected_sha256:hash,expected_content_type:'application/pdf'}]];
  if(query.startsWith('UPDATE public.evidence SET status=')){
   assert.match(query,/AND status='PENDING_UPLOAD' AND/);assert.equal(query.includes(' OR '),false);
   if(claimed)return [[]];claimed=true;return [[{id:uuid}]];
  }
  if(query.startsWith('UPDATE public.evidence SET uploaded_at'))return [[]];
  if(query.startsWith('WITH scanned AS'))return [[{id:uuid,status:params[5],malware_status:params[4]}]];
  throw Error('unexpected statement');
 }} as unknown as Database;
 const env:EvidenceEnv={ENABLE_DOCUMENT_UPLOADS:'true',SCANNER_TOKEN:token,EVIDENCE_BUCKET:{put:async()=>{puts++;entered();await gate;}} as unknown as R2Bucket,SCANNER:{fetch:async()=>{scans++;return scans===1?Response.json({error:'SCANNER_BUSY'},{status:429}):Response.json({sha256:hash,verdict:'CLEAN'});}} as unknown as Fetcher};
 const input=()=>new Request(url,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes).buffer});
 const first=upload(db,'actor',uuid,uuid,uuid,input(),env);await started;
 await assert.rejects(upload(db,'actor',uuid,uuid,uuid,input(),env),(e:any)=>e.code==='UPLOAD_ALREADY_CLAIMED');
 release();const result=await first;assert.equal(result.status,'PENDING_REVIEW');assert.equal(puts,1);assert.equal(scans,2);
});

test('storage failure releases only an unfinished matching claim and does not call the scanner',async()=>{
 const hash=await digest(bytes),queries:string[]=[];let scans=0;
 const db={forActor:async(_actor:string,statements:{query:string}[])=>{
  const query=statements[0].query;queries.push(query);
  if(query.startsWith('SELECT 1 FROM'))return [[{allowed:1}]];
  if(query.startsWith('SELECT e.storage_key'))return [[{storage_key:'synthetic/key',expected_size:bytes.length,expected_sha256:hash,expected_content_type:'application/pdf'}]];
  if(query.includes("SET status='PENDING_SCAN'"))return [[{id:uuid}]];
  return [[]];
 }} as unknown as Database;
 const env:EvidenceEnv={ENABLE_DOCUMENT_UPLOADS:'true',SCANNER_TOKEN:token,EVIDENCE_BUCKET:{put:async()=>{throw Error('synthetic R2 failure');}} as unknown as R2Bucket,SCANNER:{fetch:async()=>{scans++;return new Response();}} as unknown as Fetcher};
 await assert.rejects(upload(db,'actor',uuid,uuid,uuid,new Request(url,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes).buffer}),env),(e:any)=>e.code==='STORAGE_UNAVAILABLE');
 assert.equal(scans,0);assert.match(queries.at(-1)!,/status='PENDING_SCAN' AND uploaded_at IS NULL AND sha256=\$4/);
});

test('database actor context and deadline settings remain local to the same bounded transaction',async()=>{
 const prior=neonConfig.fetchFunction;const batches:any[]=[];
 neonConfig.fetchFunction=async(_url:unknown,options:any)=>{const payload=JSON.parse(options.body);batches.push({payload,options});return Response.json({results:payload.queries.map(()=>({fields:[],rows:[]}))});};
 try{
  assert.deepEqual(await new Database(connection).forActor('actor-a',[{query:'SELECT 1'}],true),[[]]);
  assert.equal(batches.length,1);const {payload,options}=batches[0];
  assert.equal(payload.queries.length,3);assert.deepEqual(payload.queries[0].params,['actor-a']);assert.match(payload.queries[0].query,/set_config\('app.actor_id', \$1, true\)/);
  assert.match(payload.queries[1].query,/statement_timeout.*15000.*true.*lock_timeout.*5000.*true/);
  assert.equal(options.signal instanceof AbortSignal,true);assert.equal(options.headers['Neon-Batch-Read-Only'],'true');assert.equal(options.headers['Neon-Batch-Isolation-Level'],'RepeatableRead');
 }finally{neonConfig.fetchFunction=prior;}
});
