import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadSchema,reviewSchema,scanVerdict,validSignature,digest } from '../src/evidence';
const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic document');
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
 const input={decision:'VERIFIED',note:'Synthetic review',documentSubtype:'ID_COPY',documentDate:null,certificationConfirmed:true,contentConfirmed:true};
 assert.equal(reviewSchema.safeParse(input).success,true);
 assert.equal(reviewSchema.safeParse({...input,malware_status:'CLEAN'}).success,false);
 assert.equal(reviewSchema.safeParse({...input,reviewed_by:'another-person'}).success,false);
});
