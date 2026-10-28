// Executes the production migration/functions with real PostgreSQL RLS in a disposable CI database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
assert.equal(process.env.CI,'true');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vectra_ci');assert.equal(process.env.PGUSER,'postgres');
function psql(sql:string):Promise<string>{return new Promise((resolve,reject)=>{
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let out='',error='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Project database check timed out'));},20000);
  child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>error+=v);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(Error(error));});child.stdin.end(sql);
});}
const literal=(v:string)=>`'${v.replaceAll("'","''")}'`;
const org='10000000-0000-4000-8000-000000000001',otherOrg='10000000-0000-4000-8000-000000000002';
const project='20000000-0000-4000-8000-000000000001';
const tx=(actor:string,sql:string)=>`BEGIN; SET LOCAL ROLE emalahleni_worker; SELECT set_config('app.actor_id',${literal(actor)},true); ${sql}; COMMIT;`;
const create=(id:string,code:string,name='Synthetic housing',organisation=org)=>`SELECT row_to_json(r) FROM public.create_housing_project(${literal(id)}::uuid,${literal(organisation)}::uuid,${literal(code)},${literal(name)},'Synthetic authority','Synthetic location') r`;
await psql(`
 CREATE ROLE neondb_owner NOLOGIN; CREATE ROLE emalahleni_worker NOLOGIN;
 GRANT USAGE,CREATE ON SCHEMA public TO neondb_owner; GRANT USAGE ON SCHEMA public TO emalahleni_worker;
 SET ROLE neondb_owner;
 CREATE TABLE public.organisations(id uuid PRIMARY KEY,name text NOT NULL,type text NOT NULL);
 CREATE TABLE public.users(id text PRIMARY KEY,display_name text,created_at timestamptz DEFAULT now());
 CREATE TABLE public.projects(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.organisations,code text NOT NULL,name text NOT NULL,UNIQUE(organisation_id,code));
 CREATE TABLE public.project_memberships(project_id uuid REFERENCES public.projects,user_id text REFERENCES public.users,role text NOT NULL,active boolean NOT NULL,PRIMARY KEY(project_id,user_id));
 CREATE TABLE public.audit_events(id bigserial PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.projects,actor_id text NOT NULL,action text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz DEFAULT now());
 ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY; ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
 ALTER TABLE public.project_memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_memberships FORCE ROW LEVEL SECURITY;
 CREATE POLICY membership_self ON public.project_memberships FOR SELECT USING(user_id=current_setting('app.actor_id',true));
 CREATE POLICY migration_owner_project_memberships ON public.project_memberships TO neondb_owner USING(true) WITH CHECK(true);
 CREATE POLICY project_member_read ON public.projects FOR SELECT USING(EXISTS(SELECT 1 FROM public.project_memberships m WHERE m.project_id=projects.id AND m.user_id=current_setting('app.actor_id',true) AND m.active));
 CREATE POLICY migration_owner_projects ON public.projects TO neondb_owner USING(true) WITH CHECK(true);
 GRANT SELECT ON public.projects,public.project_memberships TO emalahleni_worker;
 INSERT INTO public.organisations VALUES('${org}','Synthetic owner','PRIVATE'),('${otherOrg}','Other organisation','PRIVATE');
 INSERT INTO public.users(id) VALUES('synthetic-creator'),('synthetic-officer'),('synthetic-other');
 RESET ROLE;
`);
const migration=await readFile(new URL('../migrations/20261028_housing_project_creation.sql',import.meta.url),'utf8');
await psql(`SET ROLE neondb_owner; ${migration}`);
await psql(`INSERT INTO public.project_creators VALUES('${org}','synthetic-creator',true),('${otherOrg}','synthetic-other',true);`);
const options=await psql(tx('synthetic-creator','SELECT count(*) FROM public.project_creation_options()'));
assert.equal(options.split('\n').at(-1),'1');
assert.equal((await psql(tx('synthetic-officer','SELECT count(*) FROM public.project_creation_options()'))).split('\n').at(-1),'0');
await assert.rejects(psql(tx('synthetic-officer',create(project,'SYN-NEW'))),/PROJECT_CREATION_DENIED/);
await assert.rejects(psql(tx('synthetic-creator',create(project,'SYN-NEW','Synthetic housing',otherOrg))),/PROJECT_CREATION_DENIED/);
await assert.rejects(psql(tx('synthetic-creator',create(project,'INVALID CODE'))),/INVALID_PROJECT_DETAILS/);
assert.equal(await psql('SELECT count(*) FROM public.projects'),'0');
// Two overlapping submissions must create one project, one ADMIN membership and one audit event.
const concurrent=await Promise.all([psql(tx('synthetic-creator',create(project,'SYN-NEW'))),psql(tx('synthetic-creator',create(project,'SYN-NEW')))]);
const results=concurrent.map(v=>JSON.parse(v.split('\n').at(-1)!));
assert.deepEqual(results.map(r=>r.created).sort(),[false,true]);
assert.equal(await psql('SELECT count(*) FROM public.projects'),'1');
assert.equal(await psql("SELECT count(*) FROM public.project_memberships WHERE role='ADMIN' AND active"),'1');
assert.equal(await psql("SELECT count(*) FROM public.audit_events WHERE action='PROJECT_CREATED'"),'1');
await assert.rejects(psql(tx('synthetic-creator',create(project,'SYN-CHANGED'))),/PROJECT_REQUEST_CONFLICT/);
await assert.rejects(psql(tx('synthetic-creator',create('20000000-0000-4000-8000-000000000002','SYN-NEW'))),/PROJECT_CODE_EXISTS/);
assert.equal((await psql(tx('synthetic-creator','SELECT count(*) FROM public.projects'))).split('\n').at(-1),'1');
assert.equal((await psql(tx('synthetic-other','SELECT count(*) FROM public.projects'))).split('\n').at(-1),'0');
assert.equal((await psql(tx('synthetic-officer','SELECT count(*) FROM public.projects'))).split('\n').at(-1),'0');
for(const sql of ["INSERT INTO public.project_creators VALUES('"+org+"','synthetic-officer',true)","INSERT INTO public.project_memberships VALUES('"+project+"','synthetic-officer','ADMIN',true)","INSERT INTO public.projects(id,organisation_id,code,name) VALUES(gen_random_uuid(),'"+org+"','SYN-BYPASS','Denied')"]){
  await assert.rejects(psql(tx('synthetic-officer',sql)),/permission denied/);
}
// Denying the audit write rolls back the project and membership, not just the last step.
await psql("CREATE FUNCTION public.reject_synthetic_project_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PROJECT_CREATED' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_project_audit();");
await assert.rejects(psql(tx('synthetic-creator',create('20000000-0000-4000-8000-000000000003','SYN-ROLLBACK'))),/SYNTHETIC_AUDIT_FAILURE/);
assert.equal(await psql('SELECT count(*) FROM public.projects'),'1');
assert.equal(await psql('SELECT count(*) FROM public.project_memberships'),'1');
await psql('DROP TRIGGER synthetic_audit_failure ON public.audit_events;');
await psql("UPDATE public.project_creators SET active=false WHERE user_id='synthetic-creator';");
await assert.rejects(psql(tx('synthetic-creator',create(project,'SYN-NEW'))),/PROJECT_CREATION_DENIED/);
assert.equal((await psql(tx('synthetic-creator','SELECT count(*) FROM public.projects'))).split('\n').at(-1),'1','Revoking creation does not remove existing project access');
console.log('Housing project SQL: scoped creation, RLS isolation, exact retries, concurrency, duplicate codes, no direct privilege escalation, atomic audit rollback and revocation passed.');
