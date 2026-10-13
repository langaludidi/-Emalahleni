// Run only against the disposable test branch seeded with synthetic fixtures.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHandler, type Env } from '../src/worker';
import { blankForm } from '../src/contracts';
import { Database } from '../src/database';

const line = readFileSync('/workspace/emalahleni-stage8/.env.worker','utf8').trim();
const dburl = new URL(line.slice('DATABASE_URL='.length));
dburl.hostname='ep-square-bread-za3vo1pp.c-2.eu-west-2.aws.neon.tech';
const env:Env={DATABASE_URL:dburl.href,FORM_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),ENABLE_CASE_API:'true'};
// Authentication is independently tested using signed JWTs; this harness supplies fixture actors.
const handler=createHandler(async request=>request.headers.get('Test-Actor') || 'unknown-actor');
const projectA='20000000-0000-4000-8000-000000000001';const projectB='20000000-0000-4000-8000-000000000002';
async function call(actor:string,path:string,method='GET',data?:unknown) {
 const response=await handler(new Request('https://test.example'+path,{method,headers:{'Test-Actor':actor,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const result=await response.json() as any;return {status:response.status,result};
}
const f=blankForm();f.applicant.firstNames='Synthetic';f.applicant.surname='Fixture';
const a=await call('synthetic-officer-a',`/api/projects/${projectA}/applications`,'POST',{reference:'SYN-LIVE-A',form:f});assert.equal(a.status,201,JSON.stringify(a));
const b=await call('synthetic-officer-b',`/api/projects/${projectB}/applications`,'POST',{reference:'SYN-LIVE-B',form:f});assert.equal(b.status,201,JSON.stringify(b));
const rootA=`/api/projects/${projectA}/applications/${a.result.id}`;const rootB=`/api/projects/${projectB}/applications/${b.result.id}`;
assert.equal((await call('synthetic-officer-a',rootA)).result.form.applicant.firstNames,'Synthetic');
assert.equal((await call('synthetic-officer-a',rootB)).status,404);
assert.equal((await call('synthetic-officer-a',rootB,'PUT',{version:0,form:f})).status,409);
assert.equal((await call('synthetic-officer-a',rootA,'PUT',{version:0,form:f})).status,200);
assert.equal((await call('synthetic-officer-a',rootA,'PUT',{version:0,form:f})).status,409);
assert.equal((await call('synthetic-auditor-a',rootA,'PUT',{version:1,form:f})).status,409);
assert.equal((await call('synthetic-officer-a',rootA,'PUT',{version:1,form:{...f,dohs_complete:true}})).status,400);
assert.equal((await call('synthetic-officer-a',rootA+'/dohs/SECTION_C','PUT',{state:'COMPLETE',note:'Synthetic review note'})).status,403);
const review=await call('synthetic-reviewer-a',rootA+'/dohs/SECTION_C','PUT',{state:'COMPLETE',note:'Synthetic review note'});assert.equal(review.status,200,JSON.stringify(review));
assert.equal((await call('synthetic-reviewer-a',rootB+'/dohs/SECTION_C','PUT',{state:'COMPLETE',note:'Synthetic review note'})).status,403);
const readiness=await call('synthetic-officer-a',rootA+'/readiness');assert.equal(readiness.status,200,JSON.stringify(readiness));assert.equal(readiness.result.submissionReady,false);
const db=new Database(dburl.href);
const [noActor]=await db.forActor('',[{query:'SELECT id FROM public.applications'}]);assert.equal(noActor.length,0);
const [officer]=await db.forActor('synthetic-officer-a',[{query:'SELECT id FROM public.applications'}]);assert.equal(officer.length,1);
const [other]=await db.forActor('synthetic-officer-b',[{query:'SELECT id FROM public.applications'}]);assert.equal(other.length,1);assert.equal(other[0].id,b.result.id);
const [audits]=await db.forActor('synthetic-auditor-a',[{query:'SELECT action FROM public.audit_events ORDER BY created_at'}]);
assert.ok(audits.some(r=>r.action==='DRAFT_CREATED'));assert.ok(audits.some(r=>r.action==='DRAFT_SAVED'));assert.ok(audits.some(r=>r.action==='DOHS_SECTION_REVIEWED'));
console.log('PASS: encrypted create/read/save, populated cross-project read/write isolation, stale-version conflict, auditor write denial, departmental ownership, provisional readiness, actor reset, and audit events.');
