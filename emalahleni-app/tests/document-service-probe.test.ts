import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {probeDocumentService,DocumentServiceCheckError} from '../src/document-service-probe';
import {digest,type EvidenceEnv} from '../src/evidence';
import {HttpError} from '../src/http';
import {startupReason,startupDiagnostic} from '../scanner/startup-errors';

const text='NAMES: SYNTHETIC TEST\nSURNAME: EXAMPLE\nIDENTITY NUMBER: 9001010000080\nDATE OF BIRTH: 1990-01-01';
const notReady=(error:unknown)=>error instanceof HttpError&&error.status===503&&error.code==='DOCUMENT_SERVICE_NOT_READY';
function harness(){
 const requests:Request[]=[];const state:{health?:Response;scan?:Response;reading?:Response;fail?:boolean}={};
 const env:EvidenceEnv={ENABLE_DOCUMENT_UPLOADS:'false',SCANNER_TOKEN:'synthetic-private-service-probe-token-0000',EVIDENCE_BUCKET:new Proxy({},{get(){throw new Error('The synthetic service probe must not access storage.');}}) as R2Bucket,SCANNER:{fetch:async(request:Request)=>{
  requests.push(request.clone() as Request);if(state.fail)throw new Error('PRIVATE PROVIDER DETAILS MUST NOT ESCAPE');
  const path=new URL(request.url).pathname;
  if(path==='/healthz')return state.health??Response.json({status:'ready',malwareScanner:'ready',idReader:'ready'});
  const hash=await digest(new Uint8Array(await request.arrayBuffer()));
  if(path==='/scan')return state.scan??Response.json({sha256:hash,verdict:'CLEAN'});
  if(path==='/read-id')return state.reading??Response.json({sha256:hash,text});
  throw new Error('Unexpected route');
 }} as Fetcher};
 return {env,requests,state};
}

test('synthetic document service acceptance uses fixed valid PDF bytes and all three private checks without storage',async()=>{
 const h=harness();
 assert.deepEqual(await probeDocumentService(h.env),{status:'ready',checks:{scannerHealth:true,cleanScan:true,idReading:true}});
 assert.deepEqual(h.requests.map(r=>[new URL(r.url).pathname,r.method]),[['/healthz','GET'],['/scan','POST'],['/read-id','POST']]);
 for(const request of h.requests)assert.equal(request.headers.get('Authorization'),`Bearer ${h.env.SCANNER_TOKEN}`);
 const bytes=new Uint8Array(await h.requests[1].arrayBuffer());
 assert.equal(h.requests[1].headers.get('Content-Type'),'application/pdf');assert.equal(h.requests[2].headers.get('Content-Type'),'application/pdf');
 assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 assert.deepEqual(new Uint8Array(await h.requests[2].arrayBuffer()),bytes);
 const again=harness();await probeDocumentService(again.env);assert.deepEqual(new Uint8Array(await again.requests[1].arrayBuffer()),bytes);
});

test('unconfigured and unavailable service checks fail closed with generic errors and stop before later stages',async()=>{
 const h=harness();
 for(const change of [{SCANNER:undefined},{SCANNER_TOKEN:undefined},{SCANNER_TOKEN:'too-short'}])await assert.rejects(probeDocumentService({...h.env,...change}),e=>e instanceof HttpError&&e.code==='DOCUMENT_SERVICE_NOT_CONFIGURED');
 assert.equal(h.requests.length,0);
 h.state.fail=true;await assert.rejects(probeDocumentService(h.env),notReady);assert.equal(h.requests.length,1);
 for(const response of [Response.json({status:'ready',malwareScanner:'ready',idReader:'missing'}),Response.json({status:'ready',malwareScanner:'ready',idReader:'ready',extra:true}),new Response('PRIVATE DETAILS',{status:503}),new Response('x'.repeat(131073))]){
  const check=harness();check.state.health=response;await assert.rejects(probeDocumentService(check.env),notReady);assert.equal(check.requests.length,1);
 }
});

test('mismatched hashes, unclean scans, malformed OCR and incorrect identity extraction never report ready',async()=>{
 for(const response of [Response.json({sha256:'a'.repeat(64),verdict:'CLEAN'}),Response.json({sha256:'a'.repeat(64),verdict:'INFECTED'}),new Response('not JSON')]){
  const h=harness();h.state.scan=response;await assert.rejects(probeDocumentService(h.env),notReady);assert.equal(h.requests.length,2);
 }
 for(const makeResponse of [
  (_hash:string)=>Response.json({sha256:'a'.repeat(64),text}),
  (hash:string)=>Response.json({sha256:hash,text:'x'.repeat(16001)}),
  (hash:string)=>Response.json({sha256:hash,text,verified:true}),
  (hash:string)=>Response.json({sha256:hash,text:text.replace('SYNTHETIC TEST','OTHER PERSON')}),
  (hash:string)=>Response.json({sha256:hash,text:text.replace('1990-01-01','1991-01-01')})
 ]){
  const h=harness();const normal=h.env.SCANNER!.fetch.bind(h.env.SCANNER);
  h.env.SCANNER={fetch:async(request:Request)=>new URL(request.url).pathname==='/read-id'?makeResponse(await digest(new Uint8Array(await request.arrayBuffer()))):normal(request)} as Fetcher;
  await assert.rejects(probeDocumentService(h.env),notReady);
 }
});

test('failed service checks expose only fixed diagnostic stages and never private provider details',async()=>{
 for(const [response,stage] of [
  [Response.json({error:'SCANNER_START_FAILED'},{status:503}),'STARTUP'],
  [Response.json({error:'SCANNER_CONNECTION_FAILED'},{status:503}),'CONNECTION'],
  [Response.json({error:'SCANNER_START_FAILED',reason:'CONFIGURATION'},{status:503}),'STARTUP_CONFIGURATION'],
  [Response.json({error:'SCANNER_START_FAILED',reason:'PORT'},{status:503}),'STARTUP_PORT'],
  [Response.json({error:'SCANNER_START_FAILED',reason:'private details'},{status:503}),'STARTUP'],
  [Response.json({error:'SCANNER_NOT_READY',reason:'ENGINE_KILLED'},{status:503}),'HEALTH_ENGINE_KILLED'],
  [Response.json({error:'SCANNER_NOT_READY',reason:'PDFINFO_UNAVAILABLE'},{status:503}),'HEALTH_PDFINFO_UNAVAILABLE'],
  [Response.json({error:'SCANNER_NOT_READY',reason:'private decoder details'},{status:503}),'HEALTH'],
  [new Response('private token and provider details',{status:401}),'CREDENTIALS'],
  [new Response('private token and provider details',{status:503}),'HEALTH'],
  [Response.json({error:'private token and provider details'},{status:503}),'HEALTH'],
 ] as const){
  const h=harness();h.state.health=response;
  await assert.rejects(probeDocumentService(h.env),error=>error instanceof DocumentServiceCheckError&&error.code==='DOCUMENT_SERVICE_NOT_READY'&&error.failedCheck===stage&&!error.message.includes('private'));
 }
 const h=harness();h.state.scan=new Response('private decoder details',{status:503});
 await assert.rejects(probeDocumentService(h.env),error=>error instanceof DocumentServiceCheckError&&error.failedCheck==='SCAN');
 const reading=harness();reading.state.reading=new Response('private decoder details',{status:503});
 await assert.rejects(probeDocumentService(reading.env),error=>error instanceof DocumentServiceCheckError&&error.failedCheck==='ID_READING');
});

test('startup diagnostics classify known SDK failures without returning provider messages',()=>{
 for(const [message,reason] of [
  ['Containers have not been enabled for this Durable Object class.','CONFIGURATION'],
  ['startAndWaitForPorts is not a function','RPC'],
  ['Container exited before we could determine health, exit code: 1','EXIT'],
  ['Container is not listening on port 8080','PORT'],
  ['Container did not start after 30000ms','INSTANCE'],
  ['The container is not running, consider calling start()','INSTANCE'],
  ['PRIVATE PROVIDER MESSAGE AND TOKEN','UNKNOWN'],
 ] as const)assert.equal(startupReason(new Error(message)),reason);
 assert.equal(startupReason({message:'the container is not listening'}),'PORT');
 assert.equal(startupReason(new Error('Startup aborted',{cause:new Error('the container is not listening')})),'PORT');
});

test('private startup diagnostics retain the exception message while redacting runtime secrets',()=>{
 const token='synthetic-private-token/for+diagnostic-tests==';
 const connection='postgresql://user:private-password@db.invalid/neondb?sslmode=require';
 const message=`Cannot perform I/O on behalf of a different request. token=${token} encoded=${encodeURIComponent(token)} url=${connection} Authorization: Bearer another-private-value`;
 const result=startupDiagnostic({message},{SCANNER_TOKEN:token,DATABASE_URL:connection});
 assert.match(result.errorMessage,/Cannot perform I\/O on behalf of a different request/);
 for(const value of [token,encodeURIComponent(token),connection,'private-password','another-private-value'])assert.equal(result.errorMessage.includes(value),false);
 assert.match(result.errorMessage,/\[redacted/);
 assert.equal(startupDiagnostic(new Error('x'.repeat(20000)),{}).errorMessage.length<=1024,true);
 assert.equal(startupDiagnostic({get message(){throw new Error('private');}},{}).errorMessage,'No message supplied by runtime');
 const caused=startupDiagnostic(new Error('Startup aborted',{cause:new Error(message)}),{SCANNER_TOKEN:token,DATABASE_URL:connection});
 assert.match(caused.errorMessage,/caused by: Cannot perform I\/O/);
 assert.equal(caused.errorMessage.includes(token),false);
});

