// Real PostgreSQL row-lock regression. Runs only in the disposable CI service database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {upload,digest} from '../src/evidence';
import type {Database} from '../src/database';
assert.equal(process.env.CI,'true');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vectra_ci');assert.equal(process.env.PGUSER,'postgres');
const project='10000000-0000-4000-8000-000000000001',application='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
const actor='synthetic-claim-actor',bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic row-lock probe'),hash=await digest(bytes);
let claim:{query:string;params:unknown[]}|undefined;const captured=Error('CLAIM_CAPTURED');
const db={forActor:async(_actor:string,statements:{query:string;params?:unknown[]}[])=>{
 const {query,params=[]}=statements[0];
 if(query.startsWith('SELECT 1 FROM'))return [[{allowed:1}]];
 if(query.startsWith('SELECT e.storage_key'))return [[{storage_key:'synthetic/key',expected_size:bytes.length,expected_sha256:hash,expected_content_type:'application/pdf'}]];
 if(query.startsWith('UPDATE public.evidence SET status=')){claim={query,params};throw captured;}
 throw Error('Unexpected statement before upload claim');
}} as unknown as Database;
await assert.rejects(upload(db,actor,project,application,id,new Request('https://app.example/upload',{method:'PUT',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes).buffer}),{
 ENABLE_DOCUMENT_UPLOADS:'true',EVIDENCE_BUCKET:{} as R2Bucket,SCANNER:{} as Fetcher,SCANNER_TOKEN:'synthetic-no-external-scanner',
}),error=>error===captured);
assert.ok(claim);
const literal=(value:unknown)=>`'${String(value).replaceAll("'","''")}'`;
const claimSql=claim.query.replace(/\$(\d+)/g,(_match,index)=>literal(claim!.params[Number(index)-1]));
function psql(sql:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let out='',error='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Disposable PostgreSQL check timed out'));},15000);
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{error+=chunk;});
  child.once('error',failure=>{clearTimeout(timer);reject(failure);});
  child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`Disposable PostgreSQL check failed: ${error}`));});child.stdin.end(sql);
 });
}
await psql(`
 CREATE TABLE public.evidence(id uuid PRIMARY KEY,project_id uuid,application_id uuid,status text,sha256 text,uploaded_at timestamptz);
 CREATE TABLE public.project_memberships(project_id uuid,user_id text,active boolean,role text);
 INSERT INTO public.evidence VALUES(${literal(id)},${literal(project)},${literal(application)},'PENDING_UPLOAD',NULL,NULL);
 INSERT INTO public.project_memberships VALUES(${literal(project)},${literal(actor)},true,'OFFICER');
`);
const transaction=`BEGIN; SELECT set_config('app.actor_id',${literal(actor)},true); ${claimSql}; SELECT pg_sleep(1); COMMIT;`;
const results=await Promise.all([psql(transaction),psql(transaction)]);
assert.equal(results.flatMap(value=>value.trim().split('\n')).filter(value=>value===id).length,1,'Exactly one overlapping request must claim the document');
assert.equal((await psql(`SELECT status||':'||sha256 FROM public.evidence WHERE id=${literal(id)};`)).trim(),'PENDING_SCAN:'+hash);
assert.equal((await psql(transaction)).split('\n').filter(value=>value===id).length,0,'An already claimed upload must not claim again');
console.log('Real PostgreSQL concurrent upload claims: one winner, overlapping loser and replay rejected. Production claim SQL was captured from upload().');
