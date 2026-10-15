import test from 'node:test';
import assert from 'node:assert/strict';
import type {Database} from '../src/database';
import {digest} from '../src/evidence';
import {HttpError} from '../src/http';
import {idReadingConfigured,readIdDocument,type IdReadingEnv} from '../src/id-document';
const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic ID reader fixture');
const unavailable=(error:unknown)=>error instanceof HttpError&&error.code==='ID_READING_UNAVAILABLE';
async function harness(){
 const hash=await digest(bytes),calls:any[]=[],objects:string[]=[],requests:Request[]=[];const state={allowAudit:true};
 const row:any={storage_key:'quarantine/synthetic-key',content_type:'application/pdf',sha256:hash,kind:'APPLICANT_ID',status:'PENDING_REVIEW',malware_status:'CLEAN',role:'OFFICER'};
 const db={forActor:async(actor:string,queries:any[])=>{calls.push({actor,queries});return [queries[0].query.startsWith('SELECT')?[row]:queries[0].query.startsWith('WITH current_document')&&state.allowAudit?[{id:'synthetic-audit'}]:[]];}} as unknown as Database;
 const env:IdReadingEnv={ENABLE_DOCUMENT_UPLOADS:'true',ENABLE_ID_READING:'true',SCANNER_TOKEN:'synthetic-scanner-token',EVIDENCE_BUCKET:{get:async(key:string)=>{objects.push(key);return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};}} as any,SCANNER:{fetch:async(request:Request)=>{requests.push(request);return Response.json({sha256:hash,text:'Names: SYNTHETIC\nSurname: EXAMPLE'});}} as any};
 const read=()=>readIdDocument(db,'synthetic-actor','synthetic-project','synthetic-case','synthetic-evidence',env);
 return {hash,calls,objects,requests,row,db,env,read,state};
}
test('ID reading requires configuration, project visibility, a writer and a clean applicant ID before accessing storage',async()=>{
 const h=await harness();assert.equal(idReadingConfigured(h.env),true);
 for(const change of [{ENABLE_ID_READING:'false'},{ENABLE_DOCUMENT_UPLOADS:'false'},{SCANNER:undefined}])await assert.rejects(readIdDocument(h.db,'actor','project','case','id',{...h.env,...change}),e=>e instanceof HttpError&&e.code==='ID_READING_NOT_CONFIGURED');
 assert.equal(h.calls.length,0);
 await assert.rejects(readIdDocument({forActor:async()=>[[]]} as any,'actor','other-project','case','id',h.env),e=>e instanceof HttpError&&e.status===404);
 for(const change of [{role:'AUDITOR'},{role:'DOHS_REVIEWER'},{kind:'SPOUSE_ID'},{malware_status:'SCAN_FAILED'},{status:'PENDING_UPLOAD'},{status:'REJECTED'}]){
  const original={...h.row};Object.assign(h.row,change);await assert.rejects(h.read(),e=>e instanceof HttpError&&[403,409].includes(e.status));Object.assign(h.row,original);
 }
 assert.deepEqual(h.objects,[]);assert.deepEqual(h.requests,[]);
});
test('ID suggestions bind to stored bytes and never write raw OCR or identity values into audit records',async()=>{
 const h=await harness();const result=await h.read();
 assert.equal(result.evidenceId,'synthetic-evidence');assert.equal(result.sha256,h.hash);assert.equal(result.requiresConfirmation,true);
 assert.equal(result.fields.firstNames,'SYNTHETIC');assert.equal(result.fields.surname,'EXAMPLE');
 assert.deepEqual(h.objects,['quarantine/synthetic-key']);assert.equal(new URL(h.requests[0].url).pathname,'/read-id');
 assert.deepEqual(new Uint8Array(await h.requests[0].arrayBuffer()),bytes);
 assert.equal(JSON.stringify(h.calls.slice(1)).includes('EXAMPLE'),false);assert.equal(JSON.stringify(h.calls.slice(1)).includes('Names:'),false);
 h.row.sha256='a'.repeat(64);await assert.rejects(h.read(),e=>e instanceof HttpError&&e.code==='STORED_FILE_CHANGED');assert.equal(h.requests.length,1);
});
test('ID reading rejects unavailable, oversized, malformed or mismatched private service results',async()=>{
 const h=await harness();
 for(const response of [Response.json({sha256:'a'.repeat(64),text:'Names: Wrong'}),Response.json({sha256:h.hash,text:'x'.repeat(16001)}),Response.json({sha256:h.hash,text:'Names: Wrong',verified:true}),new Response('not JSON'),Response.json({error:'busy'},{status:503}),new Response('x'.repeat(131073))]){
  h.env.SCANNER={fetch:async()=>response} as any;await assert.rejects(h.read(),unavailable);
 }
 assert.equal(h.calls.some(call=>call.queries[0].query.includes("'ID_DETAILS_READ'")),false);
});
test('a matching infected verdict invalidates the prior clean record; an unrelated verdict cannot',async()=>{
 const h=await harness();h.env.SCANNER={fetch:async()=>Response.json({sha256:'a'.repeat(64),verdict:'INFECTED'},{status:422})} as any;
 await assert.rejects(h.read(),unavailable);assert.equal(h.calls.length,1);
 h.env.SCANNER={fetch:async()=>Response.json({sha256:h.hash,verdict:'INFECTED'},{status:422})} as any;
 await assert.rejects(h.read(),e=>e instanceof HttpError&&e.code==='ID_READING_FILE_REJECTED');
 assert.equal(h.calls.at(-1).queries[0].params[3],h.hash);
 assert.match(h.calls.at(-1).queries[0].query,/malware_status='INFECTED'/);
});

test('ID suggestions are withheld if evidence or membership changes while reading',async()=>{const h=await harness();h.state.allowAudit=false;await assert.rejects(h.read(),e=>e instanceof HttpError&&e.code==='ID_READING_STATE_CHANGED');});
