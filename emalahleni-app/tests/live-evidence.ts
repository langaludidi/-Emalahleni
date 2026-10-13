// Uses real PostgreSQL RLS on a disposable branch; R2/scanner are explicit test doubles.
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {createHandler,type Env} from '../src/worker';import {blankForm} from '../src/contracts';import {digest} from '../src/evidence';
const url=new URL(readFileSync('/workspace/emalahleni-stage8/.env.worker','utf8').trim().slice('DATABASE_URL='.length));url.hostname='ep-square-bread-za3vo1pp.c-2.eu-west-2.aws.neon.tech';
const objects=new Map<string,Uint8Array>();let verdict='CLEAN';let offline=false;
const env:Env={DATABASE_URL:url.href,FORM_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),ENABLE_CASE_API:'true',ENABLE_DOCUMENT_UPLOADS:'true',SCANNER_TOKEN:'synthetic-secret',
 EVIDENCE_BUCKET:{put:async(k:string,bytes:Uint8Array)=>{objects.set(k,new Uint8Array(bytes));},get:async(k:string)=>{const bytes=objects.get(k);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}} as any,
 SCANNER:{fetch:async(r:Request)=>{if(offline)throw Error('offline');return Response.json({sha256:await digest(new Uint8Array(await r.arrayBuffer())),verdict});}} as any};
const handler=createHandler(async r=>r.headers.get('Test-Actor')??'unknown');
async function call(actor:string,path:string,method='GET',data?:unknown,raw=false){const response=await handler(new Request('https://test.example'+path,{method,headers:{'Test-Actor':actor,'Content-Type':raw?'application/pdf':'application/json'},...(data===undefined?{}:{body:raw?new Uint8Array(data as Uint8Array).buffer:JSON.stringify(data)})}),env);const result=response.headers.get('Content-Type')?.includes('json')?await response.json():await response.arrayBuffer();return {status:response.status,result:result as any};}
const project='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const created=await call('synthetic-officer-a',`/api/projects/${project}/applications`,'POST',{reference:'SYN-EVIDENCE-'+crypto.randomUUID().slice(0,8).toUpperCase(),form:blankForm()});assert.equal(created.status,201,JSON.stringify(created));const root=`/api/projects/${project}/applications/${created.result.id}`;
const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic fixture');const hash=await digest(bytes);
async function intent(){const r=await call('synthetic-officer-a',root+'/evidence','POST',{kind:'APPLICANT_ID',filename:'synthetic.pdf',contentType:'application/pdf',size:bytes.length,sha256:hash,dependantOrdinal:null});assert.equal(r.status,201,JSON.stringify(r));return r.result;}
const clean=await intent();assert.equal((await call('synthetic-officer-b',clean.uploadPath,'PUT',bytes,true)).status,403);
assert.equal((await call('synthetic-officer-a',clean.uploadPath,'PUT',new TextEncoder().encode('wrong'),true)).status,400);
const uploaded=await call('synthetic-officer-a',clean.uploadPath,'PUT',bytes,true);assert.equal(uploaded.status,200,JSON.stringify(uploaded));assert.equal(uploaded.result.status,'PENDING_REVIEW');
assert.equal((await call('synthetic-officer-a',clean.uploadPath,'PUT',bytes,true)).status,409);
const review={decision:'VERIFIED',note:'Synthetic identity review',documentSubtype:'ID_COPY',documentDate:null,certificationConfirmed:true,contentConfirmed:true};
assert.equal((await call('synthetic-officer-a',root+`/evidence/${clean.id}/review`,'PUT',review)).status,403);
assert.equal((await call('synthetic-assessor-a',root+`/evidence/${clean.id}/review`,'PUT',{...review,certificationConfirmed:false})).status,409);
assert.equal((await call('synthetic-assessor-a',root+`/evidence/${clean.id}/review`,'PUT',review)).status,200);
assert.equal((await call('synthetic-officer-a',root+`/evidence/${clean.id}/download`)).status,200);
assert.equal((await call('synthetic-officer-b',root+`/evidence/${clean.id}/download`)).status,404);
offline=true;const failed=await intent();const failResult=await call('synthetic-officer-a',failed.uploadPath,'PUT',bytes,true);assert.equal(failResult.result.status,'PENDING_SCAN');
assert.equal((await call('synthetic-officer-a',root+`/evidence/${failed.id}/download`)).status,404);
assert.equal((await call('synthetic-assessor-a',root+`/evidence/${failed.id}/review`,'PUT',review)).status,409);
offline=false;assert.equal((await call('synthetic-officer-a',root+`/evidence/${failed.id}/scan`,'POST')).result.status,'PENDING_REVIEW');
verdict='INFECTED';const infected=await intent();const rejected=await call('synthetic-officer-a',infected.uploadPath,'PUT',bytes,true);assert.equal(rejected.result.status,'REJECTED');assert.equal((await call('synthetic-officer-a',root+`/evidence/${infected.id}/download`)).status,404);
const dept=root+'/dohs/SECTION_E';const first=await call('synthetic-reviewer-a',dept,'PUT',{state:'PENDING',note:'Synthetic initial departmental note',expectedReviewedAt:null});assert.equal(first.status,200,JSON.stringify(first));
assert.equal((await call('synthetic-reviewer-a',dept,'PUT',{state:'COMPLETE',note:'Synthetic stale departmental note',expectedReviewedAt:null})).status,409);
assert.equal((await call('synthetic-reviewer-a',dept,'PUT',{state:'COMPLETE',note:'Synthetic approved departmental note',expectedReviewedAt:first.result.reviewed_at})).status,200);
console.log('PASS: upload integrity and replay controls, cross-project denial, clean scan plus authorised review, certification gate, scanner outage quarantine/retry, infected download denial, and DoHS optimistic concurrency.');
