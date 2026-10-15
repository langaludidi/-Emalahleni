// Real local workerd -> production Container class -> Docker -> ClamAV/OCR.
// Requires Docker; runs in CI with a public synthetic credential and document only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {syntheticPdf} from './synthetic-pdf.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const directory=await mkdtemp(join(tmpdir(),'emalahleni-worker-contract-'));
const logPath=join(root,'review/scanner-worker-integration.log');
await import('node:fs/promises').then(({mkdir})=>mkdir(dirname(logPath),{recursive:true}));
const log=await open(logPath,'w');
const secret='synthetic-worker-container-contract-token-00000';
const headers={Authorization:`Bearer ${secret}`};
const config=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
config.name='emalahleni-scanner-ci';
config.main=join(root,'scanner/test/worker-entrypoint.ts');
for(const key of ['account_id','assets','r2_buckets'])delete config[key];
config.vars={SCANNER_TOKEN:secret};
config.observability={enabled:false};
config.containers[0]={...config.containers[0],name:'emalahleni-scanner-ci',image:join(root,'scanner/Dockerfile'),image_build_context:join(root,'scanner'),observability:{enabled:false}};
config.exports.DocumentScanner.container='emalahleni-scanner-ci';
const configPath=join(directory,'wrangler.jsonc');
await writeFile(configPath,JSON.stringify(config));
const base='http://127.0.0.1:8792';
const child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',configPath,'--ip','127.0.0.1','--port','8792','--persist-to',join(directory,'state')],{
 cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:join(directory,'config')},
});
let spawnError;
child.once('error',error=>{spawnError=error;});
try{
 let listening=false;
 const deadline=Date.now()+180_000;
 while(Date.now()<deadline){
  if(spawnError)throw spawnError;
  if(child.exitCode!==null)throw new Error('Local Worker exited; inspect scanner-worker-integration.log.');
  try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)})).status===401){listening=true;break;}}catch{}
  await delay(1000);
 }
 assert.equal(listening,true,'Local Worker must become ready within three minutes.');
 const started=Date.now();
 const health=await fetch(base+'/healthz',{headers,signal:AbortSignal.timeout(140_000)});
 assert.equal(health.status,200,`Native Worker health failed: ${await health.clone().text()}`);
 assert.deepEqual(await health.json(),{status:'ready',malwareScanner:'ready',idReader:'ready'});
 console.log(`Native Worker/Container startup and authenticated health passed after ${Date.now()-started}ms.`);
 const bytes=syntheticPdf(),sha256=createHash('sha256').update(bytes).digest('hex');
 const scan=await fetch(base+'/scan',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:bytes,signal:AbortSignal.timeout(140_000)});
 assert.equal(scan.status,200,`Native Worker scan failed: ${await scan.clone().text()}`);
 assert.deepEqual(await scan.json(),{sha256,verdict:'CLEAN'});
 const reading=await fetch(base+'/read-id',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:bytes,signal:AbortSignal.timeout(140_000)});
 assert.equal(reading.status,200,`Native Worker reading failed: ${await reading.clone().text()}`);
 const result=await reading.json();assert.equal(result.sha256,sha256);assert.match(result.text,/SYNTHETIC PERSON/);assert.match(result.text,/0001015009086/);
 console.log('Real workerd, native Durable Object fetch, Container startup, auth, binary scan hash and Tesseract OCR passed.');
}finally{
 try{await fetch(base+'/__ci_stop',{method:'POST',headers,signal:AbortSignal.timeout(5000)});}catch{}
 try{process.kill(-child.pid,'SIGTERM');}catch{}
 await Promise.race([new Promise(resolve=>child.once('close',resolve)),delay(3000)]);
 try{process.kill(-child.pid,'SIGKILL');}catch{}
 await log.close();
 await rm(directory,{recursive:true,force:true});
}
