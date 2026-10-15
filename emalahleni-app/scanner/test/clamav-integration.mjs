// Runs only inside the isolated test image, with official ClamAV signatures.
// No live beneficiary documents and no external OCR/AI provider are used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syntheticPdf } from './synthetic-pdf.mjs';
const base='http://127.0.0.1:8080', secret=process.env.SCANNER_TOKEN;
if (!secret || secret.length<32) throw new Error('Set the isolated test credential.');
const headers={Authorization:`Bearer ${secret}`};
let ready=false;
const started=Date.now(),deadline=started+90_000;
while(Date.now()<deadline) {
  try { if((await fetch(base+'/healthz',{headers,signal:AbortSignal.timeout(3000)})).ok){ready=true;break;} }catch{}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
assert.equal(ready,true,'ClamAV signatures and OCR tools must become ready within the 90-second startup budget.');
console.log(`Synthetic scanner readiness reached after ${Date.now()-started}ms.`);
assert.equal((await fetch(base+'/healthz')).status,401);
const bytes=syntheticPdf(),sha256=createHash('sha256').update(bytes).digest('hex');
const clean=await fetch(base+'/scan',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:bytes});
assert.equal(clean.status,200);assert.deepEqual(await clean.json(),{sha256,verdict:'CLEAN'});
const read=await fetch(base+'/read-id',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:bytes});
assert.equal(read.status,200);const result=await read.json();assert.equal(result.sha256,sha256);assert.match(result.text,/SYNTHETIC PERSON/);assert.match(result.text,/0001015009086/);
// Standard harmless EICAR antivirus-test string. Never send it to the deployed application.
const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const eicarHash=createHash('sha256').update(eicar).digest('hex');
for(const route of ['/scan','/read-id']) {
  const response=await fetch(base+route,{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:eicar});
  assert.equal(response.status,route==='/scan'?200:422);assert.deepEqual(await response.json(),{sha256:eicarHash,verdict:'INFECTED'});
}
console.log('Actual ClamAV clean/EICAR, readiness, binary hash contract, PDF rasterisation and Tesseract OCR passed with synthetic data.');
