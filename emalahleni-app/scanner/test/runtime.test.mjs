import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScannerServer, readId, runTool, scan } from '../server.mjs';

import { syntheticPdf } from './synthetic-pdf.mjs';

test('malware gate rejects before a decoder can inspect invalid bytes',async()=>{
  await assert.rejects(readId(Buffer.from('not an image'),'image/png',{scanFile:async()=> 'INFECTED'}),/DOCUMENT_INFECTED/);
  await assert.rejects(readId(Buffer.from('not an image'),'image/png',{scanFile:async()=> {throw new Error('scanner unavailable');}}),/scanner unavailable/);
});

test('actual Tesseract and Poppler read a synthetic PDF and image; temp files are removed',async()=>{
  const before=new Set((await readdir(tmpdir())).filter(n=>n.startsWith('emalahleni-read-')));
  const text=await readId(syntheticPdf(),'application/pdf',{scanFile:async()=> 'CLEAN'});
  assert.match(text,/EXAM\s*PLE/);assert.match(text,/SYNTHETIC PERSON/);assert.match(text,/0001015009086/);
  const directory=await mkdtemp(join(tmpdir(),'synthetic-test-'));
  try {
    await writeFile(join(directory,'test.pdf'),syntheticPdf());
    await runTool('pdftoppm',['-f','1','-singlefile','-r','150','-png',join(directory,'test.pdf'),join(directory,'image')]);
    const imageText=await readId(await readFile(join(directory,'image.png')),'image/png',{scanFile:async()=> 'CLEAN'});
    assert.match(imageText,/EXAM\s*PLE/);assert.match(imageText,/SYNTHETIC/);
  }finally{await rm(directory,{recursive:true,force:true});}
  const after=(await readdir(tmpdir())).filter(n=>n.startsWith('emalahleni-read-')&&!before.has(n));assert.deepEqual(after,[]);
});

test('page, pixel, corrupt document and command timeout bounds fail closed',async()=>{
  await assert.rejects(readId(syntheticPdf(3),'application/pdf',{scanFile:async()=> 'CLEAN'}),/PDF_PAGE_LIMIT/);
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(10000,16);png.writeUInt32BE(10000,20);
  await assert.rejects(readId(png,'image/png',{scanFile:async()=> 'CLEAN'}),/IMAGE_TOO_LARGE/);
  await assert.rejects(readId(Buffer.from('invalid'),'image/jpeg',{scanFile:async()=> 'CLEAN'}),/INVALID_DOCUMENT/);
  await assert.rejects(runTool('sleep',['5'],{timeout:20}),/READ_TIMEOUT/);
});

test('HTTP contract, auth, missing readiness, upload limits and infected OCR are truthful',{skip:process.env.SCANNER_TEST_NO_SOCKETS==='1'?'executor denies loopback listening; required in CI':false},async()=>{
  const secret='synthetic-scanner-test-secret-00000000';
  const server=createScannerServer({secret,scanFile:async()=> 'INFECTED',ready:async()=> {throw new Error('unavailable');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`, headers={Authorization:`Bearer ${secret}`,'Content-Type':'application/pdf'};
  try{
    assert.equal((await fetch(base+'/scan',{method:'POST',body:'test'})).status,401);
    assert.equal((await fetch(base+'/healthz',{headers})).status,503);
    const bytes=syntheticPdf(),sha256=createHash('sha256').update(bytes).digest('hex');
    const scanResult=await fetch(base+'/scan',{method:'POST',headers,body:bytes});assert.deepEqual(await scanResult.json(),{sha256,verdict:'INFECTED'});
    const readResult=await fetch(base+'/read-id',{method:'POST',headers,body:bytes});assert.equal(readResult.status,422);assert.deepEqual(await readResult.json(),{sha256,verdict:'INFECTED'});
    assert.equal((await fetch(base+'/read-id',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'test'})).status,415);
    assert.equal((await fetch(base+'/scan',{method:'POST',headers,body:Buffer.alloc(5*1024*1024+1)})).status,413);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('unavailable ClamAV fails closed',async()=>{await assert.rejects(scan(Buffer.from('synthetic'),{host:'127.0.0.1',port:1}),/SCAN_UNAVAILABLE|SCAN_TIMEOUT/);});
