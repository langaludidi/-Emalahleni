// Executes the production review SQL against the disposable CI PostgreSQL service.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {review} from '../src/evidence';
import {projectDashboard} from '../src/dashboard';
import {reviewDepartment} from '../src/department-review';
import type {Database,Statement} from '../src/database';
assert.equal(process.env.CI,'true');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vectra_ci');assert.equal(process.env.PGUSER,'postgres');
const project='10000000-0000-4000-8000-000000000002',application='20000000-0000-4000-8000-000000000002',id='30000000-0000-4000-8000-000000000002';
const assessor='synthetic-review-assessor',department='synthetic-review-department';
const literal=(v:unknown):string=>v===null?'NULL':typeof v==='boolean'?(v?'TRUE':'FALSE'):typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
async function capture(operation:(db:Database)=>Promise<unknown>){
 let statement:Statement|undefined;const stopped=Error('CAPTURED');
 const db={forActor:async(_actor:string,statements:Statement[])=>{
  if(statements[0].query.startsWith('SELECT 1 FROM'))return [[{allowed:1}]];
  assert.equal(statements.length,1);statement=statements[0];throw stopped;
 }} as unknown as Database;
 await assert.rejects(operation(db),e=>e===stopped);assert.ok(statement);
 return statement.query.replace(/\$(\d+)/g,(_match,index)=>literal(statement!.params![Number(index)-1]));
}
const evidenceSql=await capture(db=>review(db,assessor,project,application,id,{formVersion:0,decision:'VERIFIED',note:'Synthetic content checked',documentSubtype:'ID_COPY',documentDate:null,certificationConfirmed:true,contentConfirmed:true}));
const departmentSql=await capture(db=>reviewDepartment(db,department,project,application,'PAGE_2',{formVersion:0,state:'COMPLETE',note:'Synthetic department checked',expectedReviewedAt:null}));
function psql(sql:string,locked?:()=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let out='',error='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Disposable PostgreSQL review check timed out'));},15000);
  child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('LOCK_HELD'))locked?.();});child.stderr.on('data',chunk=>{error+=chunk;});
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(error));});child.stdin.end(sql);
 });
}
const tx=(actor:string,sql:string)=>`BEGIN; SELECT set_config('app.actor_id',${literal(actor)},true); ${sql}; COMMIT;`;
async function race(actor:string,holder:string,contender:string){
 let notify!:()=>void;const ready=new Promise<void>(resolve=>{notify=resolve;});
 const first=psql(tx(actor,`${holder}; SELECT 'LOCK_HELD'; SELECT pg_sleep(1)`),notify);
 await Promise.race([ready,first.then(()=>{throw Error('Holder ended before lock was observed');})]);
 return Promise.all([first,psql(contender)]);
}
await psql(`
 CREATE TABLE public.applications(id uuid PRIMARY KEY,project_id uuid,version integer NOT NULL);
 ALTER TABLE public.evidence ADD COLUMN review_notes text,ADD COLUMN document_subtype text,ADD COLUMN document_date date,
   ADD COLUMN reviewed_by text,ADD COLUMN reviewed_at timestamptz,ADD COLUMN reviewed_form_version integer CHECK(reviewed_form_version>=0),
   ADD COLUMN certification_acknowledged boolean,ADD COLUMN certification_acknowledged_by text,ADD COLUMN certification_acknowledged_at timestamptz,
   ADD COLUMN certification_required boolean,ADD COLUMN malware_status text;
 CREATE TABLE public.dohs_section_reviews(project_id uuid,application_id uuid,section text,state text,note text,reviewed_by text,reviewed_at timestamptz,reviewed_form_version integer CHECK(reviewed_form_version>=0),UNIQUE(application_id,section));
 CREATE TABLE public.audit_events(project_id uuid,actor_id text,action text,metadata jsonb);
 INSERT INTO public.applications VALUES(${literal(application)},${literal(project)},0);
 INSERT INTO public.project_memberships VALUES(${literal(project)},${literal(assessor)},true,'ASSESSOR'),(${literal(project)},${literal(department)},true,'DOHS_REVIEWER');
 INSERT INTO public.evidence(id,project_id,application_id,status,malware_status,certification_required) VALUES(${literal(id)},${literal(project)},${literal(application)},'PENDING_REVIEW','CLEAN',true);
`);
const reset=()=>psql(`UPDATE public.applications SET version=0; UPDATE public.evidence SET status='PENDING_REVIEW',reviewed_form_version=NULL WHERE id=${literal(id)}; DELETE FROM public.dohs_section_reviews; DELETE FROM public.audit_events;`);
const save=`UPDATE public.applications SET version=1 WHERE id=${literal(application)}`;
// Save wins: a waiting review must recheck the form version after the row lock.
for(const [actor,sql,action] of [[assessor,evidenceSql,'EVIDENCE_REVIEWED'],[department,departmentSql,'DOHS_SECTION_REVIEWED']]){
 await reset();await race(assessor,save,tx(actor,sql));
 assert.equal((await psql(`SELECT count(*) FROM public.audit_events WHERE action=${literal(action)}`)).trim(),'0','No stale review may be recorded after a concurrent save');
 // Review wins: save waits, and the recorded version remains the older checked version.
 await reset();await race(actor,sql,tx(assessor,save));
 const table=actor===assessor?'evidence':'dohs_section_reviews';
 assert.equal((await psql(`SELECT a.version||':'||r.reviewed_form_version FROM public.${table} r JOIN public.applications a ON a.id=r.application_id WHERE r.application_id=${literal(application)}`)).trim(),'1:0');
}
// Dashboard metadata must count old approvals as awaiting review.
await reset();await psql(tx(assessor,evidenceSql));await psql(save);
let dashboardSql='';await projectDashboard({forActor:async(_actor:string,statements:Statement[])=>{dashboardSql=statements[2].query.replaceAll('$1',literal(project));return [[{allowed:1}],[{}],[{}],[]];}} as unknown as Database,assessor,project);
const counts=(await psql(dashboardSql)).trim().split('|');assert.equal(counts[5],'1');assert.equal(counts[6],'0');
await reset();const overlap=await Promise.all([psql(tx(assessor,evidenceSql)),psql(tx(assessor,evidenceSql))]);
assert.equal(overlap.join('\n').split('\n').filter(line=>line.startsWith(id+'|')).length,1,'Only one overlapping assessor decision may win');
assert.equal((await psql('SELECT count(*) FROM public.audit_events')).trim(),'1');
assert.equal((await psql(tx(assessor,evidenceSql))).includes(id),false,'A current approval cannot be overwritten by a replay');
await psql(`UPDATE public.evidence SET reviewed_form_version=NULL WHERE id=${literal(id)}`);
assert.ok((await psql(tx(assessor,evidenceSql))).includes(id),'Legacy evidence can receive a fresh review without a rescan');
await reset();await psql(`UPDATE public.evidence SET malware_status='INFECTED' WHERE id=${literal(id)}`);
assert.equal((await psql(tx(assessor,evidenceSql))).includes(id),false,'An infected file must remain unreviewable');
await reset();const first=await psql(tx(department,departmentSql));assert.match(first,/PAGE_2\|COMPLETE\|0\|/);
assert.equal((await psql(tx(department,departmentSql))).includes('PAGE_2'),false,'A departmental insert replay must not overwrite an existing decision');
const timestamp=(await psql(`SELECT to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.dohs_section_reviews`)).trim();
const updateSql=await capture(db=>reviewDepartment(db,department,project,application,'PAGE_2',{formVersion:0,state:'RETURNED',note:'Synthetic supported correction',expectedReviewedAt:timestamp}));
assert.ok((await psql(tx(department,updateSql))).includes('PAGE_2|RETURNED|0|'));
assert.equal((await psql(tx(department,updateSql))).includes('PAGE_2'),false,'The full timestamp CAS must still reject stale decisions');
console.log('Production review SQL: both save/review race orderings, competing assessor decisions, legacy re-review, infected denial and departmental timestamp conflicts passed.');
