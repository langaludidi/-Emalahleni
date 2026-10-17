import test from 'node:test';
import assert from 'node:assert/strict';
import { blankForm } from '../src/contracts';
import { encryptForm } from '../src/crypto';
import { HttpError } from '../src/http';
import { type Database } from '../src/database';
import {
  historicalSnapshotsForProject, readProjectDashboard, reportingCounts,
  DASHBOARD_ROW_LIMIT, type DashboardApplication
} from '../src/dashboard';

test('historical workbook snapshots remain separate and project-scoped', () => {
  const historical=historicalSnapshotsForProject({name:'Emalahleni 200',code:'EMAL-200'});
  assert.equal(historical.length,2);
  assert.deepEqual(historical.map(s=>[s.red,s.amber,s.green]),[[58,151,0],[58,149,2]]);
  assert.equal(historical[1].applications,209);
  assert.equal(historical[1].fieldPlanSites,211);
  assert.equal(historical[1].fieldPlanGpsCaptured,94);
  historical[0].red=999;
  assert.equal(historicalSnapshotsForProject({name:'Emalahleni 200',code:'EMAL-200'})[0].red,58);
  assert.deepEqual(historicalSnapshotsForProject({name:'Another project',code:'OTHER'}),[]);
});

test('reporting status counts are derived rather than copied from the workbook', () => {
  const rows = ['RED','AMBER','RED'].map((readiness,i)=>({
    id:String(i),reference:'SYN-'+i,workflowStatus:'DRAFT',updatedAt:'2026-10-17T00:00:00Z',
    blockerCount:0,reviewCount:0,gpsStatus:'NOT_CAPTURED',readiness
  } as DashboardApplication));
  assert.deepEqual(reportingCounts(rows),{RED:2,AMBER:1,GREEN:0});
  assert.equal(DASHBOARD_ROW_LIMIT,300);
});

test('read-only dashboard returns only safe register fields, and never edits capture data',async () => {
  const project='00000000-0000-4000-8000-000000000101';
  const application='00000000-0000-4000-8000-000000000102';
  const key=Buffer.alloc(32,4).toString('base64');
  const form=blankForm();
  form.applicant.firstNames='Synthetic';
  form.applicant.surname='Private Person';
  form.applicant.idNumber='0000000000000';
  form.site.latitude=-31.7;
  form.site.longitude=27.3;
  const ciphertext=await encryptForm(form,key,project,application);
  let readOnly=false;
  let statements:string[]=[];
  const db={
    forActor: async(actor:string, queries:{query:string;params?:unknown[]}[],ro=false)=>{
      assert.equal(actor,'test-actor');
      readOnly=ro;statements=queries.map(q=>q.query);
      for(const query of queries)assert.equal(query.params?.[0],project);
      return [
        [{id:project,name:'Emalahleni 200',code:'EMAL-200',role:'MANAGER'}],
        [{total:1,drafts:1,returned:0}],
        [{id:application,reference:'SYN-EXAMPLE',version:1,workflow_status:'DRAFT',updated_at:'2026-10-16T12:00:00Z',fields_ciphertext:ciphertext}],
        [],
        []
      ];
    }
  } as unknown as Database;
  const report=await readProjectDashboard(db,'test-actor',project,key);
  assert.equal(readOnly,true);
  assert.ok(statements.every(q=>q.trimStart().startsWith('SELECT')));
  assert.equal(report.live.total,1);
  assert.equal(report.live.drafts,1);
  assert.equal(report.live.gpsCaptured,1);
  assert.equal(report.live.readiness?.RED,1);
  assert.equal(report.historicalSnapshots.length,2);
  assert.equal(report.applications[0].reference,'SYN-EXAMPLE');
  assert.equal(report.applications[0].gpsStatus,'CAPTURED_UNVERIFIED');
  const response=JSON.stringify(report);
  for (const secret of ['Private Person','0000000000000','-31.7','27.3',ciphertext]) {
    assert.equal(response.includes(secret),false,'Dashboard leaked a beneficiary attribute');
  }
});

test('dashboard refuses unassigned project members', async () => {
  const db={forActor:async()=>[[],[{total:0,drafts:0,returned:0}],[],[],[]]} as unknown as Database;
  await assert.rejects(
    readProjectDashboard(db,'outsider','00000000-0000-4000-8000-000000000001',Buffer.alloc(32,4).toString('base64')),
    (error:unknown)=>error instanceof HttpError && error.status===403
  );
});
