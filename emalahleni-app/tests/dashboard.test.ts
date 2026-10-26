import test from 'node:test';
import assert from 'node:assert/strict';
import type {Database,Statement} from '../src/database';
import {projectDashboard} from '../src/dashboard';
import {createHandler} from '../src/worker';

const project='10000000-0000-4000-8000-000000000001';
test('dashboard uses a single read-only actor snapshot and only returns project aggregate metadata',async()=>{
  let calls=0;
  const applications={total:121,draft:100,awaitingAssessment:10,returned:7,assessmentComplete:4};
  const evidence={total:12,pendingUpload:1,pendingScan:1,scanFailed:1,infected:1,awaitingReview:4,verified:4,rejected:1};
  const recent=[{id:'case',reference:'SYN-DASHBOARD',version:1,workflow_status:'DRAFT',updated_at:'2026-10-23T10:00:00Z'}];
  const db={forActor:async(actor:string,statements:Statement[],readOnly:boolean)=>{
    calls++;assert.equal(actor,'synthetic-actor');assert.equal(readOnly,true);assert.equal(statements.length,4);
    assert.deepEqual(statements.map(item=>item.params),[[project,'synthetic-actor'],[project],[project],[project]]);
    assert.ok(statements.every(item=>!item.query.includes('fields_ciphertext')));
    assert.match(statements[0].query,/user_id=\$2 AND active/);
    assert.match(statements[1].query,/FROM public.applications WHERE project_id=\$1/);
    assert.match(statements[2].query,/FROM public.evidence e JOIN public.applications/);
    return [[{allowed:1}],[applications],[evidence],recent];
  }} as unknown as Database;
  const result=await projectDashboard(db,'synthetic-actor',project);
  assert.equal(calls,1);assert.deepEqual(result.applications,applications);assert.deepEqual(result.evidence,evidence);assert.deepEqual(result.recent,recent);assert.ok(!Number.isNaN(Date.parse(result.generatedAt)));
});
test('dashboard denies a missing or inactive membership instead of presenting an empty project',async()=>{
  const db={forActor:async()=>[[],[{total:0}],[{total:0}],[]]} as unknown as Database;
  await assert.rejects(projectDashboard(db,'nonmember',project),(error:any)=>error.status===404&&error.code==='NOT_FOUND');
});
test('dashboard requires authenticated API access and preserves private response headers',async()=>{
  const app=createHandler(async()=>{throw Error('no session');});
  const result=await app(new Request(`https://app.example/api/projects/${project}/dashboard`),{ENABLE_CASE_API:'true',DATABASE_URL:'configured',FORM_ENCRYPTION_KEY:'configured'});
  assert.equal(result.status,401);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.deepEqual(await result.json(),{error:'UNAUTHENTICATED'});
});
