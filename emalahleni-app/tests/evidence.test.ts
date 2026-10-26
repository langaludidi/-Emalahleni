import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadSchema,reviewSchema,scanVerdict,scanResult,validSignature,digest,uploadsConfigured,createIntent,upload,rescan,type EvidenceEnv } from '../src/evidence';
import type {Database} from '../src/database';
import {HttpError} from '../src/http';
const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic document');
test('upload availability and every upload entry point require enabled storage and scanner before touching data',async()=>{
 const ready:EvidenceEnv={ENABLE_DOCUMENT_UPLOADS:'true',EVIDENCE_BUCKET:{} as R2Bucket,SCANNER:{} as Fetcher,SCANNER_TOKEN:'synthetic-token'};
 assert.equal(uploadsConfigured(ready),true);
 const blocked:EvidenceEnv[]=[{}, {...ready,ENABLE_DOCUMENT_UPLOADS:'false'},...Object.keys(ready).map(key=>({...ready,[key]:undefined}))];
 const db={forActor:async()=>{throw new Error('Database must not be touched');}} as unknown as Database;
 for(const env of blocked){
  assert.equal(uploadsConfigured(env),false);
  const unavailable=(error:unknown)=>error instanceof HttpError&&error.status===503&&error.code==='DOCUMENT_UPLOADS_NOT_CONFIGURED';
  await assert.rejects(createIntent(db,'actor','project','case',{},env),unavailable);
  await assert.rejects(upload(db,'actor','project','case','document',new Request('https://app.example',{method:'PUT',body:bytes}),env),unavailable);
  await assert.rejects(rescan(db,'actor','project','case','document',env),unavailable);
 }
});
test('upload contracts reject executable types, path filenames, oversized files and ambiguous dependants',()=>{
 const input={kind:'APPLICANT_ID',filename:'synthetic.pdf',contentType:'application/pdf',size:bytes.length,sha256:'a'.repeat(64),dependantOrdinal:null};
 assert.equal(uploadSchema.safeParse(input).success,true);
 for(const change of [{filename:'../id.pdf'},{filename:'id\r\n.pdf'},{contentType:'text/html'},{size:6000000},{dependantOrdinal:1}])assert.equal(uploadSchema.safeParse({...input,...change}).success,false);
 assert.equal(uploadSchema.safeParse({...input,kind:'DEPENDANT_ID_OR_BIRTH_CERT',dependantOrdinal:null}).success,false);
 assert.equal(validSignature(bytes,'application/pdf'),true);assert.equal(validSignature(bytes,'image/jpeg'),false);
});
test('scanner results fail closed for unavailable, malformed, wrong-hash and failed services',async()=>{
 const hash=await digest(bytes);
 assert.equal(await scanVerdict(bytes,hash,{}),'SCAN_FAILED');
 for(const value of [{verdict:'CLEAN',sha256:'wrong'},{verdict:'CLEAN',sha256:hash,extra:'unexpected'},{clean:true}])assert.equal(await scanVerdict(bytes,hash,{SCANNER_TOKEN:'secret',SCANNER:{fetch:async()=>Response.json(value)} as any}),'SCAN_FAILED');
 assert.equal(await scanVerdict(bytes,hash,{SCANNER_TOKEN:'secret',SCANNER:{fetch:async()=>{throw new Error('offline')}} as any}),'SCAN_FAILED');
 assert.equal(await scanVerdict(bytes,hash,{SCANNER_TOKEN:'secret',SCANNER:{fetch:async()=>Response.json({sha256:hash,verdict:'INFECTED'})} as any}),'INFECTED');
 assert.equal(await scanVerdict(bytes,hash,{SCANNER_TOKEN:'secret',SCANNER:{fetch:async()=>Response.json({sha256:hash,verdict:'CLEAN'})} as any}),'CLEAN');
});
test('review clients cannot set scanner status or impersonate the reviewer',()=>{
 const input={formVersion:0,decision:'VERIFIED',note:'Synthetic review',documentSubtype:'ID_COPY',documentDate:null,certificationConfirmed:true,contentConfirmed:true};
 assert.equal(reviewSchema.safeParse(input).success,true);
 const {formVersion,...missingVersion}=input;assert.equal(reviewSchema.safeParse(missingVersion).success,false);
 assert.equal(reviewSchema.safeParse({...input,formVersion:-1}).success,false);
 assert.equal(reviewSchema.safeParse({...input,malware_status:'CLEAN'}).success,false);
 assert.equal(reviewSchema.safeParse({...input,reviewed_by:'another-person'}).success,false);
});
test('failed scans expose fixed useful reasons without returning provider text or accepting an invalid verdict',async()=>{
 const hash=await digest(bytes),secret='synthetic-private-scanner-token';
 const env=(response:()=>Promise<Response>):EvidenceEnv=>({SCANNER_TOKEN:secret,SCANNER:{fetch:response} as unknown as Fetcher});
 for(const [status,value,reason] of [
  [401,{},'CREDENTIALS'],[415,{},'UNSUPPORTED_MEDIA_TYPE'],[429,{},'BUSY'],
  [503,{error:'SCANNER_START_FAILED',reason:'INSTANCE',private:secret},'STARTUP_INSTANCE'],
  [503,{error:'SCANNER_START_FAILED',reason:secret},'STARTUP'],
  [503,{error:'SCANNER_CONNECTION_FAILED'},'CONNECTION'],[503,{private:secret},'UNAVAILABLE'],
  [503,{error:'SIGNATURES_NOT_READY'},'SIGNATURES_NOT_READY'],[503,{error:'SCAN_TIMEOUT'},'ENGINE_TIMEOUT'],[400,{error:'EMPTY_FILE'},'EMPTY_FILE'],
  [200,{sha256:'0'.repeat(64),verdict:'CLEAN'},'HASH_MISMATCH'],[200,{sha256:hash,verdict:'CLEAN',private:secret},'INVALID_RESPONSE'],
 ] as const){
  const result=await scanResult(bytes,hash,env(async()=>Response.json(value,{status})));
  assert.deepEqual(result,{verdict:'SCAN_FAILED',failure:reason});assert.equal(JSON.stringify(result).includes(secret),false);
 }
 assert.deepEqual(await scanResult(bytes,hash,env(async()=>new Response(secret,{status:200}))),{verdict:'SCAN_FAILED',failure:'INVALID_RESPONSE'});
 assert.deepEqual(await scanResult(bytes,hash,env(async()=>{throw Error(secret);})),{verdict:'SCAN_FAILED',failure:'CONNECTION'});
 assert.deepEqual(await scanResult(bytes,hash,env(async()=>new Response('x'.repeat(2048),{status:200}))),{verdict:'SCAN_FAILED',failure:'INVALID_RESPONSE'});
 assert.deepEqual(await scanResult(bytes,hash,env(async()=>Response.json({sha256:hash,verdict:'CLEAN'}))),{verdict:'CLEAN'});
 assert.deepEqual(await scanResult(bytes,hash,env(async()=>Response.json({sha256:hash,verdict:'INFECTED'}))),{verdict:'INFECTED'});
});

